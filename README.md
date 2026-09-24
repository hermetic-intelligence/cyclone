# Cyclone

Cyclone is a small, local recorder for LeetCode practice. A Chrome extension captures microphone audio, the problem statement, code states, and observed Run/Submit events. A separate Python command turns the export into synchronized speech and code episodes, plus a readable debug timeline.

## Capture stack

The extension uses Bun to install dependencies and run its TypeScript/esbuild build for Chrome Manifest V3. A content script reads the visible LeetCode code editor, a service worker handles the shortcut, and an offscreen document records microphone audio with `MediaRecorder`. Audio chunks and events are written to IndexedDB during the session. The extension exports a ZIP on stop; it makes no network requests.

The ZIP contains `session.json` for problem and session metadata, including a snapshot of the rendered statement when available; `events.jsonl` for timestamped `code`, `run`, and `submit` events; and `audio.webm`. Event `tMs` values and audio timestamps share the origin immediately before microphone recording begins. Results are included only when the page visibly exposes them.

## Try it

Build and load the extension using [extension/README.md](extension/README.md). On a LeetCode problem, use **Alt+Shift+R** or the extension popup to start and stop. On first use, a full extension tab asks for lasting microphone access and closes before recording begins. The red `REC` badge indicates an active session. Pressing **Submit** also ends the session after its visible result appears, or after 30 seconds if none appears. Either finish path saves a ZIP under Chrome's `Downloads/Cyclone` folder. With the local processor installed, the ZIP is transcribed and reported automatically.

Process an export:

```sh
uv run --project processor --locked python processor/process_session.py /path/to/cyclone-session.zip -o session-analysis
```

This produces `analysis.json`, `agent.json`, `agent.md`, and `report.md`. `agent.json` and `agent.md` group nearby speech, code changes, and Run/Submit actions into episodes. For local batch transcription, install `faster-whisper` and add `--transcribe`. To process future ZIPs automatically after a session ends, install the per-user macOS processor described in [processor/README.md](processor/README.md). Without transcription, episodes still contain code and actions. The raw ZIP remains the source of truth.

## Current validation boundary

The extension build and processor tests check the code and export contract. Reading the visible editor textarea was verified on a live, unauthenticated LeetCode Two Sum page. A real Chrome attempt produced a decodable WebM spanning the six-minute session, 77 code events, and a local transcript. Speech recognition made some mistakes, but the original audio remains in the export. A synthetic Chromium page now checks Submit-triggered export and manual-stop races; a logged-in LeetCode Submit has not yet been exercised. LeetCode can change its editor DOM, so real attempts remain useful integration checks.
