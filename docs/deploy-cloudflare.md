# Deploying Kindred on Cloudflare

Kindred runs as a Cloudflare Worker. Its data sits in D1 (SQLite in the cloud): one database for accounts, and one
per family. Pictures sit in R2. Cloudflare Access can go in front of the site as well. Every command below is one
from `mise.toml`, `wrangler.jsonc` or `scripts/`.

## What you need

- A Cloudflare account, and [mise](https://mise.jdx.dev) with the Node version from `mise.toml`.
- `npm install` in the repository (wrangler is a dev dependency).
- `npx wrangler login`, once per machine.

## 1. Create the databases and the bucket

```sh
npx wrangler d1 create kindred-accounts
npx wrangler d1 create kindred-<family>      # one for each family; <family> is its id, e.g. kindred-smith
npx wrangler r2 bucket create kindred-media
```

Each `d1 create` prints a `database_id`. Paste it into `wrangler.jsonc`, in the `d1_databases` list, replacing the
`REPLACE-WITH-D1-ID` placeholder. The bucket needs no id.

## 2. Bind each family

Each family has its own D1 binding. A family with the id `my-family` is bound as `TREE_MY_FAMILY`: take the id, make
it upper case and change dashes to underscores. The binding names the database, and it points at `migrations/tree`:

```jsonc
{ "binding": "TREE_MY_FAMILY", "database_name": "kindred-my-family", "database_id": "<the id from step 1>", "migrations_dir": "migrations/tree" }
```

The app finds families by these bindings, so a family with no binding does not exist for the site. The family's
URL is `/<id>`.

The first family that first-time setup makes (step 7) needs its binding too. Its id is `KINDRED_DEFAULT_TREE`, or
`family` when that is not set, so `TREE_FAMILY` must exist, or the binding for whatever `KINDRED_DEFAULT_TREE` names.

## 3. Apply the schema

```sh
mise run cf:migrate:remote    # node scripts/cf-migrate.ts --remote: every D1 in wrangler.jsonc, in migration order
```

Run it again after each release that adds a file to `migrations/`. The migrations are the same files the Node
driver applies, so both targets keep one schema.

## 4. Bring a family in (optional)

If you have a family in a local `data/<id>.db` (for example, from `mise run data`), check the copy first, then send it:

```sh
node scripts/import-to-d1.ts <id> --plan     # prints what would be copied; changes nothing, needs no Cloudflare login
node scripts/import-to-d1.ts <id> --remote   # copies the rows into the family's D1 database and its pictures into R2
```

`--plan` prints the row count of each table that would be copied, and the pictures that would go to R2: every file
under `data/media/<id>/`, plus any picture stored inside the database. It reads the local file and `wrangler.jsonc`,
and it calls neither D1 nor R2.

A transfer copies all 14 tables the family's data lives in: its name and settings, houses, people, parent links,
partnerships, memories, map pins, portraits, the Edit tab's fields, house succession, gallery albums and pictures, the
tags on gallery pictures, and the cached occupation translations. Two bookkeeping tables are left out on purpose.
`op` holds the retry keys of changes already sent; they expire after 30 days and mean nothing on another database.
`d1_migrations` is wrangler's record of the schema the target already has. After the rows are written, the script reads
each table's count back from D1 and compares it with what it sent. A mismatch stops the run before any picture is
uploaded.

It refuses a database that already holds people unless you pass `--replace`. `--replace` empties the 14 copied tables
and writes them again. It leaves `op` alone, so the target keeps its retry keys, and it leaves the pictures already in
R2. The local file is never changed.

Accounts are not copied: passkeys belong to a host name, so the first person to open the deployed site sets it up and
invites the others.

## 5. Secrets and settings

| Name | Kind | What it does |
| --- | --- | --- |
| `KINDRED_SECRET` | secret | Seals each family's AI key (AES-GCM under a key derived from this secret and the family's id). Set it before you save an AI key. Changing it makes the saved keys unreadable, so the settings page asks for them again. Back it up. |
| `KINDRED_SETUP_CODE` | secret | A fixed code of at least 12 letters or digits, asked for by `/setup`. On Workers every isolate would make its own random code, so use a fixed one; do not use `required` there. |
| `KINDRED_ORIGIN` | variable | The public address, e.g. `https://family.example.org`. Passkeys are tied to it. Set it when the address is not the one the Worker sees. |
| `KINDRED_DEFAULT_TREE` | variable | The family `/` opens directly, for its members. Without it, two or more families show the chooser. |
| `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD` | variable | Cloudflare Access. The team domain and the application's audience tag. See step 6. |

```sh
npx wrangler secret put KINDRED_SECRET
npx wrangler secret put KINDRED_SETUP_CODE
```

Set the variables in the Cloudflare dashboard (Workers, Settings, Variables), or in `wrangler.jsonc` under `vars`,
which the repository does not set today. Locally they go in `.dev.vars`, which is gitignored.

## 6. Cloudflare Access (optional)

Put an Access application in front of the site's hostname. Kindred then reads the signed-in identity from the Access
token, and the first verified identity can become steward automatically when setup codes are off. Set
`CF_ACCESS_TEAM_DOMAIN` to your team's domain and `CF_ACCESS_AUD` to the application's audience tag. Access is an
extra lock, not a replacement for passkeys: people still sign in to Kindred with their own passkey.

## 7. Deploy

```sh
mise run deploy    # vite build, then npx wrangler deploy
```

The first account claims stewardship when it is made, and setup makes the server's first family too. Open the site and
go through `/setup` (with the setup code, if you set one). Type the family's name and your own name, then create the
passkey. The family gets the id `KINDRED_DEFAULT_TREE` (or `family`) and the name you typed. On the next screen, add
yourself to it as its starting point, or skip that and the family opens empty. Setup closes after that account exists.

Setup can only make that family when its binding exists (`TREE_FAMILY`, or the `TREE_<ID>` for your
`KINDRED_DEFAULT_TREE`), and its database has the schema from step 3. Otherwise setup stops before it asks for a
passkey, and says what to add.

## Checking a deployment locally first

`mise run dev:cf` runs the Worker in workerd, with local D1 and R2 (wrangler's `local` environment in
`wrangler.jsonc`). It applies the migrations to the local databases first. The local databases are `kindred-local-*`,
with the test families `modern` and `realm`:

```sh
mise run dev:cf
mise run cf:seed   # copies data/modern.db and data/realm.db into the local D1 databases, replacing what is there
```

`cf:seed` replaces the local databases, so it is safe for test data only.

## Backups

The data lives in D1 and R2. Take a copy of each database with wrangler (`npx wrangler d1 export --help` shows the
options), and keep the `KINDRED_SECRET` value alongside them: a database is useless to the app without it if it holds
AI keys. Test the restore on a scratch database before you rely on it.

## Troubleshooting

- **A family is missing from the site**: its `TREE_<ID>` binding is absent or misspelt, or the id is not lower case.
- **Setup stops before the passkey**: the family it would make has no `TREE_<ID>` binding, or its database has no
  schema yet. Add the binding (step 2) and run `mise run cf:migrate:remote` (step 3), then open `/setup` again.
- **Passkey errors on a custom domain**: set `KINDRED_ORIGIN` to the public address. Changing the host name later
  needs new passkeys.
- **The AI settings say the key cannot be read**: `KINDRED_SECRET` changed or is missing. Enter the key again.
- **A migration failed**: the failing file is named in the output. Migrations apply in order and each one is its own
  transaction; fix the cause and run `mise run cf:migrate:remote` again.
