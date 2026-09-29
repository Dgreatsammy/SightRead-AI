#!/usr/bin/env bash
# Downloads Tesseract language data Audiveris needs for lyric/text OCR.
# Safe to re-run; skips files that already exist.
set -euo pipefail
DEST="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/tools/audiveris/tessdata"
mkdir -p "$DEST"
LANGS=("${@:-eng}")
for lang in "${LANGS[@]}"; do
  target="$DEST/$lang.traineddata"
  if [ -f "$target" ]; then
    echo "skip: $lang.traineddata already present"
    continue
  fi
  echo "downloading: $lang.traineddata"
  curl -fL -o "$target" \
    "https://raw.githubusercontent.com/tesseract-ocr/tessdata/main/$lang.traineddata"
done
echo "done. TESSDATA_PREFIX should point at: $DEST"
