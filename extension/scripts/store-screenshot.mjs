import { chromium } from "playwright";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const profile = await mkdtemp(resolve(tmpdir(), "cyclone-store-shot-"));
let context;
try {
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    viewport: { width: 1280, height: 800 },
    args: [
      `--disable-extensions-except=${resolve(root, "dist")}`,
      `--load-extension=${resolve(root, "dist")}`,
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream"
    ]
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  const extensionId = new URL(worker.url()).host;
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  const page = await context.newPage();
  await page.route("https://leetcode.com/problems/cyclone-store-demo/**", (route) => route.fulfill({
    contentType: "text/html",
    body: `<!doctype html><html lang="en"><meta charset="utf-8"><title>Pair Sum — demo practice problem</title>
      <style>
        *{box-sizing:border-box}body{margin:0;background:#f8fafc;color:#18202a;font:16px/1.5 system-ui,sans-serif}
        header{height:64px;background:#fff;border-bottom:1px solid #dbe2ea;display:flex;align-items:center;padding:0 36px;gap:22px}
        header strong{font-size:22px;color:#275dad}header span{color:#64748b;font-size:14px}
        main{display:grid;grid-template-columns:46% 54%;gap:20px;padding:24px 36px;height:calc(100vh - 64px)}
        section{background:#fff;border:1px solid #dbe2ea;border-radius:12px;padding:28px;overflow:hidden}
        .tag{color:#28725d;font-size:13px;font-weight:700;letter-spacing:.04em;text-transform:uppercase}
        h1{font-size:28px;margin:12px 0 20px}p{max-width:55ch}code{background:#edf2f7;padding:2px 5px;border-radius:4px}
        .example{background:#f2f6fb;border-radius:8px;padding:14px 18px;margin-top:26px}
        .toolbar{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;font-size:14px}
        button{border:0;background:#27745f;color:white;border-radius:7px;padding:9px 18px;font-weight:700}
        textarea{display:block;width:100%;height:490px;padding:20px;border:1px solid #dbe2ea;border-radius:8px;background:#101827;color:#dce9f9;font:17px/1.6 ui-monospace,SFMono-Regular,monospace;resize:none}
        .hint{font-size:13px;color:#64748b;margin-top:10px}
      </style>
      <header><strong>Practice problem</strong><span>Demo page for Cyclone capture</span></header>
      <main><section><div class="tag">Array · Easy</div><h1>Pair Sum</h1>
        <div data-track-load="description_content"><p>Given an array of integers and a target value, return the indices of two numbers whose sum is the target.</p>
        <p>Assume there is exactly one answer, and do not use the same element twice.</p>
        <div class="example"><strong>Example</strong><br><code>numbers = [2, 7, 11, 15]</code><br><code>target = 9</code><br>Output: <code>[0, 1]</code></div></div>
        <p class="hint">This is a demo problem page. Cyclone is shown recording with a test microphone.</p>
      </section><section><div class="toolbar"><span>Python3</span><button type="button">Run</button></div>
        <textarea aria-label="Code editor" spellcheck="false">def two_sum(numbers, target):\n    seen = {}\n    for index, value in enumerate(numbers):\n        needed = target - value\n        if needed in seen:\n            return [seen[needed], index]\n        seen[value] = index</textarea>
        <p class="hint">Talk through your approach while Cyclone records code changes and speech.</p>
      </section></main></html>`
  }));
  await page.goto("https://leetcode.com/problems/cyclone-store-demo/");
  await page.bringToFront();
  const started = await popup.evaluate(() => chrome.runtime.sendMessage({ type: "toggle" }));
  if (!started?.ok) throw new Error(`Capture did not start: ${JSON.stringify(started)}`);
  await page.locator("#cyclone-capture-status").getByText("Cyclone recording").waitFor();
  const output = resolve(root, "store-assets/screenshot-1.png");
  await page.screenshot({ path: output });
  console.log(output);
} finally {
  await context?.close();
  await rm(profile, { recursive: true, force: true });
}
