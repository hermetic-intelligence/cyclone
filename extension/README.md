# Cyclone DSA Capture extension

This Manifest V3 extension captures a LeetCode attempt locally. It records microphone audio, snapshots the visible problem statement and editor, notes Run and Submit clicks, and saves one ZIP containing `session.json`, `events.jsonl`, and `audio.webm` under Chrome's `Downloads/Cyclone` folder.

## Build and load

From this directory, run:

```sh
bun install --frozen-lockfile
bun run build
```

The Bun lockfile is `bun.lock`. Run `bun run typecheck` to check the TypeScript source.

Run `bun run smoke` for a separate headless Chromium check. It uses a fake microphone and a small LeetCode-shaped fixture, then confirms that a ZIP was downloaded with editor events and decodable Opus WebM audio. Set `CYCLONE_REAL_MIC=1` to use the default microphone in the isolated Chromium profile. This does not touch your normal Chrome profile or tabs. The first run needs Playwright's Chromium (`bunx playwright install chromium`) and `ffprobe` on `PATH`.

In Chrome, open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select the generated `dist` directory. Open a LeetCode problem, then start from the extension popup or press **Alt+Shift+R**. On the first attempt, Cyclone opens a full extension tab so Chrome can ask for microphone access. Click **Request microphone access** there and choose **Allow while visiting the site** in Chrome’s prompt. Cyclone closes the permission tab before returning to LeetCode and starting the hidden recorder. **Allow this time** expires when that tab closes, so it cannot support tab-free recording. Stop from the same popup or shortcut to assemble and download the ZIP.

After rebuilding and reloading an already installed extension, reload the LeetCode problem tab when it is safe to do so. Chrome does not replace content scripts already running in an open page. If the shortcut fails to start, the extension shows `!` on its toolbar icon and the popup displays the error.

## Manual first-attempt check

On a LeetCode problem page, confirm the extension can read the current editor and language, grant microphone access, and check that the toolbar icon shows `REC`. Cyclone waits for a nonempty microphone chunk before showing `REC`, while retaining the clock origin from immediately before the recorder started. Speak while making a few edits; Run or Submit once if available. Stop and inspect the ZIP in Chrome's `Downloads/Cyclone` folder: it should contain the three files above, `session.json` should contain `problemStatement` when the page exposes it, code events should carry increasing `tMs`, and audio should play as WebM. Outcome labels are included only when the page visibly changes to a recognized result; an unobserved result is omitted.

The editor adapter uses the visible `textarea[aria-label="Code editor"]` value with a 750 ms poll. If Chrome has already blocked microphone access, the permission tab explains where to check Chrome and macOS microphone settings.
