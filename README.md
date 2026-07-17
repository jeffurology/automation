# PA Portal Automation

Record-then-freeze automation for payer prior-authorization portals (EviCore,
Cohere, …). The core idea: **~90% of any auth is identical every time**
(navigation, demographics, codes) — that's deterministic code with no model
variance and no token cost. The **~10% that varies** (the clinical survey, an
odd modal, a new question) stays with the agent, which answers **only from the
case packet** and flags anything it can't source rather than inventing it.

```
record  →  freeze  →  patch      (the whole engine)
```

## Layout

```
automation/
├── config.sh                  # shared paths (PA_ROOT etc.)
├── .env.example               # credentials template (never commit .env)
├── scripts/
│   ├── setup.sh               # Step 1: install + register Playwright MCP
│   ├── record.sh              # Step 2: codegen capture (spec + trace)
│   ├── show-trace.sh          # inspect a captured trace
│   └── scrub-credentials.mjs  # Step 4: strip typed secrets from recordings
├── skills/evicore/            # Step 3: the frozen unit of repeatability
│   ├── SKILL.md               # when to use, portal quirks, where to stop
│   ├── submit_auth.ts         # deterministic: login → form fill → STOP at survey
│   ├── survey_map.yaml        # every clinical question → packet field
│   ├── selectors.json         # every element in one place (patch on portal change)
│   └── packet.example.json    # shape of a case packet
└── runner/
    ├── run_case.py            # Step 4: SDK loop for one case
    └── watch.py               # Step 4: watched-folder trigger
```

Everything PHI-adjacent (browser profiles, traces, recordings, case packets,
audit screenshots) lives under **`PA_ROOT` (default `/opt/pa`), outside the git
repo**. The repo holds code only. `.gitignore` is set up to keep it that way.

## Step 1 — Wire the hands to the brain

```bash
cp .env.example .env          # fill in EVICORE_USER / EVICORE_PW
bash scripts/setup.sh evicore # installs Claude Code + Playwright + Chromium,
                              # registers the Playwright MCP server against the
                              # persistent evicore profile
```

`--user-data-dir` gives each portal its own persistent Chrome profile, so login
sessions and MFA device-trust survive between runs. One profile dir per portal:
`/opt/pa/profiles/evicore`, `/opt/pa/profiles/cohere`, … Run headed while
building — you want to watch.

## Step 2 — Capture a real auth with codegen + trace

```bash
bash scripts/record.sh evicore case01
```

Records selectors and DOM instead of pixels. Produces two files per case:

- `recordings/evicore_case01.spec.ts` — the runnable clicks + selectors
- `traces/evicore_case01.zip` — screenshots + full DOM snapshot + network per step

The coordinator does one full auth — login, member search, demographics, CPT/ICD,
document upload, the clinical survey — then closes the window.

> **Login rule:** click record/pause on the codegen toolbar **before** typing the
> password, resume **after**. Codegen embeds typed text as plaintext; the Step 4
> scrubber catches anything that slips through, but pausing is the clean way.

Run this **3–5 times on different real cases** — vary the indication (a staging
PET, a recurrence PET, a chest CT) so the survey branches get exercised. Inspect
any trace:

```bash
bash scripts/show-trace.sh evicore case01
```

## Step 3 — Freeze into a skill

Point Claude Code at the recordings and traces and have it distill the skill:

> Read the specs in `$PA_ROOT/recordings/` and the traces in `$PA_ROOT/traces/`
> (unzip and inspect DOM + network per step). Synthesize a reusable skill: a
> deterministic Playwright script covering login → member search → demographics →
> CPT/ICD entry → document upload, plus a survey map of every clinical question
> that appeared and which case-packet field answers it. Flag any step where the
> recordings disagree with each other or a selector looks fragile.

The output is `skills/evicore/` (scaffolded here — fill it from your real
recordings). `selectors.json` is the single file you patch when the portal
changes.

## Step 4 — The production loop

Scrub credentials first (ingestion step one):

```bash
node scripts/scrub-credentials.mjs "$PA_ROOT/recordings" --portal evicore --write
```

Then run a case, or watch a folder:

```bash
# one case (staff dropped $PA_ROOT/cases/CASE01/packet.json)
python runner/run_case.py --case CASE01 --portal evicore

# watched folder — staff drop packets into $PA_ROOT/inbox, a run fires per packet
python runner/watch.py --portal evicore
```

The script runs the boring parts, the agent handles the variable parts, and the
browser **stops at the review screen**. Week one, the coordinator physically
clicks submit in the headed browser — the simplest possible gate. Auth number +
screenshots land in `$PA_ROOT/audit/<case_id>/`. As confidence builds,
auto-submit the clean straight-through cases and reserve the human for
`NEEDS_HUMAN` flags.

## Step 5 — Self-healing

When EviCore changes a page and a selector breaks, the deterministic script
fails → the agent falls back to accessibility-tree exploration, finds the field,
finishes the auth, then **patches `selectors.json` and shows you the diff**. A
portal change costs one slower run instead of a dead pipeline.

## Testing

You can validate the whole deterministic path **without EviCore credentials or
any PHI**, using a bundled mock portal whose labels/roles match
`selectors.json`.

**1. Smoke test (end-to-end against the mock portal):**

```bash
bash test/smoke.sh          # headless
HEADED=1 bash test/smoke.sh # watch it drive the browser
```

It serves `test/mock_portal.html`, drives `submit_auth.ts` through login →
member search → demographics → CPT/ICD → document upload, and asserts every
audit screenshot was produced and that it **stops at the survey** (never
submits). All data lives in a throwaway temp dir — `/opt/pa` is untouched.

**2. Unit-test the credential scrubber** (the one piece with real logic):

```bash
# make a fake recording with a plaintext password, then confirm it gets scrubbed
node scripts/scrub-credentials.mjs test/  --portal evicore   # dry run, reports findings
```

**3. Static checks** (syntax only, no browser):

```bash
node --check scripts/scrub-credentials.mjs
python3 -m py_compile runner/*.py
node --experimental-strip-types --check skills/evicore/submit_auth.ts
```

**4. Against real EviCore** (final step, needs credentials + a real case): fill
`.env`, run `scripts/setup.sh evicore`, drop a real `packet.json` under
`$PA_ROOT/cases/<id>/`, and run `python runner/run_case.py --case <id> --headed`
so you can watch. It stops at the review screen for you to eyeball and submit.

## The through-line

This record-then-freeze cycle is exactly what Skyvern calls workflow generation.
When you scale onto self-hosted Skyvern, the survey maps and selector inventories
you built here become its workflow definitions — nothing is throwaway.

## Guardrails (built in)

- **Human-in-the-loop submit** — the deterministic script stops at the review
  screen; it never clicks final submit.
- **Answer only from the packet** — the agent writes `NEEDS_HUMAN` for any survey
  question it can't source, and stops. No invented clinical answers.
- **No secrets in code or recordings** — credentials come from env vars; the
  scrubber strips anything typed into a recording.
- **No PHI in git** — all runtime data lives outside the repo; `.gitignore`
  enforces it.
- **Full audit trail** — every page screenshotted to `$PA_ROOT/audit/<case_id>/`.
```
