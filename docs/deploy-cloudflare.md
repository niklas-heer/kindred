# Deploying Kindred on Cloudflare

Kindred runs as a Cloudflare Worker. Each family's data sits in its own [Durable Object](https://developers.cloudflare.com/durable-objects/)
with SQLite storage, made the moment a steward makes the family; the accounts sit in one more. Pictures sit in R2. Nothing
needs creating or binding per family, and there is no limit on how many there are. Installs from before Durable Objects keep
their D1 databases (one for accounts, one per family) and keep working unchanged; see [Families in D1](#2-bind-each-family). People
sign in with Kindred's passkeys or through Cloudflare Access, one or the other (step 6). Every command below is one from
`mise.toml`, `wrangler.jsonc` or `scripts/`.

## One-click deploy

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/niklas-heer/kindred)

The button copies this repository into your GitHub (or GitLab) account, connects it to Workers Builds and deploys it. It
needs a Cloudflare account on the **Workers Paid plan** (see [What you need](#what-you-need)). It makes everything
`wrangler.jsonc` asks for and nothing else:

| What | Name | Made by |
| --- | --- | --- |
| The Worker | `kindred` (you may rename it) | the button |
| `FAMILIES` Durable Objects, class `FamilyStore`, SQLite storage | one object per family, and one for the accounts | the Worker, on first use |
| `MEDIA` R2 bucket | `kindred-media` (you may rename it) | the button |
| `KINDRED_SECRET` | secret: a long random value, for example from `openssl rand -base64 32`. It seals the AI keys stewards save; keep a copy | you, in the button's form |
| `KINDRED_SETUP_CODE` | secret: 12 or more letters or digits, asked for by `/setup` so nobody else can claim the new site | you, in the button's form |

There is no D1 database and no migration step: each Durable Object applies `migrations/` to itself. The build runs with the
Node version in `.node-version` and the `build` and `deploy` scripts of `package.json`; keep the button's defaults.

Then, the first run:

1. Open the address the button shows (`https://kindred.<your-subdomain>.workers.dev`). It sends you to `/setup`.
2. Enter the setup code, the family's name and your own name, and create a passkey. You are the first steward, and the first
   family (`family`, or `KINDRED_DEFAULT_TREE`) is made.
3. Add yourself as the family's starting point, or skip it. Invite the others from the Access page.
4. For a custom domain, add it to the Worker (Settings, Domains & Routes) and set `KINDRED_ORIGIN` to it **before** anyone else
   makes a passkey: passkeys are bound to the host name.
5. More families: Manage families in the account menu. Each is made at once, in its own Durable Object.

**Keeping the families in the EU.** Durable Objects can be kept in the EU jurisdiction. Before anyone opens the new site, add
`"vars": { "KINDRED_JURISDICTION": "eu" }` to `wrangler.jsonc` in your copy of the repository and push: Workers Builds deploys
again. The setting decides where the first object is made, so it cannot be changed afterwards. Kindred records it in the bucket
on first use and refuses to start with another value, rather than show empty families and an open `/setup`. The R2 bucket's
location is chosen when it is made: for an EU bucket, make one with `npx wrangler r2 bucket create kindred-media --jurisdiction eu`
and add `"jurisdiction": "eu"` to the `MEDIA` binding before the first deploy.

Updating later: pull this repository's new release into your copy and push; Workers Builds deploys it, and every Durable
Object brings its schema up to date the first time it is used.

The rest of this guide is the same deployment by hand, with wrangler, and the older setup with D1.

## What you need

- A Cloudflare account, and [mise](https://mise.jdx.dev) with the Node version from `mise.toml`.
- `npm install` in the repository (wrangler is a dev dependency).
- `npx wrangler login`, once per machine.
- **The Workers Paid plan.** The free plan allows 10 ms of CPU time per request, and drawing a family's pages takes more:
  20 to 78 ms per page in a measurement (on Node, for invented families of 346 and 1,627 people; the people list and
  house pages are the heaviest). On the free plan most page loads would be cut off. Share-link passwords need it too (see
  [the nightly archive](#the-nightly-archive-optional)).

`wrangler.jsonc` turns on [Smart Placement](https://developers.cloudflare.com/workers/configuration/smart-placement/).
A page reads its database in several steps, one after the other (the session, then the reader's families, then the family itself),
so a Worker that runs near the reader would cross the distance to the databases at every step. Smart Placement moves it
next to them once it has seen enough requests. Remove the `placement` line to run it near the reader instead.

## 1. Create the bucket (and the D1 databases, if you keep families in D1)

With Durable Objects (the default `wrangler.jsonc`) the bucket is all there is to make; skip to step 5 afterwards:

```sh
npx wrangler r2 bucket create kindred-media
```

The rest of steps 1 to 3 is for families kept in D1 (installs from before Durable Objects, or a choice to stay on D1). Add a
`d1_databases` list to `wrangler.jsonc` with an `ACCOUNTS` binding and a `TREE_<ID>` binding per family, each with
`"migrations_dir"` as in the `local` environment there:

```sh
npx wrangler d1 create kindred-accounts
npx wrangler d1 create kindred-family        # default TREE_FAMILY binding; repeat for additional families
npx wrangler r2 bucket create kindred-media
```

Each `d1 create` prints a `database_id`. Paste it into `wrangler.jsonc`, in the `d1_databases` list. The bucket needs no id.

## 2. Bind each family

With Durable Objects there is nothing to bind: a family is made in its own object when a steward makes it. This step is for
families in D1. A family with a `TREE_<ID>` binding is served from D1 even when `FAMILIES` is bound too, so an install can
keep its D1 families and make every new one as a Durable Object; [Moving a family into a Durable Object](#moving-a-family-into-a-durable-object)
moves the old ones over when you like.

Each family in D1 has its own D1 binding. A family with the id `my-family` is bound as `TREE_MY_FAMILY`: take the id, make
it upper case and change dashes to underscores. The binding names the database, and it points at `migrations/tree`:

```jsonc
{ "binding": "TREE_MY_FAMILY", "database_name": "kindred-my-family", "database_id": "<the id from step 1>", "migrations_dir": "migrations/tree" }
```

The app finds families by these bindings, so a family with no binding does not exist for the site. The family's
URL is `/<id>`.

The first family that first-time setup makes (step 7) needs its binding too. Its id is `KINDRED_DEFAULT_TREE`, or
`family` when that is not set, so `TREE_FAMILY` must exist, or the binding for whatever `KINDRED_DEFAULT_TREE` names.

### Another family

With Durable Objects, a family made later (Manage families in the account menu, see [self-host.md](self-host.md#more-than-one-family))
is made at once and needs nothing here. Without `FAMILIES` bound, it needs its own D1 database, because a Worker cannot create
or bind a D1 database by itself:

1. `npx wrangler d1 create kindred-<id>`, and its binding in `wrangler.jsonc` as above (`TREE_<ID>`).
2. `mise run deploy`, which applies the schema to it and deploys.
3. The Families page now lists it as an empty database: give it a name there and **Set up this family**. You become its steward.

Deleting a family kept in a Durable Object deletes everything the object stores, its pictures in R2 and its rows in the accounts
database. Deleting a family kept in D1 empties its database (every row; the schema stays) and deletes its pictures from R2 and its rows
in the accounts database. The database stays bound and is listed again as empty, ready for another family; to remove it for
good, take its binding out of `wrangler.jsonc`, deploy, then `npx wrangler d1 delete kindred-<id>`.

## 3. Apply the schema

Durable Objects apply the migrations to themselves, when they are made and after each deploy. For D1:

```sh
mise run cf:migrate:remote    # node scripts/cf-migrate.ts --remote: every D1 in wrangler.jsonc, in migration order
```

`mise run deploy` (step 7) applies new migrations itself, so later releases need no separate run. The migrations are
the same files the Node driver applies, so both targets keep one schema.

## 4. Bring a family in (optional)

Into a Durable Object (the default setup), after the site is set up and you are signed in, with
`scripts/import-to-do.ts` (see [Moving a family into a Durable Object](#moving-a-family-into-a-durable-object)):

```sh
node scripts/import-to-do.ts <id> --from data/<id>.db --plan                                   # what would be sent
KINDRED_SESSION=<your session> node scripts/import-to-do.ts <id> --from data/<id>.db --url https://family.example.org --remote
```

Into a D1 database: if you have a family in a local `data/<id>.db` (for example, from `mise run data`), check the copy first, then send it:

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
| `KINDRED_JURISDICTION` | variable | `eu` keeps every Durable Object (the families and the accounts) in the EU; `fedramp` in FedRAMP data centres. Empty: wherever Cloudflare places them. Choose it before anyone opens the site: it cannot be changed later, and Kindred refuses to run with a value other than the one the first object was made under. D1 databases and R2 buckets choose their jurisdiction when they are made. Not used on Node. |
| `KINDRED_SECRET` | secret | Seals each family's AI key (AES-GCM under a key derived from this secret and the family's id). Set it before you save an AI key. Changing it makes the saved keys unreadable, so the settings page asks for them again. Back it up. |
| `KINDRED_SETUP_CODE` | secret | A fixed code of at least 12 letters or digits, asked for by `/setup`. On Workers every isolate would make its own random code, so use a fixed one; do not use `required` there. Any other value locks setup. |
| `KINDRED_ORIGIN` | variable | The public address, e.g. `https://family.example.org`. Passkeys are tied to it. Set it when the address is not the one the Worker sees. |
| `KINDRED_GUEST_ORIGIN` | variable | The guest host for family share links, e.g. `https://guests.family.example.org`. Needed only with `KINDRED_AUTH=cloudflare-access`. See step 6, [Guests behind Access](#guests-behind-access). |
| `KINDRED_DEFAULT_TREE` | variable | The family `/` opens directly, for its members. Without it, two or more families show the chooser. |
| `KINDRED_AUTH` | variable | The one sign-in method: `kindred` (the default) or `cloudflare-access`. See step 6. |
| `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD` | variable | Used only with `KINDRED_AUTH=cloudflare-access`. The team domain and the application's audience tag. See step 6. |
| `KINDRED_VAPID_PUBLIC_KEY`, `KINDRED_VAPID_SUBJECT` | variable | Web Push reminders: the public VAPID key and a contact (`mailto:` or `https:`). Reminders stay hidden without them. See Reminders below. |
| `KINDRED_VAPID_PRIVATE_JWK` | secret | Web Push reminders: the private VAPID key as JWK JSON. Keep it secret. |
| `KINDRED_DEMO` | variable | `1` makes the Worker a public, read-only demo of invented families. Leave it unset for your family. See [A public demo](#a-public-demo). |
| `KINDRED_ADDRESS_LOOKUP` | variable | The address box suggests whole addresses as an editor types, from OpenStreetMap through Photon, asked by the Worker. On by default; `off` keeps the offline town suggestions only. |
| `KINDRED_HISTORY_YEARS` | variable | How many years of each family's change history the daily run keeps. Default `3`; `0` keeps it for ever. |
| `KINDRED_TURNSTILE_SITE_KEY` | variable | Cloudflare Turnstile's site key, for the public request forms (`/request`, `/privacy-request`) of a server that hosts families for others. Make a widget in the Cloudflare dashboard (Turnstile, free) for your Worker's host name. Needs the secret too. See [hosting-many-families.md](hosting-many-families.md). |
| `KINDRED_TURNSTILE_SECRET` | secret | Turnstile's secret key: the Worker asks Cloudflare whether a form's token is good. Without both, the forms rely on a hidden field and a limit per network. |

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
with enough CPU time and subrequests for your family's exports.
Share-link passwords are hashed with PBKDF2 at 100,000 iterations (the most Workers allow), which took about 20 ms of CPU
in a measurement: like every page, more than the Workers free plan's 10 ms CPU limit (see [What you need](#what-you-need)). A first archive writes every file; an interrupted
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

> **Upgrading a site that already uses Access: set `KINDRED_AUTH` to `cloudflare-access` before you deploy.** With
> `CF_ACCESS_TEAM_DOMAIN` or `CF_ACCESS_AUD` set and no `KINDRED_AUTH`, every page of the members' site answers 503 and nobody can
> sign in until the variable is set and deployed.

Each installation has exactly one sign-in method. Leave `KINDRED_AUTH` unset, or set it to `kindred`, for Kindred's own accounts and
passkeys. Then this step has nothing for you: put no Access application on the members' host name, or people will sign in twice.
Self-hosting has the trade-offs and what happens to accounts: [Choosing how people sign in](self-host.md#choosing-how-people-sign-in).

To make Cloudflare Access the only sign-in:

1. Put an Access application in front of the site's hostname, with a policy that lets in your relatives. Until you have signed in,
   limit it to yourself: the first verified identity on an empty server becomes the steward.
2. Set `KINDRED_AUTH` to `cloudflare-access`, `CF_ACCESS_TEAM_DOMAIN` to your team's domain and `CF_ACCESS_AUD` to the application's
   audience tag. Without both values the site refuses to sign anyone in, and says why.
3. Deploy, then open the site. That first sign-in makes the server's first family, named “Our family” (or its translation in the
   reader's language). If `KINDRED_SETUP_CODE` is set, `/setup` asks for the code first, and for the family's name.

Kindred reads the identity only from the verified Access token. Its passkeys and its own sign-in screens are off.

### Guests behind Access

A family share link (Access page, **Share with a link**) lets a relative look around without an account, with a link and a
password (see [roles-and-privacy.md](roles-and-privacy.md)). Without Access in front of the site, it needs no setup. With Access,
it needs one thing, because Access stops anyone without a login before Kindred ever sees them. (With `KINDRED_AUTH=kindred` and no Access application, none of this applies.)

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
- A member's own site is unchanged: Access and every policy stay as they are, and a share link is still made there.

Without `KINDRED_GUEST_ORIGIN`, a site with `KINDRED_AUTH=cloudflare-access` can't make a link: the card says so
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

With Durable Objects only there is no D1 database to migrate, so the middle step does nothing: each object brings itself up
to date the first time it is used after the deploy, before it answers anything. A migration that fails there leaves that
object as it was (every file is its own transaction) and its family answers with the error until a fixed release is deployed.
What follows about failed migrations is about D1.

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

Setup makes that family as a Durable Object when `FAMILIES` is bound. Without it, setup can only make the family when its
binding exists (`TREE_FAMILY`, or the `TREE_<ID>` for your `KINDRED_DEFAULT_TREE`), and its database has the schema from
step 3. Otherwise setup stops before it asks for a passkey, and says what to add.

## Durable Objects: limits and costs

- **One family, one object, up to 10 GB** of rows (Cloudflare's limit for one SQLite Durable Object). Pictures are in R2 and
  do not count; the invented family of 1,627 people (`mise run data`) is a 1.8 MB file. The accounts object holds every
  account, session and chat; it has the same limit.
- **One request at a time per family.** An object runs one call after the other, which is what makes a batch atomic. A family's
  reads and writes are milliseconds each, so this is the same throughput D1 gives (D1 is built on Durable Objects).
- **Costs** (Workers Paid, as published in November 2026, per month): 1 million requests, 400,000 GB-s of duration, 25 billion
  rows read, 50 million rows written and 5 GB-month of storage are included; beyond that $0.15 per million requests, $12.50 per
  million GB-s, $0.001 per million rows read, $1.00 per million rows written and $0.20 per GB-month. A family's pages make a
  handful of requests to its object; check Cloudflare's [pricing page](https://developers.cloudflare.com/durable-objects/platform/pricing/)
  for the current numbers.
- **Where they live.** An object is made near the request that first asks for it, or in the EU with `KINDRED_JURISDICTION=eu`,
  and stays there. Smart Placement can move the Worker closer to them.
- **Locally**, `mise run dev:cf` and the tests run Durable Objects in workerd, under `.wrangler/state`. workerd has no
  jurisdictions, so `KINDRED_JURISDICTION` is accepted and ignored there.

## Moving a family into a Durable Object

`scripts/import-to-do.ts` copies a family into its Durable Object on the running Worker. A Durable Object can only be reached
through its Worker, so the script reads the family on your machine and sends the rows to the Worker (`POST /api/move/<id>`),
signed in as you: `KINDRED_SESSION` is the value of your `kindred_session` cookie on the site (the browser's developer tools,
Application or Storage, Cookies). You must be a steward of the family, or, for a family that has no stewards there yet, someone
who may make families (a steward of any family, or the first account); you then become its steward. It does not run in a demo.

From a D1 database of the same install (an older install moving its families over):

```sh
KINDRED_SESSION=... node scripts/import-to-do.ts family --from-d1 kindred-family --remote --url https://family.example.org
# then remove the TREE_FAMILY binding from wrangler.jsonc and run mise run deploy
```

Every table and row moves, the history, personal items and games included, because the accounts and pictures stay where they
are. Until the binding is removed, D1 keeps serving the family and nothing reads the copy, so stop editing the family while it
moves, or move it again with `--replace` just before you remove the binding. Keep the D1 database until you have checked the
family on the site; deleting it afterwards is `npx wrangler d1 delete kindred-family`.

From a Node or Docker install's `data/<id>.db` (another install, so accounts do not come along): the same tables the D1 transfer
copies (step 4), and the pictures from the `media/<id>/` folder beside the file go to the `MEDIA` bucket with wrangler.

```sh
node scripts/import-to-do.ts family --from data/family.db --plan                  # what would be sent; sends nothing
KINDRED_SESSION=... node scripts/import-to-do.ts family --from data/family.db --remote --url https://family.example.org
```

Either way the script sends the rows in batches of a few hundred, each written as one transaction, then reads every table's
count back and compares it with what it sent. It refuses an object that already holds a family unless you pass `--replace`,
and `--replace` is refused once the object serves a family that has members. What was run for this guide: both ways against
`mise run dev:cf`'s local Worker (`--env local` instead of `--remote`): a 3,061-row family from a file with its 36 pictures,
the same family from local D1 (53 tables), then the binding removed and the family read from its object. Not run: `--remote`.


## Checking a deployment locally first

`mise run dev:cf` runs the Worker in workerd, with local D1 and R2 (wrangler's `local` environment in
`wrangler.jsonc`). It applies the migrations to the local databases first. The local databases are `kindred-local-*`,
with the test families `modern` and `realm`:

```sh
mise run dev:cf
mise run cf:seed   # copies data/modern.db and data/realm.db into the local D1 databases, replacing what is there
```

`cf:seed` replaces the local databases, so it is safe for test data only.

## A public demo

`deploy/demo/` holds what a demo of the two invented families needs, as a Worker of its own beside (never instead of) your
family's: `wrangler.jsonc`, a template with placeholder ids and `KINDRED_DEMO=1`, and `seed-d1.ts`, which generates the families
and fills the demo's databases. What a demo does and refuses is in [self-host.md](self-host.md#a-public-demo). Never bind a real
family's database in it: the demo shows every family it has to anyone.

```sh
npx wrangler d1 create kindred-demo-accounts      # paste each database_id into deploy/demo/wrangler.jsonc
npx wrangler d1 create kindred-demo-realm
npx wrangler d1 create kindred-demo-modern
npx wrangler r2 bucket create kindred-demo-media
mise run demo:cf -- --remote                       # the schema and the families (refused while a placeholder id is left)
KINDRED_WRANGLER_CONFIG=deploy/demo/wrangler.jsonc npx vite build
npx wrangler deploy -c dist/server/wrangler.json
```

Run `mise run demo:cf -- --remote` again to put the families back as they were generated: it also dates their feed
([feed.md](feed.md)) back from that day, so run it now and then to keep the demo's feed recent, and it uploads their painted
pictures to the R2 bucket under the same names each time. The demo needs no secrets, and it does
not start beside `KINDRED_AUTH=cloudflare-access`, the Access settings, `KINDRED_GUEST_ORIGIN`, `KINDRED_SETUP_CODE` or the VAPID
keys: every page then says which setting to remove. `KINDRED_WRANGLER_CONFIG` is what points the build and the D1 scripts
(`cf-migrate.ts`, `import-to-d1.ts`) at the demo's configuration instead of `wrangler.jsonc`.

To try it locally first, in workerd with local D1 and R2 and nothing sent to Cloudflare:

```sh
mise run demo:cf                                   # local databases in deploy/demo/.wrangler/state
KINDRED_WRANGLER_CONFIG=deploy/demo/wrangler.jsonc CLOUDFLARE_ENV=local npx vite build
npx wrangler dev -c dist/server/wrangler.json --local --persist-to deploy/demo/.wrangler/state
```

`mise run smoke:worker` also starts its Worker once as a demo and checks it.

## Backups

**Durable Objects.** Cloudflare keeps 30 days of point-in-time history for every SQLite Durable Object, but only code inside the
Worker can reach it, and Kindred has no command for it yet. For a file you hold, use each family's own export (GEDCOM or the
Markdown archive, [exchange.md](exchange.md)) and the nightly archive, and back up the bucket as below. The sections that follow
are about D1.

The data lives in D1 and R2, and the sealing key is a setting: back up all three. Keep the `KINDRED_SECRET` value with
them, because saved AI keys cannot be decrypted without it (the rest of the database stays usable).

**D1: export each database to a file.** The names are the `database_name` values in `wrangler.jsonc` (`kindred-accounts`,
`kindred-family`, and one for each family you bound):

```sh
mkdir -p backups
npx wrangler d1 export kindred-accounts --remote --output backups/accounts.sql
npx wrangler d1 export kindred-family   --remote --output backups/family.sql
```

`wrangler d1 export --help` shows the flags used here (`--remote`, `--output`; `--no-data`, `--no-schema` and `--table` are there too).
Repeat the second line for every family. Kindred ships no backup script of its own for Cloudflare. Against the local databases of
`mise run dev:cf` the same command is `npx wrangler d1 export kindred-local-realm --local --env local --output backups/realm.sql`.

**D1: Time Travel.** D1 also keeps its own point-in-time history, which `--timestamp` can reach back 30 days into (wrangler's help says so).
`npx wrangler d1 time-travel info kindred-family` shows the restore points, and
`npx wrangler d1 time-travel restore kindred-family --timestamp <time>` puts the same database back to one of them. It is the
quickest way to undo a bad change; it is not a substitute for a file you hold.

**R2: the pictures.** A D1 export does not contain them. `npx wrangler r2 object get kindred-media/<family>/<key> --remote --file <path>`
fetches one object, and wrangler has no command for the whole bucket. To copy the bucket, use R2's S3-compatible API with a
tool such as `rclone` or the `aws` CLI (Cloudflare's R2 documentation describes the endpoint and the access keys). The keys
are in the family's database (`photo`, `media`, `portrait` and `research_document` rows).

**Restoring.** Restore into a new, empty database and check it before you switch to it. `wrangler d1 execute` finds a database by the
name in `wrangler.jsonc`, so make the database, then point the family's `TREE_<ID>` binding at it (its `database_name` and
`database_id`, keeping `migrations_dir`) before you load the file:

```sh
npx wrangler d1 create kindred-family-restored
# edit wrangler.jsonc: the family's binding now names kindred-family-restored and its new database_id
{ echo 'CREATE VIEW guard AS SELECT 1 AS ok;'; grep -v '^CREATE VIEW guard AS' backups/family.sql; } > backups/family.restore.sql
npx wrangler d1 execute kindred-family-restored --remote --file backups/family.restore.sql
npx wrangler d1 execute kindred-family-restored --remote --command "select count(*) from person"
```

The second line of the commands puts the `guard` view first. The export lists it after the triggers that use it, and loading the file as it
stands stops with `no such table: main.guard`; if your export has the view earlier, the line changes nothing. Then run `mise run deploy` to
switch the Worker to the restored database. For the pictures, copy the objects back into the bucket under the same keys, for example
`npx wrangler r2 object put kindred-media/<family>/<key> --remote --file <path>`. The export holds the schema and the `d1_migrations` record, so
the migrations see the restored database as up to date.

What was run for this guide: the whole cycle on the local databases (`mise run dev:cf`'s), with `--local --env local` in place of
`--remote`: migrate, import a family, export it, load the file into a new empty database (it failed at the `guard` view until the second line
was added, then held the same 1,627 people, 400 stories, 28 migration records and 10 triggers as the source), and fetch and put a picture with
`r2 object get` and `r2 object put`. What was not run, because it needs a Cloudflare account: the same commands with `--remote`,
`d1 create`, the Time Travel commands (they have no local mode), `mise run deploy` and the S3 route to R2. Rehearse those on a scratch
database first.

## Moving from Docker

A family in a Docker or Node installation goes to Cloudflare with `scripts/import-to-d1.ts` (step 4). From Docker, make an
online backup and use it as the source: [Moving between Docker, Node and Cloudflare](self-host.md#moving-between-docker-node-and-cloudflare)
has the steps. Going back from Cloudflare to Docker has no tool; that section says what is possible by hand.

## Upgrading

1. Read [CHANGELOG.md](../CHANGELOG.md) for every release between yours and the one you are moving to.
2. Back up (above).
3. `git fetch --tags`, then `git checkout <tag>` for the release you chose (for example `v2.0.0`), then `npm install`.
4. `mise run deploy`: it builds, applies the new migrations to the deployed databases and then deploys (step 7).
5. Open the site and check you can sign in. If the Worker is wrong but the data is fine, check out the previous tag and
   run `mise run deploy` again; migrations only go forward, so a migration that shipped stays (step 7 says how to undo one).

## Troubleshooting

- **A family is missing from the site**: its `TREE_<ID>` binding is absent or misspelt, or the id is not lower case. With
  Durable Objects: its row in the accounts database's `family_store` table is missing (the move or the family's making stopped
  part-way; make or move it again).
- **Every page says the jurisdiction cannot be changed**: `KINDRED_JURISDICTION` differs from the value the first Durable Object
  was made under. Set it back; the families are where they were.
- **The transfer says the database already has a family's details**: first-time setup made them. Pass `--replace` to
  overwrite them with the copy (step 4), or send the copy to a database that has none.
- **Setup stops before the passkey**: the family it would make has no `TREE_<ID>` binding, or its database has no
  schema yet. Add the binding (step 2) and run `mise run cf:migrate:remote` (step 3), then open `/setup` again.
- **Passkey errors on a custom domain**: set `KINDRED_ORIGIN` to the public address. Changing the host name later
  needs new passkeys.
- **The AI settings say the key cannot be read**: `KINDRED_SECRET` changed or is missing. Enter the key again.
- **A migration failed**: the failing file is named in the output. Migrations apply in order and each one is its own
  transaction; fix the cause and run `mise run cf:migrate:remote` again.
