# Operations Runbook

## Runtime Commands
- Validate env templates: `npm run env:validate`
- Print release version: `npm run print-version`
- Run prod migrations: `npm run db:migrate:prod`
- Build: `npm run build`
- Start production server: `npm start`
- Run release smoke checks: `npm run release:smoke`

## Backup and Restore
### SQLite
- Backup: `npm run backup:sqlite`
- Restore: `npm run restore:sqlite -- backups/<file>.db`
- Restore test cadence: at least weekly in staging.

### Postgres
- Backup: `pg_dump "$DATABASE_URL" > backup.sql`
- Restore: `psql "$DATABASE_URL" < backup.sql`
- Restore test cadence: at least weekly in staging.

## Disaster Recovery Targets
- `RPO`: 24 hours.
- `RTO`: 2 hours.
- Keep infrastructure config and deployment manifests in version control.
- Execute rollback steps from `docs/ROLLBACK.md`.

## Data Retention and Cleanup
- Retention jobs run every 10 minutes.
- Defaults:
  - analytics retention: `RETENTION_DAYS_ANALYTICS` (default 90)
  - audit retention: `RETENTION_DAYS_AUDIT` (default 365)
- Before lowering retention windows, validate against legal/policy requirements.

## Security and Secret Management
- Do not commit `.env` files or secrets.
- Store production secrets in your host secret manager.
- Rotate `SESSION_SECRET`, API keys, and mail credentials regularly.
- Run `npm run security:audit` in CI and triage high/critical advisories.

## Monitoring and Health
- Health endpoint: `GET /api/health`
- Metrics endpoint: `GET /api/metrics`
  - In production, set `METRICS_TOKEN` and send `X-Metrics-Token` header.
- Logs include request IDs; use them when tracing incidents.

## Email Deliverability (SPF/DKIM/DMARC)
- Configure SPF include for your mail provider.
- Enable DKIM signing for the transactional domain.
- Publish DMARC and monitor aggregate reports.

## CDN and Static Assets
- Serve static assets behind CDN in production.
- Use immutable caching for hashed JS/CSS/image assets.
- Use S3/R2 uploads in production (`UPLOADS_DRIVER=s3`).
