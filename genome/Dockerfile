# syntax=docker/dockerfile:1
#
# ORBES GENOME CODE: verification API, admin console and web apps in one image.
#
#   docker build -t orbes-genome .
#   docker run --env-file .env -p 8080:8080 -v orbes-keys:/var/lib/orbes/keys orbes-genome
#
# The image runs the TypeScript sources with tsx (a runtime dependency) and
# serves the web apps built in the `web` stage. It holds no secrets and no
# keys: configuration comes from the environment (see .env.example), signing
# keys live encrypted in the /var/lib/orbes/keys volume (KEY_PROVIDER=local).
#
# Operator commands run in the same image, e.g.
#   docker compose exec app node --import tsx scripts/keys.ts generate
#   docker compose exec app node --import tsx scripts/db.ts migrate

ARG NODE_IMAGE=node:22-slim

# ── 1. Production dependencies ─────────────────────────────────────────────
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
ENV NODE_ENV=production \
    npm_config_audit=false \
    npm_config_fund=false \
    npm_config_update_notifier=false
COPY package.json package-lock.json ./
# --omit=dev: the only dev dependency is playwright-core (browser E2E tests).
# --ignore-scripts: no third-party install script runs at build time; esbuild
# (used by the web build and by tsx) finds its @esbuild/<platform> binary
# without its optional postinstall step.
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    npm ci --omit=dev --ignore-scripts

# ── 2. Web apps (esbuild → dist/web, content-hashed) ───────────────────────
FROM deps AS web
COPY tsconfig.json ./
COPY scripts/build-web.ts ./scripts/
COPY src ./src
RUN npm run build:web

# ── 3. Runtime ─────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS runtime
LABEL org.opencontainers.image.title="ORBES GENOME CODE" \
      org.opencontainers.image.description="ORBES product identity and authentication service" \
      org.opencontainers.image.vendor="ORBES"
ENV NODE_ENV=production \
    ORBES_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    KEY_PROVIDER=local \
    KEY_DIR=/var/lib/orbes/keys \
    npm_config_update_notifier=false \
    npm_config_fund=false
WORKDIR /app

# Key directory: owned by the unprivileged `node` user (uid 1000), mode 0700 as
# LocalKeyProvider requires. A fresh named volume inherits this ownership.
RUN mkdir -p /var/lib/orbes/keys \
 && chown -R node:node /var/lib/orbes \
 && chmod 0700 /var/lib/orbes/keys

# Application files stay root-owned and read-only for the process user.
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.json ./
COPY src/core ./src/core
COPY src/server ./src/server
COPY scripts/db.ts scripts/keys.ts ./scripts/
COPY --from=web /app/dist/web ./dist/web

USER node
EXPOSE 8080
VOLUME ["/var/lib/orbes/keys"]

# Node 22 has fetch built in (the slim image has no curl). /api/v1/health also
# checks the database round trip and answers 503 when it is unreachable.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/v1/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]

# index.ts drains requests and closes the database on SIGTERM.
STOPSIGNAL SIGTERM
CMD ["node", "--import", "tsx", "src/server/index.ts"]
