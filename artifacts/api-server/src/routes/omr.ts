import { Router, type IRouter } from "express";
import multer from "multer";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const router: IRouter = Router();

const upload = multer({
  dest: path.join(os.tmpdir(), "sightread-omr"),
  limits: {
    fileSize: 15 * 1024 * 1024,
  },
});

const execFileAsync = promisify(execFile);

const serverDistDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(serverDistDir, "../../..");
const audiverisRoot =
  process.env["AUDIVERIS_HOME"] ||
  path.join(projectRoot, "tools/audiveris/runtime/opt/audiveris");
const audiverisRuntime = path.join(audiverisRoot, "lib/runtime");
const AUDIVERIS_JAVA = path.join(audiverisRuntime, "bin/java");
const AUDIVERIS_APP = path.join(audiverisRoot, "lib/app");

router.post("/omr", upload.single("file"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "No score image was uploaded." });
    return;
  }

  const outputDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "sightread-omr-output-"),
  );

  try {
    const jarFiles = await collectJarFiles(AUDIVERIS_APP);

    if (jarFiles.length === 0) {
      throw new Error("Audiveris application JARs were not found.");
    }

    const classpath = jarFiles.join(path.delimiter);

    await execFileAsync(
      AUDIVERIS_JAVA,
      [
        "-Djava.awt.headless=true",
        "-Dsun.java2d.uiScale=1",
        "--enable-native-access=ALL-UNNAMED",
        "-cp",
        classpath,
        "org.audiveris.omr.Main",
        "-batch",
        "-transcribe",
        "-export",
        "-output",
        outputDir,
        req.file.path,
      ],
      {
        maxBuffer: 10 * 1024 * 1024,
        env: {
          ...process.env,
          JAVA_HOME: audiverisRuntime,
          LD_LIBRARY_PATH: [
            path.join(audiverisRuntime, "lib"),
            process.env["LD_LIBRARY_PATH"],
            process.env["NIX_LD_LIBRARY_PATH"],
          ]
            .filter(Boolean)
            .join(path.delimiter),
          PATH: [
            path.join(audiverisRuntime, "bin"),
            process.env["PATH"],
          ]
            .filter(Boolean)
            .join(path.delimiter),
        },
      },
    );

    const files = await fs.readdir(outputDir);
    const musicXmlFile = files.find((file) => /\.mxl$/i.test(file));

    if (!musicXmlFile) {
      throw new Error("Audiveris completed but did not produce MusicXML.");
    }

    const mxlPath = path.join(outputDir, musicXmlFile);
    const xml = await extractMusicXmlFromMxl(mxlPath);

    res.json({
      success: true,
      musicXml: xml,
      source: "audiveris",
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "OMR processing failed.";

    res.status(500).json({
      error: message,
    });
  } finally {
    await fs.rm(req.file.path, { force: true }).catch(() => {});
    await fs.rm(outputDir, { recursive: true, force: true }).catch(() => {});
  }
});

async function collectJarFiles(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const jars: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      jars.push(...(await collectJarFiles(entryPath)));
    } else if (entry.isFile() && entry.name.endsWith(".jar")) {
      jars.push(entryPath);
    }
  }

  return jars;
}

async function extractMusicXmlFromMxl(mxlPath: string): Promise<string> {
  const extractDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "sightread-mxl-"),
  );

  try {
    const { execFileSync } = await import("node:child_process");

    execFileSync("unzip", ["-q", "-o", mxlPath, "-d", extractDir]);

    const containerPath = path.join(extractDir, "META-INF", "container.xml");
    const containerXml = await fs.readFile(containerPath, "utf8");

    const rootfileMatch = containerXml.match(
      /full-path=["']([^"']+)["']/i,
    );

    if (!rootfileMatch) {
      throw new Error("Audiveris MXL did not contain a root MusicXML file.");
    }

    const xmlPath = path.join(extractDir, rootfileMatch[1]);
    return await fs.readFile(xmlPath, "utf8");
  } finally {
    await fs.rm(extractDir, { recursive: true, force: true }).catch(() => {});
  }
}

export default router;
