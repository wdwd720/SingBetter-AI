# Changelog

## 1.0.0-launch

### Added
- Launch readiness audit report at `docs/LAUNCH_READINESS_REPORT.md`.
- Release docs:
  - `docs/LAUNCH_CHECKLIST.md`
  - `docs/DEPLOYMENT_WEB.md`
  - `docs/DEPLOYMENT_DESKTOP.md`
  - `docs/ROLLBACK.md`
  - `SECURITY.md`
- Release scripts:
  - `npm run print-version`
  - `npm run env:validate`
  - `npm run release:prep`
  - `npm run release:smoke`
  - `npm run db:migrate:prod`

### Security
- Release mode config validation with fail-fast checks.
- Hardened session/cookie settings and proxy handling.
- CSRF protection for state-changing API routes.
- Production CORS allowlist policy.
- Route-level rate limits for expensive endpoints.
- Upload validation hardening and safer static file headers.
- Optional Sentry integration and log redaction.

### Observability
- Expanded `/api/health` with DB/storage/jobs/queue/build/mode details.
- Request ID propagation in errors and logs.

### Product/UX
- Live Coaching guided flow updates and clearer empty states.
- Progress page date-range filtering and trend empty state messaging.
- Profile controls for consent and celebration preferences.
