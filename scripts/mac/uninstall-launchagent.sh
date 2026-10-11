#!/usr/bin/env bash
# Stops and removes the com.kicooley.claudsidian-rc LaunchAgent. The log file is kept.
set -euo pipefail

LABEL="com.kicooley.claudsidian-rc"
DEST="$HOME/Library/LaunchAgents/$LABEL.plist"

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
if [[ -f "$DEST" ]]; then
  rm -f "$DEST"
  echo "removed $DEST"
else
  echo "no LaunchAgent plist at $DEST"
fi
echo "stopped $LABEL (log kept at $HOME/Library/Logs/claudsidian-rc.log)"
