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
npx wrangler d1 create kindred-family        # default TREE_FAMILY binding; repeat for additional families
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

`mise run deploy` (step 7) applies new migrations itself, so later releases need no separate run. The migrations are
the same files the Node driver applies, so both targets keep one schema.

## 4. Bring a family in (optional)

If you have a family in a local `data/<id>.db` (for example, from `mise run data`), check the copy first, then send it:

```sh
node scripts/import-to-d1.ts <id> --plan     # prints what would be copied; changes nothing, needs no Cloudflare login
node scripts/import-to-d1.ts <id> --remote   # copies the rows into the family's D1 database and its pictures into R2
```

`--plan` prints the row count of each table that would be copied, and the pictures that would go to R2: every file
under `data/media/<id>/`, plus any picture stored inside the database. It reads the local file and `wrangler.jsonc`,
and it calls neither D1 nor R2.

A transfer copies all 18 tables the family's data lives in: its name and settings, houses, people, parent links,
partnerships, memories, map pins, portraits, the Edit tab's fields, house succession, gallery albums and pictures, the
tags on gallery pictures, painted portraits, house meanings and arms reviews, story translations, and the cached occupation translations. Three bookkeeping tables are left out on purpose.
`op` holds the retry keys of changes already sent; they expire after 30 days and mean nothing on another database.
`d1_migrations` is wrangler's record of the schema the target already has. `ancestry_rev` is the counter that the GEDCOM
import guards (migration 0011): the target's own parent rows move its counter as they are written, so the source's
value is not sent, and `--replace` leaves it to keep counting up. After the rows are written, the script reads
each table's count back from D1 and compares it with what it sent. A mismatch stops the run before any picture is
uploaded.

It refuses a database that already holds people, or a family's details with no people, unless you pass `--replace`.
The second case is what first-time setup leaves behind (step 7 makes the family's name and starting point before anyone
adds a person). The check runs before anything is written, so the transfer never stops halfway through a copy. The
choice is yours: run the transfer before anyone opens `/setup` (setup then finds the family and makes no new one), or
pass `--replace` to overwrite what setup made with the copy. `--replace` empties the 18 copied tables, the setup's
details among them, and writes them again. It leaves `op` alone, so the target keeps its retry keys, and it leaves the
pictures already in R2. The accounts database is not touched, so the steward's passkey still works; a reader's “who I
am” choice may name a person the copy does not have, and they pick again. The local file is never changed.

Accounts are not copied: passkeys belong to a host name, so the first person to open the deployed site sets it up and
invites the others.

## 5. Secrets and settings

| Name | Kind | What it does |
| --- | --- | --- |
| `KINDRED_SECRET` | secret | Seals each family's AI key (AES-GCM under a key derived from this secret and the family's id). Set it before you save an AI key. Changing it makes the saved keys unreadable, so the settings page asks for them again. Back it up. |
| `KINDRED_SETUP_CODE` | secret | A fixed code of at least 12 letters or digits, asked for by `/setup`. On Workers every isolate would make its own random code, so use a fixed one; do not use `required` there. Any other value locks setup. |
| `KINDRED_ORIGIN` | variable | The public address, e.g. `https://family.example.org`. Passkeys are tied to it. Set it when the address is not the one the Worker sees. |
| `KINDRED_GUEST_ORIGIN` | variable | The guest host for family share links, e.g. `https://guests.family.example.org`. Needed only behind Cloudflare Access. See step 6, [Guests behind Access](#guests-behind-access). |
| `KINDRED_DEFAULT_TREE` | variable | The family `/` opens directly, for its members. Without it, two or more families show the chooser. |
| `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD` | variable | Cloudflare Access. The team domain and the application's audience tag. See step 6. |
| `KINDRED_VAPID_PUBLIC_KEY`, `KINDRED_VAPID_SUBJECT` | variable | Web Push reminders: the public VAPID key and a contact (`mailto:` or `https:`). Reminders stay hidden without them. See Reminders below. |
| `KINDRED_VAPID_PRIVATE_JWK` | secret | Web Push reminders: the private VAPID key as JWK JSON. Keep it secret. |

```sh
npx wrangler secret put KINDRED_SECRET
npx wrangler secret put KINDRED_SETUP_CODE
```

Set the variables in the Cloudflare dashboard (Workers, Settings, Variables), or in `wrangler.jsonc` under `vars`,
which the repository does not set today. Locally they go in `.dev.vars`, which is gitignored.

### The nightly archive (optional)

The daily job can keep a readable copy of each family in a **private GitHub repository**: the v1 Markdown archive and a
GEDCOM file, committed to a folder of that repository. What it does, and what it leaves out, is in
[exchange.md](exchange.md#the-nightly-archive). For each family you want archived, set these (`<ID>` is the family id in
capitals, with `-` as `_`):

| Name | Kind | What it does |
| --- | --- | --- |
| `KINDRED_ARCHIVE_<ID>_REPO` | variable | `owner/name` of the private repository, such as `family/kindred-archive`. |
| `KINDRED_ARCHIVE_<ID>_TOKEN` | secret | A fine-grained token for that repository only: **Only select repositories** set to it, and **Contents: Read and write**. Nothing else. |
| `KINDRED_ARCHIVE_<ID>_BRANCH` | variable | The branch to commit to. Default `main`; it must exist, with at least one commit. |
| `KINDRED_ARCHIVE_<ID>_PATH` | variable | The folder the archive owns. Default `archive`. |

```sh
npx wrangler secret put KINDRED_ARCHIVE_MODERN_TOKEN
```

Put the variables in the dashboard or in `wrangler.jsonc` under `vars`, as the other settings above.

The archive runs in the same 06:00 UTC cron as reminders and enabled background AI tasks. Use a Workers plan
with enough CPU time and subrequests for your family's exports. A first archive writes every file; an interrupted
run logs a failure and retries on the next night. The branch changes only after the files are ready, so a failed
run does not publish a partial archive. Node is not subject to Workers invocation limits.

> **The archive holds private family data.** Every name, date, place, link and biography goes into it, and the GEDCOM
> file has them too. The repository must be private, and the people who can read it must be the family's stewards. Kindred
> refuses a public repository, but it cannot see who else has access to a private one.

Give each family its own repository and token. Two families can share a repository only with different folders, and each
folder then belongs to its family: the marker file there refuses the other family.

### Reminders (optional)

Web Push reminders need the three VAPID settings. Make them once with `mise run vapid-keys -- mailto:you@example.org`, and
read [self-host.md](self-host.md#reminders) for what the reminders say and what they send:

```sh
npx wrangler secret put KINDRED_VAPID_PRIVATE_JWK    # paste the JSON line the command printed
```

Put `KINDRED_VAPID_PUBLIC_KEY` and `KINDRED_VAPID_SUBJECT` in the dashboard or in `wrangler.jsonc` under `vars`. Only the
private key is a secret.

The daily run is the cron trigger in `wrangler.jsonc`, `"triggers": { "crons": ["0 6 * * *"] }`: it runs at 06:00 UTC and
sends each device the reminders due that day, at most one message a day (`scheduled` in `src/server.ts`). The same trigger
runs the nightly archive,
and enabled background AI tasks. Check your Worker plan limits for these jobs (see above). On Workers the trigger is the switch, so
remove it to stop the daily run. `KINDRED_JOBS` is read by the Node server only.

Each reminder is encrypted for its device before it leaves the Worker, and only the browser's push services carry it. The
subscriptions are rows of the `push_subscription` table in the `ACCOUNTS` database, so they are part of its backups.

## 6. Cloudflare Access (optional)

Put an Access application in front of the site's hostname. Kindred then reads the signed-in identity from the Access
token, and the first verified identity can become steward automatically when setup codes are off. On an empty server
that first sign-in makes the server's first family too, named “Our family” (or its translation in the reader's
language), just as passkey setup does. Set
`CF_ACCESS_TEAM_DOMAIN` to your team's domain and `CF_ACCESS_AUD` to the application's audience tag. Verified Access identities sign in through Access; passkeys remain available as a separate sign-in method.

### Guests behind Access

A family share link (Access page, **Share with a link**) lets a relative look around without an account, with a link and a
password (see [roles-and-privacy.md](roles-and-privacy.md)). Without Access in front of the site, it needs no setup. With Access,
it needs one thing, because Access stops anyone without a login before Kindred ever sees them.

**A path policy is not enough.** A Bypass on `/share/*` lets a guest see the password page and nothing after it: the next page
is `/<family>`, and the app reads through `/_serverFn/*` and `/api/photo/*`, `/api/portrait/*`, `/api/media/*`. Bypassing those paths
would take Access away from your members too. So guests come in on a **second host name**, and the policy on your members' host
stays exactly as it is:

1. Add a custom domain for guests to the same Worker: in the dashboard, Workers & Pages → `kindred` → Settings → Domains &
   Routes → Add → Custom domain, for example `guests.family.example.org`. In `wrangler.jsonc` the equivalent is
   `"routes": [{ "pattern": "guests.family.example.org", "custom_domain": true }]`.
2. Set `KINDRED_GUEST_ORIGIN` to that address (`https://guests.family.example.org`). Share links then point at it.
3. Check that **no Access application covers that host name**. A wildcard application such as `*.family.example.org` would. If you have
   one, add an application for exactly `guests.family.example.org`, with one policy: action **Bypass**, include **Everyone**.
   Add nothing to the application on your members' host.

The guest host is open to the internet, so Kindred locks it down itself (`src/lib/auth/guest-host.ts`):

- It answers only a guest's own paths: `/share/*`, a family's pages (not its Access or settings pages), the app's server functions and
  assets, and pictures (`/api/photo/*`, `/api/portrait/*`, `/api/media/*`, `/api/research/*`). Everything else is a 404: `/signin`, `/setup`,
  `/invite/*`, `/api/auth/*`, exports.
- It honours only a guest's visit. An account's session cookie and an Access identity are ignored there, so a stolen member
  cookie opens nothing, and setup never runs there. A server function reached through it refuses a guest
  for anything but the reads a viewer has.
- A member's own site is unchanged: Access, passkeys and every policy stay as they are, and a share link is still made there.

Without `KINDRED_GUEST_ORIGIN`, a site behind Access (`CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` set) can't make a link: the card says so
and the server refuses, rather than handing a relative a link that Access would stop. The same setting works on Node behind Access.

## Places on Workers (optional)

Assisted place entry suggests towns as you type a place, and the Atlas can draw towns that have no pin of the family's
own yet. The towns are GeoNames' cities with 500 or more people. On Node they come from `data/gazetteer.db`, which
`mise run gazetteer` builds. Workers have no file system, so on Workers they live in an optional D1 database bound as
`GAZETTEER`. Without that binding the place picker offers only the family's own places, as it always did.

1. Create the database and put its id in `wrangler.jsonc`:

   ```sh
   npx wrangler d1 create kindred-gazetteer
   ```

   Then uncomment the `GAZETTEER` line in `d1_databases` (it is the last comment in the list) and paste the id.
2. Apply the schema (`migrations/gazetteer`) and load the towns:

   ```sh
   mise run gazetteer              # once, on the machine that builds the file: ~40 MB download, ~30 MB database
   mise run cf:migrate:remote      # the schema, for every database in wrangler.jsonc, GAZETTEER included
   mise run cf:gazetteer -- --remote  # copies data/gazetteer.db in files of about 5,000 rows, then checks the counts
   ```

   The load empties the three tables first, so running it again replaces the data, and a load that stops is not
   mistaken for a finished one (the meta rows are written last). `--rows` changes the file size. For the local
   `dev:cf` databases, `mise run cf:gazetteer -- --local --env local` does the same.
3. Deploy as usual. The Worker only reads the database: a write through the binding is refused.

**Attribution.** The town names come from [GeoNames](https://www.geonames.org), released under the
[Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/) licence (CC BY 4.0). Keep that credit
wherever the towns are shown: the place picker and the Atlas already say "Towns: GeoNames", and the database records its
source in its `meta` table (`source`).

**Speed.** The place search reads the `name` table through its primary key, by the folded spelling, and the Atlas's towns
in a map box read the `place_by_lat` index. Both are index range scans (`EXPLAIN QUERY PLAN` shows them), and the three
name reads of one search are sent together. On a database of 150,000 towns a search took a few milliseconds on SQLite;
on D1 the time is mostly the round trip, and the name reads of a search wait for about one of them.

## 7. Deploy

```sh
mise run deploy    # vite build, then cf:migrate:remote, then npx wrangler deploy
```

The steps run in that order, and the first one that fails stops the rest, so new code never goes live on an old schema:

- **The build fails:** nothing has changed on Cloudflare.
- **A migration fails:** the new Worker is not deployed and the current one keeps serving. Each file applies as a unit and
  is recorded only when it succeeds, so the failed file left nothing behind. Files and databases before it stay migrated,
  because migrations only go forward. Fix the cause and run `mise run deploy` again: it continues from the first file
  not yet applied. To undo a migration that succeeded but was wrong, restore that database with
  `npx wrangler d1 time-travel restore`.
- **`wrangler deploy` fails:** the schema is new and the previous Worker keeps serving on it. Run `mise run deploy` again.

Because the migrations run first, the previous Worker serves on the new schema for a moment even when all goes well.
A migration must therefore not break the release before it: to remove or rename something the running code uses, stop
using it in one release and change the schema in the next.

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
options), and keep the `KINDRED_SECRET` value alongside them: saved AI keys cannot be decrypted without it. The rest of the database remains usable. Back up R2 media separately;
a D1 export does not contain the pictures. Test the restore on a scratch database before you rely on it.

## Troubleshooting

- **A family is missing from the site**: its `TREE_<ID>` binding is absent or misspelt, or the id is not lower case.
- **The transfer says the database already has a family's details**: first-time setup made them. Pass `--replace` to
  overwrite them with the copy (step 4), or send the copy to a database that has none.
- **Setup stops before the passkey**: the family it would make has no `TREE_<ID>` binding, or its database has no
  schema yet. Add the binding (step 2) and run `mise run cf:migrate:remote` (step 3), then open `/setup` again.
- **Passkey errors on a custom domain**: set `KINDRED_ORIGIN` to the public address. Changing the host name later
  needs new passkeys.
- **The AI settings say the key cannot be read**: `KINDRED_SECRET` changed or is missing. Enter the key again.
- **A migration failed**: the failing file is named in the output. Migrations apply in order and each one is its own
  transaction; fix the cause and run `mise run cf:migrate:remote` again.
