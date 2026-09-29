# Cyclone

Cyclone captures a LeetCode practice attempt and makes a report you can take to your own coaching model. It records your microphone, code states, the problem statement, and visible Run/Submit results. Speech transcription runs locally in Chrome; Cyclone does not provide a coaching model.

## Use Cyclone

Cyclone currently needs desktop Chrome 120 or newer, a microphone, a LeetCode problem page, and a working WebGPU adapter for transcription. The first use of a speech model needs internet access to download its weights. Report upload also needs internet access. Leave room for model files, browser cache, and recording ZIPs. We have tested the local path on an Apple silicon Mac; there is no established minimum RAM or verified Windows/Linux support. Larger transcription models remain experimental.

For the friends test, get the newest `dev-*` prerelease from this private repository's [Releases page](https://github.com/e24z/cyclone/releases). Unzip `Cyclone-*-friends.zip`, read its `PRIVACY.md` and `LICENSE`, then load the contained `extension` folder as an unpacked extension in Chrome. Keep that folder in place. The first recording asks for microphone permission. Open the Cyclone popup on a LeetCode problem, choose a local speech model, agree to private report upload, and start. Stop in the popup or finish with Submit.

You can instead ask your agent to **“install or update Cyclone using `UPDATE-SKILL.md` in the download.”** The same [update skill](.agents/skills/cyclone-update/SKILL.md) ships with the repository. Each push to `main` creates a commit-tagged developer prerelease. An unpacked Chrome extension does not update itself: the agent must replace its files and reload it. Friends need access to this private repository to fetch releases.

| Download | Contents | Use |
| --- | --- | --- |
| `Cyclone/Sessions/*.zip` | `session.json`, `events.jsonl`, `audio.webm` | Original evidence; audio stays on your computer. |
| `Cyclone/Reports/*.zip` | `README.md`, `timeline.json` | Readable speech/code/action sequence and complete timed record. Bring `README.md` to your coach. |

The report ZIP, including code and speech transcript, uploads to private Cyclone storage after you agree in the popup. If transcription fails, the report still contains code and actions with a warning. See [PRIVACY.md](PRIVACY.md) for data handling. The software is [proprietary](LICENSE), with permission for invited testing and contribution.

## Develop

From `extension/`, run `bun install --frozen-lockfile`, `bun run build`, `bun run typecheck`, `bun run test:reports`, and `bun run smoke`. The smoke test uses an isolated Chromium profile with a fake microphone. Agents should handle development installation and reloads using the [workflow in AGENTS.md](AGENTS.md). `bun run package:friends` makes a local ZIP under `extension/.outputs/`.

Cyclone is useful as a standalone capture and report tool. Its raw ZIP and report are the boundary a future Cyclone service could consume. The old Python watcher and processor have been removed. The older unlisted Chrome Web Store 0.2.0 submission is still pending review outside this repository; it is not the current friends build.
