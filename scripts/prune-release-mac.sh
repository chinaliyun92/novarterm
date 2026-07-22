#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RELEASE_DIR="$ROOT/release"
VERSION="$(node -p "require('$ROOT/package.json').version")"

if [[ ! -d "$RELEASE_DIR" ]]; then
  exit 0
fi

# Keep only arm64 zip + blockmap + latest-mac.yml for install and auto-update.
# Preserve release/mac-arm64 when the unpacked .app bundle is needed locally.
rm -f \
  "$RELEASE_DIR/.DS_Store" \
  "$RELEASE_DIR/builder-debug.yml" \
  "$RELEASE_DIR/builder-effective-config.yaml" \
  "$RELEASE_DIR"/*.dmg \
  "$RELEASE_DIR"/*.dmg.blockmap \
  "$RELEASE_DIR"/*-x64-mac.zip \
  "$RELEASE_DIR"/*-x64-mac.zip.blockmap \
  "$RELEASE_DIR"/*-universal-mac.zip \
  "$RELEASE_DIR"/*-universal-mac.zip.blockmap \
  "$RELEASE_DIR/NovarTerm-${VERSION}-mac.zip" \
  "$RELEASE_DIR/NovarTerm-${VERSION}-mac.zip.blockmap"

rm -rf \
  "$RELEASE_DIR/mac" \
  "$RELEASE_DIR/mac-universal" \
  "$RELEASE_DIR/mac-universal-x64-temp" \
  "$RELEASE_DIR/mac-universal-arm64-temp"

find "$RELEASE_DIR" -name '.DS_Store' -delete
