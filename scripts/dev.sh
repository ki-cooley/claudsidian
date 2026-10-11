#!/usr/bin/env bash
# Watch-mode build that copies every successful build into the vault's plugin folder.
# Usage: scripts/dev.sh [--vault PATH]   (default vault: the yes-chef vault, or $CLAUDSIDIAN_VAULT if set)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VAULT="${CLAUDSIDIAN_VAULT:-/Users/kicooley-winters/workspace/projects/yes-chef}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --vault) VAULT="$2"; shift 2 ;;
    --vault=*) VAULT="${1#--vault=}"; shift ;;
    -h|--help) echo "usage: $(basename "$0") [--vault PATH]"; exit 0 ;;
    *) echo "dev: unknown argument: $1" >&2; exit 2 ;;
  esac
done

cd "$ROOT"
echo "watching src/, installing into $VAULT/.obsidian/plugins/claudsidian on every build"
CLAUDSIDIAN_VAULT="$VAULT" exec node esbuild.config.mjs
