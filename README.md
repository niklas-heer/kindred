# Kindred v2

A family tree you can live in, inspired by grand-strategy games. Dynasties are drawn as tree-like houses
with crowns and arms, you move through the tree with the keyboard, and the whole family's record, stories,
photographs and places sit in one place. Each family is its own database, on your own machine or on
Cloudflare.

This repository is the code that becomes **Kindred v2** in
[niklas-heer/kindred](https://github.com/niklas-heer/kindred), which is the Markdown-archive project that
Kindred v1 is. See [docs/migration-plan.md](docs/migration-plan.md) for how it moves.

## What it does

- **Tree views.** *Family* is an hourglass around one person, *Dynasty* is a CK3-style house tree (pick a house
  from the list), and *Ancestors* is the pedigree. Cards zoom from full cards, to name plates, to house-coloured
  tiles with crowns for rulers. A **minimap** shows the whole tree, and a **ruler** names each generation.
- **Find and narrow.** ⌘K or `/` finds anyone by name, nickname, title or house, and every result says how they
  are related to you. Fold branches, or use a **lens** to dim everyone except a direct line, a house, the living,
  or the path between two people.
- **Houses and arms.** Each house has a shield, a motto and a head of house with a line of succession. Arms are
  drawn from a designer, and the assistant can suggest a design from a surname.
- **Atlas.** A world map of where the family was born, died and married, with a replay of the family spreading
  out through time, the *Chronicle* that narrates it, arms on each place, and the moves a mother's line made.
- **Almanac and contacts.** Upcoming birthdays, anniversaries and memorial days, with `.ics` export and "on this
  day". An address book grouped by household, with vCard export.
- **Reminders (optional).** Browser notifications on each device for birthdays, anniversaries and memorial days, in the
  device's language. Needs three VAPID settings; [docs/self-host.md](docs/self-host.md#reminders) says how.
- **Chronicle and stories.** Memories, sayings, anecdotes and recipes on each person, and a wall of sayings.
- **Photographs.** A gallery of the family's pictures, albums, places and dates, with faces tagged to people.
  Pictures live in media storage (`data/media/` on Node, R2 on Cloudflare).
- **Needed.** The research to-do list, nearest relatives first. *Blaze through* asks only for what is missing,
  one person at a time.
- **An AI assistant (optional).** Ask about the family, search people, or propose a change, which you approve
  as yourself. Off until a steward adds a key. [docs/ai.md](docs/ai.md) says what is sent where.
- **Roles and privacy.** Viewer, contributor, editor and steward, enforced on the server, and private fields
  for editors and stewards. [docs/roles-and-privacy.md](docs/roles-and-privacy.md).
- **Import and export.** GEDCOM 5.5.1 in and out, with a preview before anything is written, and a Markdown archive
  in the v1 format out. [docs/exchange.md](docs/exchange.md).
- **Themes.** *Codex* (dark lacquer and gold, the default), *Paper* (light) and *Night* (a candlelit study).
  Codex plays small sound effects, and the speaker button mutes them.
- **German and English**, with the interface in both. Names and written content are never translated.

## Screenshots

These are placeholders until they are captured. Each one should show the feature at desktop width (1440×900) and,
where it matters, at phone width (390×844).

- [ ] `docs/screenshots/dynasty-codex.png`: the Dynasty view of a house in the Codex theme
- [ ] `docs/screenshots/family-paper.png`: the Family hourglass in the Paper theme
- [ ] `docs/screenshots/minimap-zoomed-out.png`: the whole tree, zoomed out to tiles, with the minimap
- [ ] `docs/screenshots/atlas-replay.png`: the Atlas during a replay, with the Chronicle beside it
- [ ] `docs/screenshots/almanac.png`: the Almanac with birthdays and "on this day"
- [ ] `docs/screenshots/houses-arms.png`: a house page with its arms, motto and line of succession
- [ ] `docs/screenshots/gallery.png`: the gallery with an album and tagged faces
- [ ] `docs/screenshots/needed-blaze.png`: *Blaze through* asking for one missing fact
- [ ] `docs/screenshots/exchange.png`: the import preview, showing new people, matches and conflicts
- [ ] `docs/screenshots/phone-person.png`: a person's panel at 390×844

## Quick start (local, Node and SQLite)

You need [mise](https://mise.jdx.dev). It installs Node (the version is in `mise.toml`).

```sh
mise install && npm install
mise run data     # optional: generate the two test families (realm, modern) into data/
mise run gazetteer  # optional: an offline place search from GeoNames (about 40 MB)
mise run dev      # http://localhost:4517
```

On a new install, open the site and create the first account with a passkey. The first account becomes steward
of every family that exists, and setup closes as soon as it exists. Invite everyone else from the Access page.

`mise run data` also imports the real archive from `../family-archive` when that folder exists, and says so when it
does not. Your own family's files never leave `data/`, which is gitignored.

Passkeys need HTTPS or `localhost`. Behind a reverse proxy, set `KINDRED_ORIGIN` to the public address (see
[docs/self-host.md](docs/self-host.md)).

### Commands

Every task is in `mise.toml`. These are the ones you are likely to use:

| Command | What it does |
| --- | --- |
| `mise run install` | `npm install` |
| `mise run data` | Generate the test families and rebuild their databases (the real archive only if it is present) |
| `mise run seed` | Build any missing `data/<id>.db` from `data/seed/`; existing databases are kept |
| `mise run gazetteer` | Download GeoNames `cities500` once and build `data/gazetteer.db` |
| `mise run dev` | Run on Node with the SQLite files in `data/` (`vite dev`, port 4517) |
| `mise run dev:cf` | Run the Worker in workerd with local D1 and R2, after applying migrations; `mise run cf:seed` loads the test families |
| `mise run check` | `tsc --noEmit` |
| `mise run test` | The unit tests for accounts, Access and the storage layer |
| `mise run build` | Build the Worker into `dist/` (`KINDRED_TARGET=node` builds for Node instead) |
| `mise run build:node` | Build the production server for Node into `dist/` |
| `mise run start` | Run that production server (`PORT`, `HOST`, `KINDRED_DATA_DIR`; see [docs/self-host.md](docs/self-host.md)) |
| `mise run deploy` | Build and `wrangler deploy` (see [docs/deploy-cloudflare.md](docs/deploy-cloudflare.md)) |
| `mise run clean` | Remove build output and the generated databases |

## Self-host with Docker

The image runs the production server on Node 26, with the data in a volume. The full guide is
[docs/self-host.md](docs/self-host.md): settings, HTTPS, backups and upgrades.

```sh
cp .env.example .env          # optional; set KINDRED_ORIGIN and KINDRED_SETUP_CODE for a public address
docker compose up -d --build  # http://localhost:4901; open /setup and create the first account
```

For HTTPS on a domain, set `KINDRED_DOMAIN` and `KINDRED_ORIGIN` to `https://` that domain, and run
`docker compose --profile https up -d --build` (Caddy gets the certificate). Without Docker:
`mise run build:node && mise run start`.

## Deploy on Cloudflare

Kindred runs on Cloudflare Workers, with one D1 database for the accounts, one D1 database per family, and an R2
bucket for media. Cloudflare Access is optional, in front of the site. The full steps are in
[docs/deploy-cloudflare.md](docs/deploy-cloudflare.md). In short:

```sh
npx wrangler login
npx wrangler d1 create kindred-accounts        # paste the id into wrangler.jsonc
npx wrangler d1 create kindred-<family>        # one per family; add a TREE_<FAMILY> binding for it
npx wrangler r2 bucket create kindred-media
mise run cf:migrate:remote                     # the schema, for every database in wrangler.jsonc
npx wrangler secret put KINDRED_SECRET         # seals the AI keys; keep it, and back it up
npx wrangler secret put KINDRED_SETUP_CODE     # a fixed code of 12+ characters for /setup
mise run deploy
```

Optional settings, as Worker variables or in `.dev.vars` locally: `KINDRED_ORIGIN` (the public address),
`KINDRED_DEFAULT_TREE` (the family `/` opens directly, for members of it), and `CF_ACCESS_TEAM_DOMAIN` with
`CF_ACCESS_AUD` (Cloudflare Access).

## Your data and export

Every family is one database you can read. On Node it is `data/<family>.db`, a SQLite file; on Cloudflare it is a
D1 database. The browser keeps a session cookie and a few preferences (theme, language, sound, how names are shown),
and nothing else. You can take a family out at any time:

- **GEDCOM 5.5.1** (`.ged`), which other genealogy programs read. What it cannot carry is listed before you download.
- **A Markdown archive** (a ZIP), one note per person in the v1 format that Kindred v1 and `scripts/import-kindred.ts`
  read.

Editors and stewards can export. Stewards can import a GEDCOM file, which is previewed first and written only when
they confirm. See [docs/exchange.md](docs/exchange.md) for what each format keeps and drops.

Stories, contacts, houses and pictures are not in either text file. The gallery and portraits are kept in media
storage, and the database holds only their keys.

## Roles and privacy, in brief

- **Viewer**: browse everything, change nothing.
- **Contributor**: also add memories, sayings, recipes and photos.
- **Editor**: also add and edit people, links, places and contacts, and export the family.
- **Steward**: also edit houses and arms, manage access, and import.

Every change is checked on the server, not just hidden in the browser. Private fields are shown to editors and
stewards only. Details, and what the AI assistant sees, are in [docs/roles-and-privacy.md](docs/roles-and-privacy.md)
and [docs/ai.md](docs/ai.md).

## How it is built

TanStack Start (server functions) with React 19, TanStack Router, Query, Form, Hotkeys and Pacer, and the design
system in `src/components/ui`. Storage is a small `Db` interface (`src/lib/store`), with `node:sqlite` on Node and
D1 on Cloudflare, and the same migrations (`migrations/`) for both. [docs/data-model.md](docs/data-model.md)
describes the tables.

- `src/lib/layout.ts`: contour-packed tidy trees for the dynasty, hourglass and pedigree views.
- `src/lib/graph.ts`: relatives, generations and English kinship labels ("half-cousin once removed").
- `src/lib/exchange/`: GEDCOM and Markdown, the import plan, and the exports.
- `src/lib/ai/`: the assistant and the image features, behind one provider interface.

## Development

```sh
mise run check   # the types
mise run test    # the unit tests
```

Schema changes are new numbered files in `migrations/`; a file that has shipped is never edited. Translations
live in `src/lib/i18n/en.ts` (the source) and `de.ts`.

## Licence and credits

Kindred is open source under the [MIT licence](https://opensource.org/licenses/MIT), as Kindred v1 is. A LICENSE
file is added when this code moves into niklas-heer/kindred.

Credits and their licences:

- Heraldic charges come from [game-icons.net](https://game-icons.net), under **CC BY 3.0**. Attribution: "Game-icons.net, CC BY 3.0".
- Portraits use DiceBear Lorelei, under CC0.
- Place names for the offline gazetteer come from [GeoNames](https://www.geonames.org), under **CC BY 4.0**.
- Typefaces come from Fontsource: Cinzel, EB Garamond, Inter and IM Fell English, under the SIL Open Font License.
- The Atlas draws its map from `world-atlas`, which is built from Natural Earth data.
