#!/usr/bin/env bash
# Step 2 — Capture a real auth with codegen + trace.
# This is your "screen recording", except it records selectors and DOM instead
# of pixels. The coordinator drives; codegen watches and writes two files:
#   - a runnable Playwright spec (the clicks + selectors as code)
#   - a trace.zip (screenshots + full DOM snapshot + network per step)
#
# Usage:  scripts/record.sh <portal> <case-id> [start-url]
#   scripts/record.sh evicore case01
#   scripts/record.sh evicore case02 https://www.evicore.com
#
# LOGIN RULE: on the login screen, click record/pause on the codegen toolbar
# BEFORE typing the password, resume AFTER. Codegen embeds typed text as
# plaintext in the spec — you don't want credentials in the file. (Step 4's
# scrubber catches any that slip through, but pausing is the clean way.)
#
# Run this 3-5 times per portal on DIFFERENT real cases — vary the indication
# (a staging PET, a recurrence PET, a chest CT) so the survey branches get
# exercised.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/../config.sh"
pa_init_dirs

PORTAL="${1:?usage: record.sh <portal> <case-id> [start-url]}"
CASE="${2:?usage: record.sh <portal> <case-id> [start-url]}"

# Default start URL per portal. Extend this map as you add portals.
declare -A PORTAL_URLS=(
  [evicore]="https://www.evicore.com"
  [cohere]="https://www.coherehealth.com"
)
START_URL="${3:-${PORTAL_URLS[$PORTAL]:-}}"
if [[ -z "$START_URL" ]]; then
  echo "No default URL for portal '$PORTAL'. Pass one as the 3rd argument." >&2
  exit 1
fi

TRACE="$PA_TRACES/${PORTAL}_${CASE}.zip"
SPEC="$PA_RECORDINGS/${PORTAL}_${CASE}.spec.ts"

echo "==> Recording $PORTAL / $CASE"
echo "    trace -> $TRACE"
echo "    spec  -> $SPEC"
echo "    url   -> $START_URL"
echo "    REMINDER: pause the recorder before typing the password."
echo

npx playwright codegen \
  --save-trace="$TRACE" \
  --target=playwright-test \
  -o "$SPEC" \
  "$START_URL"

echo
echo "Captured. Inspect the trace any time with:"
echo "    scripts/show-trace.sh $PORTAL $CASE"
