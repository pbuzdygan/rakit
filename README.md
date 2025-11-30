# Rakit - EARLY DEVELOPMENT

Rakit dashboard for self-hosted ops. Stack: Express + better-sqlite3 + React (Vite) + Tailwind + Zustand + TanStack Query + Framer Motion.

## Run
```bash
APP_PIN= docker compose up --build
```
App: `http://<NAS_IP>:8011`  
Health: `http://<NAS_IP>:8011/health` → `{ "status": "ok" }`

## Deployment notes
- Dockerfile keeps native deps lean and still installs frontend + backend packages separately for cache hits.
- If the Vite build fails the image still gets a placeholder HTML in `/app/public/index.html`.
- `DB_FILE` defaults to `/data/rakit_db.sqlite`; mount `./data:/data` for persistence.
 - Set `IP_DASH_SECRET` (see `docker-compose.yml`) to a 32+ character string to encrypt stored controller API keys for IP Dash profiles. Proxy mode now uses the built-in relay, so no additional docker compose configuration is required.

## Quick test checklist
1. `APP_PIN= docker compose up --build`
2. Browse to `http://<NAS_IP>:8011`.
3. Enter the PIN (default `123456`) → Rakit console appears.
4. Main bar → switch between **Overview / IT Cabinet / IP Dash**.
5. Cabinet view → Add cabinet → select it → Add device; drag devices along rack slots and add comments.
6. IP Dash view → add a controller profile (host + API key), switch between Table / Grid view, toggle filters and refresh data.
7. Menu → Export snapshot → download `.xlsx` with the cabinet registry.
8. Menu → Settings → Toggle theme + Lock application.

## Expected boot log
```
Rakit backend listening on :8011
```
