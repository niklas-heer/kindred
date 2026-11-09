## What this changes and why

<!-- One or two sentences. Link the issue if there is one. -->

## Checklist

- [ ] `mise run check` (types) and `mise run test` pass, and the change has a test
- [ ] Every new word the app shows is in English, German and Afrikaans (`src/lib/i18n/areas/`)
- [ ] A schema change is a new numbered migration (no edit to a shipped one) that runs on SQLite and D1, and `docs/data-model.md` is updated
- [ ] A new `KINDRED_*` setting is in `docs/self-host.md`, `docs/deploy-cloudflare.md`, `compose.yaml` and `.env.example`
- [ ] Tests, fixtures and screenshots use invented names only, no real family's data
- [ ] `CHANGELOG.md` has a line under Unreleased if a self-hoster would notice
