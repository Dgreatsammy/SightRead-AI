import JSZip from "jszip";
import { promises as fs } from "node:fs";

export async function extractMusicXmlFromMxl(mxlPath: string): Promise<string> {
  let archive: JSZip;
  try {
    archive = await JSZip.loadAsync(await fs.readFile(mxlPath));
  } catch {
    throw new Error(
      "Audiveris produced an MXL file that is missing or malformed and could not be opened.",
    );
  }

  const containerEntry = archive.file(/(^|\/)META-INF\/container\.xml$/i)[0];
  if (!containerEntry) {
    throw new Error("Audiveris MXL did not contain META-INF/container.xml.");
  }

  const containerXml = await containerEntry.async("string");
  const rootfileMatch = containerXml.match(/full-path=["']([^"']+)["']/i);
  if (!rootfileMatch?.[1]) {
    throw new Error("Audiveris MXL did not contain a root MusicXML file.");
  }

  const rootfilePath = rootfileMatch[1].replace(/^\.?\//, "");
  const rootfileEntry = archive.file(rootfilePath);
  if (!rootfileEntry) {
    throw new Error(
      `Audiveris MXL referenced a missing MusicXML file: ${rootfileMatch[1]}.`,
    );
  }

  return rootfileEntry.async("string");
}