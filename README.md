# Asset-Manager-Pro (SingBetter)

Full-stack Express + React app with:
- public website/landing,
- authenticated web app,
- installable PWA.

## Node Version
- Recommended: `Node.js 20.19.x LTS` (Windows x64)
- Verify:
  - `node -v`
  - `npm -v`

## Windows Local Setup
1. Open project root:
   - `cd "c:\Users\Mihir Modi\Downloads\Asset-Manager-Pro\Asset-Manager-Pro\Asset-Manager-Pro"`
2. Install dependencies:
   - `npm install`
3. Create `.env` from `.env.example`.
4. Minimum local `.env`:
```env
DATABASE_URL=file:./dev.db
DISABLE_AUTH=true
AUTH_PROVIDER=local
SESSION_SECRET=change-me
USE_JSON_DB=false
UPLOADS_DRIVER=local
UPLOAD_SCAN_MODE=basic
ASSEMBLYAI_API_KEY=
```
5. Start app:
   - `npm run dev`
6. Open:
   - `http://127.0.0.1:5000`

## Local Auth and Accounts
- Dev bypass mode:
  - `DISABLE_AUTH=true` gives local test user (`local-user`).
- Real account mode:
  - Set `DISABLE_AUTH=false`, keep `AUTH_PROVIDER=local`.
  - Use `/login` to sign up/sign in.
- Included auth capabilities:
  - Email/password login and signup
  - Session-based auth with rotation (`/api/auth/session/rotate`)
  - Password reset flow (`/api/auth/password/request-reset`, `/api/auth/password/reset`)
  - Optional MFA (TOTP + recovery codes)

## Database Modes
### SQLite (default local)
- `DATABASE_URL=file:./dev.db`
- Tables auto-initialize on startup.

### Postgres (production)
- `DATABASE_URL=postgres://...`
- Migrations:
  - `npm run db:generate`
  - `npm run db:migrate`
- Included SQL migration:
  - `migrations/0001_platform_hardening.sql`

## JSON Fallback
- DB mode is used when `DATABASE_URL` is set.
- Force JSON fallback only with:
  - `USE_JSON_DB=true`

## Upload Storage and Scanning
### Local disk
- `UPLOADS_DRIVER=local`
- Files served from `/uploads/*`.

### S3-compatible (recommended production)
- `UPLOADS_DRIVER=s3`
- Required vars:
  - `S3_ENDPOINT`
  - `S3_BUCKET`
  - `S3_ACCESS_KEY_ID`
  - `S3_SECRET_ACCESS_KEY`
  - `S3_REGION`
  - `PUBLIC_UPLOADS_BASE_URL`

### Upload scan control
- `UPLOAD_SCAN_MODE=basic|strict|off`
- `basic`: EICAR signature check
- `strict`: EICAR + file header validation

## API Platform Features
- API version alias:
  - `/api/v1/*` rewrites to `/api/*`
- API docs:
  - `GET /api/openapi.json`
  - Source: `docs/openapi.json`
- Health and metrics:
  - `GET /api/health`
  - `GET /api/metrics` (set `METRICS_TOKEN` for production)
- Profile/privacy/compliance:
  - `GET|PUT /api/profile`
  - `POST /api/privacy/consent`
  - `GET /api/privacy/export`
  - `DELETE /api/privacy/delete-account`

## Live Coaching Persistence Check
1. Start app in DB mode (`DATABASE_URL=file:./dev.db`, `USE_JSON_DB=false`).
2. Upload/analyze in Live Coaching.
3. Confirm history API:
   - `http://127.0.0.1:5000/api/live-coaching/history?limit=10`
4. Stop server, start again:
   - `npm run dev`
5. Reload history endpoint and verify entries still exist.

## Build and Production Run
- Build:
  - `npm run build`
- Start production server:
  - `npm start`
- Uses `PORT` and `HOST` env vars (default host behavior included).

## Windows Desktop App (.exe)
- Build and package Windows installer:
  - `npm run desktop:win`
- Output installer:
  - `release/SingBetter AI Setup 1.0.0.exe`
- Portable unpacked app folder:
  - `release/win-unpacked/`
- Run desktop app from source (build + launch Electron):
  - `npm run desktop:dev`

### Desktop runtime behavior
- Desktop app starts an embedded local server on `127.0.0.1:5510`.
- App data is stored in your Windows user app-data folder:
  - SQLite DB: `%APPDATA%/SingBetter AI/singbetter.db`
  - Upload files: `%APPDATA%/SingBetter AI/uploads/`
- Auth provider defaults to local account auth in desktop mode.
- On first desktop run, app attempts one-time DB migration copy (if needed) from:
  - `./dev.db`
  - `./prod-local.db`
  - legacy `%APPDATA%/SingBetter AI/desktop.db`

## Docker
### Single container
- `docker build -t asset-manager-pro .`
- `docker run --rm -p 5000:5000 --env-file .env asset-manager-pro`

### Local prod-like stack (app + Postgres)
- `docker compose up --build`

## Example Host: Render
1. Create a new Web Service from this repo.
2. Build command: `npm install && npm run build`
3. Start command: `npm start`
4. Set environment variables:
   - `NODE_ENV=production`
   - `HOST=0.0.0.0`
   - `PORT=5000`
   - `DATABASE_URL=postgres://...` (Render Postgres)
   - `SESSION_SECRET=<strong-secret>`
   - `DISABLE_AUTH=false`
   - `AUTH_PROVIDER=local`
   - `UPLOADS_DRIVER=s3` plus S3/R2 envs
5. Run migration once against production DB:
   - `npm run db:migrate`

## PWA Install
- Build or run dev (`npm run dev` / `npm run build && npm start`)
- Open app in Chromium browser
- Use install prompt or browser install button
- Manifest: `client/public/manifest.webmanifest`

## Security and Operations
- Rate limiting is enabled (global + auth endpoints).
- Request correlation IDs and structured logs are enabled.
- Data retention cleanup job runs in background.
- Backup/restore scripts:
  - `npm run backup:sqlite`
  - `npm run restore:sqlite -- backups/<file>.db`
- Security audit:
  - `npm run security:audit`
- Operations runbook:
  - `docs/operations.md`

## Launch and Release
- Release prep:
  - `npm run release:prep`
- Release smoke checks:
  - `npm run release:smoke`
- Print version + commit:
  - `npm run print-version`
- Validate env templates:
  - `npm run env:validate`
- Launch checklists and deployment docs:
  - `docs/LAUNCH_CHECKLIST.md`
  - `docs/DEPLOYMENT_WEB.md`
  - `docs/DEPLOYMENT_DESKTOP.md`
  - `docs/ROLLBACK.md`
  - `SECURITY.md`
  - `CHANGELOG.md`

## CI/CD and Dependency Hygiene
- CI workflow:
  - `.github/workflows/ci.yml`
- Deployment workflow scaffold:
  - `.github/workflows/deploy.yml`
- Dependabot:
  - `.github/dependabot.yml`

## Tests
- Run all tests:
  - `npm run test`
- Type-check:
  - `npm run check`
