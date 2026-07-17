#!/usr/bin/env python3
"""Step 4 — watched-folder trigger.

Staff drop a case packet (a folder containing packet.json, or a bare packet.json)
into PA_ROOT/inbox. This watcher fires run_case.py for each one, moves the packet
into PA_ROOT/cases/<case_id>/, and lets the run stop at the review screen for a
human to eyeball and submit.

Usage:
    python runner/watch.py [--portal evicore] [--poll 5]

Dependencies: watchdog if installed (event-driven); otherwise falls back to
polling so there are no hard deps.
"""
import argparse
import asyncio
import json
import os
import shutil
import time
from pathlib import Path

from run_case import run_case  # same package dir

PA_ROOT = Path(os.environ.get("PA_ROOT", "/opt/pa"))
INBOX = Path(os.environ.get("PA_INBOX", PA_ROOT / "inbox"))
CASES = Path(os.environ.get("PA_CASES", PA_ROOT / "cases"))


def _case_id_from(entry: Path) -> str:
    """Derive a stable case id and normalise the drop into CASES/<id>/packet.json."""
    if entry.is_dir():
        case_id = entry.name
        dest = CASES / case_id
        shutil.move(str(entry), str(dest))
    else:  # a bare packet.json (or *.json)
        try:
            data = json.loads(entry.read_text())
            case_id = str(data.get("case_id") or entry.stem)
        except Exception:
            case_id = entry.stem
        dest = CASES / case_id
        dest.mkdir(parents=True, exist_ok=True)
        shutil.move(str(entry), str(dest / "packet.json"))
    return case_id


def _ready(entry: Path) -> bool:
    """A drop is ready when its packet.json exists (dir) or it is a *.json file."""
    if entry.name.startswith("."):
        return False
    if entry.is_dir():
        return (entry / "packet.json").exists()
    return entry.suffix == ".json"


async def _handle(entry: Path, portal: str) -> None:
    case_id = _case_id_from(entry)
    print(f"[watch] picked up {case_id}")
    try:
        await run_case(portal, case_id)
    except Exception as e:  # keep the watcher alive on a single bad case
        print(f"[watch] case {case_id} failed: {e}")


async def poll_loop(portal: str, poll_seconds: float) -> None:
    INBOX.mkdir(parents=True, exist_ok=True)
    CASES.mkdir(parents=True, exist_ok=True)
    print(f"[watch] watching {INBOX} (poll {poll_seconds}s) portal={portal}")
    seen: set[str] = set()
    while True:
        for entry in sorted(INBOX.iterdir()):
            key = entry.name
            if key in seen or not _ready(entry):
                continue
            seen.add(key)
            await _handle(entry, portal)
        time.sleep(poll_seconds)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--portal", default="evicore")
    ap.add_argument("--poll", type=float, default=5.0, help="poll interval seconds")
    args = ap.parse_args()
    asyncio.run(poll_loop(args.portal, args.poll))


if __name__ == "__main__":
    main()
