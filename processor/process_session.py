#!/usr/bin/env python3
"""Turn a Cyclone session export into a readable timeline and structured analysis."""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
import tempfile
import zipfile
from pathlib import Path
from contextlib import contextmanager
from typing import Any


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def read_events(path: Path) -> list[dict[str, Any]]:
    events = []
    for line_no, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError as exc:
            raise ValueError(f"{path.name}:{line_no}: invalid JSON: {exc}") from exc
        if not isinstance(event, dict):
            raise ValueError(f"{path.name}:{line_no}: event must be an object")
        # t_ms is accepted for early/third-party exporters; tMs is canonical.
        if "tMs" not in event and "t_ms" in event:
            event["tMs"] = event["t_ms"]
        try:
            event["tMs"] = max(0, int(event.get("tMs", 0)))
        except (TypeError, ValueError):
            event["tMs"] = 0
        event["type"] = str(event.get("type", "unknown"))
        events.append(event)
    return sorted(events, key=lambda e: e["tMs"])


@contextmanager
def source_dir(source: Path):
    """Yield the input root, extracting ZIPs into a temporary directory if needed."""
    if source.is_dir():
        yield source
    elif zipfile.is_zipfile(source):
        with tempfile.TemporaryDirectory(prefix="cyclone-session-") as tmp:
            with zipfile.ZipFile(source) as zf:
                # Reject paths that could escape the temporary extraction root.
                root = Path(tmp).resolve()
                for info in zf.infolist():
                    target = (root / info.filename).resolve()
                    if target != root and root not in target.parents:
                        raise ValueError(f"Unsafe path in archive: {info.filename}")
                zf.extractall(root)
            # Exports may be wrapped in a single containing folder.
            candidates = [p for p in root.rglob("session.json") if p.is_file()]
            if not candidates:
                raise ValueError("ZIP does not contain session.json")
            yield candidates[0].parent
    else:
        raise ValueError(f"Input must be a directory or ZIP: {source}")


def compress_code_states(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Keep changed code snapshots only; event trace itself remains untouched."""
    states: list[dict[str, Any]] = []
    previous: str | None = None
    for event in events:
        if event["type"] != "code" or not isinstance(event.get("code"), str):
            continue
        code = event["code"]
        if code == previous:
            continue
        states.append({"tMs": event["tMs"], "code": code,
                       **({"language": event["language"]} if event.get("language") else {})})
        previous = code
    return states


def select_report_states(states: list[dict[str, Any]], quiet_ms: int = 4000) -> list[dict[str, Any]]:
    """Show the initial code and the last state before each editing pause."""
    if not states:
        return []
    selected = [states[0]]
    for index, state in enumerate(states[1:], 1):
        next_time = states[index + 1]["tMs"] if index + 1 < len(states) else None
        if next_time is None or next_time - state["tMs"] >= quiet_ms:
            if state is not selected[-1]:
                selected.append(state)
    return selected


def transcribe(audio: Path | None, model_name: str) -> tuple[list[dict[str, Any]], str | None]:
    if not audio or not audio.exists():
        return [], "No audio.webm was included."
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        return [], "faster-whisper is not installed; transcription was skipped."
    try:
        model = WhisperModel(model_name, device="cpu", compute_type="int8")
        segments, info = model.transcribe(str(audio), word_timestamps=False, vad_filter=True)
        result = [{"startMs": round(seg.start * 1000), "endMs": round(seg.end * 1000),
                   "text": seg.text.strip()} for seg in segments]
        return result, None
    except Exception as exc:  # Preserve processing output even if local ASR fails.
        return [], f"Transcription failed: {type(exc).__name__}: {exc}"


def fmt_time(ms: int) -> str:
    seconds = ms // 1000
    return f"{seconds // 60:02d}:{seconds % 60:02d}"


def build_timeline(events: list[dict[str, Any]], speech: list[dict[str, Any]], states: list[dict[str, Any]]) -> list[dict[str, Any]]:
    items = []
    state_times = {state["tMs"] for state in states}
    for e in events:
        if e["type"] == "code" and e["tMs"] not in state_times:
            continue
        item = {"tMs": e["tMs"], "kind": e["type"]}
        if e["type"] in ("run", "submit") and e.get("result") is not None:
            item["result"] = e["result"]
        if e["type"] == "code":
            item["codeChanged"] = True
        items.append(item)
    for s in speech:
        items.append({"tMs": s["startMs"], "kind": "speech", "endMs": s["endMs"], "text": s["text"]})
    return sorted(items, key=lambda x: x["tMs"])


def render_markdown(meta: dict[str, Any], events: list[dict[str, Any]], states: list[dict[str, Any]],
                    speech: list[dict[str, Any]], warning: str | None, source_hash: str) -> str:
    title = meta.get("title") or "Untitled problem"
    out = [f"# DSA Session: {title}", "", f"- Problem: {meta.get('problemUrl') or 'Not recorded'}",
           f"- Language: {meta.get('language') or 'Not recorded'}",
           f"- Session: `{meta.get('sessionId') or 'unknown'}`",
           f"- Source SHA-256: `{source_hash}`", "", "## Timeline", ""]
    timeline = build_timeline(events, speech, states)
    if not timeline:
        out.append("No events were recorded.")
    for item in timeline:
        t = fmt_time(item["tMs"])
        kind = item["kind"]
        if kind == "speech":
            out.append(f"- **{t} — You said:** {item['text']}")
        elif kind == "code":
            out.append(f"- **{t} — Code changed** (snapshot {sum(1 for s in states if s['tMs'] <= item['tMs'])})")
        elif kind in ("run", "submit"):
            result = f" — {item['result']}" if item.get("result") else ""
            out.append(f"- **{t} — {kind.title()}{result}**")
        else:
            out.append(f"- **{t} — {kind}**")
    out += ["", "## Code snapshots", ""]
    if not states:
        out.append("No code snapshots were recorded.")
    for index, state in enumerate(states, 1):
        out += [f"### Snapshot {index} at {fmt_time(state['tMs'])}", "", f"```{state.get('language') or meta.get('language') or ''}", state["code"], "```", ""]
    if warning:
        out += ["## Audio", "", warning, ""]
    return "\n".join(out).rstrip() + "\n"


def process(source: Path, output: Path, do_transcribe: bool = False, model: str = "small") -> Path:
    source = source.expanduser().resolve()
    output = output.expanduser().resolve()
    with source_dir(source) as root:
        metadata_path = root / "session.json"
        events_path = root / "events.jsonl"
        if not metadata_path.is_file() or not events_path.is_file():
            raise ValueError("Session needs session.json and events.jsonl")
        meta = read_json(metadata_path)
        events = read_events(events_path)
        states = compress_code_states(events)
        report_states = select_report_states(states)
        audio = root / "audio.webm"
        if do_transcribe:
            speech, warning = transcribe(audio, model)
        else:
            speech, warning = [], "Transcription was not requested; the original audio remains in the source export." if audio.exists() else None
        digest = hashlib.sha256(source.read_bytes()).hexdigest() if source.is_file() else hashlib.sha256(
            "\n".join(f"{p.relative_to(root)}:{hashlib.sha256(p.read_bytes()).hexdigest()}" for p in sorted(root.rglob("*")) if p.is_file()).encode()
        ).hexdigest()
        output.mkdir(parents=True, exist_ok=True)
        structured = {"metadata": meta, "source": {"path": str(source), "sha256": digest},
                      "events": events, "codeStates": states, "reportCodeStates": report_states,
                      "transcript": speech,
                      "transcriptionWarning": warning}
        (output / "analysis.json").write_text(json.dumps(structured, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        (output / "report.md").write_text(render_markdown(meta, events, report_states, speech, warning, digest), encoding="utf-8")
    return output


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="session ZIP or extracted session directory")
    parser.add_argument("-o", "--output", type=Path, default=Path("session-analysis"))
    parser.add_argument("--transcribe", action="store_true", help="transcribe audio locally (requires faster-whisper)")
    parser.add_argument("--model", default="small", help="faster-whisper model name; default: small")
    args = parser.parse_args()
    try:
        output = process(args.input, args.output, args.transcribe, args.model)
    except (OSError, ValueError, json.JSONDecodeError, zipfile.BadZipFile) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    print(f"Wrote {output / 'report.md'} and {output / 'analysis.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
