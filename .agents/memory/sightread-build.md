---
name: SightRead artifact build
description: Environment requirement for validating the SightRead AI Vite artifact locally.
---

The SightRead AI artifact's Vite configuration requires both `PORT` and `BASE_PATH` during a production build.

**Why:** A bare package build fails before Vite transforms the app when either variable is absent, even though the managed preview workflow supplies them.

**How to apply:** Set the preview port and mounted base path when running a local validation build, for example `PORT=18449 BASE_PATH=/ pnpm --filter @workspace/sightread-ai run build`.