# Repository Guidelines

- Work from the repository root with Node.js 26.x; install locked dependencies with `npm ci`.
- Run `npm run verify` before handing off changes. The Husky hook also runs lint-staged and `npm run typecheck`.
- Never increase the `lint:ci` warning ceiling in `package.json`; lower it when fixing warnings.
- Read `.github/CONTRIBUTING.md` for conventions and `SECURITY.md` before changing authentication, storage, printing, networking, or release configuration.
- Never commit `.env`, signing material, patient data, patient backups, dependencies, or generated build artifacts.
- Preserve the no-network invariant: no Android `INTERNET` permission, remote fonts, analytics, or phone-home behavior.
- Access persisted records through `src/data/`; keep framework-free domain logic and unit tests in `src/lib/`.
- Update `src/lib/models.ts`, its tests, and the README when stored document shapes change.
- Use `src/lib/date-range.ts` helpers for local-calendar-day bounds and formatting.
