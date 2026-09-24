#!/usr/bin/env python3
"""Install the per-user macOS job that processes future Cyclone ZIP downloads."""
from __future__ import annotations

import argparse
import os
import plistlib
import shutil
import subprocess
import time
from pathlib import Path

LABEL = "com.e24z.cyclone.processor"


def build_plist(repo: Path, runtime: Path, uv: Path, downloads: Path, log: Path,
                since_ns: int) -> dict:
    return {
        "Label": LABEL,
        "ProgramArguments": [
            str(uv), "run", "--project", str(repo / "processor"), "--locked",
            "--extra", "transcribe", "python", "-m", "processor.watch_downloads",
            "--downloads", str(downloads), "--since-ns", str(since_ns),
        ],
        "WorkingDirectory": str(runtime),
        "WatchPaths": [str(downloads)],
        "StartInterval": 60,
        "RunAtLoad": True,
        "StandardOutPath": str(log),
        "StandardErrorPath": str(log),
    }


def previous_cutoff(path: Path) -> int | None:
    try:
        arguments = plistlib.loads(path.read_bytes())["ProgramArguments"]
        return int(arguments[arguments.index("--since-ns") + 1])
    except (OSError, ValueError, KeyError, IndexError, TypeError):
        return None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--downloads", type=Path, default=Path.home() / "Downloads" / "Cyclone")
    args = parser.parse_args()
    if os.uname().sysname != "Darwin":
        parser.error("this installer requires macOS")
    repo = Path(__file__).resolve().parent.parent
    uv_path = shutil.which("uv")
    if not uv_path:
        parser.error("uv is required to run the local processor")
    downloads = args.downloads.expanduser().resolve()
    downloads.mkdir(parents=True, exist_ok=True)
    runtime = Path.home() / "Library" / "Application Support" / "Cyclone" / "runtime"
    runtime_package = runtime / "processor"
    runtime_package.mkdir(parents=True, exist_ok=True)
    (runtime_package / "__init__.py").touch()
    for source in ("process_session.py", "watch_downloads.py"):
        shutil.copy2(repo / "processor" / source, runtime_package / source)
    log = Path.home() / "Library" / "Logs" / "Cyclone" / "processor.log"
    log.parent.mkdir(parents=True, exist_ok=True)
    plist_path = Path.home() / "Library" / "LaunchAgents" / f"{LABEL}.plist"
    plist_path.parent.mkdir(parents=True, exist_ok=True)
    cutoff = previous_cutoff(plist_path) or time.time_ns()
    plist_path.write_bytes(plistlib.dumps(build_plist(repo, runtime, Path(uv_path).resolve(), downloads, log, cutoff)))

    domain = f"gui/{os.getuid()}"
    service = f"{domain}/{LABEL}"
    if subprocess.run(["launchctl", "print", service], capture_output=True).returncode == 0:
        subprocess.run(["launchctl", "bootout", service], check=True)
    subprocess.run(["launchctl", "bootstrap", domain, str(plist_path)], check=True)
    print(f"Installed {plist_path}")
    print(f"Future ZIPs in {downloads} will produce reports under {downloads / 'Reports'}")
    print(f"Processor code snapshot: {runtime_package}")
    print(f"Processor log: {log}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
