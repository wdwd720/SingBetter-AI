# Launch Readiness Report

Date: 2026-02-11
Repository: Asset-Manager-Pro (SingBetter AI)

## 1) Current Architecture Summary

### Frontend (Website + Web App)
- React 18 + Wouter + TanStack Query + Tailwind + Radix UI.
- Marketing entry page (`/`) and authenticated app routes (`/live-coaching`, `/progress`, `/profile`, etc).
- PWA install prompt and service worker registration enabled.

### Backend API
- Express 5 server with central boot in `server/index.ts` and route registration in `server/routes.ts`.
- Auth supports three modes: disabled (dev bypass), local email/password, and Replit OIDC.
- Persistence supports SQLite (`file:`/`sqlite:`) and Postgres via Drizzle.
- Platform routes include profile/privacy/notifications/feedback/analytics/admin endpoints.

### Desktop App
- Electron wrapper in `desktop/main.cjs`.
- Desktop mode launches embedded server and stores DB/uploads in app-data folder.
- Windows packaging configured via `electron-builder` scripts.

### PWA
- `vite-plugin-pwa` configured with manifest/icons and Workbox runtime strategy.
- `/api/*` currently NetworkOnly in runtime cache configuration.

## 2) What Is Already Implemented (Confirmed)

- [x] Typecheck, tests, and production build succeed (`npm run check`, `npm run test`, `npm run build`).
- [x] Structured request ID middleware and API logging are present.
- [x] Global rate limiting and stricter auth limiter are present.
- [x] Upload abstraction supports local and S3-compatible storage.
- [x] Upload scanning modes exist (`off`, `basic`, `strict`) with basic signature checks.
- [x] Password auth with signup/login/logout/session rotation is implemented.
- [x] Password reset flow exists (token request + reset endpoint).
- [x] Optional MFA flow is implemented (TOTP + recovery codes).
- [x] Privacy endpoints exist (consent, export, delete account).
- [x] Notifications/feedback/analytics endpoints exist.
- [x] OpenAPI JSON endpoint exists.
- [x] Health and metrics endpoints exist.
- [x] PWA manifest and install prompt exist.
- [x] Desktop installer scripts exist and release artifacts are present.
- [x] Dockerfile and docker-compose exist for deploy/prod-like local run.
- [x] CI workflow exists (check + test + build).

## 3) Missing or Risky Areas (Gap List)

### Production Env Validation and Secret Hygiene
- Gap: no strict "release mode" guardrail that fails hard on unsafe production env combinations (e.g., `DISABLE_AUTH=true`, weak `SESSION_SECRET`, unsafe uploads defaults).
- Risk: accidental insecure launch.

### Auth and Session Security Settings
- Gap: session cookie policy is mostly good, but needs explicit production policy checks and clearer proxy/TLS rules for release hardening.
- Gap: session rotation endpoint exists but is not explicitly per-route rate limited.

### CSRF and CORS Posture
- Gap: no CSRF protection for cookie-based state-changing routes.
- Gap: no explicit production CORS origin allowlist enforcement.

### Rate Limiting and Abuse Prevention
- Gap: global limiter exists, but expensive routes (transcribe/analyze/upload) need tighter per-route throttles.

### Upload Security and Limits
- Gap: multipart size limit exists, but extension allowlist and response header hardening for served uploads can be stricter.
- Gap: production defaults should enforce at least `basic` scan mode.

### Error Handling and Observability
- Gap: centralized handler exists, but health endpoint lacks deep readiness details (DB/storage/jobs/build metadata).
- Gap: no optional Sentry integration hook.
- Gap: log redaction policy is not explicit.

### Analytics and Privacy Consent Gating
- Gap: frontend sends `app_loaded` analytics event immediately; consent gating not enforced client-side.

### Accessibility and UX Polish
- Gap: major flows need explicit guided step state in Live Coaching and clearer empty/loading states.
- Gap: accessibility baseline checks and keyboard/focus audit are incomplete.

### Desktop Security Hardening
- Gap: desktop security defaults are mostly good; needs explicit navigation lock-down review and release-mode env safety checks.

### Deployment and Packaging Reproducibility
- Gap: release docs/checklist/changelog/security docs are incomplete for public launch operations.
- Gap: release scripts (prep/smoke/version print) are missing.

## 4) Prioritized Plan

### P0 (must-do before public launch)
1. Strict production/release config validation and fail-fast boot checks.
2. Enforce dev-bypass auth only in development; surface dev mode in UI + health.
3. Add CSRF protection for state-changing API calls.
4. Add production CORS allowlist controls.
5. Add tighter per-route limits for auth/upload/transcribe/analyze routes.
6. Harden request size/content-type checks and upload serving safety headers.
7. Expand health/readiness payload with DB/storage/jobs/build metadata and mode flags.
8. Add optional Sentry plumbing and sensitive log redaction helpers.
9. Consent-gate analytics event posting.
10. Add launch docs and release scripts/checklists.

### P1 (soon after launch)
1. Live Coaching UX stepper and stronger empty/loading states.
2. Progress filters/date ranges and additional polish.
3. a11y lint/check pipeline and keyboard/focus improvements.
4. More robust desktop hardening tests and packaging signing pipeline.
5. Extended abuse protections and anomaly monitoring.

### P2 (later)
1. Full observability stack integration (external metrics backend, dashboards, alerts).
2. Advanced moderation/malware scanning integrations.
3. Broader localization and personalization polish.

## 5) Verification Steps (Current Baseline)

- Node: `node -v` -> v20.19.0
- npm: `npm -v` -> 10.8.2
- Typecheck: `npm run check` (pass)
- Tests: `npm run test` (pass: 7 files, 13 tests)
- Build: `npm run build` (pass)

## Scope for This Release Pass

This release pass will implement P0 items in small, reviewable patches with tests and updated docs, while preserving existing features.
