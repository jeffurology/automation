# config.sh — shared paths and settings for the PA automation pipeline.
# Source this from any script:  source "$(dirname "$0")/../config.sh"
#
# PA_ROOT holds everything PHI-adjacent (browser profiles, traces, recordings,
# case packets, audit screenshots). It lives OUTSIDE the git repo on purpose —
# none of it should ever be committed. The repo holds code only.

# Root for all runtime data. Override in your shell/env if you keep it elsewhere.
export PA_ROOT="${PA_ROOT:-/opt/pa}"

# One persistent Chrome profile per portal. Login sessions + MFA device-trust
# survive between runs because the profile dir persists.
export PA_PROFILES="$PA_ROOT/profiles"   # /opt/pa/profiles/<portal>
export PA_TRACES="$PA_ROOT/traces"       # trace.zip artifacts from codegen
export PA_RECORDINGS="$PA_ROOT/recordings" # generated .spec.ts recordings
export PA_CASES="$PA_ROOT/cases"         # incoming case packets (packet.json / PDFs)
export PA_AUDIT="$PA_ROOT/audit"         # per-case screenshots + auth numbers
export PA_INBOX="$PA_ROOT/inbox"         # watched folder — staff drop packets here

# Ensure the data directories exist.
pa_init_dirs() {
  mkdir -p "$PA_PROFILES" "$PA_TRACES" "$PA_RECORDINGS" \
           "$PA_CASES" "$PA_AUDIT" "$PA_INBOX"
}
