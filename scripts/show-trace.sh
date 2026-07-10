#!/usr/bin/env bash
# Open the Playwright Trace Viewer for a captured auth.
# A timeline where you click any step and see the screenshot + DOM + network at
# that moment. Same data Claude reads in Step 3.
#
# Usage:  scripts/show-trace.sh <portal> <case-id>
#         scripts/show-trace.sh /path/to/trace.zip
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/../config.sh"

if [[ "${1:-}" == *.zip ]]; then
  TRACE="$1"
else
  PORTAL="${1:?usage: show-trace.sh <portal> <case-id>  |  <trace.zip>}"
  CASE="${2:?usage: show-trace.sh <portal> <case-id>  |  <trace.zip>}"
  TRACE="$PA_TRACES/${PORTAL}_${CASE}.zip"
fi

[[ -f "$TRACE" ]] || { echo "No trace at $TRACE" >&2; exit 1; }
npx playwright show-trace "$TRACE"
