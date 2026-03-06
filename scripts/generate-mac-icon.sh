#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE_ICON="$ROOT_DIR/resources/AppIcon.png"
ICONSET_DIR="$ROOT_DIR/build/icon.iconset"
TARGET_ICNS="$ROOT_DIR/build/icon.icns"

if [[ ! -f "$SOURCE_ICON" ]]; then
  echo "icon source not found: $SOURCE_ICON" >&2
  exit 1
fi

mkdir -p "$ICONSET_DIR"

for size in 16 32 64 128 256 512; do
  sips -z "$size" "$size" "$SOURCE_ICON" --out "$ICONSET_DIR/icon_${size}x${size}.png" >/dev/null
  double_size=$((size * 2))
  sips -z "$double_size" "$double_size" "$SOURCE_ICON" --out "$ICONSET_DIR/icon_${size}x${size}@2x.png" >/dev/null
done

iconutil -c icns "$ICONSET_DIR" -o "$TARGET_ICNS"
echo "generated: $TARGET_ICNS"
