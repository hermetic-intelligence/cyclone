# Cyclone session processor

Processes a session ZIP or extracted export directory into `analysis.json`, `agent.json`, `agent.md`, and `report.md`. The source export stays intact; the outputs include its path and SHA-256 digest. Events are retained in `analysis.json` (with canonicalized `tMs`) while duplicate consecutive code snapshots are compressed into `codeStates`. Each code state has an `eventIndex` pointing into `analysis.events`. The readable debug report uses `reportCodeStates`: the initial state and the last state before each editing pause of at least four seconds. All intermediate states remain in `analysis.json`.

`agent.json` groups transcript intervals, changed code states, and Run/Submit actions when the gap between activities is at most eight seconds. It starts a new episode after one minute of activity at the next nonoverlapping boundary. Each episode has `startMs`, `endMs`, `speech`, `codeBefore`, `codeAfter`, and `actions`. Its `source` indices point to the `transcript`, `codeStates`, and `events` arrays in the sibling `analysis.json` (all indices are zero-based). `codeBeforeState` and `codeAfterState` identify the snapshots behind the displayed code; `null` means no earlier code was captured. `agent.md` presents the same episodes with the captured problem statement. These are deterministic proximity groups, not a claim that speech semantically explains every nearby edit.

From the repository root, run:

```sh
uv run --project processor --locked python processor/process_session.py session.zip -o session-analysis
```

Audio transcription is optional and runs locally with faster-whisper:

```sh
uv run --project processor --locked --extra transcribe python processor/process_session.py session.zip -o session-analysis --transcribe
```

The `transcribe` extra is recorded in `pyproject.toml` and `uv.lock`. The first transcription may download the selected model (`--model small` by default). Without the extra, audio is left untouched and the report explains that transcription was skipped.

Run the processor tests from the repository root with `uv run --project processor --locked python -m unittest discover -s processor/tests -v`.

Expected export files are `session.json`, `events.jsonl`, and optionally `audio.webm`. New exports include `problemStatement` in `session.json` when the page exposes it. Event timestamps are milliseconds relative to the same origin as `audio.webm`. `code` events carry `code`; `run` and `submit` may carry `result`.
