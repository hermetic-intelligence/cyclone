# Cyclone

Cyclone captures a LeetCode practice attempt and makes a report you can take to your own coaching model. It records your microphone, code states, the problem statement, and visible Run/Submit results. Speech transcription runs locally in Chrome; Cyclone does not provide a coaching model.

## Install and update

Paste this into an agent of your choice that can access your GitHub account and control Chrome:

```text
Install Cyclone from https://github.com/hermetic-intelligence/cyclone for me. Use the latest developer release and verify that it works in my Chrome profile.
```

Your agent can discover the repository's [install and update skill](.agents/skills/cyclone-install/SKILL.md) after cloning it. The skill uses the newest prebuilt `dev-*` prerelease; you do not need Bun or a local build. You do need access to this private repository. The first recording asks for microphone permission. Open the Cyclone popup on a LeetCode problem, choose a local speech model, agree to private report upload, and start. Stop in the popup or finish with Submit.

For an update, paste:

```text
Update my Cyclone extension from https://github.com/hermetic-intelligence/cyclone. Keep my current Chrome profile and verify the installed version.
```

Changes to the extension or its release workflow on `main` create a commit-tagged developer prerelease. README and skill edits alone do not create a new extension version. An unpacked Chrome extension does not update itself: ask your agent to update it when you want the newest build. The agent replaces the installed files and reloads the extension. If you want the skill available to your Codex agent outside this checkout, you may install the **skill alone** from the cloned repo with `npx skills add . --skill cyclone-install -g -a codex -y`. That optional command does not install Cyclone in Chrome.

If you are an agent asked to install or update this repository, read [the Cyclone install skill](.agents/skills/cyclone-install/SKILL.md) and handle the browser steps for the user.

Cyclone currently needs desktop Chrome 120 or newer, a microphone, a LeetCode problem page, and a working WebGPU adapter for transcription. The first use of a speech model needs internet access to download its weights. Report upload also needs internet access. Leave room for model files, browser cache, and recording ZIPs. We have tested the local path on an Apple silicon Mac; there is no established minimum RAM or verified Windows/Linux support. Larger transcription models remain experimental.

| Download | Contents | Use |
| --- | --- | --- |
| `Cyclone/Sessions/*.zip` | `session.json`, `events.jsonl`, `audio.webm` | Original evidence; audio stays on your computer. |
| `Cyclone/Reports/*.zip` | `README.md`, `timeline.json` | Readable speech/code/action sequence and complete timed record. Bring `README.md` to your coach. |

## Example report

Here is a short excerpt of the generated report's `README.md`, using an illustrative Two Sum attempt. It puts speech, code snapshots, and observed results in time order:

````markdown
# Two Sum

## Attempt in time order

### 00:00 Code

```python3
def twoSum(nums, target):
    pass
```

### 00:05 You said: I can use a lookup table.

### 00:09 Code

```python3
def twoSum(nums, target):
    seen = {}
    for i, x in enumerate(nums):
        seen[x] = i
        if target - x in seen:
            return [seen[target - x], i]
```

### 00:15 Run: Wrong Answer

### 00:18 You said: Let me check the complement.
````

The report also contains the problem statement and later events. Its `timeline.json` keeps the complete timed code and transcript; the separate raw ZIP keeps the original audio.

The report ZIP, including code and speech transcript, uploads to private Cyclone storage after you agree in the popup. If transcription fails, the report still contains code and actions with a warning. See [PRIVACY.md](PRIVACY.md) for data handling. The software is [proprietary](LICENSE), with permission for invited testing and contribution.

## Develop

From `extension/`, run `bun install --frozen-lockfile`, `bun run build`, `bun run typecheck`, `bun run test:reports`, and `bun run smoke`. The smoke test uses an isolated Chromium profile with a fake microphone. Agents should handle development installation and reloads using the [workflow in AGENTS.md](AGENTS.md). `bun run package:friends` makes a local ZIP under `extension/.outputs/`.

Cyclone is useful as a standalone capture and report tool. Its raw ZIP and report are the boundary a future Cyclone service could consume. The old Python watcher and processor have been removed. The older unlisted Chrome Web Store 0.2.0 submission is still pending review outside this repository; it is not the current friends build.
