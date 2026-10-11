#!/usr/bin/env bash
# Runs the Claude Code Remote Control server rooted in the vault. Started by the LaunchAgent, usable by hand.
# Env: VAULT (default yes-chef), RC_NAME (yes-chef), RC_PERMISSION_MODE (auto), RC_CAPACITY (8).
set -uo pipefail

VAULT="${VAULT:-/Users/kicooley-winters/workspace/projects/yes-chef}"
RC_NAME="${RC_NAME:-yes-chef}"
RC_PERMISSION_MODE="${RC_PERMISSION_MODE:-auto}"
RC_CAPACITY="${RC_CAPACITY:-8}"

log() { printf '%s claudsidian-rc: %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }

if [[ -x "$HOME/.local/bin/claude" ]]; then
  CLAUDE="$HOME/.local/bin/claude"
elif command -v claude >/dev/null 2>&1; then
  CLAUDE="$(command -v claude)"
else
  log "claude binary not found in ~/.local/bin or PATH; install Claude Code first"
  exit 1
fi

if [[ ! -d "$VAULT" ]]; then
  log "vault folder does not exist: $VAULT"
  exit 1
fi
cd "$VAULT" || exit 1

preconditions() {
  cat <<'MSG'
Remote Control did not start. The three things it needs on this Mac:
  1. Signed in to claude.ai in Claude Code: run `claude auth login` (a claude.ai subscription, not an API key).
  2. Remote Control accepted once interactively: run `claude remote-control` in the vault, wait for
     "Remote Control ready", then Ctrl-C. The same run accepts the vault trust dialog
     (hasTrustDialogAccepted in ~/.claude.json) and the `--permission-mode auto` opt-in.
  3. DISABLE_GROWTHBOOK must not be set in the environment (it hides Remote Control).
Then re-run this script or `launchctl kickstart -k gui/$(id -u)/com.kicooley.claudsidian-rc`.
MSG
}

# Fail fast with the preconditions instead of letting launchd respawn a silently failing process.
if ! "$CLAUDE" auth status --json 2>/dev/null | grep -q '"loggedIn": *true'; then
  log "claude auth status does not report loggedIn: true (claude $("$CLAUDE" --version 2>/dev/null || echo unknown))"
  preconditions
  exit 1
fi

log "starting: cwd=$VAULT name=$RC_NAME permission-mode=$RC_PERMISSION_MODE capacity=$RC_CAPACITY (claude $("$CLAUDE" --version 2>/dev/null | head -1))"
exec "$CLAUDE" remote-control \
  --name "$RC_NAME" \
  --permission-mode "$RC_PERMISSION_MODE" \
  --capacity "$RC_CAPACITY"
