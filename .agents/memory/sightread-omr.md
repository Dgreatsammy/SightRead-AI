---
name: SightRead OMR portability
description: Deployment constraints and output-format assumptions for Audiveris imports.
---

Audiveris imports must not depend on an OS-level ZIP executable, and the import path must accept either a packaged MXL result or a direct MusicXML result.

**Why:** The deployed runtime may not provide `unzip`, and Audiveris output format can vary by input and runtime while remaining a valid export.

**How to apply:** Keep archive handling in the Node server, report malformed containers clearly, and inspect the actual output files before treating an OMR run as successful.