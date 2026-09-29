import { chromium } from "playwright";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import assert from "node:assert/strict";

const archive = process.env.CYCLONE_SAMPLE_ZIP;
if (!archive) throw new Error("Set CYCLONE_SAMPLE_ZIP to an existing Cyclone raw session ZIP.");
const model = process.env.CYCLONE_MODEL ?? "onnx-community/whisper-small.en";
const minDurationMs = Number(process.env.CYCLONE_MIN_DURATION_MS ?? 300000);
const extension = resolve(import.meta.dirname, "../dist");
const profile = await mkdtemp(resolve(tmpdir(), "cyclone-webgpu-"));
let context;

try {
  const archiveBytes = await readFile(archive);
  const metadata = JSON.parse(execFileSync("unzip", ["-p", archive, "session.json"], { encoding: "utf8" }));
  const events = execFileSync("unzip", ["-p", archive, "events.jsonl"], { encoding: "utf8" }).trim().split("\n").filter(Boolean).map(JSON.parse);
  const audio = execFileSync("unzip", ["-p", archive, "audio.webm"], { maxBuffer: 50 * 1024 * 1024 });
  const sourceHash = createHash("sha256").update(archiveBytes).digest("hex");
  assert.ok(metadata.sessionId && metadata.endedAt && audio.length > 0);

  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: false,
    acceptDownloads: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, "--enable-unsafe-webgpu"]
  });
  await context.route("https://dalyamgpwkllgwwfywpq.supabase.co/**", (route) => route.abort());
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  const extensionId = new URL(worker.url()).host;
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await worker.evaluate(async () => {
    const url = chrome.runtime.getURL("offscreen.html");
    const contexts = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"], documentUrls: [url] });
    if (!contexts.length) await chrome.offscreen.createDocument({
      url: "offscreen.html", reasons: ["BLOBS"], justification: "Check local report generation in the offscreen document."
    });
  });
  await page.evaluate(async ({ metadata, events, audioBase64, sourceHash, model }) => {
    const db = await new Promise((resolve, reject) => {
      const opening = indexedDB.open("cyclone-capture", 2);
      opening.onupgradeneeded = () => {
        if (!opening.result.objectStoreNames.contains("sessions")) opening.result.createObjectStore("sessions", { keyPath: "sessionId" });
        if (!opening.result.objectStoreNames.contains("chunks")) opening.result.createObjectStore("chunks", { keyPath: "id" });
        if (!opening.result.objectStoreNames.contains("uploads")) opening.result.createObjectStore("uploads", { keyPath: "sessionId" });
      };
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => reject(opening.error);
    });
    const bytes = Uint8Array.from(atob(audioBase64), (char) => char.charCodeAt(0));
    const tx = db.transaction(["sessions", "chunks"], "readwrite");
    tx.objectStore("sessions").put({ sessionId: metadata.sessionId, metadata, events, sourceHash });
    tx.objectStore("chunks").put({ id: `${metadata.sessionId}:0`, sessionId: metadata.sessionId, chunkIndex: 0,
      blob: new Blob([bytes], { type: "audio/webm" }) });
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
    db.close();
    await chrome.storage.local.set({ pendingReport: { sessionId: metadata.sessionId, sourceHash, sourcePath: "cyclone-webgpu-smoke.zip", rawComplete: true, transcriptionModel: model } });
  }, { metadata, events, audioBase64: audio.toString("base64"), sourceHash, model });
  const restored = await page.evaluate(({ sessionId, sourceHash }) => chrome.runtime.sendMessage({
    type: "offscreen-raw", sessionId, sourceHash
  }), { sessionId: metadata.sessionId, sourceHash });
  assert.equal(restored?.ok, true, JSON.stringify(restored));
  const restoredHash = await page.evaluate(async (url) => {
    const bytes = await (await fetch(url)).arrayBuffer();
    return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }, restored.url);
  assert.equal(restoredHash, sourceHash, "Restored raw ZIP differs from the original.");
  await page.evaluate((url) => chrome.runtime.sendMessage({ type: "offscreen-revoke", url }), restored.url);
  if (process.env.CYCLONE_RESTORE_ONLY === "1") {
    console.log(JSON.stringify({ sourceHashMatches: true, restoredRawZip: true }));
  } else {
  const response = await page.evaluate(({ sessionId, sourceHash, model }) => chrome.runtime.sendMessage({
    type: "offscreen-process", sessionId, sourceHash, sourcePath: "cyclone-webgpu-smoke.zip", model
  }), { sessionId: metadata.sessionId, sourceHash, model });
  assert.equal(response?.ok, true, JSON.stringify(response));

  let report;
  for (let attempt = 0; attempt < 480; attempt++) {
    const downloads = await page.evaluate(() => chrome.downloads.search({}));
    report = downloads.find((item) => item.state === "complete");
    if (report) break;
    const status = await page.evaluate(() => chrome.storage.local.get("lastCaptureError"));
    if (status.lastCaptureError) throw new Error(status.lastCaptureError);
    await page.waitForTimeout(1000);
  }
  assert.ok(report, "The offscreen document did not download a report within eight minutes.");
  const analysis = JSON.parse(execFileSync("unzip", ["-p", report.filename, "timeline.json"], { encoding: "utf8" }));
  assert.equal(analysis.source.sha256, sourceHash);
  assert.equal(analysis.transcription.requestedModel, model);
  assert.equal(analysis.transcriptionWarning, null, analysis.transcriptionWarning);
  assert.ok(analysis.transcript.length > 0);
  assert.ok(analysis.transcript.at(-1).endMs > minDurationMs, "Transcription did not reach the end of the session.");
  console.log(JSON.stringify({ model: analysis.transcription.model, fallbackReason: analysis.transcription.fallbackReason,
    segments: analysis.transcript.length, lastEndMs: analysis.transcript.at(-1).endMs,
    reportBytes: report.fileSize, sourceHashMatches: true }));
  }
} finally {
  await context?.close();
  await rm(profile, { recursive: true, force: true });
}
