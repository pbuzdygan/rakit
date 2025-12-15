# ───────────────────────────────────────────────
# 1️⃣ BUILD STAGE
# ───────────────────────────────────────────────
FROM node:20-bookworm-slim AS build
ARG APP_VERSION=dev
ARG APP_REPO=buzuser/rakit_dev
ARG APP_CHANNEL=main
ENV VITE_APP_VERSION=$APP_VERSION
ENV VITE_GITHUB_REPO=$APP_REPO
ENV VITE_APP_CHANNEL=$APP_CHANNEL

WORKDIR /app

# --- Systemowe zależności tylko dla natywnych modułów ---
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ pkg-config \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=development

# --- Używamy cache npm ---
COPY backend/package*.json ./backend/
COPY frontend/package*.json ./frontend/

# --- Instalacja zależności (z fallbackiem, szybciej) ---
RUN cd backend && (npm ci --no-audit --prefer-offline || npm install --legacy-peer-deps --no-audit --no-fund)
RUN cd frontend && (npm ci --no-audit --prefer-offline || npm install --legacy-peer-deps --no-audit --no-fund)

# --- Skopiowanie kodu ---
COPY backend ./backend
COPY frontend ./frontend

# --- Build frontendu ---
RUN cd frontend && npm run build || (echo "⚠️ Frontend build failed, placeholder" && mkdir -p dist && \
    printf '<!doctype html><html><head><meta charset=\"utf-8\"><title>Rakit</title></head><body><h1>Frontend failed to build. Run docker compose build --no-cache --progress=plain to inspect logs.</h1></body></html>' > dist/index.html)

RUN npm cache clean --force

# ───────────────────────────────────────────────
# 2️⃣ RUNTIME STAGE
# ───────────────────────────────────────────────
FROM node:20-bookworm-slim AS runtime
ARG APP_VERSION=dev
ARG APP_REPO=buzuser/rakit_dev
ARG APP_CHANNEL=main
ENV APP_VERSION=$APP_VERSION
ENV APP_REPO=$APP_REPO
ENV APP_CHANNEL=$APP_CHANNEL

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8011
EXPOSE 8011

# --- Minimalne biblioteki dla SQLite ---
RUN apt-get update && apt-get install -y --no-install-recommends \
    libsqlite3-0 \
 && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/backend /app
COPY --from=build /app/frontend/dist /app/public

RUN npm ci --omit=dev --no-audit --prefer-offline && npm cache clean --force

RUN mkdir -p /data

CMD ["node", "server.js"]
