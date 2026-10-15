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

/** How many pages the server reads from one upload (keep in step with the server). */
export const MAX_PAGES_READ = 4;

/** The longest the app waits for a score to be read before giving up. */
export const OMR_WAIT_LIMIT_SECONDS = 300;

/**
 * Estimates a PDF's page count from its raw bytes, without a PDF library.
 * Returns null when it can't tell (some PDFs hide this information).
 */
export function estimatePdfPageCount(bytes: Uint8Array): number | null {
  // Latin-1 keeps every byte as one character, which is all we need for tags.
  let text = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    text += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  let best = 0;
  for (const match of text.matchAll(/\/Type\s*\/Pages[^>]*?\/Count\s+(\d+)/g)) {
    best = Math.max(best, Number(match[1]));
  }
  for (const match of text.matchAll(/\/Count\s+(\d+)[^>]*?\/Type\s*\/Pages/g)) {
    best = Math.max(best, Number(match[1]));
  }
  if (best === 0) {
    best = (text.match(/\/Type\s*\/Page(?![a-zA-Z])/g) ?? []).length;
  }
  return best > 0 ? best : null;
}

export function assessPdfPages(
  pageCount: number | null,
  maxPages = MAX_PAGES_READ,
): string | null {
  if (pageCount === null || pageCount <= maxPages) return null;
  return (
    `This PDF has about ${pageCount} pages, but only the first ${maxPages} are read, ` +
    `and each page takes about a minute. A long score such as a full chorus will be cut short ` +
    `or may time out. For the best result, upload just the page or pages you want to practise.`
  );
}

/** What to tell someone while a score is being read, by seconds waited. */
export function omrWaitMessage(seconds: number): string {
  if (seconds < 20) return "Converting your scanned page into notes.";
  if (seconds < 90)
    return "Still working. This step can take a few minutes, especially for photos or larger pages.";
  if (seconds < 180)
    return `Still working (${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s). Each page takes about a minute, so more pages take longer.`;
  return (
    `This is taking longer than usual (${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s). ` +
    `A long or many-page score may not finish. You can cancel and try just one or two pages.`
  );
}
