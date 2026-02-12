# Security Policy

## Supported Versions
- Current release branch is supported for security fixes.

## Reporting a Vulnerability
- Email: `security@example.com` (replace with real address before public launch).
- Include reproduction steps, impact, and affected endpoints/components.

## Security Baseline
- Production boot fails when unsafe config is detected (release mode checks).
- Session cookies are hardened with `httpOnly`, `sameSite`, and secure proxy-aware settings.
- CSRF protection is enforced for state-changing API routes.
- CORS is restricted by allowlist in production.
- Request body size, content type, and upload validation are enforced.
- Upload scanning supports `basic` and `strict` modes.
- Structured logs include request IDs and redact sensitive fields.
- Metrics endpoint supports token protection in production.

## Secrets Hygiene
- `.env` is gitignored.
- Never commit API keys, DB credentials, or session secrets.
- Rotate secrets immediately if exposed.

## Dependency Hygiene
- Run `npm run security:audit` in CI and before release.
- Apply dependency updates regularly and test with `npm run release:prep`.
