---
name: SightRead OMR portability
description: Deployment constraints and output-format assumptions for Audiveris imports.
---

Audiveris imports must not depend on an OS-level ZIP executable, and the import path must accept either a packaged MXL result or a direct MusicXML result.

Raster score images also need enough pixel density for Audiveris to detect staff spacing, and uploaded filenames must retain their extension when passed to Audiveris.

**Why:** The deployed runtime may not provide `unzip`; output format can vary by input; and real uploads showed that extensionless PDFs skipped export while 100-DPI raster scores were rejected for a 7-pixel interline.

**How to apply:** Keep archive handling in Node, preserve the safe original extension, upscale low-resolution raster scores, report malformed containers clearly, and inspect output files before treating an OMR run as successful.