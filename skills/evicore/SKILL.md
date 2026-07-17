---
name: evicore
description: >
  Submit a prior authorization on the EviCore portal from a case packet.
  Use for imaging PAs (chest CT, staging PET, recurrence PET, etc.) routed
  through EviCore. Runs the deterministic parts as code and answers the
  clinical survey ONLY from the case packet — never invents an answer.
when_to_use: >
  A case packet (packet.json or PDF) exists for a member whose imaging
  authorization goes through EviCore. Invoke from the production loop
  (runner/run_case.py) or directly in Claude Code with the packet path.
---

# EviCore prior-authorization skill

## The 90/10 split
- **~90% is deterministic** (`submit_auth.ts`): navigation, login, member search,
  demographics, CPT/ICD entry, document upload. No model variance, no token cost.
- **~10% varies** (the clinical survey, an odd modal, a new question). That stays
  with the agent, which answers **only from the case packet** and writes
  `NEEDS_HUMAN` for anything it cannot source.

## How to run an auth
1. Run `submit_auth.ts` with the packet. It logs in (using the persistent
   profile — see below), searches the member, fills demographics + CPT/ICD, and
   uploads documents, then lands on the **clinical survey**.
2. For each survey question, look it up in `survey_map.yaml`. Map the question to
   its packet field and enter the packet's value.
   - If a question is **not** in the map, or the mapped packet field is **empty
     or absent**, write `NEEDS_HUMAN: <question text>` to the audit log and
     **stop**. Do not guess.
3. **Stop at the review screen.** Do not click final submit. Screenshot every
   page to `$PA_AUDIT/<case_id>/`.

## Portal quirks
- **Login / MFA**: session and MFA device-trust persist in the Chrome profile at
  `$PA_PROFILES/evicore`. First run of a new profile needs a human to complete
  MFA once; after that it's trusted.
- **Credentials**: never hard-coded. `submit_auth.ts` reads
  `process.env.EVICORE_USER` / `process.env.EVICORE_PW`.
- Add observed quirks here as you find them (session timeouts, popups, the
  member-search disambiguation modal, etc.).

## Where to stop (hard rules)
- Stop at the review screen — a human approves the submit.
- Stop on any survey question you can't source from the packet.
- Stop if a selector in `selectors.json` no longer matches (self-healing:
  fall back to the accessibility tree, finish, then patch `selectors.json` and
  show the diff — see Step 5 in the repo README).

## Files
- `submit_auth.ts` — deterministic Playwright: login → member search →
  demographics → CPT/ICD → document upload → land on survey.
- `survey_map.yaml` — every clinical question seen in recordings → packet field.
- `selectors.json` — every element selector in one place. **This is the file you
  patch when the portal changes.**
