# Audiveris OCR language data

Audiveris uses Tesseract to read lyrics, titles, composer credits, and
dynamic markings printed on the page. Without a trained language file here,
it silently skips text recognition, and lyric syllables get misread as
musical symbols instead (stray dynamics, trill marks, octave-shift clefs).

This directory is intentionally empty in git (language files are ~20-30MB
each and are not source code). Run this once after cloning, and again after
any fresh Replit environment/deploy that doesn't persist this folder:

    pnpm run setup:ocr

This downloads `eng.traineddata` from the official tesseract-ocr/tessdata
repo (the standard model, not `tessdata_fast` -- Audiveris needs the legacy
engine data that only the standard model includes).

For scores in other languages (German, Latin, Italian are common in choral
music), download the matching file the same way and add its code, e.g.:

    curl -L -o deu.traineddata \
      https://raw.githubusercontent.com/tesseract-ocr/tessdata/main/deu.traineddata
