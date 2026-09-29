# Cyclone

Cyclone records LeetCode practice and prepares a local report. The Chrome extension captures microphone audio, the problem statement, code states, and observed Run/Submit events. After capture, it transcribes speech on the user's machine with WebGPU and presents speech, code snapshots, and actions in time order. Cyclone does not call a coaching model; the user can bring the report's `README.md` to one of their own.

## Capture and report

The extension uses a content script for the visible LeetCode editor, a service worker for the shortcut and downloads, and an offscreen document for microphone recording and report creation. Audio chunks and events are written to IndexedDB during capture. On stop, Cyclone first downloads a raw ZIP under `Downloads/Cyclone/Sessions` containing `session.json`, `events.jsonl`, and `audio.webm`. The recording and event clock share the same start time. Run/Submit results appear only when the page visibly exposes them.

The `ASR` badge appears while the offscreen document prepares a second ZIP under `Downloads/Cyclone/Reports`. That ZIP contains `README.md`, the main chronological account to share with a coaching model, and `timeline.json`, the complete captured event and timed transcript record. The raw ZIP remains the source of truth and its SHA-256 is recorded in the report. A WebGPU or model failure still produces a report with code and actions plus a visible transcription warning.

Cyclone offers Base English, Small English, experimental Medium English, and experimental Large V3 Turbo for local transcription; Small is the default. Model weights download from Hugging Face on first use and are cached by the browser. In the current test build, Cyclone uploads completed report ZIPs, including code and transcript, to private Supabase storage after the user agrees in the popup. Raw audio stays local. See [extension/README.md](extension/README.md) for development and checks. The old Python processor and macOS watcher have been retired. The unlisted 0.2.0 Chrome Web Store submission remains pending review, but the current friend build is distributed as an unpacked extension; [CHROMEWEBSTORE.md](CHROMEWEBSTORE.md) records that older submission.

Developer builds are published as commit-tagged prereleases when `main` is pushed. A friend with access to this private repository can ask their agent to follow [the Cyclone update skill](.agents/skills/cyclone-update/SKILL.md) to fetch, install, or update the unpacked extension. The skill is also included in each friends ZIP.

## Validation boundary

A real Chrome Two Sum attempt produced a decodable six-minute WebM and 77 code events. In an isolated Chromium profile, Cyclone's offscreen WebGPU path transcribed that saved recording into 32 timed segments ending at 6m22s. The fake-microphone smoke test checks raw export, report fallback, Submit-triggered export, and manual-stop races. A logged-in LeetCode Submit and model quality on friends' machines have not yet been exercised. Speech recognition can mishear coding terms, so the raw audio remains available for checking exact words.
