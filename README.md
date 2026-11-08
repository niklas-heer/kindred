# Kindred v2

Kindred is a shared family tree with houses, photographs, stories and places. It runs on Node with SQLite,
or on Cloudflare Workers with D1 and R2.

Version 2.0.0 replaces the v1 Markdown archive application. It is a web app, not an upgrade to the Rust CLI.
Read the [release notes](docs/releases/v2.0.0.md) and [v1 migration guide](docs/migration-plan.md) before moving an archive.

## What it does

- **Tree views.** *Family* is an hourglass around one person, *Dynasty* is a CK3-style house tree (pick a house
  from the list), and *Ancestors* is the pedigree. Cards zoom from full cards, to name plates, to house-coloured
  tiles with crowns for rulers. A **minimap** shows the whole tree, and a **ruler** names each generation.
- **Find and narrow.** ⌘K or `/` finds anyone by name, nickname, title or house, and every result says how they
  are related to you. Fold branches, or use a **lens** to dim everyone except a direct line, a house, the living,
  or the path between two people.
- **Houses and arms.** Each house has a shield, a motto and a head of house with a line of succession. Arms are
  drawn from a designer, and the assistant can research a name's meaning, check whether the arms fit it, and suggest revised or new designs from that feedback. Heads and heirs can be of any gender; houses can have a country flag.
- **Atlas.** A world map of where the family was born, died and married, with a replay of the family spreading
  out through time, the *Chronicle* that narrates it, arms on each place, and the moves a mother's line made.
- **Almanac and contacts.** Upcoming birthdays, anniversaries and memorial days, with `.ics` export and "on this
  day". An address book grouped by household, with vCard export.
- **Reminders (optional).** Browser notifications on each device for birthdays, anniversaries and memorial days, in the
  device's language. Needs three VAPID settings; [docs/self-host.md](docs/self-host.md#reminders) says how.
- **Life.** A person's timeline includes a spouse's death and widowhood when the dates support it, with their age at each dated event.
- **Chronicle and stories.** Memories, sayings, anecdotes and recipes on each person, and a wall of sayings.
- **Photographs.** A gallery of the family's pictures, albums, places and dates, with faces tagged to people. AI face suggestions need a person to confirm them.
  Pictures live in media storage (`data/media/` on Node, R2 on Cloudflare).
- **Needed.** The research to-do list, nearest relatives first. *Blaze through* asks only for what is missing,
  one person at a time.
- **AI features (optional).** The assistant answers questions about the family, searches people, and proposes changes
  that you approve as yourself. It can also suggest faces in a photo, a portrait look, and arms from a surname. A steward
  connects Anthropic, OpenAI and OpenRouter, and chooses a provider and model per feature. Models come from each
  provider's list. The family shares one monthly dollar budget ($5 by default), including background work and painted
  portraits. Web search has its own switch. Features stay off until enabled; scheduled arms reviews and translations
  have their own switches and run log.
  [docs/ai.md](docs/ai.md) says what is sent where.
- **Roles and privacy.** Viewer, contributor, editor and steward, enforced on the server, and private fields
  for editors and stewards. [docs/roles-and-privacy.md](docs/roles-and-privacy.md).
- **Import and export.** GEDCOM 5.5.1 in and out, with a preview before anything is written, and a Markdown archive
  in the v1 format out. [docs/exchange.md](docs/exchange.md).
- **Nightly archive (optional).** Each family can be copied every night, as the Markdown archive and a GEDCOM file, into
  a private GitHub repository you name. Kindred only writes to it, and only when something changed.
  [docs/exchange.md](docs/exchange.md#the-nightly-archive).
- **Themes.** *Codex* (dark lacquer and gold, the default), *Paper* (light) and *Night* (a candlelit study).
  Codex plays small sound effects, and the speaker button mutes them.
- **English, German and Afrikaans**, with the interface in all three. A flag picker switches the language. Names and
  written content are never translated.

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

On Node, local storage defaults to `data/`, which is gitignored. Enabled AI features send selected data to their provider;
optional remote archives and push reminders also use external services.

Passkeys need HTTPS or `localhost`. Behind a reverse proxy, set `KINDRED_ORIGIN` to the public address (see
[docs/self-host.md](docs/self-host.md)).

### Commands

Every task is in `mise.toml`. These are the ones you are likely to use:

| Command | What it does |
| --- | --- |
| `mise run install` | `npm install` |
| `mise run data` | Generate the test families and rebuild their databases |
| `mise run seed` | Build any missing `data/<id>.db` from `data/seed/`; existing databases are kept |
| `mise run gazetteer` | Download GeoNames `cities500` once and build `data/gazetteer.db` |
| `mise run dev` | Run on Node with the SQLite files in `data/` (`vite dev`, port 4517) |
| `mise run dev:cf` | Run the Worker in workerd with local D1 and R2, after applying migrations; `mise run cf:seed` loads the test families |
| `mise run cf:migrate` | Apply all local D1 migrations |
| `mise run cf:migrate:remote` | Apply all deployed D1 migrations |
| `mise run cf:seed` | Replace local D1 test families from the generated SQLite files |
| `mise run cf:gazetteer -- --remote` | Load the offline place database into the configured remote GAZETTEER binding |
| `mise run ai-eval -- --dry-run` | Plan AI model evaluations without sending requests; see [AI docs](docs/ai.md) |
| `mise run check` | `tsc --noEmit` |
| `mise run test` | Every unit test (the same list as `npm test`) |
| `mise run build` | Build the Worker into `dist/` (`KINDRED_TARGET=node` builds for Node instead) |
| `mise run build:node` | Build the production server for Node into `dist/` |
| `mise run start` | Run that production server (`PORT`, `HOST`, `KINDRED_DATA_DIR`; see [docs/self-host.md](docs/self-host.md)) |
| `mise run deploy` | Build and `wrangler deploy` (see [docs/deploy-cloudflare.md](docs/deploy-cloudflare.md)) |
| `mise run smoke:worker` | Build the Worker into a scratch folder, run it locally and check its routes; never contacts Cloudflare |
| `mise run ci` | The CI pipeline in Dagger: the checks, both builds, the Worker smoke test and the Docker build. Needs a container engine, such as Colima, running |
| `mise run vapid-keys` | Make the key pair for reminders and print its three settings |
| `mise run clean` | Remove build output and the generated databases |

## Self-host with Docker

The image runs the production server on Node 26, with the data in a volume. The full guide is
[docs/self-host.md](docs/self-host.md): settings, HTTPS, backups and upgrades.

```sh
cp .env.example .env          # optional; set KINDRED_ORIGIN and KINDRED_SETUP_CODE for a public address
docker compose up -d --build  # http://localhost:4901; open /setup and create the first account
```

For HTTPS on a domain, set `KINDRED_DOMAIN` to your domain and `KINDRED_ORIGIN` to `https://` followed by that domain, and run
`docker compose --profile https up -d --build` (Caddy gets the certificate). Without Docker:
`mise run build:node && mise run start`.

## Deploy on Cloudflare

Kindred runs on Cloudflare Workers, with one D1 database for the accounts, one D1 database per family, and an R2
bucket for media. Cloudflare Access is optional, in front of the site. The full steps are in
[docs/deploy-cloudflare.md](docs/deploy-cloudflare.md). In short:

```sh
npx wrangler login
npx wrangler d1 create kindred-accounts        # paste the id into wrangler.jsonc
npx wrangler d1 create kindred-family          # matches the default TREE_FAMILY binding
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
D1 database. The browser keeps a session cookie and a few preferences (theme, language, sound, how names are shown). The accounts
database keeps accounts and passkeys and, when reminders are on, each device's push subscription. A family's people,
stories and pictures stay in that family's own database. You can take a family out at any time:

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
- **Steward**: also edit houses and arms, delete albums, manage access and AI settings, and import.

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
live in `src/lib/i18n/areas/`, one file per area, each with its English, German and Afrikaans text.
[src/lib/i18n/README.md](src/lib/i18n/README.md) says how to add a string.

## Licence and credits

Kindred is open source under the [MIT licence](LICENSE), as Kindred v1 is.

Credits and their licences:

- Heraldic charges come from [game-icons.net](https://game-icons.net), under **CC BY 3.0**. Attribution: "Game-icons.net, CC BY 3.0".
- Portraits use DiceBear Lorelei, under CC0.
- Place names for the offline gazetteer come from [GeoNames](https://www.geonames.org), under **CC BY 4.0**.
- Typefaces come from Fontsource: Cinzel, EB Garamond, Inter and IM Fell English, under the SIL Open Font License.
- The Atlas draws its map from `world-atlas`, which is built from Natural Earth data.
