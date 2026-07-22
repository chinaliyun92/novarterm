#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC_ICON="${ROOT}/resources/AppIcon.png"
OUT_ICON="${ROOT}/build/icon.ico"

if [[ ! -f "$SRC_ICON" ]]; then
  echo "source icon not found: $SRC_ICON" >&2
  exit 1
fi

if ! command -v sips >/dev/null 2>&1; then
  echo "sips not found; cannot generate Windows icon." >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 not found; cannot generate Windows icon." >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

SIZES=(16 32 48 64 128 256)
for size in "${SIZES[@]}"; do
  sips -z "$size" "$size" "$SRC_ICON" --out "${TMP_DIR}/icon-${size}.png" >/dev/null
done

TMP_DIR="$TMP_DIR" OUT_ICON="$OUT_ICON" python3 - <<'PY'
import os
import struct

tmp_dir = os.environ["TMP_DIR"]
out_path = os.environ["OUT_ICON"]

sizes = [16, 32, 48, 64, 128, 256]
images = []
for size in sizes:
    path = os.path.join(tmp_dir, f"icon-{size}.png")
    with open(path, "rb") as f:
        data = f.read()
    width = 0 if size == 256 else size
    height = 0 if size == 256 else size
    images.append((width, height, data))

count = len(images)
offset = 6 + 16 * count
entries = []
for width, height, data in images:
    entry = struct.pack(
        "<BBBBHHII",
        width,
        height,
        0,   # color count
        0,   # reserved
        1,   # planes
        32,  # bit count
        len(data),
        offset,
    )
    entries.append(entry)
    offset += len(data)

with open(out_path, "wb") as f:
    f.write(struct.pack("<HHH", 0, 1, count))
    for entry in entries:
        f.write(entry)
    for _, _, data in images:
        f.write(data)
PY

echo "generated: ${OUT_ICON}"
