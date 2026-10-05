import { Router, type IRouter } from "express";
import multer from "multer";
import sharp from "sharp";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { extractMusicXmlFromMxl } from "../lib/mxl.js";
import { sanitizeAudiverisMusicXml } from "../lib/sanitizeAudiverisMusicXml.js";

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
// Audiveris uses Tesseract OCR to read lyrics, titles, and dynamic markings.
// Without trained language data it silently skips text recognition and
// misreads lyric syllables as musical symbols (stray dynamics, trills,
// octave-shift marks). See tools/audiveris/tessdata/README.md for setup.
const AUDIVERIS_TESSDATA_PREFIX =
  process.env["AUDIVERIS_TESSDATA_PREFIX"] ||
  path.join(projectRoot, "tools/audiveris/tessdata");
// Modern JVMs (Java 10+) auto-detect a container's cgroup memory limit and
// size the default heap accordingly, so this is normally unset. It exists as
// a manual override for tuning against real numbers from a host's metrics
// (e.g. Railway's dashboard) if the default sizing ever proves too
// aggressive or too conservative for this workload. Example: "1536m".
const AUDIVERIS_JAVA_MAX_HEAP = process.env["AUDIVERIS_JAVA_MAX_HEAP"];

router.post(
  "/omr",
  (req, _res, next) => {
    console.log(
      "[OMR] request reached upload middleware:",
      req.method,
      req.path,
    );
    next();
  },
  upload.single("file"),
  async (req, res) => {
    console.log("[OMR] upload middleware completed:", req.file?.originalname);
    if (!req.file) {
      res.status(400).json({ error: "No score image was uploaded." });
      return;
    }

    const outputDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "sightread-omr-output-"),
    );
    const temporaryInputPaths = new Set([req.file.path]);

    try {
      const originalExtension = path
        .extname(req.file.originalname)
        .toLowerCase();
      let inputPath = req.file.path;

      if (originalExtension) {
        const namedInputPath = `${req.file.path}${originalExtension}`;
        await fs.rename(req.file.path, namedInputPath);
        temporaryInputPaths.add(namedInputPath);
        inputPath = namedInputPath;
      }

      if (/\.(png|jpe?g)$/i.test(originalExtension)) {
        const upscaledInputPath = path.join(outputDir, "upscaled-input.png");
        await prepareRasterInput(inputPath, upscaledInputPath);
        temporaryInputPaths.add(upscaledInputPath);
        inputPath = upscaledInputPath;
      }

      const jarFiles = await collectJarFiles(AUDIVERIS_APP);

      if (jarFiles.length === 0) {
        throw new Error("Audiveris application JARs were not found.");
      }

      const classpath = jarFiles.join(path.delimiter);

      try {
        await execFileAsync(
          AUDIVERIS_JAVA,
          [
            "-Djava.awt.headless=true",
            "-Dsun.java2d.uiScale=1",
            "--enable-native-access=ALL-UNNAMED",
            ...(AUDIVERIS_JAVA_MAX_HEAP
              ? [`-Xmx${AUDIVERIS_JAVA_MAX_HEAP}`]
              : []),
            "-cp",
            classpath,
            "org.audiveris.omr.Main",
            "-batch",
            "-transcribe",
            "-export",
            "-output",
            outputDir,
            inputPath,
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
              PATH: [path.join(audiverisRuntime, "bin"), process.env["PATH"]]
                .filter(Boolean)
                .join(path.delimiter),
              TESSDATA_PREFIX: AUDIVERIS_TESSDATA_PREFIX,
            },
          },
        );
      } catch (error) {
        throw new Error(formatAudiverisFailure(error));
      }

      const files = await listFilesRecursive(outputDir);
      const musicXmlFile =
        files.find((file) => /\.mxl$/i.test(file)) ??
        files.find(
          (file) =>
            /\.(musicxml|xml)$/i.test(file) &&
            !/META-INF[/\\]container\.xml$/i.test(file),
        );

      if (!musicXmlFile) {
        const outputSummary =
          files.length > 0 ? ` Output files: ${files.join(", ")}.` : "";
        throw new Error(
          `Audiveris completed but did not produce MusicXML.${outputSummary}`,
        );
      }

      const mxlPath = path.join(outputDir, musicXmlFile);
      const rawXml = /\.mxl$/i.test(musicXmlFile)
        ? await extractMusicXmlFromMxl(mxlPath)
        : await fs.readFile(mxlPath, "utf8");

      // Repairs a specific, observed Audiveris misreading (a decorative
      // range-indicator glyph read as a fake pickup measure, which both
      // shifts every later barline and orphans the first lyric). See the
      // function's own comment for the full explanation. No-ops on input
      // that doesn't match that exact pattern.
      const xml = sanitizeAudiverisMusicXml(rawXml);

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
      await Promise.all(
        [...temporaryInputPaths].map((inputPath) =>
          fs.rm(inputPath, { force: true }).catch(() => {}),
        ),
      );
      await fs.rm(outputDir, { recursive: true, force: true }).catch(() => {});
    }
  },
);

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

async function listFilesRecursive(
  directory: string,
  relativeDirectory = "",
): Promise<string[]> {
  const entries = await fs.readdir(path.join(directory, relativeDirectory), {
    withFileTypes: true,
  });
  const files: string[] = [];

  for (const entry of entries) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursive(directory, relativePath)));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }

  return files;
}

function formatAudiverisFailure(error: unknown) {
  if (!error || typeof error !== "object") {
    return "Audiveris failed while processing the score.";
  }

  const details = error as {
    code?: unknown;
    message?: unknown;
    signal?: unknown;
    stderr?: unknown;
    stdout?: unknown;
  };
  const message =
    typeof details.message === "string"
      ? details.message
      : "Audiveris failed while processing the score.";
  const status =
    typeof details.code === "number"
      ? ` Exit code: ${details.code}.`
      : typeof details.signal === "string"
        ? ` Signal: ${details.signal}.`
        : "";
  const stderr =
    typeof details.stderr === "string" ? details.stderr.trim() : "";
  const stdout =
    typeof details.stdout === "string" ? details.stdout.trim() : "";
  const output = [stderr, stdout].filter(Boolean).join("\n").trim();
  const diagnostic = output ? ` Audiveris output:\n${output.slice(-5000)}` : "";
  return `${message}.${status}${diagnostic}`;
}

async function prepareRasterInput(
  inputPath: string,
  outputPath: string,
): Promise<void> {
  const image = sharp(inputPath);
  const metadata = await image.metadata();
  const width = metadata.width;
  const height = metadata.height;

  if (!width || !height) {
    throw new Error("The uploaded raster score has no readable dimensions.");
  }

  const sourceDensity = metadata.density ?? 0;
  // sharp reports 72 dpi for JPEG/PNG files that carry no density metadata.
  // That sentinel says nothing about the scan, so treating it as a real
  // reading makes Math.min(3, 300 / 72) saturate at 3 and, via the Math.max
  // below, force a 3x upscale on every default-density JPEG no matter how
  // large it already is. Real declared densities (100 dpi scans, 300 dpi
  // scans) are unaffected and keep driving the upscale.
  const declaredDensity = sourceDensity > 72 ? sourceDensity : 0;
  const densityScale =
    declaredDensity > 0 ? Math.min(3, 300 / declaredDensity) : 1;
  const dimensionScale =
    Math.max(width, height) < 2200
      ? Math.min(3, 2200 / Math.max(width, height))
      : 1;
  const scale = Math.max(densityScale, dimensionScale);

  let pipeline = image
    .rotate()
    .flatten({ background: "#ffffff" })
    .grayscale()
    .normalize()
    .sharpen({ sigma: 1 });

  if (scale > 1.05) {
    pipeline = pipeline.resize({
      width: Math.round(width * scale),
      height: Math.round(height * scale),
      kernel: sharp.kernel.lanczos3,
    });
  }

  await pipeline
    .png()
    .withMetadata({ density: 300 })
    .toFile(outputPath);
}

export default router;
