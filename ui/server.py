#!/usr/bin/env python3
"""Local intake UI for triggering a prior-auth run.

Serves ui/index.html and, on submit, builds a packet.json from the form, writes
it into the case folder + the watched inbox, and (optionally) kicks off
run_case.py in a headed browser. The run stops at the review screen — nothing is
auto-submitted.

SECURITY: binds to 127.0.0.1 only. Patient data stays on this machine. Do not
expose this port to a network.

Usage:
    python ui/server.py                 # http://127.0.0.1:8080
    PA_UI_PORT=9000 python ui/server.py

Env (mirrors config.sh):
    PA_ROOT (default /opt/pa), PA_UI_PORT (default 8080)
"""
import json
import os
import re
import subprocess
import sys
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
UI_DIR = Path(__file__).resolve().parent
PA_ROOT = Path(os.environ.get("PA_ROOT", "/opt/pa"))
CASES = Path(os.environ.get("PA_CASES", PA_ROOT / "cases"))
INBOX = Path(os.environ.get("PA_INBOX", PA_ROOT / "inbox"))
AUDIT = Path(os.environ.get("PA_AUDIT", PA_ROOT / "audit"))
PORT = int(os.environ.get("PA_UI_PORT", "8080"))

REQUIRED = ("first_name", "last_name", "member_id", "clinical")


def _slug(s: str, n: int = 14) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "", s or "").upper()[:n] or "X"


def _codes(s: str) -> list[str]:
    return [c.strip() for c in re.split(r"[,\s]+", s or "") if c.strip()]


def build_packet(form: dict) -> tuple[str, dict]:
    """Turn form fields into the packet.json shape the skill expects."""
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    case_id = f"{_slug(form['last_name'])}-{_slug(form['member_id'])}-{stamp}"
    packet = {
        "case_id": case_id,
        "portal": form.get("portal", "evicore"),
        "member": {
            "id": form["member_id"].strip(),
            "dob": form.get("dob", "").strip(),
            "first_name": form["first_name"].strip(),
            "last_name": form["last_name"].strip(),
            "phone": form.get("phone", "").strip(),
        },
        "cpt": _codes(form.get("cpt", "")),
        "icd": _codes(form.get("icd", "")),
        "indication": form.get("indication", "").strip(),
        "diagnosis": {"primary_site": form.get("primary_site", "").strip()},
        "prior_imaging": {"performed": bool(form.get("prior_imaging"))},
        "clinical_findings": form["clinical"].strip(),
        "documents": [],  # operators drop PDFs into the case folder if needed
    }
    return case_id, packet


def write_case(case_id: str, packet: dict) -> Path:
    case_dir = CASES / case_id
    case_dir.mkdir(parents=True, exist_ok=True)
    packet_path = case_dir / "packet.json"
    packet_path.write_text(json.dumps(packet, indent=2))
    # Also drop a copy into the watched inbox so a running watcher fires it.
    inbox_dir = INBOX / case_id
    inbox_dir.mkdir(parents=True, exist_ok=True)
    (inbox_dir / "packet.json").write_text(json.dumps(packet, indent=2))
    return packet_path


def trigger_run(case_id: str, portal: str) -> bool:
    """Spawn run_case.py in the background. Returns True if it started."""
    try:
        subprocess.Popen(
            [sys.executable, str(REPO / "runner" / "run_case.py"),
             "--case", case_id, "--portal", portal],
            cwd=str(REPO),
            env={**os.environ, "PA_ROOT": str(PA_ROOT)},
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        return True
    except Exception as e:  # SDK missing, etc. — packet is still saved.
        print(f"[ui] could not start run for {case_id}: {e}", file=sys.stderr)
        return False


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, body: bytes, ctype: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path in ("/", "/index.html"):
            self._send(200, (UI_DIR / "index.html").read_bytes(), "text/html; charset=utf-8")
        elif self.path == "/health":
            self._send(200, b'{"ok":true}', "application/json")
        else:
            self._send(404, b"not found", "text/plain")

    def do_POST(self):
        if self.path != "/submit":
            self._send(404, b'{"error":"not found"}', "application/json")
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            form = json.loads(self.rfile.read(length) or b"{}")
            missing = [k for k in REQUIRED if not str(form.get(k, "")).strip()]
            if missing:
                raise ValueError(f"missing required field(s): {', '.join(missing)}")

            case_id, packet = build_packet(form)
            packet_path = write_case(case_id, packet)
            triggered = trigger_run(case_id, packet["portal"]) if form.get("run_now") else False

            resp = {
                "case_id": case_id,
                "packet_path": str(packet_path),
                "audit_dir": str(AUDIT / case_id),
                "triggered": triggered,
            }
            self._send(200, json.dumps(resp).encode(), "application/json")
        except Exception as e:
            self._send(400, json.dumps({"error": str(e)}).encode(), "application/json")

    def log_message(self, *args):  # quieter console
        pass


def main():
    for d in (CASES, INBOX, AUDIT):
        d.mkdir(parents=True, exist_ok=True)
    # 127.0.0.1 only — never bind 0.0.0.0; this form carries patient data.
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"PA intake UI -> http://127.0.0.1:{PORT}   (data root: {PA_ROOT})")
    print("Ctrl-C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped.")


if __name__ == "__main__":
    main()
