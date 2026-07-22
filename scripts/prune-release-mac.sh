#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RELEASE_DIR="$ROOT/release"

if [[ ! -d "$RELEASE_DIR" ]]; then
  exit 0
fi

# Keep only distributable artifacts required for manual install and auto-update.
# Preserve release/mac when the unpacked .app bundle is needed locally.
rm -f \
  "$RELEASE_DIR/.DS_Store" \
  "$RELEASE_DIR/builder-debug.yml" \
  "$RELEASE_DIR/builder-effective-config.yaml" \
  "$RELEASE_DIR"/*.dmg \
  "$RELEASE_DIR"/*.dmg.blockmap

find "$RELEASE_DIR" -name '.DS_Store' -delete
