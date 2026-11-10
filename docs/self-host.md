# Self-hosting Kindred

Kindred runs as one container, or as one Node process, and keeps every family in a SQLite file on the machine it runs on.
Nothing needs an account with a cloud provider. This guide starts with Docker, then covers HTTPS, the data, backups,
upgrades, and running without Docker. The managed alternative is Cloudflare: [deploy-cloudflare.md](deploy-cloudflare.md).

## Quick start with Docker

You need Docker with Compose. From the repository:

```sh
cp .env.example .env          # optional for a trial on this machine; see "Settings" below
docker compose up -d --build  # builds the image and starts the app on http://localhost:4901
docker compose ps             # "healthy" once the health check passes
```

Open <http://localhost:4901/setup> and create the first account with a passkey. The setup asks for the name of the
first family, your name, and a passkey. You become the steward of every family that exists, and setup closes as soon as
the first account exists. Invite everyone else from the Access page.

The app listens only on this machine (`127.0.0.1`). To reach it from other devices, use HTTPS (below): passkeys
do not work on a plain address other than `localhost`.

### With a published image (from the next release)

From the next release, each version tag publishes a ready-made image for amd64 and arm64 to
`ghcr.io/niklas-heer/kindred`, tagged with the version (`2.1.0`, without the `v`) and `latest`. Until then, no image exists
there and you build from source as above. The image is built without the offline place search (see below). With it you need no
checkout and no build tools. Save this as `compose.yaml` next to a `.env` made from [`.env.example`](../.env.example), and put
the version you chose in place of `<version>`:

```yaml
services:
  app:
    image: ghcr.io/niklas-heer/kindred:<version>
    restart: unless-stopped
    stop_grace_period: 20s
    env_file: .env
    environment:
      KINDRED_ORIGIN: ${KINDRED_ORIGIN:-http://localhost:4901}
    ports:
      - "127.0.0.1:4901:4901"
    volumes:
      - kindred-data:/data
volumes:
  kindred-data:
```

Then `docker compose up -d`. To upgrade, change the tag and run `docker compose pull && docker compose up -d` (read the
changelog first, see "Upgrades"). Use the repository's own `compose.yaml` instead if you want the HTTPS profile with Caddy.
This file was written from the repository's `compose.yaml` and could not be run before the first image exists.

## What it needs

- **One small machine.** Kindred is one Node process (Node 26, which the image has) with SQLite files. There is no database
  server and no queue. Any home server, NAS that runs Docker, small VPS or Raspberry Pi 4 class board that runs Docker should
  do. We have not measured memory use, so watch it for a day with `docker stats` before you decide what size to rent.
- **Disk.** A family's database is small: about 1 MB for an invented family of 1,627 people with 400 stories and no pictures.
  Pictures are the weight: each photograph, portrait and research document is a file in `media/<id>/`. Plan for the pictures,
  and for the backups next to them (a copy of everything, once per backup you keep). The place search file adds about 40 MB if
  you build it in.
- **Building the image** (`docker compose up -d --build`) runs `npm ci` with all the development tools, so it wants a few
  minutes, a few hundred megabytes of free disk and the network. A published image (below) needs none of that.
- **HTTPS and a host name** that stays the same, for anything other than this machine (see "HTTPS with Caddy").

## Choosing how people sign in

Each installation uses exactly one sign-in method, set by `KINDRED_AUTH`. It is a deployment setting, not a switch inside
Kindred, because choosing wrongly can lock people out or open the site.

| | `kindred` (the default) | `cloudflare-access` |
| --- | --- | --- |
| **How people sign in** | A passkey on their phone or computer | Whatever your Cloudflare Access policy allows: an email code, Google, your company login |
| **Who looks after logins** | Kindred, with nothing more to run | You, in Cloudflare Zero Trust |
| **Choose it when** | You want Kindred to work by itself, anywhere it runs | You already manage people in Cloudflare and want one place to add or remove them |
| **What it costs** | HTTPS and a host name that stays the same. A relative who loses every device needs a new invitation | A Cloudflare account and an Access application whose policy lets in every relative. Guests need a second host name |

With `kindred`, Cloudflare Access tokens are ignored completely, even valid ones. If you still have an Access application in
front of the site, people will sign in twice: remove the application from the members' host name.

With `cloudflare-access`, set three things (`KINDRED_AUTH`, `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD`, see
[deploy-cloudflare.md](deploy-cloudflare.md#6-cloudflare-access-optional)):

- **Identity** comes only from a token that verifies against your team's public keys. A plain email header is never believed.
- **Accounts** are the verified email address. **Roles** stay in Kindred: Access decides who may reach the site, and the
  family's Access page decides what they may do there.
- **The first steward** is the first verified identity to open an empty server, and that visit makes the first family. Limit the
  Access policy to yourself until you have signed in, or set `KINDRED_SETUP_CODE`: `/setup` then asks for the code.
- **Everyone else** needs an invitation, and the Access policy must let them in too. An invitation to their address takes effect on
  their first visit. With an invitation link they open it and say what the family should call them. Anyone else Access lets through
  sees that they have not been invited.
- **Kindred's own sign-in is off**: no passkeys, no sign-in page, and any old session cookie is ignored. "Sign out" goes to Cloudflare
  Access's own sign-out.
- **Guests** need the guest host, `KINDRED_GUEST_ORIGIN` ([Guests behind Access](deploy-cloudflare.md#guests-behind-access)).

Stewards can see the active method on the family's Access page. It is read-only there.

### When the setting is wrong

Kindred never guesses and never falls back to something more open. Until the setting is fixed, the members' site shows a
page naming the problem, nobody can sign in, and the log says the same once. The guest host and `/api/health` stay up.

| Situation | What to do |
| --- | --- |
| `KINDRED_AUTH` is empty and `CF_ACCESS_TEAM_DOMAIN` or `CF_ACCESS_AUD` is set | Choose: set `KINDRED_AUTH` |
| `KINDRED_AUTH` is anything but the two values | Correct the value |
| `KINDRED_AUTH=cloudflare-access` without both Access values | Set both |
| `CF_ACCESS_TEAM_DOMAIN` is not a host name | Use the form `myfamily.cloudflareaccess.com` |

### Changing method later

Accounts are not touched by the setting: the same people, roles and families are there afterwards. What changes is who can prove
they are that account.

- **To `kindred`**: anyone with a passkey signs in as before, as long as the host name stays the same. Someone whose account was made
  through Access and who never added a passkey cannot sign in. The Access page shows each member's passkeys while the site is on
  `kindred`. Kindred has no way to add a passkey while `cloudflare-access` is active, so that person needs a new invitation, which
  makes a new account. Setting the value back brings them in again.
- **To `cloudflare-access`**: accounts are matched by email, and accounts made with a passkey may not have one (the first steward's
  never does). Give each one its address first, in the accounts database: `UPDATE user SET email = 'name@example.org' WHERE id = '…';`.
  Addresses are lower-case. An account without a match sees "not invited" until it has one.

## Settings

Compose reads `.env` for the settings below, and passes the ones the app reads into the container: `KINDRED_ORIGIN`,
`KINDRED_AUTH`, `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`, `KINDRED_GUEST_ORIGIN`, `KINDRED_SETUP_CODE`, `KINDRED_REQUIRE_SETUP_CODE`, `KINDRED_DEFAULT_TREE`, `KINDRED_SECRET`, the three `KINDRED_VAPID_*` reminder
settings, `KINDRED_JOBS`, `KINDRED_TRUSTED_PROXIES` and `KINDRED_DEMO`. `KINDRED_DOMAIN` goes to
Caddy, and `WITH_GAZETTEER` and `KINDRED_COMMIT` to the build. An empty value is the same as an unset one, so the defaults still apply. Without
Docker, set them as environment variables for the server.

The image fixes four things that Compose cannot change without breaking the setup: the data is the `/data` volume
(`KINDRED_DATA_DIR`), the app listens on port 4901 inside the container (`PORT`, and `HOST` is `0.0.0.0`), and the
gazetteer is at `/app/gazetteer/gazetteer.db`. Those four are for running without Docker.

| Setting | Default | What it does |
| --- | --- | --- |
| `KINDRED_AUTH` | `kindred` | The installation's one sign-in method: `kindred` or `cloudflare-access`. See [Choosing how people sign in](#choosing-how-people-sign-in). |
| `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD` | unset | Used only with `KINDRED_AUTH=cloudflare-access`: your team domain and the Access application's audience tag. |
| `KINDRED_GUEST_ORIGIN` | unset | The guest host for family share links, needed only with `KINDRED_AUTH=cloudflare-access` (see [deploy-cloudflare.md](deploy-cloudflare.md#guests-behind-access)). |
| `KINDRED_ORIGIN` | `http://localhost:4901` in Compose; otherwise the address the request came in on | The public address, such as `https://family.example.org`. Passkeys are bound to its host name, sessions use its scheme for the cookie's `Secure` flag, and the setup warning uses it. Set it before the first sign-in. |
| `KINDRED_SETUP_CODE` | empty | Who may create the first account. Empty: anyone who reaches `/setup` first. `required` (any case): a one-time code is printed in the log at each start, until the first account exists. Or a code of your own, 12 or more letters or digits, which stays the same. Any other value locks setup: nobody can create the first account until the value is fixed, and the log says so once. |
| `KINDRED_REQUIRE_SETUP_CODE` | empty | `1`, `true`, `yes` or `required` (any case) does the same as `KINDRED_SETUP_CODE=required`; `0`, `false`, `no` or `off` does not. Any other value requires the code, to be safe, and the log says so once. |
| `KINDRED_DEFAULT_TREE` | `family` | The family that `/` opens directly, for its members. Lower-case letters, digits and dashes. |
| `KINDRED_DATA_DIR` | `/data` in the image, `data/` otherwise | Where the families, pictures, accounts and the secret are kept. Docker: fixed at `/data`. |
| `KINDRED_SECRET` | the `secret` file in the data folder | The key that seals the AI keys the stewards save. Set it here to keep it out of the data folder; it must then stay the same. |
| `KINDRED_ACCOUNTS_DB` | `accounts.db` in the data folder | Advanced: a different path for the accounts database. The tests use it. Compose does not pass it, and the image has no use for it: leave it unset. |
| `KINDRED_GAZETTEER` | `gazetteer.db` in the data folder | The offline place search. The image sets it to a file it may contain (see below). |
| `KINDRED_VAPID_PUBLIC_KEY`, `KINDRED_VAPID_PRIVATE_JWK`, `KINDRED_VAPID_SUBJECT` | empty | Web Push reminders. Make the three with `mise run vapid-keys -- mailto:you@example.org`. Without all three the Reminders item is hidden. See [Reminders](#reminders). |
| `KINDRED_JOBS` | empty | `off` stops the daily run at 06:00 UTC for reminders, archives and enabled background AI tasks. Any other value keeps it on. |
| `KINDRED_TRUSTED_PROXIES` | empty (0) | How many reverse proxies stand in front of the server: `1` for Caddy alone, as in [HTTPS with Caddy](#https-with-caddy). The limits on signing in, share links and invitations then count the visitor's address that the proxy passes on (X-Forwarded-For, counted from the right, so a visitor cannot write their own). Empty or `0`: the header is never believed. Set it only when every request reaches the server through that many proxies. Not used on Cloudflare. |
| `KINDRED_DEMO` | empty | `1` makes the server a public, read-only demo of invented families. Leave it empty for your family. See [A public demo](#a-public-demo). |
| `KINDRED_DEMO_ORIGIN` | `http://localhost:4902` | Compose's demo profile only: the `KINDRED_ORIGIN` of its demo service. |
| `PORT` | `4901` | The port the server listens on. Docker: the image uses 4901, and Compose maps it. |
| `HOST` | `127.0.0.1` | The address it listens on. The image sets `0.0.0.0`, so that Docker can reach it. |

The Docker build also takes `WITH_GAZETTEER=1` (see below) and `KINDRED_COMMIT`, the commit a steward's feedback report names. The build has no `.git`, so without it the report says `unknown`: `KINDRED_COMMIT=$(git rev-parse --short HEAD) docker compose up -d --build`.

`KINDRED_SETUP_CODE=required` can be replaced by `KINDRED_REQUIRE_SETUP_CODE=1` (or `true`, `yes` or `required`), which means the same thing. Check the log after you change either variable. A value Kindred does not understand never leaves setup open: in `KINDRED_REQUIRE_SETUP_CODE` it requires the code, and in `KINDRED_SETUP_CODE` it locks setup. Either way the log says so, and never prints the value.

### The setup code and a public address

Setup is the one moment when a stranger could become the steward, so pay attention to it when the address is public.
The server is loud about it:

- With no setup code and a public `KINDRED_ORIGIN` (or a host name other than `localhost`), the first request logs a warning
  that setup is open on that address. Anyone who reaches `/setup` first becomes the steward.
- With `KINDRED_SETUP_CODE=required`, the code is printed in the log (`docker compose logs app`) at each start, and `/setup`
  asks for it. The code changes on every restart, so the first person to set up after a restart needs the new one.
- With a fixed code of 12 or more letters or digits in `KINDRED_SETUP_CODE`, `/setup` asks for it, and the server never prints it.
  Spaces, dashes and capitals do not matter when you type it.
- With `KINDRED_SETUP_CODE` set to anything else (other than `required`, in any case), setup is locked: no one can create the
  first account, and the log warns once. That is deliberate, so a typo cannot leave setup open. Fix the value and restart.

For a public address, set a code, create the steward account yourself, and then the code no longer matters: setup closes once
the first account exists.

## HTTPS with Caddy

Passkeys need HTTPS, or `localhost`. For a server on the internet, the compose file has an optional Caddy service that
gets a certificate from Let's Encrypt and passes requests to the app. Caddy's config is in
[`deploy/Caddyfile`](../deploy/Caddyfile).

1. Point a DNS record for your host name (for example `family.example.org`) at the server.
2. Open ports 80 and 443 on the server. Caddy needs port 80 for the certificate challenge.
3. In `.env`, set both values to that name, and say that Caddy is the one proxy in front of the app:

   ```sh
   KINDRED_ORIGIN=https://family.example.org
   KINDRED_DOMAIN=family.example.org
   KINDRED_TRUSTED_PROXIES=1
   ```

   Without `KINDRED_TRUSTED_PROXIES`, every request seems to come from Caddy, so the limits on signing in and on share
   links become one limit for the whole site, and a stranger could use it up for everyone. The server logs a warning
   when it sees requests from a proxy and the setting is missing.

4. Start the app with the `https` profile:

   ```sh
   docker compose --profile https up -d --build
   ```

Why these two must match: a passkey is registered for the host name it was created on. If the name changes later, every
person has to register a new passkey. Choose the name once.

If you already run a reverse proxy, skip the Caddy service. Point the proxy at the app's port (set the `ports` line in
`compose.yaml` to `"4901:4901"` if the proxy is on another machine), and set `KINDRED_ORIGIN` to the public `https://` address. The proxy should send `X-Forwarded-Proto` (Caddy does): without it,
the setup warning would name `http://` for a site that is served over TLS. It should also add the visitor's address to
`X-Forwarded-For` (Caddy, nginx's `proxy_add_x_forwarded_for` and most others do); set `KINDRED_TRUSTED_PROXIES` to the
number of proxies a request passes through. With the app's port open to others as well, anyone reaching it directly
could claim any address, so keep the port private to the proxy.

## Your data

Everything the app keeps is in the data folder: `/data` in the container, which is the named volume `kindred-data`, and
`data/` when you run it without Docker.

| What | Where | Notes |
| --- | --- | --- |
| Each family | `<id>.db` | One SQLite file per family. The id is the file name. |
| Accounts, passkeys, sessions, memberships, AI settings, provider connections and feature routes | `accounts.db` | Separate from the families. |
| Portraits, gallery pictures and research documents | `media/<id>/` | The database holds only each file's key. |
| The sealing secret for saved AI keys | `secret` | Made the first time an AI key is saved, with mode 600. See below. |
| Copies made before a migration | `backups/` | See "Upgrades". |

SQLite runs in WAL mode, so you will see `-wal` and `-shm` files next to each database while the app runs. They belong to the
database: leave them in place, and never copy a live `.db` file with `cp`. Use the online backup below.

The volume belongs to uid 1000, the image's `node` user, which runs the app. If you replace the volume with a folder on the
host (a bind mount at `/data`), that folder must belong to uid 1000 before the first start, or the app cannot write its files:

```sh
sudo chown -R 1000:1000 ./kindred-data   # the folder you bind-mount at /data
```

A folder owned by root makes the app's first write fail with `EACCES` (permission denied).

The place search file (`gazetteer.db`) is not in the volume. In the image it is at `/app/gazetteer/gazetteer.db`, built in
when `WITH_GAZETTEER=1`, and it is rebuilt from GeoNames, so it does not need a backup.

### The secret

`secret` seals the AI key that a family's steward saves. It is written once and read back on every use. **Keep it with the
backups.** If it is lost, the saved AI key cannot be read, and the steward has to enter the key again in the AI settings.
Nothing else is affected. If you set `KINDRED_SECRET`, that value is used instead of the file, and it must stay the same.

## Backups

Back up three things: the family and account databases, the pictures, and the `secret` file.

**While the app runs (no downtime), with Docker.** The image has no `sqlite3` command, but it has Node's own online backup,
which copies a live database the same way `.backup` does. It writes into `./backups` on this machine. The one-off containers
below run as `root`, not as the image's `node` user (uid 1000): a `backups` folder made by a root shell on the host is owned
by root, and uid 1000 cannot write into it. `root` writes there, and the app keeps running as `node`.

```sh
mkdir -p backups
docker compose run --rm --no-deps --user root --entrypoint node -v "$PWD/backups:/backup" app -e "
  const { backup, DatabaseSync } = require('node:sqlite');
  const fs = require('node:fs');
  (async () => {
    for (const f of fs.readdirSync('/data')) {
      if (!f.endsWith('.db') || f === 'gazetteer.db') continue;
      await backup(new DatabaseSync('/data/' + f), '/backup/' + f);
    }
  })();"
docker compose cp app:/data/media backups/
docker compose cp app:/data/secret backups/    # if it exists yet
```

**While the app runs, without Docker**, with the `sqlite3` command (macOS and most Linux systems have it):

```sh
dest="$HOME/kindred-backups/$(date +%F)"
mkdir -p "$dest"
for f in data/*.db; do
  case "$f" in *gazetteer.db) continue ;; esac
  sqlite3 "$f" ".backup '$dest/$(basename "$f")'"
done
cp -R data/media "$dest/"
cp data/secret "$dest/" 2>/dev/null || true
```

**Everything, with the app stopped.** Stop the app so that the files are quiet, copy the whole volume, and start it again:

```sh
docker compose stop app
docker run --rm --user root -v kindred_kindred-data:/data -v "$PWD/backups:/backup" kindred:local \
  tar -czf "/backup/kindred-data-$(date +%F).tar.gz" -C /data .
docker compose start app
```

The archive is written as `root` into `backups/`, and it is readable by anyone who can read that folder.

The volume is called `kindred_kindred-data` because Compose names it after the project (`kindred`). `docker volume ls` shows the name.

**Restoring** replaces everything in the volume: stop the app, unpack a copy into the volume, and start it again. It runs as
the image's `node` user, which owns the volume, and only reads the archive from `backups/`.

```sh
docker compose stop app
docker run --rm -v kindred_kindred-data:/data -v "$PWD/backups:/backup" kindred:local \
  sh -c 'rm -rf /data/* && tar -xzf /backup/kindred-data-2026-11-08.tar.gz -C /data'
docker compose start app
```

### Restoring the other backups

Every restore is the same in three steps: stop the app, put the files back, start the app. Replace a database's files
together: delete the `-wal` and `-shm` files next to a database you replace, because leftovers of the old one do not
belong to the new file.

**From the online backup** (`backups/*.db`, `backups/media/`, `backups/secret`, made by the first or second method above).
This puts back every family and the accounts. The folder holds what the backup holds, and nothing else is deleted:

```sh
docker compose stop app
docker compose run --rm --no-deps --user root --entrypoint sh -v "$PWD/backups:/backup:ro" app -c '
  rm -f /data/*.db-wal /data/*.db-shm
  cp /backup/*.db /data/
  [ -d /backup/media ] && mkdir -p /data/media && cp -R /backup/media/. /data/media/
  [ -f /backup/secret ] && cp /backup/secret /data/secret
  chown -R node:node /data'
docker compose start app
```

**One family.** Put back only that family's `<id>.db` and `media/<id>/`; the accounts stay as they are. A family's database
belongs with the accounts database of its time: members and roles live in `accounts.db`, so a restored family whose
members have since changed shows the roles as they are now.

**Without Docker.** Stop the server, copy the files from the backup into the data folder (`data/`, or `KINDRED_DATA_DIR`),
remove the `-wal` and `-shm` files of the databases you replaced, and start the server again.

**Copies made before an upgrade** are in `backups/` inside the data folder; restore one by copying it over the file it was
made from, as above (see "Upgrades").

These steps were written from the commands above and from how the app reads its data folder. They were not run against a
live installation for this guide: try a restore on a scratch volume before you need it.

A GEDCOM or Markdown export ([exchange.md](exchange.md)) is readable, but it is not a backup: it leaves out stories, contacts,
houses, and the pictures.

## Moving between Docker, Node and Cloudflare

The same files serve Docker and plain Node: a data folder moves between them as it is (stop the app, copy the folder, set
`KINDRED_DATA_DIR`). Cloudflare is different, because the data is in D1 and R2 rather than files.

**Docker to Cloudflare.** `scripts/import-to-d1.ts` reads a family's database and pictures and writes them to D1 and R2 (the
whole procedure is [step 4 of the Cloudflare guide](deploy-cloudflare.md#4-bring-a-family-in-optional)). From Docker:

1. Make an online backup (see "Backups"). It gives you `backups/<id>.db` and `backups/media/<id>/`.
2. In a checkout of the repository, put the pictures where the script looks for them (always `data/media/<id>/`, whatever
   `--from` says): `mkdir -p data/media && cp -R backups/media/<id> data/media/`.
3. Check, then send: `node scripts/import-to-d1.ts <id> --from backups/<id>.db --plan`, then the same with `--remote`.

Accounts do not move: passkeys belong to a host name. The first person to open the new site sets up, and invites the others.
Fields a member made **Personal** stay behind, because only their owner's account can read them; the script prints how many.

**Cloudflare to Docker or Node.** There is no tool for it. D1 is SQLite and Node reads the same schema, so it should be
possible by hand: `npx wrangler d1 export kindred-family --remote --output family.sql`, load the file into a new SQLite file
named `<id>.db` in the data folder (for example with the `sqlite3` command), and download the pictures from R2 into
`media/<id>/` under their keys. Nobody has done this with Kindred yet, so treat it as an outline, not a recipe. Accounts do not
move either. What does work today is the readable route: a steward exports GEDCOM or the Markdown archive from **Import and
export** and imports it on the new server ([exchange.md](exchange.md) says what each keeps and drops), then adds the pictures
again.

## The nightly archive (optional)

The daily job can keep a readable copy of each family in a **private GitHub repository**: the v1 Markdown archive and a
GEDCOM file, committed to a folder of that repository once a day, and only when something changed. What it writes, and
what it leaves out, is in [exchange.md](exchange.md#the-nightly-archive).

> **The archive holds private family data.** Every name, date, place, link and biography goes into it. The repository
> must be private, and only the family's stewards should have access to it. Kindred refuses a public repository.

For each family you want archived, set these (`<ID>` is the family id in capitals, with `-` as `_`; for `modern`, `MODERN`):

- `KINDRED_ARCHIVE_<ID>_REPO`: `owner/name` of the private repository.
- `KINDRED_ARCHIVE_<ID>_TOKEN`: a fine-grained GitHub token for that one repository, with **Contents: Read and write**
  and nothing else. Create a new token for each family.
- `KINDRED_ARCHIVE_<ID>_BRANCH` (default `main`, which must already exist with a commit) and `KINDRED_ARCHIVE_<ID>_PATH`
  (default `archive`, the folder the archive owns).

Without Docker, set them as environment variables for the server. With Docker, Compose passes only the variables it lists,
so add the family's lines to the `environment:` list of `app` in `compose.yaml`, reading their values from `.env`, which
is gitignored:

```yaml
      KINDRED_ARCHIVE_MODERN_REPO: ${KINDRED_ARCHIVE_MODERN_REPO:-}
      KINDRED_ARCHIVE_MODERN_TOKEN: ${KINDRED_ARCHIVE_MODERN_TOKEN:-}
```

Keep the token in `.env` and out of `compose.yaml`, which is committed. Each family needs its own repository or its own
folder, because a folder belongs to one family (see [exchange.md](exchange.md#the-nightly-archive)).

To run it now for one family, without waiting for the night, and see what it would change first:

```sh
node scripts/archive-now.ts modern --dry-run   # then the same without --dry-run to commit
```

## Reminders

Kindred can remind the members of a family on their own devices of birthdays, wedding anniversaries and memorial days.
A reminder is a browser notification (Web Push), so it needs three settings and a browser with push. Each member turns
reminders on for each family under **Reminders** in the account menu.

1. Make the keys once, on any machine with mise:

   ```sh
   mise run vapid-keys -- mailto:you@example.org
   ```

   It prints `KINDRED_VAPID_PUBLIC_KEY`, `KINDRED_VAPID_PRIVATE_JWK` and `KINDRED_VAPID_SUBJECT`. The private key is secret:
   whoever has it can send messages as your server.
2. Put the three lines in `.env` (Docker reads them; `compose.yaml` lists them), or in the environment for `mise run start`.
3. Restart the server. Without the three settings the **Reminders** item stays hidden, and the daily run sends nothing.

**Reusing keys.** If you already have a VAPID key pair, from another Kindred server or a family site you run, use its three
values instead of making new ones. Browser subscriptions belong to this site's address, so each device still turns
reminders on once here, but it needs no new keys to do so.

### What the server does each day

- At **06:00 UTC** each day, the server sends each device the reminders due that day, for the days the device chose: on the
  day, the day before, a week before. A device gets one message per family per day, the occasions nearest first, at most six
  lines and then a count.
- Days are counted in UTC, so an occasion is reminded on the UTC day it falls on.
- The occasions are those of the Almanac: birthdays of living people (up to 100 years old), wedding anniversaries of living
  couples who have not separated, and memorial days of people who died within the last 30 years. A year on its own, or a
  partial date, is never remembered.
- A device is paused when the app has not been opened on it for 35 days, and removed after 60 days. Opening the app
  refreshes it. A device is also removed when the push service says it is gone, or when its owner leaves the family.
- A person can have reminders on up to ten devices.
- The run logs one summary line with counts, and one line for each family that fails. Logs never contain names or device addresses.
- The same daily run also handles configured archives and enabled background AI tasks.
- `KINDRED_JOBS=off` stops the daily run, for example on a second server that serves the same families. The run never
  happens at startup, so a restart sends nothing early.

### Privacy

- Each reminder is encrypted for its device (RFC 8291) before it leaves the server, and signed with your VAPID key (RFC 8292).
  The browser's push service (Apple, Google, Mozilla or Microsoft) carries the encrypted message. It sees that a message
  reached the device, and when, but it cannot read it.
- The server sends only to those four push services. It cannot be used to send messages anywhere else.
- A reminder names people and gives dates from the family's record, in the device's language (English, German or Afrikaans).
  It never includes private fields, notes or stories. Every member can read the same names and dates in the app
  ([roles-and-privacy.md](roles-and-privacy.md)).
- The subscriptions are rows in the accounts database (`push_subscription`): the device's push address, its two keys, the
  days and kinds it chose, its language and the time it was last opened. Back them up with the accounts database.

### iPhone and iPad

Safari sends reminders only to a site added to the Home Screen (Share, then Add to Home Screen), and only once it is opened
from there. The Reminders dialog says so when it is needed.

### Troubleshooting

- **No Reminders item in the account menu:** one of the three settings is missing or malformed. The daily run logs
  `the VAPID keys are not set` each day it runs.
- **"This device has reminders set up by someone else.":** another member turned reminders on in this browser. They can
  turn them off there, or you can use another browser.
- **"This device's reminders have expired.":** the push service no longer knows the device. Turn reminders on again.

## Upgrades

> **If you use Cloudflare Access, set `KINDRED_AUTH=cloudflare-access` before you upgrade.** With `CF_ACCESS_TEAM_DOMAIN` or
> `CF_ACCESS_AUD` set and no `KINDRED_AUTH`, Kindred refuses to guess: every page of the members' site answers 503 and nobody can
> sign in until you set it. See [Choosing how people sign in](#choosing-how-people-sign-in). Without those settings there is nothing to do.

Upgrade to a release, not to whatever `main` holds today. Releases are tags (`v2.0.0`, ...): the
[releases page](https://github.com/niklas-heer/kindred/releases) and [CHANGELOG.md](../CHANGELOG.md) list them. Do this each time:

1. **Read the changelog** for every release between yours and the new one. A release that needs something from you says so at the top
   of its section (for example a new setting, or a migration).
2. **Back up** (see "Backups"). Migrations run on their own and cannot be undone.
3. **Get the new version and rebuild:**

   ```sh
   git fetch --tags
   git checkout v2.0.0          # the release you chose
   KINDRED_COMMIT=$(git rev-parse --short HEAD) docker compose up -d --build
   ```

   Without Docker: check out the tag, then `mise install && npm install && mise run build:node`, and restart `mise run start`.
4. **Check** that `docker compose ps` shows "healthy" and that people can sign in.

From the next release, a prebuilt image is published for each tag. With it, step 3 is to set the new tag in your compose file
(see "Quick start with Docker") and run `docker compose pull && docker compose up -d`. Until you do, the image you run does not change.

Schema changes are migrations in `migrations/`, and they run when a file is opened. The app opens a family's file, and
`accounts.db`, on first use after the upgrade. Before the first pending migration, it copies the file to `backups/`
next to it (`/data/backups` in the container), named after the migration and the time. Look there if an upgrade goes wrong.

To go back, stop the app, restore the backup of the file from `backups/` (or the whole volume), and start the previous
image. An older image cannot read a file that a newer migration has changed, so restore the backup as well.

## Running without Docker

You need [mise](https://mise.jdx.dev), which installs the Node version in `mise.toml`:

```sh
mise install && npm install
mise run build:node      # the production build into dist/
mise run start           # http://127.0.0.1:4901
```

`mise run start` is `node server/node.ts`. It serves the built client and the server bundle in `dist/`, with the
environment variables above. It runs as production (`NODE_ENV=production`) unless `NODE_ENV` says otherwise. Keep the data folder out of the repository for a real server:

```sh
KINDRED_DATA_DIR=/var/lib/kindred HOST=0.0.0.0 KINDRED_ORIGIN=https://family.example.org mise run start
```

The server listens on `HOST`:`PORT`, and on SIGTERM or SIGINT it stops accepting connections, finishes the requests in
progress, closes the SQLite files and exits. That is what `docker stop` sends, too.

HTTPS is not part of the server. Put a reverse proxy in front of it, as above.

Compression is part of the server, so a proxy is not needed for it. The build writes brotli and gzip copies of the built
scripts and styles, and the server sends whichever the browser takes. Pages and server-function answers are compressed as
they are sent (brotli at a moderate level, or gzip), so a large family's tree page is about 150 kB on the wire instead of
1.6 MB. The assistant's streamed replies, small answers and pictures are sent as they are. A proxy that compresses too,
such as Caddy's `encode`, leaves an answer that is already compressed alone.

### Bun

Bun is not supported. Kindred's storage uses Node's `node:sqlite`, and Bun does not provide it. The production build starts under
Bun 1.3.14 and serves the health check and the static files, but any page that reads the database fails. `/setup` returns 500,
with `No such built-in module: node:sqlite` in the log. Kindred does not have a Bun SQLite driver: run it on Node 26.

## More than one family

One server can hold several families, each with its own members, pictures and settings. A steward of any family on the server
(or the server's first account) opens **Manage families** in the account menu, or the link under the family cards on the home
page, and makes another one: its name, its address (`/<id>`), an optional tagline and the theme it opens in. The maker becomes
its steward and is asked to add themselves first, as after setup; nobody else sees the new family until they are invited.

- The address is lower-case letters, digits and single dashes, 2 to 40 characters, starting with a letter. Words the app uses
  for its own pages (`api`, `setup`, `signin`, `share`, `invite`, `ui`, `families` and a few more) are refused. It cannot be changed
  later: it is the family's database name.
- On Node and Docker the family is a new file, `data/<id>.db`, beside the others; back it up with them. A file of that name that
  already holds people is never written over. A database that holds no family yet (an empty file) is listed on the page and can
  be set up from there.
- On Cloudflare a family needs its own D1 database, bound when the Worker is deployed: see
  [deploy-cloudflare.md](deploy-cloudflare.md#another-family).
- A family's stewards change its name, tagline and theme on the same page (the Access page has the name and tagline too).
- A family's steward can delete it there. The page offers the export first (the Markdown archive and GEDCOM), then asks for the
  family's address to be typed and for the steward's passkey. Deleting removes the family's database, every picture and document it
  stored, and every row of the accounts database that belongs to it: memberships, invitations, the share link and its guests'
  visits, the AI settings, chats and spending, statistics, reminder subscriptions, join requests (and the pending accounts of those
  who asked) and feedback. The accounts of its members stay, for their other families. The server's last family, and the family
  `KINDRED_DEFAULT_TREE` names, cannot be deleted. **It cannot be undone**: only a backup brings it back.

If the server stops in the middle of making or deleting a family, do it again: a family that was left with its details but
no people and no members is finished by making it again, and a deletion that stopped is finished by deleting again (or forgotten
when a new family takes the address).

## A public demo

`KINDRED_DEMO=1` turns a server into a public showcase of the two invented families (the Realm of Aurelmarch and the modern family
the tests use), for a project page or to try Kindred before installing it:

- Nobody signs in. Every visitor reads every family as a viewer, so the tree, the people, the Atlas, the Almanac, the Today page
  and the games' practice modes (which run in the browser) all work. A slim bar on every page says it is a demo with an invented
  family and links to the repository.
- Every change is refused on the server, in the storage layer every write passes through: nothing is saved, uploaded or deleted,
  and the visitor gets "This is a demo, so nothing can be changed or saved here." There are no accounts, no setup, no
  invitations, no share links, no join requests, no AI, no reminders, no statistics and no daily jobs.
- Only the environment turns it on; nothing a visitor sends can. The security headers and the caching rules are the same as
  everywhere else.
- It cannot be combined with `KINDRED_AUTH=cloudflare-access`, `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`, `KINDRED_GUEST_ORIGIN`,
  `KINDRED_SETUP_CODE`, `KINDRED_REQUIRE_SETUP_CODE` or the `KINDRED_VAPID_*` keys. With any of them, or with a value other than
  `1` or empty, the Node server does not start and says why; on Cloudflare every page says so instead.

Never point a demo at your family's data: it would show your family to anyone. The commands below make the invented families in
a folder of their own, fresh on every start.

```sh
mise run demo                                   # Node: builds the server, makes the families in .demo/data, serves them on :4901
docker compose --profile demo up -d --build demo   # Docker: the same on http://localhost:4902, in its own volume
```

`mise run demo` takes `PORT`, `HOST` and `KINDRED_ORIGIN` as usual, and `KINDRED_DATA_DIR` for another folder (never `data/`).
In Compose, set `KINDRED_DEMO_ORIGIN` to the demo's public address, and put it behind Caddy or another proxy as for any install.
For a demo on Cloudflare, see [deploy-cloudflare.md](deploy-cloudflare.md#a-public-demo) and `deploy/demo/`.

## Health

`GET /api/health` returns `ok` with status 200 while the server answers. It reads no data. The image's `HEALTHCHECK` uses it, so
`docker compose ps` shows the state, and a load balancer can use the same path.

## Security headers and caching

Every page carries an enforced Content-Security-Policy: scripts only from the server itself and with the page's own nonce,
connections only to the server itself, and no framing by other sites. A blocked script, frame or connection is reported to
`/api/csp-report`, which logs one `[kindred] content policy blocked: …` line for each. Pages, server functions and API answers
are sent with `Cache-Control: private, no-store`; pictures may stay in the member's own browser (`private`); the built
`assets/` files are public and cached for a year. A caching proxy or CDN in front of Kindred must not override this: a "cache
everything" rule would hand one member's family pages to the next visitor.

## The offline place search

Place suggestions come from the family's own places and, when the file exists, from the GeoNames gazetteer (about 40 MB, every
town with 500 people or more). Without the file, the place search offers only the family's own places, and the map shows the
pins. Nothing else changes.

To include it in the image, set `WITH_GAZETTEER=1` in `.env` (or pass `--build-arg WITH_GAZETTEER=1`). **The build then needs the
network**: it downloads `cities500.zip` and `admin1CodesASCII.txt` from geonames.org. Without the network, the build fails at
that step; leave the setting at `0` and the image still builds.

## Test families and resets (development)

These commands are for the repository's own development setup, on the Node dev server (`mise run dev`, port 4517):

```sh
mise run data      # generate the two test families (realm, modern) and rebuild their databases
mise run seed      # build any missing data/<id>.db from data/seed/; existing databases are kept
node scripts/seed.ts --force data/seed/modern.json   # rebuild one family; the old file is copied to data/backups/
mise run clean     # remove dist/, .output/, .tanstack/, .wrangler/, the generated databases and data/media
```

`mise run clean` deletes the databases, so keep a copy of `data/` first if you have edits in it.

## Checking it works

```sh
curl http://127.0.0.1:4901/api/health   # ok
mise run check                          # the types
mise run test                           # the unit tests: accounts, Access, storage, the server's static files
```
