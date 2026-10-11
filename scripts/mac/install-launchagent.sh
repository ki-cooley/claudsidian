#!/usr/bin/env bash
# Installs the com.kicooley.claudsidian-rc LaunchAgent so `claude remote-control` runs in the vault at login.
# Usage: scripts/mac/install-launchagent.sh [--vault PATH]
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LABEL="com.kicooley.claudsidian-rc"
VAULT="${VAULT:-/Users/kicooley-winters/workspace/projects/yes-chef}"
SCRIPT="$HERE/claudsidian-rc.sh"
TEMPLATE="$HERE/$LABEL.plist"
DEST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/claudsidian-rc.log"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --vault) VAULT="$2"; shift 2 ;;
    --vault=*) VAULT="${1#--vault=}"; shift ;;
    -h|--help) echo "usage: $(basename "$0") [--vault PATH]"; exit 0 ;;
    *) echo "install-launchagent: unknown argument: $1" >&2; exit 2 ;;
  esac
done

[[ -d "$VAULT" ]] || { echo "install-launchagent: vault folder does not exist: $VAULT" >&2; exit 1; }
[[ -f "$SCRIPT" ]] || { echo "install-launchagent: missing $SCRIPT" >&2; exit 1; }
[[ -f "$TEMPLATE" ]] || { echo "install-launchagent: missing $TEMPLATE" >&2; exit 1; }

cat <<MSG
Preconditions (the agent exits and retries every 15 s until all hold):
  1. Signed in: \`claude auth login\` with the claude.ai account.
  2. Remote Control accepted once interactively: \`cd "$VAULT" && claude remote-control\`, then Ctrl-C.
     That run also accepts the vault trust dialog and the --permission-mode auto opt-in.
  3. DISABLE_GROWTHBOOK is not set.

MSG

mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
touch "$LOG"
sed -e "s|__SCRIPT__|$SCRIPT|g" -e "s|__VAULT__|$VAULT|g" -e "s|__HOME__|$HOME|g" "$TEMPLATE" > "$DEST"
plutil -lint "$DEST" >/dev/null

UID_NUM="$(id -u)"
launchctl bootout "gui/$UID_NUM/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$UID_NUM" "$DEST"
echo "installed $DEST (script $SCRIPT, vault $VAULT)"
echo "log: $LOG"
echo "--- first 5 s of log ---"
tail -n 20 -f "$LOG" &
TAIL_PID=$!
sleep 5
kill "$TAIL_PID" 2>/dev/null || true
echo "------------------------"
echo "status: launchctl print gui/$UID_NUM/$LABEL | head -20"
