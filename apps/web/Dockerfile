# syntax=docker/dockerfile:1.7
# ReMix web image (tenant sites, student portal, admin). Build from the repo root:
#   docker build -f apps/web/Dockerfile -t remix-web .
# Run: docker run -p 3001:3001 -e API_INTERNAL_URL=http://api:4000 -e TENANT_BASE_DOMAINS=remix.lk \
#        -e PLATFORM_HOSTS=admin.remix.lk remix-web
#
# Next.js bakes rewrites in at build time. Production routes /api/v1 at the edge proxy (ADR 0003),
# so the default build has no rewrite; local staging (`pnpm stack:prod`) builds with
# WEB_API_REWRITE=true and API_INTERNAL_URL pointing at the API container.

ARG NODE_IMAGE=node:24-bookworm-slim

# ── build: install the workspace slice and run `next build` (standalone output) ──
FROM ${NODE_IMAGE} AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true NEXT_TELEMETRY_DISABLED=1
# Slow or flaky networks (the supply-chain policy check queries the registry for every package).
ENV npm_config_fetch_timeout=300000 npm_config_fetch_retries=5
RUN corepack enable
WORKDIR /repo

# Manifests first so the dependency layer is cached across source changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/web/package.json apps/web/
COPY packages/types/package.json packages/types/
COPY packages/ui/package.json packages/ui/
COPY packages/config/package.json packages/config/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @remix/web...

COPY packages/config packages/config
COPY packages/types packages/types
COPY packages/ui packages/ui
COPY apps/web apps/web

ARG WEB_API_REWRITE=false
ARG API_INTERNAL_URL=http://api:4000
ENV WEB_STANDALONE=true WEB_API_REWRITE=${WEB_API_REWRITE} API_INTERNAL_URL=${API_INTERNAL_URL}
RUN pnpm --filter @remix/web build

# ── runtime: the standalone server only, non-root ──
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production PORT=3001 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
# Patch CVE-2026-103111 until the Node base image includes Debian's fixed PCRE2 package.
RUN apt-get update -o APT::Update::Error-Mode=any \
 && apt-get install -y --no-install-recommends --only-upgrade libpcre2-8-0 \
 && dpkg --compare-versions "$(dpkg-query -W -f='${Version}' libpcre2-8-0)" ge 10.42-1+deb12u2 \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=3s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3001) + '/_next/static/').then((r) => process.exit(r.status < 500 ? 0 : 1), () => process.exit(1))"]
CMD ["node", "apps/web/server.js"]
