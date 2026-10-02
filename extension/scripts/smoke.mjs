import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile, readFile, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import assert from "node:assert/strict";

const builtExtension = resolve(import.meta.dirname, "../dist");
const realMic = process.env.CYCLONE_REAL_MIC === "1";
const liveUpload = process.env.CYCLONE_TEST_UPLOAD === "1";
const profile = await mkdtemp(resolve(tmpdir(), "cyclone-smoke-"));
let context;

try {
  const extension = resolve(profile, "test-extension");
  await cp(builtExtension, extension, { recursive: true });
  if (!liveUpload) {
    // Offscreen documents are not normal Playwright pages. Instrument a temporary
    // COPY only; never put test mocks into the distributable extension/dist.
    const payload = Buffer.from(JSON.stringify({ sub: "00000000-0000-0000-0000-000000000001", exp: Math.floor(Date.now() / 1000) + 3600, role: "authenticated", aud: "authenticated" })).toString("base64url");
    const session = { access_token: `eyJhbGciOiJIUzI1NiJ9.${payload}.c3ludGhldGlj`, refresh_token: "synthetic", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: "00000000-0000-0000-0000-000000000001", aud: "authenticated" } };
    const prefix = `localStorage.setItem("sb-dalyamgpwkllgwwfywpq-auth-token", ${JSON.stringify(JSON.stringify(session))});
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  if (String(input).endsWith("/functions/v1/transcribe")) {
    const bytes = new Uint8Array(init.body); const view = new DataView(bytes.buffer);
    if (new TextDecoder().decode(bytes.slice(0,4)) !== "RIFF" || view.getUint32(24,true) !== 16000 || bytes.length > 640044) throw new Error("Bad passage WAV");
    return localStorage.getItem("smokeExhausted") ? Response.json({error:"Experiment allowance exhausted"},{status:402}) : Response.json({text:"I can use a lookup table.",model:"gpt-transcribe"});
  }
  return originalFetch(input, init);
};\n`;
    const offscreen = resolve(extension, "offscreen.js");
    await writeFile(offscreen, prefix + await readFile(offscreen, "utf8"));
  }
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    acceptDownloads: true,
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
      ...liveUpload ? [] : ["--proxy-server=127.0.0.1:1"],
      ...realMic ? ["--use-fake-ui-for-media-stream"] : ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"]
    ]
  });

  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  const extensionId = new URL(worker.url()).host;
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.evaluate(async () => {
    const cache = await caches.open("transformers-cache");
    await cache.put("https://huggingface.co/onnx-community/whisper-small.en/resolve/main/config.json", new Response("old model"));
    await cache.put("https://example.com/keep", new Response("unrelated"));
  });
  await popup.getByRole("button", { name: "Remove old model downloads" }).click();
  await popup.getByRole("button", { name: "Removed 1 old model files" }).waitFor();
  const keptCache = await popup.evaluate(async () => (await (await caches.open("transformers-cache")).keys()).map(key => key.url));
  assert.deepEqual(keptCache, ["https://example.com/keep"]);
  const page = await context.newPage();
  await page.route("https://leetcode.com/problems/cyclone-smoke/**", async (route) => {
    await route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><title>Cyclone smoke</title><h1>Test problem</h1><div data-track-load="description_content">Given an integer, return its square.</div><button>Python3</button><button>Run</button><button data-e2e-locator="console-submit-button">Submit</button><div data-e2e-locator="submission-result"></div><textarea aria-label="Code editor">print(1)</textarea>'
    });
  });
  await page.goto("https://leetcode.com/problems/cyclone-smoke/");
  await context.setOffline(true);
  await page.bringToFront();

  const priorConsent = await popup.evaluate(async () => {
    await chrome.storage.local.set({ reportUploadConsent: true });
    return chrome.runtime.sendMessage({ type: "get-status" });
  });
  assert.equal(priorConsent.uploadConsent, false, "old local-only consent must not authorize audio uploads");
  const consent = await popup.evaluate(() => chrome.runtime.sendMessage({ type: "agree-upload" }));
  assert.equal(consent?.ok, true);
  const requestedModel = "gpt-transcribe";
  const start = await popup.evaluate(() => chrome.runtime.sendMessage({ type: "toggle" }));
  const startReturnedAtMs = Date.now();
  assert.equal(start?.ok, true, `start failed: ${JSON.stringify(start)}`);
  await page.locator("#cyclone-capture-status").getByText("Cyclone recording").waitFor();
  assert.equal(await worker.evaluate(() => chrome.action.getBadgeText({})), "REC");
  assert.equal((await popup.evaluate(() => chrome.runtime.sendMessage({ type: "clear-legacy-models" }))).ok, false);

  await page.locator('textarea[aria-label="Code editor"]').fill("print(2)");
  await popup.bringToFront();
  await page.waitForTimeout(6200);
  await page.bringToFront();
  await page.getByRole("button", { name: "Submit" }).click();
  await page.waitForTimeout(200);
  await page.locator("[data-e2e-locator='submission-result']").evaluate((element) => { element.textContent = "Accepted"; });
  await popup.bringToFront();
  const firstDownloads = await waitForCompletedDownloads(popup, page, 2);
  const raw = firstDownloads.find((item) => zipEntries(item.filename).includes("audio.webm"));
  const reportZip = firstDownloads.find((item) => zipEntries(item.filename).includes("timeline.json"));
  assert.ok(raw && reportZip, `Submit did not save raw and report ZIPs: ${JSON.stringify(firstDownloads)}`);
  const archive = raw.filename;
  const agent = execFileSync("unzip", ["-p", reportZip.filename, "README.md"], { encoding: "utf8" });
  const analysis = JSON.parse(execFileSync("unzip", ["-p", reportZip.filename, "timeline.json"], { encoding: "utf8" }));
  assert.equal(analysis.transcription.requestedModel, requestedModel);
  assert.match(agent, /Given an integer, return its square\./);
  assert.equal(analysis.source.sha256, hashFile(archive));
  assert.match(analysis.source.path, /^Cyclone\/Sessions\/cyclone-/);
  if (!liveUpload) {
    assert.equal(analysis.transcription.status, "complete", analysis.transcriptionWarning);
    assert.equal(analysis.transcription.timing, "audio-passage-intervals");
    assert.match(agent, /I can use a lookup table/);
    assert.match(agent, /not word timestamps/);
  }
  await page.waitForTimeout(1000);
  const completed = await popup.evaluate(() => chrome.downloads.search({ state: "complete" }));
  assert.equal(completed.length, 2, "Submit/result caused duplicate ZIP exports");
  const retainedUploads = await popup.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const opening = indexedDB.open("cyclone-capture", 2);
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => reject(opening.error);
    });
    const read = (store) => new Promise((resolve, reject) => {
      const request = db.transaction(store, "readonly").objectStore(store).getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return { uploads: (await read("uploads")).length, sessions: (await read("sessions")).length };
  });
  if (!liveUpload) assert.deepEqual(retainedUploads, { uploads: 1, sessions: 0 }, "offline upload must survive raw-session cleanup");
  const alarmsAfterResult = await worker.evaluate(() => chrome.alarms.getAll());
  assert.ok(!alarmsAfterResult.some(({ name }) => name.startsWith("cyclone-submit-")), "result-driven stop should clear its fallback alarm");
  const audio = execFileSync("unzip", ["-p", archive, "audio.webm"]);
  assert.ok(audio.length > 0, "audio.webm is empty");
  assert.equal(audio.subarray(0, 4).toString("hex"), "1a45dfa3", "audio.webm is not WebM");
  const audioPath = resolve(profile, "audio.webm");
  await writeFile(audioPath, audio);
  const codec = execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_name", "-of", "default=noprint_wrappers=1:nokey=1", audioPath], { encoding: "utf8" }).trim();
  assert.equal(codec, "opus", "audio.webm is not decodable Opus audio");
  const packetTimes = execFileSync("ffprobe", ["-v", "error", "-show_entries", "packet=pts_time", "-of", "csv=p=0", audioPath], { encoding: "utf8" }).trim().split("\n").map(Number);
  assert.ok(Math.max(...packetTimes) >= 6, `audio covers only ${Math.max(...packetTimes)} seconds`);
  const session = JSON.parse(execFileSync("unzip", ["-p", archive, "session.json"], { encoding: "utf8" }));
  const events = execFileSync("unzip", ["-p", archive, "events.jsonl"], { encoding: "utf8" });
  assert.equal(session.title, "Test problem");
  assert.equal(session.problemStatement, "Given an integer, return its square.");
  assert.ok(startReturnedAtMs - Date.parse(session.startedAt) >= 500,
    "session clock must start before waiting for the first microphone chunk");
  assert.match(events, /print\(2\)/);
  assert.match(events, /"type":"submit"/);
  assert.match(events, /"result":"Accepted"/);

  if (!liveUpload) await popup.evaluate(() => localStorage.setItem("smokeExhausted", "true"));
  // A manual stop while a Submit result is pending must cancel its timeout.
  const changedModel = await popup.evaluate(() => chrome.runtime.sendMessage({
    type: "set-transcription-model", model: "gpt-transcribe"
  }));
  assert.equal(changedModel?.ok, true);
  await page.bringToFront();
  await popup.evaluate(() => chrome.runtime.sendMessage({ type: "toggle" }));
  await page.locator("#cyclone-capture-status").getByText("Cyclone recording").waitFor();
  await page.waitForTimeout(6200);
  await page.bringToFront();
  await page.getByRole("button", { name: "Submit" }).click();
  await page.waitForTimeout(300);
  const alarmsWhilePending = await worker.evaluate(async () => {
    const names = (await chrome.alarms.getAll()).map(({ name }) => name);
    return names.filter((name) => name.startsWith("cyclone-submit-"));
  });
  assert.equal(alarmsWhilePending.length, 1, "Submit should schedule a session-scoped automatic-stop fallback");
  const alarm = alarmsWhilePending[0];
  const stop = await popup.evaluate(() => chrome.runtime.sendMessage({ type: "toggle" }));
  assert.equal(stop?.ok, true, `stop failed: ${JSON.stringify(stop)}`);
  await waitForCompletedDownloads(popup, page, 4);
  if (!liveUpload) {
    const exports = await popup.evaluate(() => chrome.downloads.search({ state: "complete" }));
    const latestReport = exports.filter(item => zipEntries(item.filename).includes("timeline.json")).sort((a, b) => b.id - a.id)[0];
    const failed = JSON.parse(execFileSync("unzip", ["-p", latestReport.filename, "timeline.json"], { encoding: "utf8" }));
    assert.equal(failed.transcription.status, "failed");
    assert.match(failed.transcriptionWarning, /Experiment allowance exhausted/);
  }
  const alarmsAfterManualStop = await worker.evaluate(() => chrome.alarms.getAll());
  assert.ok(!alarmsAfterManualStop.some(({ name }) => name === alarm), "manual stop should cancel the pending Submit alarm");
  await page.locator("[data-e2e-locator='submission-result']").evaluate((element) => { element.textContent = "Wrong Answer"; });
  await page.waitForTimeout(1000);
  const allDownloads = await popup.evaluate(() => chrome.downloads.search({ state: "complete" }));
  assert.equal(allDownloads.length, 4, "manual stop followed by a delayed result caused a duplicate export");
  if (liveUpload) {
    await context.setOffline(false);
    await popup.evaluate(() => chrome.runtime.sendMessage({ type: "offscreen-upload-pending" }));
    await popup.waitForFunction(async () => {
      const data = await chrome.storage.local.get("reportUploadStatus");
      return data.reportUploadStatus?.status === "saved";
    }, undefined, { timeout: 30000 });
    const auth = await popup.evaluate(() => JSON.parse(localStorage.getItem("sb-dalyamgpwkllgwwfywpq-auth-token")));
    assert.ok(auth?.access_token && auth?.refresh_token, "anonymous upload session was not saved");
    const { createClient } = await import("@supabase/supabase-js");
    const client = createClient("https://dalyamgpwkllgwwfywpq.supabase.co", "sb_publishable_15b21h1aMNKJohsGZzhY-w_SKHTE2v_", { auth: { persistSession: false } });
    const restored = await client.auth.setSession({ access_token: auth.access_token, refresh_token: auth.refresh_token });
    assert.ifError(restored.error);
    const { data: stored, error: listError } = await client.storage.from("reports").list(auth.user.id);
    assert.ifError(listError);
    assert.equal(stored.length, 2, "the extension did not upload both synthetic reports");
    const removed = await client.storage.from("reports").remove(stored.map((file) => `${auth.user.id}/${file.name}`));
    assert.ifError(removed.error);
  }
  console.log(`${realMic ? "Real mic" : "Fake mic"} capture smoke passed: decodable Opus, separate local report with raw ZIP hash, mocked hosted ASR success and allowance exhaustion, old consent reset, safe model cleanup, Submit/result and manual stop without duplicate exports.`);
} finally {
  await context?.close();
  await rm(profile, { recursive: true, force: true });
}

async function waitForCompletedDownloads(popup, page, count) {
  for (let attempt = 0; attempt < 80; attempt++) {
    const items = await popup.evaluate(() => chrome.downloads.search({}));
    const interrupted = items.find((item) => item.state === "interrupted");
    if (interrupted) throw new Error(`Download interrupted: ${interrupted.error}`);
    const complete = items.filter((item) => item.state === "complete");
    if (complete.length >= count) return complete;
    await page.waitForTimeout(250);
  }
  throw new Error(`Expected ${count} downloads: ${JSON.stringify(await popup.evaluate(() => chrome.downloads.search({})))}`);
}

function hashFile(path) {
  return execFileSync("shasum", ["-a", "256", path], { encoding: "utf8" }).split(" ")[0];
}

function zipEntries(path) {
  return execFileSync("unzip", ["-Z1", path], { encoding: "utf8" }).trim().split("\n");
}
