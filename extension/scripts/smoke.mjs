import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import assert from "node:assert/strict";

const extension = resolve(import.meta.dirname, "../dist");
const realMic = process.env.CYCLONE_REAL_MIC === "1";
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
      ...realMic ? ["--use-fake-ui-for-media-stream"] : ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"]
    ]
  });

  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  const extensionId = new URL(worker.url()).host;
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  const page = await context.newPage();
  await page.route("https://leetcode.com/problems/cyclone-smoke/**", async (route) => {
    await route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><title>Cyclone smoke</title><h1>Test problem</h1><div data-track-load="description_content">Given an integer, return its square.</div><button>Python3</button><textarea aria-label="Code editor">print(1)</textarea>'
    });
  });
  await page.goto("https://leetcode.com/problems/cyclone-smoke/");
  await page.bringToFront();

  const start = await popup.evaluate(() => chrome.runtime.sendMessage({ type: "toggle" }));
  const startReturnedAtMs = Date.now();
  assert.equal(start?.ok, true, `start failed: ${JSON.stringify(start)}`);
  await page.locator("#cyclone-capture-status").getByText("Cyclone recording").waitFor();
  assert.equal(await worker.evaluate(() => chrome.action.getBadgeText({})), "REC");

  await page.locator('textarea[aria-label="Code editor"]').fill("print(2)");
  await popup.bringToFront();
  await page.waitForTimeout(6200);
  await page.bringToFront();
  const stop = await popup.evaluate(() => chrome.runtime.sendMessage({ type: "toggle" }));
  assert.equal(stop?.ok, true, `stop failed: ${JSON.stringify(stop)}`);
  let download;
  for (let attempt = 0; attempt < 40; attempt++) {
    const [item] = await popup.evaluate(() => chrome.downloads.search({ orderBy: ["-startTime"], limit: 1 }));
    if (item?.state === "complete") { download = item; break; }
    if (item?.state === "interrupted") throw new Error(`Download interrupted: ${item.error}`);
    await page.waitForTimeout(250);
  }
  assert.ok(download, `ZIP was not saved: ${JSON.stringify(await popup.evaluate(() => chrome.downloads.search({})))}`);
  const archive = download.filename;
  const audio = execFileSync("unzip", ["-p", archive, "audio.webm"]);
  assert.ok(audio.length > 0, "audio.webm is empty");
  assert.equal(audio.subarray(0, 4).toString("hex"), "1a45dfa3", "audio.webm is not WebM");
  const codec = execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_name", "-of", "default=noprint_wrappers=1:nokey=1", "pipe:0"], { input: audio, encoding: "utf8" }).trim();
  assert.equal(codec, "opus", "audio.webm is not decodable Opus audio");
  const packetTimes = execFileSync("ffprobe", ["-v", "error", "-show_entries", "packet=pts_time", "-of", "csv=p=0", "pipe:0"], { input: audio, encoding: "utf8" }).trim().split("\n").map(Number);
  assert.ok(Math.max(...packetTimes) >= 6, `audio covers only ${Math.max(...packetTimes)} seconds`);
  const session = JSON.parse(execFileSync("unzip", ["-p", archive, "session.json"], { encoding: "utf8" }));
  const events = execFileSync("unzip", ["-p", archive, "events.jsonl"], { encoding: "utf8" });
  assert.equal(session.title, "Test problem");
  assert.equal(session.problemStatement, "Given an integer, return its square.");
  assert.ok(startReturnedAtMs - Date.parse(session.startedAt) >= 500,
    "session clock must start before waiting for the first microphone chunk");
  assert.match(events, /print\(2\)/);
  console.log(`${realMic ? "Real mic" : "Fake mic"} capture smoke passed: ${audio.length} audio bytes, decodable Opus WebM, editor events, automatic ZIP download.`);
} finally {
  await context?.close();
  await rm(profile, { recursive: true, force: true });
}
