import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import assert from "node:assert/strict";

const extension = resolve(import.meta.dirname, "../dist");
const realMic = process.env.CYCLONE_REAL_MIC === "1";
const liveUpload = process.env.CYCLONE_TEST_UPLOAD === "1";
const profile = await mkdtemp(resolve(tmpdir(), "cyclone-smoke-"));
let context;

try {
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
  await checkModelSettings(context, worker, popup, extensionId);
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

  const consent = await popup.evaluate(() => chrome.runtime.sendMessage({ type: "agree-upload" }));
  assert.equal(consent?.ok, true);
  const requestedModel = liveUpload ? "onnx-community/whisper-small.en" : "onnx-community/whisper-large-v3-turbo";
  await popup.locator("#model").selectOption(requestedModel);
  await popup.waitForFunction(async (model) => (await chrome.storage.local.get("transcriptionModel")).transcriptionModel === model,
    requestedModel);
  const start = await popup.evaluate(() => chrome.runtime.sendMessage({ type: "toggle" }));
  const startReturnedAtMs = Date.now();
  assert.equal(start?.ok, true, `start failed: ${JSON.stringify(start)}`);
  await page.locator("#cyclone-capture-status").getByText("Cyclone recording").waitFor();
  assert.equal(await worker.evaluate(() => chrome.action.getBadgeText({})), "REC");
  assert.equal((await popup.evaluate(() => chrome.runtime.sendMessage({ type: "remove-model-cache", model: null }))).ok, false);

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
    assert.equal(analysis.transcription.status, "failed");
    assert.match(analysis.transcriptionWarning, /Local transcription failed/);
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
  const audioPath = resolve(profile, "captured-audio.webm");
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

  // A manual stop while a Submit result is pending must cancel its timeout.
  const changedModel = await popup.evaluate(() => chrome.runtime.sendMessage({
    type: "set-transcription-model", model: "onnx-community/whisper-base.en"
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
  console.log(`${realMic ? "Real mic" : "Fake mic"} capture smoke passed: decodable Opus, separate local report with raw ZIP hash, ASR fallback, Submit/result and manual stop without duplicate exports.`);
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

async function checkModelSettings(context, worker, popup, extensionId) {
  const small = "https://huggingface.co/onnx-community/whisper-small.en/resolve/main/onnx/encoder_model.onnx";
  const base = "https://huggingface.co/onnx-community/whisper-base.en/resolve/main/config.json";
  await worker.evaluate(async ({ small, base }) => {
    const cache = await caches.open("transformers-cache");
    await cache.put(small, new Response("fixture", { headers: { "content-length": "7" } }));
    await cache.put(base, new Response("fixture"));
    await cache.put("https://example.com/keep", new Response("unrelated"));
    await (await caches.open("unrelated-cache")).put("https://example.com/keep", new Response("keep"));
  }, { small, base });
  const settings = await context.newPage();
  const errors = [];
  settings.on("pageerror", error => errors.push(error.message));
  await settings.goto(`chrome-extension://${extensionId}/settings.html`);
  await settings.getByRole("heading", { name: "Models and storage" }).waitFor();
  const smallRow = settings.locator("article").filter({ has: settings.locator("code", { hasText: "onnx-community/whisper-small.en" }) });
  await smallRow.getByText(/1 cached file/).waitFor();
  assert.match(await settings.locator("main").innerText(), /1 file has no size header/);
  await settings.locator("#model").selectOption("onnx-community/whisper-base.en");
  await settings.getByText("Model choice saved for your next attempt.").waitFor();
  await settings.reload();
  await settings.waitForFunction(() => document.querySelector("#model")?.value === "onnx-community/whisper-base.en");
  await popup.reload();
  await popup.waitForFunction(() => document.querySelector("#model")?.value === "onnx-community/whisper-base.en");
  await mkdir(resolve(import.meta.dirname, "../.outputs"), { recursive: true });
  await settings.screenshot({ path: resolve(import.meta.dirname, "../.outputs/model-settings-preview.png"), fullPage: true });
  await worker.evaluate(() => {
    globalThis.cacheLockHeld = false;
    void navigator.locks.request("cyclone-model-cache", { mode: "shared" }, async () => {
      globalThis.cacheLockHeld = true;
      await new Promise(resolve => { globalThis.releaseCacheLock = resolve; });
    });
  });
  for (let i = 0; i < 100 && !await worker.evaluate(() => globalThis.cacheLockHeld); i++) await settings.waitForTimeout(10);
  assert.equal(await worker.evaluate(() => globalThis.cacheLockHeld), true);
  const blocked = await popup.evaluate(() => chrome.runtime.sendMessage({ type: "remove-model-cache", model: null }));
  assert.equal(blocked.ok, false, "transcription must block deletion");
  assert.equal(await worker.evaluate(async small => Boolean(await (await caches.open("transformers-cache")).match(small)), small), true);
  await worker.evaluate(() => globalThis.releaseCacheLock());
  await settings.waitForTimeout(50);
  await smallRow.getByRole("button", { name: "Remove cached files" }).click();
  await smallRow.getByText("No cached files").waitFor();
  assert.equal(await worker.evaluate(async base => Boolean(await (await caches.open("transformers-cache")).match(base)), base), true);
  await settings.getByRole("button", { name: "Remove all model files" }).click();
  await settings.getByText(/Removed 1 cached file/).waitFor();
  const kept = await worker.evaluate(async () => ({
    urls: (await (await caches.open("transformers-cache")).keys()).map(key => key.url),
    other: Boolean(await (await caches.open("unrelated-cache")).match("https://example.com/keep"))
  }));
  assert.deepEqual(kept, { urls: ["https://example.com/keep"], other: true });
  assert.deepEqual(errors, [], "settings runtime errors");
  await settings.close();
  console.log("Model settings passed: persisted choice, inventory, targeted cleanup, unrelated cache preservation, transcription lock.");
}
