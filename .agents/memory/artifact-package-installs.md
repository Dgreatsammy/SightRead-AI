---
name: Artifact package installs
description: Workspace-specific dependency installation behavior for this pnpm monorepo.
---

When adding a dependency to an artifact package, use the package's pnpm filter so the dependency is not added to the monorepo root.

**Why:** The managed package installer currently rejects workspace-root additions and does not accept pnpm filter flags as package tokens.

**How to apply:** Target the artifact package explicitly with pnpm when the managed installer cannot scope the request; verify the package manifest and lockfile afterward.