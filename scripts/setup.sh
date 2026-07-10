#!/usr/bin/env bash
# Step 1 — Wire the hands to the brain.
# Installs Claude Code + Playwright, the Chromium browser, and registers the
# Playwright MCP server so Claude Code gets browser tools (navigate, click,
# type, read accessibility tree, screenshot).
#
# Run once per automation box. Safe to re-run (idempotent).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HERE/../config.sh"
pa_init_dirs

echo "==> Installing Claude Code + Playwright globally"
npm i -g @anthropic-ai/claude-code
npm i -g playwright

echo "==> Installing Chromium for Playwright"
npx playwright install chromium

# One MCP server, but each run points it at a per-portal profile dir via
# --user-data-dir so login/MFA state is isolated and persistent per portal.
# Default profile below is evicore; the SDK runner (runner/run_case.py)
# overrides --user-data-dir per portal at query time.
PORTAL="${1:-evicore}"
PROFILE_DIR="$PA_PROFILES/$PORTAL"
mkdir -p "$PROFILE_DIR"

echo "==> Registering Playwright MCP server (profile: $PROFILE_DIR)"
# Remove any stale registration first so this is idempotent.
claude mcp remove playwright >/dev/null 2>&1 || true
claude mcp add playwright -- npx @playwright/mcp@latest \
  --user-data-dir="$PROFILE_DIR"

echo
echo "Done. Data root: $PA_ROOT"
echo "Profiles:   $PA_PROFILES/<portal>"
echo "Next: scripts/record.sh evicore case01   (Step 2 — capture a real auth)"
