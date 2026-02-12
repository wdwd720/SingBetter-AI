# Web Deployment Guide

## Target Runtime
- Node.js `20.19.x`
- Single process: `npm start`
- Reverse proxy / platform TLS termination supported

## Build and Start
1. `npm install`
2. `npm run db:migrate:prod`
3. `npm run build`
4. `npm start`

## Required Env (Minimum)
```env
NODE_ENV=production
RELEASE_MODE=true
HOST=0.0.0.0
PORT=5000
DATABASE_URL=postgres://...
SESSION_SECRET=<strong-random>
DISABLE_AUTH=false
AUTH_PROVIDER=local
UPLOADS_DRIVER=s3
UPLOAD_SCAN_MODE=strict
TRUST_PROXY=true
CSRF_ENABLED=true
CORS_ALLOWED_ORIGINS=https://your-domain.com
METRICS_TOKEN=<secret>
ASSEMBLYAI_API_KEY=<key>
```

## Upload Storage (S3 or R2)
```env
S3_ENDPOINT=https://<provider-endpoint>
S3_BUCKET=<bucket>
S3_ACCESS_KEY_ID=<key>
S3_SECRET_ACCESS_KEY=<secret>
S3_REGION=auto
PUBLIC_UPLOADS_BASE_URL=https://<public-cdn-or-bucket-url>
```

## Health and Smoke Checks
- `GET /api/health`
- `GET /api/openapi.json`
- `npm run release:smoke`

## Example: Render
- Build command: `npm install && npm run build`
- Start command: `npm start`
- Add env vars above in Render dashboard.
- Run one-off migration job: `npm run db:migrate:prod`
