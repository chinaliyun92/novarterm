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

rename_if_exists() {
  local from="$1"
  local to="$2"
  if [[ -f "$from" ]]; then
    mv "$from" "$to"
  fi
}

echo ">>> build mac arm64"
npx electron-builder --mac zip --arm64 --publish never

# When arm64 is the only arch, electron-builder may emit an unsuffixed *-mac.zip.
rename_if_exists \
  "$RELEASE_DIR/NovarTerm-${VERSION}-mac.zip" \
  "$RELEASE_DIR/NovarTerm-${VERSION}-arm64-mac.zip"
rename_if_exists \
  "$RELEASE_DIR/NovarTerm-${VERSION}-mac.zip.blockmap" \
  "$RELEASE_DIR/NovarTerm-${VERSION}-arm64-mac.zip.blockmap"

LATEST_MAC_YML="$RELEASE_DIR/latest-mac.yml"
if [[ ! -f "$LATEST_MAC_YML" ]]; then
  echo "error: expected $LATEST_MAC_YML after arm64 build" >&2
  exit 1
fi

# Keep auto-update metadata pointed at the explicit arm64 artifact name.
perl -0pi -e "s/NovarTerm-${VERSION}-mac\\.zip/NovarTerm-${VERSION}-arm64-mac.zip/g" "$LATEST_MAC_YML"

if ! grep -q "NovarTerm-${VERSION}-arm64-mac.zip" "$LATEST_MAC_YML"; then
  echo "error: latest-mac.yml must point at the arm64 zip for auto-update" >&2
  cat "$LATEST_MAC_YML" >&2
  exit 1
fi

if [[ ! -f "$RELEASE_DIR/NovarTerm-${VERSION}-arm64-mac.zip" ]]; then
  echo "error: missing $RELEASE_DIR/NovarTerm-${VERSION}-arm64-mac.zip" >&2
  exit 1
fi

echo ">>> auto-update channel locked to arm64"
cat "$LATEST_MAC_YML"
