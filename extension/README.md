# Cyclone DSA Capture extension

This Manifest V3 extension records a LeetCode attempt and produces two downloads. The raw ZIP in `Downloads/Cyclone/Sessions` contains `session.json`, `events.jsonl`, and `audio.webm`. The report ZIP in `Downloads/Cyclone/Reports` contains `README.md` and `timeline.json`. Open the report ZIP and take `README.md` to your own coaching model.

## Build and load

From this directory:

```sh
bun install --frozen-lockfile
bun run build
bun run typecheck
```

For agent-managed development, use Chrome DevTools MCP `install_extension` with the absolute path to `dist`. After edits, rebuild and call `reload_extension` with the extension ID. Call `trigger_extension_action` to exercise the popup and inspect the browser to verify behavior. The MCP extension category must be enabled. This follows [Chrome's official AI agent development workflow](https://developer.chrome.com/docs/devtools/agents/extensions); no Store submission or manual extensions-menu interaction is needed. The connected test browser is separate from your personal Chrome profile.

Open a LeetCode problem in the test browser and start from the extension popup or press **Alt+Shift+R**. On the first attempt, Cyclone opens a full extension tab for Chrome's microphone prompt. Click **Request microphone access** and choose **Allow while visiting the site**. Cyclone closes that tab before returning to LeetCode and starting the hidden recorder. **Allow this time** expires when the tab closes and cannot support recording without that tab.

For the current developer test, `bun run package:friends` creates an unpacked-extension bundle under `.outputs/`. Each push to `main` builds an immutable developer prerelease on GitHub with the commit ID in its tag and ZIP filename. Friends with access to this private repository can download it from Releases, unzip it, and install the contained `extension` folder, or use a local agent with Chrome DevTools extension tools. An installed unpacked extension does not update itself: replace its files and reload it to use a new commit. See `FRIENDS.md` for onboarding. The older unlisted Store draft is recorded in [CHROMEWEBSTORE.md](../CHROMEWEBSTORE.md) but is not the active release path.

The repository includes [a Cyclone update skill](../.agents/skills/cyclone-update/SKILL.md), also copied into the friends ZIP as `UPDATE-SKILL.md`, so a friend's agent can perform and verify that update.

Stop from the popup or shortcut, or press **Submit** on LeetCode. Cyclone saves a visible result when one appears, then ends the recording; a 30-second alarm ends it if no result appears. The raw ZIP downloads first. The `ASR` badge stays visible while the report is created, and the popup shows its progress state. Wait for that badge to clear before starting another attempt.

The popup lets users choose Base English, Small English (default), experimental Medium English, or experimental Large V3 Turbo for local transcription. The first report with a model needs internet access to download its weights. The model and ONNX runtime run in the extension on the user's machine; Base English is used if a larger model fails to load. The report records the requested and actual model. The raw audio is not uploaded. Since 0.3.0, completed report ZIPs, including code and transcript, upload privately to Supabase after the user agrees in the popup. Upload failures are retried from browser storage. Later uses can load cached model weights. If WebGPU is unavailable or transcription fails, the report still contains code and actions and explains why speech is missing. Python, uv, and a LaunchAgent are not needed.

After rebuilding and reloading an already installed extension, reload the LeetCode problem tab when it is safe to do so. Chrome does not replace content scripts already running on a page. If the shortcut fails to start, the extension shows `!` on its toolbar icon and the popup displays the error.

## Checks

Run `bun run smoke` for an isolated headless Chromium capture using a fake microphone and a LeetCode-shaped fixture. It checks both downloads, decodable Opus audio, the raw ZIP hash in the report, transcription failure fallback, and stop/Submit races. Set `CYCLONE_REAL_MIC=1` to use the default microphone in that isolated profile. It does not touch your normal Chrome tabs. The test needs Playwright's Chromium (`bunx playwright install chromium`) and `ffprobe` on `PATH`.

Agents can use this automated Chromium path for routine development checks without asking the developer to load or reload an extension by hand. `bun run screenshot:store` builds the extension and captures its real recording indicator on an isolated demo problem page for the Store listing. A live signed-in LeetCode test still needs the developer's browser; check that no recording is in progress before reloading its extension or problem tab.

To exercise the actual offscreen WebGPU path against an existing raw session ZIP, run after building:

```sh
CYCLONE_SAMPLE_ZIP=/absolute/path/to/session.zip node scripts/webgpu-smoke.mjs
```

That test uses a separate headed Chromium profile, downloads model weights, and removes the temporary profile afterward. It loads the saved recording into the same IndexedDB format used by live capture, then checks that the report has timed speech through the end of the session.

For a manual first attempt, check that the toolbar shows `REC` after a nonempty microphone chunk, speak while changing code, and Run or Submit once if available. Confirm the raw ZIP under `Sessions` contains playable audio and increasing event `tMs` values. Once `ASR` clears, open the report ZIP and check that speech and code appear in time order. The editor adapter reads the visible `textarea[aria-label="Code editor"]` every 750 ms. LeetCode can change its page structure, so a real attempt remains useful validation.
