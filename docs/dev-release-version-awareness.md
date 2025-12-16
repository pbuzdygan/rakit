# Mechanizm release `dev` i version awareness w Mopay

Dokument opisuje kompletne elementy wymagane do repliki funkcjonalności **release dev + alias `dev_latest`** oraz **Version awareness**. Zawiera docelowe fragmenty kodu z Mopay (`mopay_dev`), dzięki czemu można przenieść rozwiązanie do innej aplikacji bez odwoływania się do repozytorium źródłowego.

---

## 1. GitHub Actions – publikacja obrazu z kanałami `main` / `dev`

Workflow wyzwala się tylko dla opublikowanych releasów i buduje obraz, gdy release wskazuje na gałąź `main` lub `dev`. Kanał (`APP_CHANNEL`) ustalany jest na podstawie gałęzi releasu; dodatkowo obraz z gałęzi `dev` otrzymuje alias `dev_latest`.

```yaml
name: Publish Docker image to GHCR

on:
  release:
    types: [ published ]

jobs:
  build-and-push:
    if: github.event.release.target_commitish == 'main' || github.event.release.target_commitish == 'dev'
    runs-on: ubuntu-latest

    permissions:
      contents: read
      packages: write

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Determine build version
        id: vars
        env:
          RELEASE_BRANCH: ${{ github.event.release.target_commitish }}
        run: |
          if [[ "${GITHUB_REF}" == refs/tags/* ]]; then
            VERSION="${GITHUB_REF#refs/tags/}"
          else
            VERSION="0.0.0-${GITHUB_SHA::7}"
          fi
          CHANNEL="main"
          if [[ "${RELEASE_BRANCH}" == "dev" ]]; then
            CHANNEL="dev"
          fi
          {
            echo "version=$VERSION"
            echo "channel=$CHANNEL"
          } >> "$GITHUB_OUTPUT"

      - name: Log in to GitHub Container Registry
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build Docker image (NO CACHE)
        run: |
            docker build \
            --no-cache \
            --build-arg APP_VERSION=${{ steps.vars.outputs.version }} \
            --build-arg APP_REPO=${{ github.repository }} \
            --build-arg APP_CHANNEL=${{ steps.vars.outputs.channel }} \
            -t ghcr.io/${{ github.repository }}:${{ steps.vars.outputs.version }} \
            .


      - name: Push versioned image
        run: |
          docker push ghcr.io/${{ github.repository }}:${{ steps.vars.outputs.version }}

      - name: Tag main latest alias
        if: github.event.release.target_commitish == 'main'
        run: |
          docker tag ghcr.io/${{ github.repository }}:${{ steps.vars.outputs.version }} ghcr.io/${{ github.repository }}:latest
          docker push ghcr.io/${{ github.repository }}:latest

      - name: Tag dev latest alias
        if: github.event.release.target_commitish == 'dev'
        run: |
          docker tag ghcr.io/${{ github.repository }}:${{ steps.vars.outputs.version }} ghcr.io/${{ github.repository }}:dev_latest
          docker push ghcr.io/${{ github.repository }}:dev_latest
```

**Najważniejsze cechy:**
- Warunek na poziomie joba wymusza, by release pochodził z `main` lub `dev`.
- Kanał (`main` / `dev`) trafia do zmiennych builda i później do aplikacji.
- Alias `latest` aktualizuje się tylko dla releasów z `main`, a `dev_latest` tylko dla releasów `dev`, dzięki czemu środowiska nie „przeskakują” między kanałami.

---

## 2. Dockerfile – przekazywanie kanału do frontendu i backendu

Dockerfile przyjmuje `APP_CHANNEL` jako argument buildu, mapuje go na zmienne środowiskowe i przekazuje zarówno do Vite (frontend), jak i Node.js (backend). Dzięki temu każda paczka „wie”, z którego kanału pochodzi.

```dockerfile
# ───────────────────────────────────────────────
# 1️⃣ BUILD STAGE – build frontend
# ───────────────────────────────────────────────
FROM node:20-bookworm-slim AS build
ARG APP_VERSION=dev
ARG APP_REPO=pbuzdygan/mopay
ARG APP_CHANNEL=main
ENV VITE_APP_VERSION=$APP_VERSION
ENV VITE_GITHUB_REPO=$APP_REPO
ENV VITE_APP_CHANNEL=$APP_CHANNEL

WORKDIR /app

# System deps for native modules (if needed)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ pkg-config \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=development

# Use cache for npm
COPY frontend/package*.json ./frontend/

RUN cd frontend && \
    (npm ci --no-audit --prefer-offline || npm install --legacy-peer-deps --no-audit --no-fund)

# Copy frontend sources
COPY frontend ./frontend

# Build frontend
RUN cd frontend && npm run build || \
  (echo "⚠️ Frontend build failed" && \
   mkdir -p dist && \
   printf '<!doctype html><html><body><h1>Frontend build error</h1></body></html>' > dist/index.html)



# ───────────────────────────────────────────────
# 2️⃣ RUNTIME STAGE – backend + built frontend
# ───────────────────────────────────────────────
FROM node:20-bookworm-slim AS runtime
ARG APP_VERSION=dev
ARG APP_REPO=pbuzdygan/mopay
ARG APP_CHANNEL=main
ENV APP_VERSION=$APP_VERSION
ENV APP_REPO=$APP_REPO
ENV APP_CHANNEL=$APP_CHANNEL

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8010
EXPOSE 8010

RUN apt-get update && apt-get install -y --no-install-recommends \
    libsqlite3-0 \
 && rm -rf /var/lib/apt/lists/*

# 1. Install deps
COPY backend/package*.json /app/
RUN npm ci --omit=dev --no-audit --prefer-offline && npm cache clean --force

# 2. Copy FULL backend – this brings schema.sql!
COPY backend /app

# 3. Copy frontend build
COPY --from=build /app/frontend/dist /app/public

RUN mkdir -p /data

CMD ["node", "server.js"]
```

**Co zrobić w innej aplikacji?**  
Przyjmij analogiczne ARG w Dockerfile i wystaw zmienne środowiskowe (`APP_CHANNEL`, `VITE_APP_CHANNEL`), aby backend i frontend mogły raportować kanał.

---

## 3. Backend – endpoint `/api/meta`

Backend zasila UI metadanymi o wersji, repozytorium i kanale. Dzięki temu frontend wie, czy działa w trybie `main` czy `dev`, co steruje całym Version awareness. Fragment odpowiedzialny za metadane:

```javascript
const app = express();
const PORT = Number(process.env.PORT || 8010);
const APP_PIN = process.env.APP_PIN || '';
const APP_VERSION = process.env.APP_VERSION || 'dev';
const APP_REPO = process.env.APP_REPO || 'pbuzdygan/mopay';
const APP_CHANNEL = process.env.APP_CHANNEL || 'main';
let keyMismatch = false;

// ...

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(morgan('dev'));

// Health check
app.get('/health', (_req,res)=> res.json({ status: 'ok' }));

app.get('/api/meta', (_req, res) => {
  res.json({ version: APP_VERSION, repo: APP_REPO, channel: APP_CHANNEL });
});
```

**Kroki przeniesienia:**
1. Dodaj zmienne `APP_VERSION`, `APP_REPO`, `APP_CHANNEL` i ustawiaj je przy starcie procesu (np. poprzez Dockerfile).
2. Wystaw endpoint HTTP zwracający JSON z powyższymi kluczami.

---

## 4. Frontend – store i Version awareness

Frontend przechowuje bieżący kanał oraz numer wersji w globalnym store i wykorzystuje je w komponencie `VersionIndicator`.

### 4.1 Store (`frontend/src/store.ts`) – fragment odpowiedzialny za wersje

```typescript
  setAppVersion: (version) =>
    set((state) => ({
      appVersion: version,
      updateAvailable: compareVersions(version, state.latestVersion) < 0,
    })),

  setLatestVersion: (version) =>
    set((state) => ({
      latestVersion: version,
      updateAvailable: compareVersions(state.appVersion, version) < 0,
    })),

  setReleaseChannel: (channel) =>
    set((state) => {
      const normalized = channel ?? 'main';
      if (state.releaseChannel === normalized) {
        return {};
      }
      return { releaseChannel: normalized, latestVersion: null, updateAvailable: false };
    }),
```

**Zasada:** przy zmianie kanału resetujemy cache wersji, dzięki czemu release z `dev` nie miesza się z `main`.

### 4.2 Komponent `VersionIndicator`

Kod odpowiedzialny za Version awareness: pobiera `/api/meta`, ustawia kanał, a następnie odpytuje GitHub API o releasy i filtruje je według kanału.

```typescript
import { useEffect, useState } from "react";
import { useAppStore, compareVersions } from "../store";
import { Api } from "../api";

const POLL_INTERVAL_MS = 1000 * 60 * 60 * 6; // 6 hours
const REPO_SLUG = import.meta.env.VITE_GITHUB_REPO || "pbuzdygan/mopay";

type VersionIndicatorProps = {
  compact?: boolean;
};

export function VersionIndicator({ compact = false }: VersionIndicatorProps) {
  const version = useAppStore((s) => s.appVersion);
  const latestVersion = useAppStore((s) => s.latestVersion);
  const updateAvailable = useAppStore((s) => s.updateAvailable);
  const releaseChannel = useAppStore((s) => s.releaseChannel);
  const setAppVersion = useAppStore((s) => s.setAppVersion);
  const setLatestVersion = useAppStore((s) => s.setLatestVersion);
  const setReleaseChannel = useAppStore((s) => s.setReleaseChannel);
  const [latestReleaseUrl, setLatestReleaseUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loadMeta = async () => {
      try {
        const meta = await Api.meta();
        if (!cancelled) {
          setAppVersion(meta?.version ?? null);
          setReleaseChannel(meta?.channel ?? "main");
        }
      } catch {
        // ignore – keep previous value
      }
    };
    loadMeta();
    return () => {
      cancelled = true;
    };
  }, [setAppVersion, setReleaseChannel]);

  useEffect(() => {
    if (!REPO_SLUG || !releaseChannel) return;
    let cancelled = false;

    const fetchLatest = async () => {
      try {
        const res = await fetch(`https://api.github.com/repos/${REPO_SLUG}/releases?per_page=30`, {
          headers: { Accept: "application/vnd.github+json" },
        });
        if (!res.ok) return;
        const data = (await res.json()) as GitHubRelease[];
        if (!Array.isArray(data)) return;
        const release = selectReleaseForChannel(data, releaseChannel);
        if (!cancelled) {
          if (release) {
            setLatestVersion(release.tag_name ?? release.name ?? null);
            setLatestReleaseUrl(release.html_url ?? null);
          } else {
            setLatestVersion(null);
            setLatestReleaseUrl(null);
          }
        }
      } catch {
        // ignore – will retry on next interval
      }
    };

    setLatestReleaseUrl(null);
    fetchLatest();
    const interval = window.setInterval(fetchLatest, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [releaseChannel, setLatestVersion]);

  const baseClass = ["version-indicator", compact ? "compact" : ""].filter(Boolean).join(" ");

  if (updateAvailable && latestVersion) {
    const href = latestReleaseUrl ?? (REPO_SLUG ? `https://github.com/${REPO_SLUG}/releases` : "#");
    return (
      <a
        href={href}
        className={`${baseClass} update`}
        target="_blank"
        rel="noreferrer"
      >
        <span className="pulse-dot" aria-hidden="true" />
        Update available · {formatVersion(latestVersion)}
      </a>
    );
  }

  if (!version) {
    return (
      <span className={baseClass}>
        <span className="status-dot" aria-hidden="true" />
        Dev build
      </span>
    );
  }

  const href = REPO_SLUG ? `https://github.com/${REPO_SLUG}/releases/tag/${formatVersion(version)}` : undefined;

  const body = (
    <>
      <span className="status-dot" aria-hidden="true" />
      Build {formatVersion(version)}
    </>
  );

  return href ? (
    <a className={baseClass} href={href} target="_blank" rel="noreferrer">
      {body}
    </a>
  ) : (
    <span className={baseClass}>{body}</span>
  );
}

function formatVersion(value: string) {
  return value;
}

type GitHubRelease = {
  tag_name?: string | null;
  name?: string | null;
  target_commitish?: string | null;
  html_url?: string | null;
};

function isDevRelease(release: GitHubRelease) {
  const tag = release.tag_name?.toLowerCase() ?? "";
  const name = release.name?.toLowerCase() ?? "";
  const branch = release.target_commitish?.toLowerCase() ?? "";
  return tag.startsWith("dev") || name.startsWith("dev") || branch === "dev";
}

function selectReleaseForChannel(releases: GitHubRelease[], channel: string) {
  if (!releases.length) return null;
  const normalized = (channel || "main").toLowerCase();
  const predicate =
    normalized === "dev"
      ? (release: GitHubRelease) => isDevRelease(release)
      : (release: GitHubRelease) => !isDevRelease(release);
  const candidates = releases.filter(predicate);
  if (!candidates.length) {
    return releases[0];
  }
  candidates.sort((a, b) => compareVersions(releaseVersion(b), releaseVersion(a)));
  return candidates[0];
}

function releaseVersion(release: GitHubRelease) {
  return release.tag_name ?? release.name ?? null;
}
```

**Logika Version awareness:**
- Kanał ustawiany jest z backendu (meta endpoint) – decyduje, które releasy brać pod uwagę.
- `isDevRelease` rozpoznaje releasy dev na podstawie tagu, nazwy lub gałęzi release.
- Każdy kanał ma osobny strumień aktualizacji – użytkownik dev dostaje powiadomienia tylko o nowych buildach dev.

---

## 5. Proces wydania kanału `dev`

1. Na gałęzi `dev` przygotuj commit z gotową funkcjonalnością.
2. Utwórz GitHub Release wskazujący na `dev` (najlepiej z tagiem/nazwą zaczynającą się od `dev-...`, aby spełnić `isDevRelease`).
3. Workflow z punktu 1 zbuduje obraz:
   - `ghcr.io/<repo>:latest`
   - `ghcr.io/<repo>:<tag>` (konkretny release)
   - `ghcr.io/<repo>:dev_latest`
4. Środowisko testowe/dev powinno pullować `:dev_latest`.  
5. UI działające na tym obrazie automatycznie ustawi kanał `dev` i będzie porównywać wersję tylko z releasami dev.

Wdrożenie w innej aplikacji polega na odwzorowaniu powyższych kroków (workflow, Dockerfile, backendowe `/api/meta`, frontendowa obsługa kanałów). Dzięki temu otrzymasz spójny mechanizm publikacji buildów deweloperskich oraz powiadamiania użytkowników o dostępnych aktualizacjach w odpowiednim kanale.
