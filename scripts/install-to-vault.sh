#!/usr/bin/env bash
# Copies the built plugin (main.js, manifest.json, styles.css) into a vault's .obsidian/plugins/claudsidian/ folder.
# Usage: scripts/install-to-vault.sh [--vault PATH]   (default vault: the yes-chef vault)
set -euo pipefail

VAULT="/Users/kicooley-winters/workspace/projects/yes-chef"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --vault)
      [[ $# -ge 2 ]] || { echo "install-to-vault: --vault needs a path" >&2; exit 2; }
      VAULT="$2"; shift 2 ;;
    --vault=*)
      VAULT="${1#--vault=}"; shift ;;
    -h|--help)
      echo "usage: $(basename "$0") [--vault PATH]"; exit 0 ;;
    *)
      echo "install-to-vault: unknown argument: $1" >&2; exit 2 ;;
  esac
done

if [[ ! -f "$ROOT/main.js" ]]; then
  echo "install-to-vault: main.js is missing in $ROOT; run npm run build first" >&2
  exit 1
fi
for f in manifest.json styles.css; do
  if [[ ! -f "$ROOT/$f" ]]; then
    echo "install-to-vault: $f is missing in $ROOT; run npm run build first" >&2
    exit 1
  fi
done
if [[ ! -d "$VAULT" ]]; then
  echo "install-to-vault: vault folder does not exist: $VAULT" >&2
  exit 1
fi

DEST="$VAULT/.obsidian/plugins/claudsidian"
mkdir -p "$DEST"
for f in main.js manifest.json styles.css; do
  cp "$ROOT/$f" "$DEST/$f"
  echo "copied $f -> $DEST/$f"
done
echo "installed claudsidian $(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$ROOT/manifest.json" | head -1) into $DEST"
echo "reload the plugin in Obsidian (Settings > Community plugins, toggle Claudsidian off and on)"
