# syntax=docker/dockerfile:1.8

ARG NODE_IMAGE=node:24.19.0-trixie-slim@sha256:ab3eebe934147fee049b5eb83c570f68c849a13c930bdfa482de99fcdfa3b3de
ARG RUNTIME_IMAGE=debian:trixie-slim@sha256:d7e12182ce18b85b93007c1dedf31f2d29e01ccf3182cc4017c709b6259bc132

FROM ${NODE_IMAGE} AS frontend-build
ARG APP_VERSION=dev
ARG APP_REPO=buzuser/rakit_dev
ARG APP_CHANNEL=main
ENV VITE_APP_VERSION=$APP_VERSION \
    VITE_GITHUB_REPO=$APP_REPO \
    VITE_APP_CHANNEL=$APP_CHANNEL
WORKDIR /build/frontend
COPY frontend/package*.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --ignore-scripts --no-audit --no-fund
COPY frontend ./
RUN npm run build

FROM ${NODE_IMAGE} AS backend-deps
ARG TARGETARCH=amd64
ENV NODE_ENV=production
WORKDIR /build/backend
COPY backend/package*.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY backend ./
RUN node --check server.js \
 && node --check db.js \
 && node --check ipdashClient.js \
 && node --check export.js \
 && case "$TARGETARCH" in amd64) native_arch=x64 ;; arm64) native_arch=arm64 ;; *) echo "Unsupported architecture: $TARGETARCH" >&2; exit 1 ;; esac \
 && find node_modules/better-sqlite3/prebuilds -type f ! -name "linux-${native_arch}.node" -delete \
 && find node_modules -type f -name '*.map' -delete \
 && rm -rf node_modules/@types \
              node_modules/better-sqlite3/build \
              node_modules/better-sqlite3/deps \
              node_modules/better-sqlite3/src \
 && rm -rf test

FROM ${RUNTIME_IMAGE} AS runtime
ARG APP_VERSION=dev
ARG APP_REPO=buzuser/rakit_dev
ARG APP_CHANNEL=main
ARG APP_REVISION=unknown
ENV APP_VERSION=$APP_VERSION \
    APP_REPO=$APP_REPO \
    APP_CHANNEL=$APP_CHANNEL \
    NODE_ENV=production \
    NODE_USE_SYSTEM_CA=1 \
    PORT=8011
LABEL org.opencontainers.image.title="Rakit" \
      org.opencontainers.image.description="Self-hosted infrastructure operations console" \
      org.opencontainers.image.source="https://github.com/${APP_REPO}" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.revision="${APP_REVISION}"

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates dumb-init libstdc++6 tzdata \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --gid 1000 node \
 && useradd --uid 1000 --gid node --home-dir /nonexistent --shell /usr/sbin/nologin --no-create-home node \
 && install -d -o root -g root -m 0755 /app \
 && install -d -o node -g node -m 0700 /data

COPY --from=backend-deps /usr/local/bin/node /usr/local/bin/node
COPY --from=backend-deps /usr/local/LICENSE /usr/local/share/licenses/node/LICENSE
COPY --from=backend-deps --chmod=0555 /build/backend /app
COPY --from=frontend-build --chmod=0555 /build/frontend/dist /app/public

WORKDIR /app
VOLUME ["/data"]
EXPOSE 8011
USER node
RUN test -r /app/server.js \
 && test -r /app/schema.sql \
 && test -r /app/public/index.html \
 && test ! -w /app

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8011)+'/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "server.js"]
