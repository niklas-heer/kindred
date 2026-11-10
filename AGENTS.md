# Working on Kindred

For AI agents and people alike. Kindred is a public, open-source family-tree web app: TanStack Start and React 19 in
TypeScript, on `node:sqlite` (Node 26) or on Cloudflare Workers with D1 and R2. MIT licence. It holds family data, so
privacy rules matter more than speed.

## Layout

- `src/routes/` pages (`$tree/` is one family's pages) and `src/routes/api/` plain HTTP routes (health, media, export).
- `src/components/` React components and their CSS, one folder per larger feature (`heraldry/`, `assistant/`, `portrait/`, `tour/`, `statistics/`).
- `src/lib/` the rest of the app, with a pair per feature: `x.functions.ts` (server functions) and `x.server.ts` (the work).
  Areas: `auth/` (passkeys, sessions, roles guard, share links), `ai/` (providers, chat, background tasks), `exchange/`
  (GEDCOM and Markdown), `store/` (storage drivers), `i18n/`, `stats/`, `jobs/` (daily jobs).
- `server/` the production Node server (`node.ts`, static files, compression, daily jobs).
- `migrations/{tree,accounts,gazetteer}/` numbered SQL files. `scripts/` seeding, test families, D1 transfer, Worker smoke test, AI evaluation. `e2e/` Playwright journeys. `docs/` guides for self-hosters.

## Commands

`mise tasks` lists them all. Run `mise install` once, so the right Node (26) is used.

- `mise run check` the types (`tsc --noEmit`). `mise run lint` is oxlint (`.oxlintrc.json`): unused code, React hook rules (`exhaustive-deps` included) and correctness; a disabled rule needs a sentence saying why. `mise run test` is `npm test`: **node's own test runner, not vitest**.
  It wants `KINDRED_DATA_DIR` pointed at an empty folder (`KINDRED_DATA_DIR=$(mktemp -d) node --test <file>` for one file);
  the store refuses to open the repository's `data/` inside a test.
  Every `*.test.ts` under `src/`, `scripts/` and `server/` runs, in any folder, so a new test needs no registration.
- `mise run e2e` builds the Node server, then runs Playwright on scratch data with the fake AI provider. It takes minutes. It uses the installed Brave, or the Chromium in `KINDRED_E2E_BROWSER`.
- `mise run smoke:worker` builds the Worker and checks it in workerd on empty local D1 and R2. It never contacts Cloudflare.
- `mise run build` builds the Worker; `mise run build:node` builds for Node, then `mise run start` runs it. `mise run dev` is the dev server (port 4517); `mise run data` makes the two invented test families.
- `mise run ci` runs the Dagger pipeline CI uses (needs a container engine).

## Conventions

- **Server functions** validate input with zod, check the role on the server (`requireReader`, `requireMember` or `requireCan` from `src/lib/auth/guard.server.ts`, see `src/lib/roles.ts`), and reach their `.server.ts` module through a dynamic `import()`, so server code stays out of the browser bundle. Never trust the client for a role.
- **Writes go through `once`** (`src/lib/db.server.ts`): read, decide, then one batch that starts with guards and carries a retry key (`opKey`). Every plan says what it did to the family's records in `history` (`added`, `removed`, `change` from `src/lib/history.server.ts`), or `NOT_A_RECORD` for a write that touches none (a game, a cache); a records write without it is refused. See "Rules every change follows" in `docs/data-model.md`.
- **Two storage drivers** (`src/lib/store/node.ts` and `cf.ts`, chosen by the `#store/driver` import map in `package.json`) must behave alike; the shared contract tests are in `src/lib/store/contract.cases.ts`. D1 has no interactive transactions.
- **Migrations** are new numbered files; a file that has shipped is never edited. They must run on SQLite and D1: no `PRAGMA`, `BEGIN` or `COMMIT`, and a new `NOT NULL` column needs a default. Update `docs/data-model.md` in the same change.
- **Text** goes in `src/lib/i18n/areas/`, in English, German (du) and Afrikaans (jy), never in a component. See `src/lib/i18n/README.md`; `npm test` fails on a missing translation.
- **Settings** (`KINDRED_*`) change together in `docs/self-host.md`, `docs/deploy-cloudflare.md`, `compose.yaml` and `.env.example`.
- **AI**: tests use the fake provider (`KINDRED_AI_FAKE=1`, `src/lib/ai/fake.ts`). Never call a real provider from a test or script you commit.
- **Privacy**: the repository is public. `data/` is local, holds real families and is never committed or read by tests. Tests, fixtures, docs and screenshots use invented names only, never a real family's.
- **Commits**: conventional commits as in `git log` (`feat(scope):`, `fix:`, `docs:`, `test:`, `perf:`, `ci:`, `chore:`), one coherent change each. Add a line to `CHANGELOG.md` under Unreleased for anything a self-hoster would notice.
