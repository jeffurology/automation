#!/usr/bin/env bash
# Smoke test — drives submit_auth.ts end to end against the local mock portal.
# No real credentials, no PHI, no EviCore. Proves the plumbing: selector
# resolver, step sequencing, packet loading, file upload, and screenshots.
#
#   bash test/smoke.sh            # headless (CI-friendly)
#   HEADED=1 bash test/smoke.sh   # watch it drive
#
# Requires: playwright installed (see scripts/setup.sh) and a local node_modules
# that can resolve "playwright" (the setup installs it; in a bare checkout run
# `npm i` or `npm link playwright` first).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"

# Isolate all test data under a throwaway root — never touches /opt/pa.
export PA_ROOT="$(mktemp -d)"
export PA_CASES="$PA_ROOT/cases"
export PA_AUDIT="$PA_ROOT/audit"
CASE="SMOKE01"
mkdir -p "$PA_CASES/$CASE"

# Test packet points its upload at the repo's dummy PDF.
sed "s#__PDF__#$HERE/sample.pdf#" "$HERE/packet.template.json" > "$PA_CASES/$CASE/packet.json"

# Serve the mock portal on a free port.
PORT=8971
python3 -m http.server "$PORT" --directory "$HERE" >/dev/null 2>&1 &
SERVER_PID=$!
cleanup() { kill "$SERVER_PID" 2>/dev/null || true; rm -rf "$PA_ROOT"; }
trap cleanup EXIT
sleep 1

export PA_START_URL="http://localhost:$PORT/mock_portal.html"
export PA_CLOSE_ON_DONE=1
export EVICORE_USER="test-user"        # dummy — the mock accepts anything
export EVICORE_PW="test-pass"
HEADED_FLAG=""; [ "${HEADED:-0}" = "1" ] && HEADED_FLAG="--headed"

echo "==> Driving mock portal at $PA_START_URL"
cd "$REPO"
node --experimental-strip-types skills/evicore/submit_auth.ts --case "$CASE" $HEADED_FLAG

# Assert the deterministic run produced every audit screenshot.
EXPECTED=(01-login 02-member 03-demographics 04-codes 05-documents)
fail=0
for name in "${EXPECTED[@]}"; do
  if [ -s "$PA_AUDIT/$CASE/$name.png" ]; then
    echo "  ok: $name.png"
  else
    echo "  MISSING: $name.png"; fail=1
  fi
done

if [ "$fail" = "0" ]; then
  echo "PASS — driver walked login → member → demographics → codes → documents and stopped at the survey."
else
  echo "FAIL — see missing screenshots above."; exit 1
fi
