# Cyclone

Cyclone captures a LeetCode practice attempt and makes a report you can take to your own coaching model. It records your microphone, code states, the problem statement, and visible Run/Submit results. Speech transcription uses OpenAI GPT-Transcribe through Cyclone’s server; Cyclone does not provide a coaching model.

## Install and update

Paste this into an agent of your choice that can download files and control Chrome. The repository and developer releases are public; no GitHub account, invitation, Bun installation, or local build is required.

```text
Install Cyclone from https://github.com/hermetic-intelligence/cyclone for me. Use the latest developer release and verify that it works in my Chrome profile.
```

Your agent can discover the repository's [install and update skill](.agents/skills/cyclone-install/SKILL.md) after cloning it. The skill uses the newest prebuilt `dev-*` prerelease. Chrome still needs to register the unpacked extension, and your agent needs browser control to handle that step. The first recording asks for microphone permission. Open the Cyclone popup on a LeetCode problem, agree to hosted audio transcription and private report upload, and start. Stop in the popup or finish with Submit.

For an update, paste:

```text
Update my Cyclone extension from https://github.com/hermetic-intelligence/cyclone. Keep my current Chrome profile and verify the installed version.
```

Changes to the extension or its release workflow on `main` create a commit-tagged developer prerelease. README and skill edits alone do not create a new extension version. An unpacked Chrome extension does not update itself: ask your agent to update it when you want the newest build. The agent replaces the installed files and reloads the extension. If you want the skill available to your Codex agent outside this checkout, you may install the **skill alone** from the cloned repo with `npx skills add . --skill cyclone-install -g -a codex -y`. That optional command does not install Cyclone in Chrome.

If you are an agent asked to install or update this repository, read [the Cyclone install skill](.agents/skills/cyclone-install/SKILL.md) and handle the browser steps for the user.

Cyclone currently needs desktop Chrome 120 or newer, a microphone, a LeetCode problem page, and internet access for transcription and report upload. It does not download or run speech models on your computer. If you used an older local build, **Remove old model downloads** in the popup clears its cached Hugging Face files without deleting recordings or reports. We have tested the capture path on an Apple silicon Mac; there is no verified Windows/Linux support yet.

Speech is transcribed in audio passages of up to twenty seconds. Their recording intervals are retained, but these are approximate passage times, not word timestamps. A passage may overlap several code changes. Cyclone’s server reserves a conservative estimated cost before each OpenAI request against a $2 total experiment allowance. This allowance does not reset monthly; the separate OpenAI project also has a $2 monthly enforced limit.

| Download | Contents | Use |
| --- | --- | --- |
| `Cyclone/Sessions/*.zip` | `session.json`, `events.jsonl`, `audio.webm` | Original recording saved locally; audio passages are sent for transcription. |
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

### 00:05 Speech through 00:08: I can use a lookup table.

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

### 00:18 Speech through 00:22: Let me check the complement.
````

The report also contains the problem statement and later events. Its `timeline.json` keeps the complete timed code and transcript; the separate raw ZIP keeps the original audio.

Audio passages and the problem title are sent through Cyclone’s server to OpenAI after you agree in the popup. The report ZIP, including code and speech transcript, uploads to private Cyclone storage after you agree in the popup. If transcription fails, the report still contains code and actions with a warning. See [PRIVACY.md](PRIVACY.md) for data handling. Cyclone’s software is open source under the [MIT license](LICENSE); this does not license your recordings, code, transcripts, or reports to others.

## Develop

From `extension/`, run `bun install --frozen-lockfile`, `bun run build`, `bun run typecheck`, `bun run test:reports`, and `bun run smoke`. The smoke test uses an isolated Chromium profile with a fake microphone. Agents should handle development installation and reloads using the [workflow in AGENTS.md](AGENTS.md). `bun run package:friends` makes a local ZIP under `extension/.outputs/`.

Cyclone is useful as a standalone capture and report tool. Its raw ZIP and report are the boundary a future Cyclone service could consume. The old Python watcher and processor have been removed. The older unlisted Chrome Web Store 0.2.0 submission is still pending review outside this repository; it is not the current friends build.

For hosted transcription development, `bun run test:transcription` from `extension/` checks passage timing, WAV validation, authentication and allowance handling with mocked OpenAI responses. Deploy `supabase/functions/transcribe` and its migration to the Cyclone Supabase project; configure the server secret `OPENAI_API_KEY` using a key from the Cyclone OpenAI project. The endpoint validates each caller with Supabase Auth and never exposes the key to the extension. Reservations and completed passage text are private server records; audio is forwarded without storage in Supabase. Failed or uncertain requests keep their allowance reservation, and retries never start a second OpenAI call for the same authenticated user and passage identity.
