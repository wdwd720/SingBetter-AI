# Launch Checklist

## 1) Preflight
1. Use Node `20.19.x` and npm `10+`.
2. Validate templates and print version:
   - `npm run env:validate`
   - `npm run print-version`
3. Install deps:
   - `npm install`

## 2) Required Production Env Vars
- `NODE_ENV=production`
- `RELEASE_MODE=true`
- `HOST=0.0.0.0`
- `PORT=5000`
- `DATABASE_URL=postgres://...`
- `SESSION_SECRET=<long-random-secret>`
- `DISABLE_AUTH=false`
- `AUTH_PROVIDER=local` (or `replit`)
- `UPLOADS_DRIVER=s3`
- `UPLOAD_SCAN_MODE=strict`
- `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`
- `S3_ENDPOINT` (for S3-compatible providers), `S3_REGION`
- `PUBLIC_UPLOADS_BASE_URL`
- `CORS_ALLOWED_ORIGINS=https://yourapp.com,https://www.yourapp.com`
- `TRUST_PROXY=true`
- `CSRF_ENABLED=true`
- `METRICS_TOKEN=<secret-token>`
- `ASSEMBLYAI_API_KEY=<key>` (required when transcription is enabled)

## 3) Build and Migrate
1. `npm run db:migrate:prod`
2. `npm run release:prep`
3. `npm run release:smoke`

## 4) Publish Web
1. Deploy using `npm run build` artifact and `npm start`.
2. Verify:
   - `/api/health`
   - `/api/openapi.json`
   - login/signup flow
   - live coaching upload + analysis
   - progress/profile pages

## 5) Publish Desktop Installer (Windows)
1. `npm run desktop:win`
2. Verify installer output:
   - `release/SingBetter AI Setup 1.0.0.exe`
3. Install on clean Windows VM/user profile and run smoke flow.

## 6) Post-Release Verification
- Confirm no dev banner in production.
- Confirm `DISABLE_AUTH` is off.
- Confirm CSRF and CORS protections are active.
- Confirm uploads are remote (`UPLOADS_DRIVER=s3`) and not local disk.
- Confirm analytics events are only accepted after user consent.

## 7) 10-Minute Smoke Test Plan
1. Open app landing page and sign up.
2. Login and open `/live-coaching`.
3. Upload reference track and run one analysis.
4. Open `/progress` and verify session appears.
5. Open `/profile`, grant consent, trigger one page reload, and confirm no visible errors.
6. Check `/api/health` shows readiness and build info.
