# syntax=docker/dockerfile:1.7
# ReMix API + worker image. Build from the repo root:
#   docker build -f apps/api/Dockerfile -t remix-api .
# Run the API:    docker run -p 4000:4000 -e DATABASE_URL=… -e TENANT_BASE_DOMAINS=… -e TRUST_PROXY=… remix-api
# Run the worker: docker run remix-api node --enable-source-maps dist/worker.js

ARG NODE_IMAGE=node:24-bookworm-slim

# ── build: install the workspace slice, bundle, then produce a prod-only deploy folder ──
FROM ${NODE_IMAGE} AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable
WORKDIR /repo

# Manifests first so the dependency layer is cached across source changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/
COPY packages/types/package.json packages/types/
COPY packages/config/package.json packages/config/
COPY packages/db/package.json packages/db/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @remix/api...

COPY packages/config packages/config
COPY packages/types packages/types
COPY packages/db packages/db
COPY apps/api apps/api
RUN pnpm --filter @remix/api build \
 && pnpm --filter @remix/api deploy --prod --legacy /out \
 && cp -r apps/api/dist /out/dist

# ── runtime: production dependencies + bundle only, non-root ──
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production PORT=4000
WORKDIR /app
COPY --from=build --chown=node:node /out/package.json ./package.json
COPY --from=build --chown=node:node /out/node_modules ./node_modules
COPY --from=build --chown=node:node /out/dist ./dist
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 4000) + '/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "--enable-source-maps", "dist/main.js"]
