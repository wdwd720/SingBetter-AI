# Rollback Guide

## When to Roll Back
- Critical production errors after deploy.
- Auth/session failures preventing sign-in.
- Data corruption risk from a migration or runtime bug.

## Fast Application Rollback
1. Re-deploy the previous known-good app build/image.
2. Verify `GET /api/health` returns `ready`.
3. Run `npm run release:smoke` (or equivalent in CI).
4. Confirm login, live coaching upload, and progress routes.

## Database Rollback Strategy
- Prefer forward-fix migrations for production data safety.
- If rollback is required:
  1. Stop writes to the app.
  2. Restore latest verified backup.
  3. Re-deploy previous app version compatible with restored schema.
  4. Validate with smoke checks.

## SQLite Local Restore
- Restore from backup file:
  - `npm run restore:sqlite -- backups/<file>.db`

## Postgres Restore
- Restore with:
  - `psql "$DATABASE_URL" < backup.sql`

## Verification After Rollback
- `GET /api/health`
- `GET /api/openapi.json`
- Login and open `/live-coaching`
- Submit one test upload and one attempt
- Check `/progress` data loads
