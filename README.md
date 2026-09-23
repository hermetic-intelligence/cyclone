# Cyclone

Cyclone is a small, local recorder for LeetCode practice. A Chrome extension captures microphone audio, code states, and observed Run/Submit events. A separate Python command turns the export into a readable timeline. The first goal is to record one real attempt and check whether the timeline faithfully reconstructs the work.

## Capture stack

The extension uses Bun to install dependencies and run its TypeScript/esbuild build for Chrome Manifest V3. A content script reads the visible LeetCode code editor, a service worker handles the shortcut, and an offscreen document records microphone audio with `MediaRecorder`. Audio chunks and events are written to IndexedDB during the session. The extension exports a ZIP on stop; it makes no network requests.

The ZIP contains `session.json` for problem and session metadata, `events.jsonl` for timestamped `code`, `run`, and `submit` events, and `audio.webm`. Event `tMs` values are milliseconds since microphone recording began. Results are included only when the page visibly exposes them.

## Try it

Build and load the extension using [extension/README.md](extension/README.md). On a LeetCode problem, use **Alt+Shift+R** or the extension popup to start and stop. The red `REC` badge indicates an active session. Stopping prompts you to save a ZIP.

Process an export:

```sh
uv run --project processor --locked python processor/process_session.py /path/to/cyclone-session.zip -o session-analysis
```

This produces `report.md` and `analysis.json`. For local batch transcription, install `faster-whisper` and add `--transcribe`; see [processor/README.md](processor/README.md). The raw ZIP remains the source of truth.

## Current validation boundary

The extension build and processor tests check the code and export contract. Reading the visible editor textarea was verified on a live, unauthenticated LeetCode Two Sum page. A complete recording with microphone permission and a logged-in Run/Submit flow still needs an actual Chrome trial. LeetCode can change its editor DOM, so the first real attempt is the intended integration check.
