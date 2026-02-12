Use this folder for committed Drizzle SQL migrations.

Typical Postgres flow:

1. Set `DATABASE_URL` to your Postgres instance.
2. Run `npm run db:generate`.
3. Commit generated SQL files from `migrations/`.
4. Run `npm run db:migrate` in production during deploy.

For local SQLite development, the app auto-initializes required tables at startup.

Committed baseline platform migration:
- `0001_platform_hardening.sql` (profile/settings, password reset, MFA, audit, analytics, notifications, privacy requests)
