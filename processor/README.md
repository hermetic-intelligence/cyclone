# Cyclone session processor

Processes a session ZIP or extracted export directory into `report.md` and `analysis.json`. The source export stays intact; the analysis includes its path and SHA-256 digest. Events are retained verbatim (with canonicalized `tMs`) while duplicate consecutive code snapshots are compressed into `codeStates`.

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

Expected export files are `session.json`, `events.jsonl`, and optionally `audio.webm`. Event timestamps are milliseconds relative to session start. `code` events carry `code`; `run` and `submit` may carry `result`.
