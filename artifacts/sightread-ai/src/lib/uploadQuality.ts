/**
 * Advisory check on an uploaded score image. Optical music recognition needs
 * enough pixels between staff lines; a small picture (a screenshot, a thumbnail,
 * a low-quality photo) is the main cause of wrong notes, stray rests and
 * garbled lyrics. This only ever produces a warning - it never blocks an upload.
 */
export const MIN_RECOMMENDED_LONG_SIDE = 2000;

export function assessImageResolution(
  width: number,
  height: number,
): string | null {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (width <= 0 || height <= 0) return null;
  const longSide = Math.max(width, height);
  if (longSide >= MIN_RECOMMENDED_LONG_SIDE) return null;
  return (
    `This image is small (${Math.round(width)} × ${Math.round(height)} px), ` +
    `so notes, rests and words may be read wrongly. For the best result, ` +
    `upload the PDF, or a scan or photo at least ${MIN_RECOMMENDED_LONG_SIDE} px ` +
    `on its long side (about 300 dpi for a full page).`
  );
}

/** Reads an image file's pixel size without keeping it in memory. */
export async function readImageSize(
  file: Blob,
): Promise<{ width: number; height: number } | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return null;
  }
}
