#!/usr/bin/env python3
"""Process completed Cyclone downloads once, for the local launchd job."""
from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from processor.process_session import process

STATUS_FILE = ".cyclone-processing.json"
OUTPUT_FILES = ("analysis.json", "agent.json", "agent.md", "report.md")


def file_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_status(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def write_status(path: Path, value: dict[str, Any]) -> None:
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent,
                                     prefix=".cyclone-status-", delete=False) as temp:
        json.dump(value, temp, indent=2)
        temp.write("\n")
        temp_path = Path(temp.name)
    os.replace(temp_path, path)


def scan(downloads: Path, since_ns: int = 0, retry_failed: bool = False) -> tuple[int, int]:
    """Process new ZIPs; return counts of completed and failed reports."""
    completed = failed = 0
    for archive in sorted(downloads.glob("cyclone-*.zip")):
        try:
            if archive.is_symlink() or not archive.is_file() or archive.stat().st_mtime_ns < since_ns:
                continue
            digest = file_hash(archive)
        except OSError:
            continue  # A download may have moved while this scan was running.

        output = downloads / "Reports" / archive.stem
        prior = read_status(output / STATUS_FILE)
        if prior.get("sourceSha256") == digest:
            if prior.get("status") == "complete" and all((output / name).is_file() for name in OUTPUT_FILES):
                continue
            if prior.get("status") == "failed" and not retry_failed:
                continue

        output.mkdir(parents=True, exist_ok=True)
        warning: str | None = None
        try:
            process(archive, output, do_transcribe=True)
            analysis = json.loads((output / "analysis.json").read_text(encoding="utf-8"))
            warning = analysis.get("transcriptionWarning")
            status = "failed" if warning else "complete"
        except Exception as exc:
            status = "failed"
            warning = f"{type(exc).__name__}: {exc}"

        write_status(output / STATUS_FILE, {
            "sourceSha256": digest,
            "status": status,
            "processedAt": datetime.now(timezone.utc).isoformat(),
            "warning": warning,
        })
        if status == "complete":
            completed += 1
            print(f"Processed {archive.name} -> {output}", flush=True)
        else:
            failed += 1
            print(f"Could not fully process {archive.name}: {warning}. Output: {output}",
                  file=sys.stderr, flush=True)
    return completed, failed


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--downloads", type=Path, default=Path.home() / "Downloads" / "Cyclone")
    parser.add_argument("--since-ns", type=int, default=0,
                        help="only process ZIPs modified at or after this Unix time in nanoseconds")
    parser.add_argument("--retry-failed", action="store_true")
    args = parser.parse_args()
    args.downloads.mkdir(parents=True, exist_ok=True)
    lock_path = Path.home() / "Library" / "Application Support" / "Cyclone" / "processor.lock"
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with lock_path.open("w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return 0  # The previous run is still transcribing another session.
        _, failed = scan(args.downloads, args.since_ns, args.retry_failed)
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
