# **Rakit – Architecture & Technical Overview**

## **1. High‑Level Overview**

Rakit is a self‑hosted, lightweight tool for documenting and exporting IT rack layouts and IP‑address allocations. It focuses on:

- Visual planning of **rack cabinets** and mounted **devices** (U‑based layout)
- Managing multiple **racks** with configurable height (U)
- Preparing **Excel exports** with branded, presentation‑ready summaries
- Optionally enriching exports with **UniFi IP Dash** data (clients, scopes, WireGuard users)
- Protecting access to the UI with a mandatory **PIN guard**
- Running as a **PWA‑ready** single‑page app with a modern, responsive UI

The app is split into:

- **Backend**: Node.js + Express + SQLite (via better‑sqlite3) + Excel export
- **Frontend**: React + TypeScript + Vite + Tailwind CSS, with React Query and Zustand

---

## **2. Tech Stack**

- **Backend**
  - Node.js (ESM)
  - Express
  - better‑sqlite3 for SQLite access
  - ExcelJS for XLSX export
  - Node `crypto` (AES‑256‑GCM) for encrypting UniFi API keys
  - `dns/promises` for resolving controller IPs
- **Frontend**
  - React + TypeScript
  - Vite bundler
  - Tailwind CSS + custom design system in CSS
  - React Query (@tanstack/react-query) for data fetching + caching
  - Zustand for global app state and UI modals
  - @dnd-kit for drag‑and‑drop device ordering within a rack
- **Deployment**
  - Docker & docker‑compose
  - Single container exposing backend + static frontend on `PORT` (default 8011)

---

## **3. Repository Structure**

`backend/  
  db.js             # SQLite initialization, schema loading, seeding demo data  
  export.js         # Excel workbook builder (racks + optional IP Dash)  
  ipdashClient.js   # UniFi IP Dash HTTP client + snapshot normalization  
  schema.sql        # Database schema (racks, devices, IP Dash profiles/scopes)  
  server.js         # Express server, REST API, encryption guard, static frontend  

frontend/  
  index.html        # Vite entry HTML  
  src/  
    api.ts          # Typed API client (fetch wrapper)  
    App.tsx         # Root React application component  
    main.tsx        # React entry + React Query/Zustand providers  
    store.ts        # Global UI state (view, theme, modals, selection)  
    components/     # UI components, views and modals  
      CabinetView.tsx     # Rack layout editor (drag & drop)  
      MainBar.tsx         # Top navigation + actions  
      PinGuard.tsx        # PIN‑based access guard  
      modals/             # Export, settings, add/edit cabinet/device, comments  
      ipdash/             # IP Dash views and profile management  
    styles/         # Global CSS + Tailwind layers`

---

## **4. Backend**

### **4.1 Configuration & Environment**

Backend is configured via environment variables:

- `PORT` – HTTP port for Express (default: `8011`).
- `APP_PIN` – 4–8 digit PIN required to access the UI.  
  - If missing or invalid, backend exits on startup (`APP_PIN must be provided`).
- `DB_FILE` – path to SQLite database file (default: `/data/rakit_db.sqlite`).
- `APP_ENC_KEY` – symmetric key used to encrypt UniFi API keys.  
  - When absent, any operation that needs IP Dash encryption is blocked.
- `IP_DASH_TIMEOUT_MS` – timeout for IP Dash HTTP requests (default: `15000` ms).

### **4.2 Database Initialization (**backend/db.js**, **backend/schema.sql**)**

`db.js`:

- Resolves DB location from `DB_FILE` (default `/data/rakit_db.sqlite`).
- Ensures parent directory exists.
- Opens a better‑sqlite3 connection with:
  - `journal_mode = WAL`
  - `foreign_keys = ON`
- Loads and executes `schema.sql` at startup.
- Performs a tiny migration check to ensure `ipdash_profiles.site_id` exists.
- Seeds initial data when tables are empty:
  - Two sample cabinets (`EDGE-A`, `LAB-1`).
  - A few sample devices assigned to those cabinets.

Schema (`schema.sql`) – main tables:

- `cabinets`
  - `id` (PK), `name` (TEXT NOT NULL)
  - `symbol` (TEXT, e.g. rack code)
  - `location` (TEXT)
  - `size_u` (INTEGER, rack height in U, default 42)
  - `created_at`, `updated_at` (timestamps + update triggers)
- `cabinet_devices`
  - `id` (PK)
  - `cabinet_id` (FK → cabinets.id, ON DELETE CASCADE)
  - `device_type` (TEXT, e.g. “Firewall”)
  - `model` (TEXT, optional)
  - `height_u` (INTEGER, device height in U, default 1)
  - `position` (INTEGER, starting U position, 1‑based)
  - `comment` (TEXT, optional)
  - `created_at`, `updated_at`
- `ipdash_profiles`
  - `id` (PK)
  - `name` (TEXT NOT NULL)
  - `location` (TEXT)
  - `host` (TEXT NOT NULL) – UniFi controller URL/base
  - `mode` (TEXT NOT NULL, `'proxy' | 'direct' | 'local-offline'`, default `'proxy'`)
  - `site_id` (TEXT, optional, UniFi site id/slug)
  - `api_key_encrypted` (TEXT NOT NULL) – AES‑GCM encrypted controller API key or local‑offline marker
  - `created_at`, `updated_at`
- `ipdash_scopes`
  - `id` (PK)
  - `profile_id` (FK → ipdash_profiles.id, ON DELETE CASCADE)
  - `cidr` (TEXT NOT NULL, IPv4 CIDR, e.g. `192.168.1.0/24`)
  - `label` (TEXT, optional friendly name)
  - `created_at`, `updated_at`
- `ipdash_scope_hosts`
  - `id` (PK)
  - `profile_id` (FK → ipdash_profiles.id, ON DELETE CASCADE)
  - `scope_id` (FK → ipdash_scopes.id, ON DELETE CASCADE)
  - `ip` (TEXT NOT NULL, reserved/assigned IP)
  - `name` (TEXT, optional)
  - `hostname` (TEXT, optional)
  - `mac` (TEXT, optional)
  - `created_at`, `updated_at`
  - Unique index: `(scope_id, ip)` – one record per IP within a scope.
- `app_meta`
  - Simple key/value store used for encryption fingerprint tracking.
- `it_cabinet_assets`
  - Additional table for high‑level IT asset metadata (not directly used by the primary UI yet).

Each main table has `AFTER UPDATE` triggers that maintain the `updated_at` timestamp.

### **4.3 Encryption of UniFi API Keys**

Rakit encrypts sensitive UniFi controller API keys at rest using `APP_ENC_KEY`.

- Algorithm: AES‑256‑GCM (authenticated encryption).
- Scope of encryption:
  - `ipdash_profiles.api_key_encrypted` column.
- Storage format:
  - values are stored as `iv:encrypted:tag`, where each part is Base64‑encoded.
- Key derivation:
  - backend derives a 32‑byte key as `sha256(APP_ENC_KEY)` and keeps it in memory.

Metadata & fingerprinting:

- `APP_ENC_KEY` fingerprint is computed as a SHA‑256 hex string.
- Fingerprint is stored under `app_meta.app_enc_key_fingerprint`.
- Helper `refreshEncryptionKeyState()`:
  - Reads number of encrypted profiles.
  - Compares stored fingerprint with current one.
  - Sets `encryptionKeyMismatch` flag when mismatched.
  - Logs detailed encryption state to the console.

Runtime guards:

- `guardEncryptionReady(res)`:
  - Returns `false` and responds with:
    - `500` when `APP_ENC_KEY` is missing but encrypted profiles exist.
    - `409` with code `ENCRYPTION_KEY_MISMATCH` when fingerprint mismatches.
  - Used by IP‑Dash‑related endpoints and export.
- `encryptSecret(value)` / `decryptSecret(payload)`:
  - `encryptSecret`:
    - Throws when `encryptionKeyMismatch` is true.
    - Generates random IV, performs AES‑GCM encryption, stores `iv:data:tag`.
    - Marks current key as “in use” (writes fingerprint if missing).
  - `decryptSecret`:
    - Parses `iv:data:tag`, derives key, decrypts to string.
    - Throws when `encryptionKeyMismatch` is true.

If `APP_ENC_KEY` is changed without resetting, all operations that require the key return a structured error and the UI guides the user to reset encrypted profiles.

### **4.4 Express Server & API (**backend/server.js**)**

Configuration:

- Reads env vars (`PORT`, `APP_PIN`, `APP_ENC_KEY`, `IP_DASH_TIMEOUT_MS`).
- Validates `APP_PIN` on startup:
  - Must be 4–8 digits.
  - If invalid or missing → process exits (running without PIN is not supported).

Common helpers:

- `clampText(value, max)` – trims text and limits length to avoid oversized payloads.
- `normalizeHost(value)` – normalizes UniFi controller URL to `https://host` form.
- `extractHostname(value)` / `resolveHostIp(value)` – normalize and resolve controller IP for display.
- `ipToInt` / `intToIp` / `describeCidr` / `isIpInRange` – utilities for IPv4 calculations and validating CIDR scopes.
- Mapping helpers (`mapCabinetRow`, `mapDeviceRow`, `mapScopeRow`, `mapProfileRow`) for shaping DB rows into API DTOs.

Middleware:

- `cors({ origin: true, credentials: true })`
- `express.json()`
- `morgan('dev')` logging

Static UI:

- `express.static` serving `backend/public`.
- Catch‑all `GET *` serving `public/index.html` (SPA routing).

#### **4.4.1 Health & PIN**

- `GET /health`
  - Returns `{ status: 'ok' }` for health checks and readiness probes.
- `POST /api/pin/verify`
  - Input: `{ pin: string }`
  - Behavior:
    - Compares with `APP_PIN` (4–8 digits).
    - Success → `{ ok: true }`.
    - Mismatch → `401` with `{ ok: false, error: 'Wrong Pin' }`.

#### **4.4.2 Cabinets**

- `GET /api/cabinets`
  - Returns `{ cabinets: Cabinet[] }` sorted by name.
  - Each cabinet: `{ id, name, symbol, location, sizeU }`.
- `POST /api/cabinets`
  - Input: `{ name, symbol?, location?, sizeU? }`.
  - Validates `name` and `sizeU` (integer 4–60 U).
  - Inserts cabinet and returns `{ ok: true, cabinet }`.
- `PATCH /api/cabinets/:cabinetId`
  - Partial update of `name`, `symbol`, `location`, `sizeU`.
  - Rejects invalid sizes and empty payloads.
  - Returns `{ ok: true, cabinet }`.
- `DELETE /api/cabinets/:cabinetId`
  - Deletes cabinet and cascades devices.
  - Returns `{ ok: true }` on success or `404` if not found.

#### **4.4.3 Cabinet Devices**

All device APIs are scoped to a given cabinet.

- `GET /api/cabinets/:cabinetId/devices`
  - Returns `{ cabinet, devices }` where:
    - `devices` are sorted by `position`.
    - Each device: `{ id, cabinetId, type, model, heightU, position, comment }`.
- `POST /api/cabinets/:cabinetId/devices`
  - Input: `{ type, model?, heightU? }`.
  - Validates:
    - `type` (required, trimmed to 60 chars).
    - `heightU` (integer 1–cabinet.sizeU).
  - Finds the first available range of U positions (`findFirstAvailablePosition`) that does not conflict with existing devices.
  - Inserts device at calculated `position`.
  - Returns `{ ok: true, device }`.
- `PATCH /api/cabinets/:cabinetId/devices/:deviceId`
  - Allows editing:
    - `type`, `model`, `comment`, `heightU`, `position`.
  - Re‑validates:
    - New `heightU` within 1–cabinet.sizeU.
    - New `position` within rack range.
    - No overlap with other devices (`hasRangeConflict`).
  - Returns `{ ok: true, device }` or error codes (`400`, `404`, `409`).
- `DELETE /api/cabinets/:cabinetId/devices/:deviceId`
  - Deletes device from cabinet.
  - Returns `{ ok: true }` or `404` if not found.

Positioning / collision model:

- Devices occupy a vertical range `[position, position + heightU - 1]`.
- Conflicts are detected when ranges overlap (except same id during edits).
- New devices are auto‑placed at the lowest free slot where the range fits.

#### **4.4.4 IP Dash Profiles & Data**

These endpoints manage UniFi IP Dash integration and local offline scopes.

- `GET /api/ipdash/profiles`
  - Returns:
    - `{ profiles, encryptionKeyMismatch, requiresPinForReset, encryptionMessage, appEncKeyConfigured }`.
- `POST /api/ipdash/profiles`
  - Requires `guardEncryptionReady` (encryption must be configured and consistent).
  - Input:
    - `name`, `location?`, `host`, `mode?`, `apiKey?`, `siteId?`.
  - Modes:
    - `'proxy'` (default) – uses reverse proxy path to UniFi.
    - `'direct'` – uses direct host URLs.
    - `'local-offline'` – disables live API calls, stores a special encrypted marker instead of API key.
  - Validates controller host and API key (except for local‑offline).
  - Normalizes host with `normalizeHost()`.
  - Encrypts API key via `encryptSecret()`.
  - Inserts row and returns `{ ok: true, profile }`.
- `PATCH /api/ipdash/profiles/:id`
  - Updates profile metadata and/or API key & site id.
  - Re‑encrypts API key when changed.
- `DELETE /api/ipdash/profiles/:id`
  - Deletes profile and cascades scopes/hosts.
- `POST /api/ipdash/profiles/test`
  - Validates connection to UniFi using provided credentials without saving.
- `POST /api/ipdash/profiles/reset-encrypted`
  - Used when `APP_ENC_KEY` changed and data is no longer decryptable.
  - Wipes encrypted profiles and clears encryption fingerprint so a new key can be used.

IP Dash scopes and offline hosts:

- `GET /api/ipdash/sites/preview`
  - Uses `IpDashClient` to fetch summary of sites for a given controller.
- `GET /api/ipdash/data` (optionally `?profileId=`…)
  - Builds IP Dash context:
    - Selects requested or latest profile.
    - For live profiles:
      - Fetches UniFi snapshot via `ipdashClient`.
      - Merges users, online clients, networks, WireGuard peers.
    - For local‑offline profiles:
      - Builds snapshot entirely from local `ipdash_scopes` + `ipdash_scope_hosts`.
  - Returns a structure compatible with frontend IpDash view (networks, hosts, tags, filters).
- Offline scopes and IPs:
  - `POST /api/ipdash/offline/scopes`
    - Creates a new CIDR scope bound to a local‑offline profile.
    - Validates CIDR (1–30, max 4096 hosts).
  - `DELETE /api/ipdash/offline/scopes/:scopeId`
    - Removes a scope (only for local‑offline profiles).
  - `POST /api/ipdash/offline/ips`
    - Adds a reserved IP inside a given scope.
    - Validates:
      - Profile exists and is local‑offline.
      - Scope belongs to profile.
      - IP belongs to scope CIDR and is not already taken.
  - `DELETE /api/ipdash/offline/ips/:hostId`
    - Deletes offline host record.

#### **4.4.5 Export**

- `POST /api/export`
  - Input payload:
    - `modules?: string[]` – list of included modules (e.g. `['cabinet', 'ipdash']`).
    - `ipdash?: { … }` – optional IP Dash context parameters (profileId, filters, view, etc.).
  - Behavior:
    - Resolves which modules to include.
    - If IP Dash is requested, first checks `guardEncryptionReady` and then builds IP Dash context.
    - Calls `buildExportWorkbook({ includeCabinet, ipDashContext })`.
    - Streams Excel workbook with headers:
      - `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
      - `Content-Disposition: attachment; filename="rakit_export.xlsx"`.

Workbook structure (`export.js`):

- Common helpers:
  - Consistent color palette, borders and header styles.
  - Utility functions for styling header/body rows.
- Sheets:
  - `Overview`
    - Summarizes included modules:
      - IT Cabinet: count of cabinets/devices, total capacity U.
      - IP Dash: presence of live snapshot sheets.
    - Contains a branded hero tile with Rakit description (light‑mode ready).
  - `Cabinets`
    - Tabular list of cabinets with counts of devices per rack.
  - Per‑cabinet sheets
    - Visual representation of devices and free space per rack.
  - Experimental cabinet sheet
    - Additional layout for experimenting with rack design.
  - IP Dash sheets
    - Device/client listings, networks, scopes, and offline reservations (when IP Dash context is present).

---

## **5. IP Dash Client (**backend/ipdashClient.js**)**

`IpDashClient` encapsulates UniFi controller communication logic and normalizes responses into a snapshot used by the export and frontend.

Key responsibilities:

- Build correct URLs for:
  - Legacy UniFi API paths (e.g. `/stat/sta`, `/stat/device`).
  - Integration API (`/proxy/network/v2/api`).
  - WireGuard users (`/site/{siteSlug}/wireguard/{networkId}/users`).
- Handle:
  - API key header injection.
  - Timeouts and basic error classification (`NotFound`, `BAD_REQUEST`, `404` → treated as empty lists).
- Methods:
  - `listSites()` – fetches list of sites from integration API.
  - `listClients(siteId)` – paginated client list from integration API.
  - `listWireguardUsers(siteSlug, networkId)` – reads WireGuard users.
  - `loadSnapshot(siteId?)`
    - In parallel:
      - loads UniFi users,
      - online clients,
      - networks,
      - devices,
      - integration clients.
    - Extracts IPs for devices (`extractDeviceIp`).
    - Merges WireGuard peers into users.
    - Normalizes integration clients shape.
    - Returns snapshot `{ users, online, networks }`.

This snapshot is then further combined with offline scopes in `server.js`.

---

## **6. Frontend**

### **6.1 Application Shell (**frontend/src/App.tsx**, **frontend/src/main.tsx**)**

- `main.tsx`:
  - Bootstraps React app.
  - Wraps app in React Query provider.
  - Imports global Tailwind styles.
- `App.tsx`:
  - Reads `theme` and current `view` from Zustand store.
  - Applies `data-theme` attribute on `<html>` to drive CSS themes and smooth transitions.
  - Renders layout:
    - Sticky `MainBar` header with glass effect.
    - Main content area:
      - `CabinetView` for rack layout.
      - `IpDashView` for UniFi integration, depending on selected view.
    - Global modals:
      - `ExportModal`, `SettingsModal`, `AddCabinetModal`, `AddDeviceModal`, `CommentModal`,
        `IpDashProfileModal`, `PwaInstallPrompt`.
  - Subscribes to scroll events to toggle header styling.

### **6.2 State Management (**frontend/src/store.ts**)**

Global UI state is handled by Zustand:

- Core fields:
  - `view` – `'cabinet' | 'ipdash'`.
  - `theme` – `'light' | 'dark'`.
  - `pinSession` – whether PIN has been successfully verified.
  - `selectedCabinetId` – currently selected rack.
  - `editingCabinetId`, `editingDevice` – edit targets for forms/modals.
  - `modals` – open/close state for all modal dialogs (export, settings, add/edit, comment).
  - IP Dash‑specific:
    - `ipDashViewMode` – `'table' | 'grid'`.
    - `ipDashRefreshToken` – integer increment to trigger refresh.
    - `ipDashProfileModalOpen`, `ipDashActiveProfileId`, `ipDashConnectionStatus`.
- Persistence:
  - Selected view, theme, active cabinet and active IP Dash profile are persisted in `localStorage`
    (helpers `load` / `save`).

### **6.3 API Client (**frontend/src/api.ts**)**

`Api` wraps the backend using `fetch`:

- Base URL:
  - `VITE_API_BASE` specifies backend root; defaults to same origin.
- Helpers:
  - `api(path, init?)`:
    - Adds JSON content‑type header.
    - Throws an error with response text when HTTP status is not OK.
    - Returns JSON when `content-type` includes `json`.

Exposed endpoints:

- `verifyPin(pin)`
- `cabinets` – `list`, `create`, `update`, `remove`.
- `devices` – `list`, `create`, `update`, `remove` (scoped per cabinet).
- `ipdash`:
  - `profiles` – `list`, `create`, `update`, `remove`, `test`, `resetEncrypted`.
  - `sites.preview` – preview UniFi sites.
  - `data(profileId?)` – fetches IP Dash context for a given or latest profile.
  - `offline.addScope`, `offline.removeScope`, `offline.addIp`, `offline.removeIp`.
- `exportWorkbook(payload)`:
  - Calls `/api/export` and triggers browser download of `rakit_export.xlsx`.

### **6.4 Rack Layout UI (**frontend/src/components/CabinetView.tsx**)**

Responsibilities:

- Fetch and render available cabinets and devices using React Query.
- Let the user:
  - select a cabinet,
  - add / edit / delete devices,
  - reorder devices vertically using drag‑and‑drop.

Key concepts:

- `RackSlot` – visual grid cell representing a single U position (droppable target).
- `RackLabel` – displays U index labels on the side.
- `RackDevice` – draggable card representing a device; supports:
  - comment marker,
  - drag handle,
  - edit and delete actions with confirmation.
- Uses `@dnd-kit/core`:
  - `PointerSensor` + `useSensors` for drag activation.
  - Devices and slots are mapped to droppable/draggable ids (`device-${id}`, `slot-${index}`).
  - Drop handling updates device `position` via API and invalidates React Query cache.

The visual layout mirrors backend rules (heightU, position constraints, collisions).

### **6.5 IP Dash UI (**frontend/src/components/ipdash/**)**

Components under `ipdash/` handle UniFi integration:

- `IpDashView`
  - Drives loading of IP Dash context from backend (`Api.ipdash.data`).
  - Supports table and grid views (`ipDashViewMode`).
  - Displays controller/IP status, live vs local‑offline indicator.
- `ProfileModal`, `IpDashProfileMenu`
  - Manage creation/edition/deletion of IP Dash profiles.
  - Show encryption status and `APP_ENC_KEY` mismatch warnings (via `/api/ipdash/profiles` flags).
- Local‑offline management UI
  - Forms for defining CIDR scopes and reserved IPs.
  - Surface validation errors coming from backend (scope overlap, IP taken, invalid network).

### **6.6 Access Guard & PWA**

- `PinGuard`:
  - Renders an overlay before the main app.
  - Submits PIN to `/api/pin/verify`.
  - On success, sets `pinSession` in store and hides itself.
  - On failure, shows inline error.
- `PwaInstallPrompt`:
  - Listens for browser PWA install events.
  - Presents an install hint/modal to the user.

---

## **7. Security & Operational Notes**

- **Authentication**
  - Single factor: numeric `APP_PIN` (4–8 digits) checked on backend.
  - No per‑user accounts; intended for small, trusted setups.
- **Data at rest**
  - SQLite database file may be volume‑mounted; encryption is applied only to UniFi API keys.
  - Rack/device metadata is stored in plaintext.
- **Network access**
  - For IP Dash live mode, backend must reach UniFi controller (proxy or direct).
  - `IP_DASH_TIMEOUT_MS` protects against slow/unreachable controllers.
- **Resilience**
  - Backend can run without IP Dash configured; rack functionality remains fully usable.
  - When `APP_ENC_KEY` is misconfigured or changed, only IP Dash operations are blocked;
    racks and exports without IP Dash continue to work.

This document should give enough detail to understand how Rakit is structured, where key behaviors live, and how to extend either the rack module or the IP Dash integration.

