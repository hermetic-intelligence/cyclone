# Cyclone DSA Capture extension

This Manifest V3 extension captures a LeetCode attempt locally. It records microphone audio, snapshots the editor when its full text changes, notes Run and Submit clicks, and downloads one ZIP containing `session.json`, `events.jsonl`, and `audio.webm`.

## Build and load

From this directory, run:

```sh
bun install --frozen-lockfile
bun run build
```

The Bun lockfile is `bun.lock`. Run `bun run typecheck` to check the TypeScript source.

In Chrome, open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select the generated `dist` directory. Open a LeetCode problem, then start from the extension popup or press **Alt+Shift+R**. Chrome will ask for microphone access the first time. Stop from the same controls to assemble and download the ZIP.

## Manual first-attempt check

On a LeetCode problem page, confirm the extension can read the current editor and language, grant microphone access, and check that the toolbar icon shows `REC`. Speak while making a few edits; Run or Submit once if available. Stop and inspect the ZIP: it should contain the three files above, code events should carry increasing `tMs`, and audio should play as WebM. Outcome labels are included only when the page visibly changes to a recognized result; an unobserved result is omitted.

The editor adapter uses the visible `textarea[aria-label="Code editor"]` value with a 750 ms poll. The shortcut's failed-start detail is written to the extension service worker console; use the popup when you need to see a permission or setup error directly.
