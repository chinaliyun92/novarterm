#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RELEASE_DIR="$ROOT/release"
VERSION="$(node -p "require('$ROOT/package.json').version")"

mkdir -p "$RELEASE_DIR"

rm -f \
  "$RELEASE_DIR/NovarTerm-${VERSION}-mac.zip" \
  "$RELEASE_DIR/NovarTerm-${VERSION}-mac.zip.blockmap" \
  "$RELEASE_DIR/NovarTerm-${VERSION}-x64-mac.zip" \
  "$RELEASE_DIR/NovarTerm-${VERSION}-x64-mac.zip.blockmap" \
  "$RELEASE_DIR/NovarTerm-${VERSION}-arm64-mac.zip" \
  "$RELEASE_DIR/NovarTerm-${VERSION}-arm64-mac.zip.blockmap" \
  "$RELEASE_DIR/NovarTerm-${VERSION}-universal-mac.zip" \
  "$RELEASE_DIR/NovarTerm-${VERSION}-universal-mac.zip.blockmap"

rename_if_exists() {
  local from="$1"
  local to="$2"
  if [[ -f "$from" ]]; then
    mv "$from" "$to"
  fi
}

echo ">>> build mac x64"
electron-builder --mac zip --x64 --publish never
rename_if_exists \
  "$RELEASE_DIR/NovarTerm-${VERSION}-mac.zip" \
  "$RELEASE_DIR/NovarTerm-${VERSION}-x64-mac.zip"
rename_if_exists \
  "$RELEASE_DIR/NovarTerm-${VERSION}-mac.zip.blockmap" \
  "$RELEASE_DIR/NovarTerm-${VERSION}-x64-mac.zip.blockmap"

echo ">>> build mac arm64"
electron-builder --mac zip --arm64 --publish never

echo ">>> build mac universal"
electron-builder --mac zip --universal --publish never
rename_if_exists \
  "$RELEASE_DIR/NovarTerm-${VERSION}-universal-mac.zip" \
  "$RELEASE_DIR/NovarTerm-${VERSION}-mac.zip"
rename_if_exists \
  "$RELEASE_DIR/NovarTerm-${VERSION}-universal-mac.zip.blockmap" \
  "$RELEASE_DIR/NovarTerm-${VERSION}-mac.zip.blockmap"

LATEST_MAC_YML="$RELEASE_DIR/latest-mac.yml"
if [[ -f "$LATEST_MAC_YML" ]]; then
  perl -0pi -e "s/NovarTerm-${VERSION}-universal-mac\\.zip/NovarTerm-${VERSION}-mac.zip/g" "$LATEST_MAC_YML"
  perl -0pi -e "s/NovarTerm-${VERSION}-universal-mac\\.zip\\.blockmap/NovarTerm-${VERSION}-mac.zip.blockmap/g" "$LATEST_MAC_YML"
fi
