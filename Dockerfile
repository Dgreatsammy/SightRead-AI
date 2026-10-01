# syntax=docker/dockerfile:1

# SightRead AI — single-container image.
# The Express server (api-server) serves both the API/OMR routes and the
# built React frontend (see artifacts/api-server/src/app.ts), so this is
# one deployable image, not a separate frontend/backend split.
#
# Base is Debian (bookworm), not Alpine: Audiveris's bundled native libs
# (leptonica/tesseract .so files) are glibc-linked (need glibc >= 2.34),
# which musl-based Alpine does not provide.

FROM node:22-bookworm-slim AS base

# System libraries required at runtime:
# - fontconfig/fonts-dejavu-core/libfreetype6: Java/AWT text layout, even headless
# - libgomp1: OpenMP runtime used by leptonica
# - ca-certificates/curl: fetching the Tesseract OCR language file at build time
RUN apt-get update && apt-get install -y --no-install-recommends \
      fontconfig \
      fonts-dejavu-core \
      libfreetype6 \
      libgomp1 \
      ca-certificates \
      curl \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable

WORKDIR /app

# ---- Build the app ----
# A prior version of this stage copied each workspace package's package.json
# in individually (for layer-cache reuse between dependency and source
# changes), but that list silently drifted out of sync with the actual repo
# (it's missed real workspace packages before) and broke the build with
# ERR_PNPM_OUTDATED_LOCKFILE. Copying the whole repo before installing is
# slightly less cache-efficient but cannot miss a workspace package: pnpm
# always sees every importer the lockfile expects.
FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
# The frontend build script reads PORT/BASE_PATH at build time even though
# they don't affect a static build's runtime behavior; values here just need
# to be valid, the real PORT is supplied by Railway/Render at container start.
RUN PORT=5173 BASE_PATH=/ pnpm --filter @workspace/sightread-ai run build \
 && pnpm --filter @workspace/api-server run build

# Tesseract language data Audiveris needs for OCR (see tools/audiveris/tessdata/README.md).
# Baked into the image at build time so it survives container restarts/redeploys
# without depending on persistent disk.
RUN bash scripts/setup-ocr.sh eng

# esbuild bundled almost everything into dist/index.mjs; sharp is the one real
# native runtime dependency left outside the bundle (see build.mjs's "external"
# list). Pruning devDependencies via pnpm (rather than hand-picking files) lets
# pnpm correctly resolve sharp's own transitive dependency tree.
RUN pnpm prune --prod

# ---- Runtime image ----
FROM base AS runtime
ENV NODE_ENV=production

# Audiveris (bundled JRE + jars) and the OCR language data it needs
COPY --from=build /app/tools/audiveris /app/tools/audiveris

# Built server + its production node_modules
COPY --from=build /app/artifacts/api-server/dist /app/artifacts/api-server/dist
COPY --from=build /app/artifacts/api-server/package.json /app/artifacts/api-server/package.json
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/artifacts/api-server/node_modules /app/artifacts/api-server/node_modules

# Built frontend (served by the Express app via express.static)
COPY --from=build /app/artifacts/sightread-ai/dist /app/artifacts/sightread-ai/dist

WORKDIR /app/artifacts/api-server

# Railway and Render both inject PORT at runtime; index.ts requires it to be set.
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:'+process.env.PORT+'/api/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--enable-source-maps", "./dist/index.mjs"]
