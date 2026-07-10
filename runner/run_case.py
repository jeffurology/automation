#!/usr/bin/env python3
"""Step 4 — the production loop for a single case.

The deterministic script runs the boring parts, the agent handles the variable
parts (the clinical survey), and a human approves the submit. The browser stops
at the review screen; auth number + screenshots land in the audit folder.

Usage:
    python runner/run_case.py --case CASE01 [--portal evicore] [--headed]

Env:
    PA_ROOT            data root (default /opt/pa)
    EVICORE_USER/_PW   portal credentials (never in the packet)
"""
import argparse
import asyncio
import os
from pathlib import Path

from claude_agent_sdk import query, ClaudeAgentOptions

PA_ROOT = Path(os.environ.get("PA_ROOT", "/opt/pa"))
REPO_ROOT = Path(__file__).resolve().parent.parent


def build_options(portal: str) -> ClaudeAgentOptions:
    profile_dir = PA_ROOT / "profiles" / portal
    profile_dir.mkdir(parents=True, exist_ok=True)
    return ClaudeAgentOptions(
        # One persistent Chrome profile per portal — login + MFA device-trust
        # survive between runs.
        mcp_servers={
            "playwright": {
                "command": "npx",
                "args": [
                    "@playwright/mcp@latest",
                    f"--user-data-dir={profile_dir}",
                ],
            }
        },
        # Loads skills/ from the repo (setting_sources=["project"]).
        setting_sources=["project"],
        cwd=str(REPO_ROOT),
    )


def build_prompt(portal: str, case_id: str) -> str:
    case_dir = PA_ROOT / "cases" / case_id
    audit_dir = PA_ROOT / "audit" / case_id
    audit_dir.mkdir(parents=True, exist_ok=True)
    return (
        f"Use the {portal} skill to submit the PA for the case in {case_dir}/.\n"
        f"Answer survey questions ONLY from packet.json. Any field you can't "
        f"source -> write NEEDS_HUMAN and stop.\n"
        f"Stop at the review screen — do NOT click final submit.\n"
        f"Screenshot every page to {audit_dir}/."
    )


async def run_case(portal: str, case_id: str) -> None:
    opts = build_options(portal)
    prompt = build_prompt(portal, case_id)
    print(f"[run] portal={portal} case={case_id}")
    async for message in query(prompt=prompt, options=opts):
        # Stream the agent's progress; the real artifacts (screenshots, auth
        # number, any NEEDS_HUMAN flag) land in the audit folder.
        print(message)
    print(f"[done] case={case_id} — review screen reached; awaiting human submit.")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--case", required=True, help="case id (folder under PA_ROOT/cases)")
    ap.add_argument("--portal", default="evicore")
    args = ap.parse_args()
    asyncio.run(run_case(args.portal, args.case))


if __name__ == "__main__":
    main()
