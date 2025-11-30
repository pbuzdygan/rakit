# Rakit

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
- Set `APP_ENC_KEY` (see `docker-compose.yml`) to a 32+ character string to encrypt stored controller API keys for IP Dash profiles. Generate one with `openssl rand -base64 32` or any other secure secret manager.
- If `APP_ENC_KEY` ever changes after profiles exist, Rakit blocks IP Dash actions until you either restore the previous key or wipe the encrypted profiles from the UI.
- Encryption is handled on the backend with AES-256-GCM keyed by `APP_ENC_KEY`. The key’s SHA-256 fingerprint is stored inside the database (`app_meta` table), so changing the key without resetting profiles is detected automatically. The UI surfaces the mismatch and provides a RESET flow (requires typing `RESET` and the optional PIN) that deletes controller profiles before encrypting new data with the fresh key.

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
