#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RELEASE_DIR="$ROOT/release"
VERSION="$(node -p "require('$ROOT/package.json').version")"

mkdir -p "$RELEASE_DIR"

# Apple Silicon only — Intel / universal builds are intentionally unsupported.
rm -f \
  "$RELEASE_DIR/NovarTerm-${VERSION}-mac.zip" \
  "$RELEASE_DIR/NovarTerm-${VERSION}-mac.zip.blockmap" \
  "$RELEASE_DIR/NovarTerm-${VERSION}-x64-mac.zip" \
  "$RELEASE_DIR/NovarTerm-${VERSION}-x64-mac.zip.blockmap" \
  "$RELEASE_DIR/NovarTerm-${VERSION}-arm64-mac.zip" \
  "$RELEASE_DIR/NovarTerm-${VERSION}-arm64-mac.zip.blockmap" \
  "$RELEASE_DIR/NovarTerm-${VERSION}-universal-mac.zip" \
  "$RELEASE_DIR/NovarTerm-${VERSION}-universal-mac.zip.blockmap" \
  "$RELEASE_DIR/latest-mac.yml"

echo ">>> build mac arm64"
electron-builder --mac zip --arm64 --publish never

LATEST_MAC_YML="$RELEASE_DIR/latest-mac.yml"
if [[ ! -f "$LATEST_MAC_YML" ]]; then
  echo "error: expected $LATEST_MAC_YML after arm64 build" >&2
  exit 1
fi

if ! grep -q "NovarTerm-${VERSION}-arm64-mac.zip" "$LATEST_MAC_YML"; then
  echo "error: latest-mac.yml must point at the arm64 zip for auto-update" >&2
  cat "$LATEST_MAC_YML" >&2
  exit 1
fi

echo ">>> auto-update channel locked to arm64"
cat "$LATEST_MAC_YML"
