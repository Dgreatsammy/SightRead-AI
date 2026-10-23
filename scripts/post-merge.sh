#!/bin/bash
# Replit runs this automatically after every git merge or pull.
#
# Keep it LIGHT. The previous version ran a full `pnpm install` (with every
# package's install scripts) plus a database push. That started dozens of
# background processes at once, got cut off by the time limit, and left the
# workspace unable to run any command ("fork: Resource temporarily unavailable").
# The app does not use the database, so there is nothing to push.
set -e
pnpm install --frozen-lockfile --ignore-scripts \
  --filter "@workspace/sightread-ai..." --filter "@workspace/api-server..."
