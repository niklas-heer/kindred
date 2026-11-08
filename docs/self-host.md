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

## Settings

Compose reads `.env` for the settings below, and passes the ones the app reads into the container: `KINDRED_ORIGIN`,
`KINDRED_SETUP_CODE`, `KINDRED_REQUIRE_SETUP_CODE`, `KINDRED_DEFAULT_TREE` and `KINDRED_SECRET`. `KINDRED_DOMAIN` goes to
Caddy, and `WITH_GAZETTEER` to the build. An empty value is the same as an unset one, so the defaults still apply. Without
Docker, set them as environment variables for the server.

The image fixes four things that Compose cannot change without breaking the setup: the data is the `/data` volume
(`KINDRED_DATA_DIR`), the app listens on port 4901 inside the container (`PORT`, and `HOST` is `0.0.0.0`), and the
gazetteer is at `/app/gazetteer/gazetteer.db`. Those four are for running without Docker.

| Setting | Default | What it does |
| --- | --- | --- |
| `KINDRED_ORIGIN` | `http://localhost:4901` in Compose; otherwise the address the request came in on | The public address, such as `https://family.example.org`. Passkeys are bound to its host name, sessions use its scheme for the cookie's `Secure` flag, and the setup warning uses it. Set it before the first sign-in. |
| `KINDRED_SETUP_CODE` | empty | Who may create the first account. Empty: anyone who reaches `/setup` first. `required` (any case): a one-time code is printed in the log at each start, until the first account exists. Or a code of your own, 12 or more letters or digits, which stays the same. Any other value locks setup: nobody can create the first account until the value is fixed, and the log says so once. |
| `KINDRED_REQUIRE_SETUP_CODE` | empty | `1`, `true`, `yes` or `required` (any case) does the same as `KINDRED_SETUP_CODE=required`; `0`, `false`, `no` or `off` does not. Any other value requires the code, to be safe, and the log says so once. |
| `KINDRED_DEFAULT_TREE` | `family` | The family that `/` opens directly, for its members. Lower-case letters, digits and dashes. |
| `KINDRED_DATA_DIR` | `/data` in the image, `data/` otherwise | Where the families, pictures, accounts and the secret are kept. Docker: fixed at `/data`. |
| `KINDRED_SECRET` | the `secret` file in the data folder | The key that seals the AI keys the stewards save. Set it here to keep it out of the data folder; it must then stay the same. |
| `KINDRED_GAZETTEER` | `gazetteer.db` in the data folder | The offline place search. The image sets it to a file it may contain (see below). |
| `PORT` | `4901` | The port the server listens on. Docker: the image uses 4901, and Compose maps it. |
| `HOST` | `127.0.0.1` | The address it listens on. The image sets `0.0.0.0`, so that Docker can reach it. |

The Docker build also takes `WITH_GAZETTEER=1`, set in `.env` or on the command line (see below).

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
3. In `.env`, set both values to that name:

   ```sh
   KINDRED_ORIGIN=https://family.example.org
   KINDRED_DOMAIN=family.example.org
   ```

4. Start the app with the `https` profile:

   ```sh
   docker compose --profile https up -d --build
   ```

Why these two must match: a passkey is registered for the host name it was created on. If the name changes later, every
person has to register a new passkey. Choose the name once.

If you already run a reverse proxy, skip the Caddy service. Point the proxy at the app's port (set the `ports` line in
`compose.yaml` to `"4901:4901"` if the proxy is on another machine), and set `KINDRED_ORIGIN` to the public `https://` address. The proxy should send `X-Forwarded-Proto` (Caddy does): without it,
the setup warning would name `http://` for a site that is served over TLS.

## Your data

Everything the app keeps is in the data folder: `/data` in the container, which is the named volume `kindred-data`, and
`data/` when you run it without Docker.

| What | Where | Notes |
| --- | --- | --- |
| Each family | `<id>.db` | One SQLite file per family. The id is the file name. |
| Accounts, passkeys, sessions, memberships, AI settings | `accounts.db` | Separate from the families. |
| Portraits and gallery pictures | `media/<id>/` | The database holds only each picture's key. |
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

A GEDCOM or Markdown export ([exchange.md](exchange.md)) is readable, but it is not a backup: it leaves out stories, contacts,
houses, and the pictures.

## Upgrades

With Docker, update the code (`git pull`, or the new release), then rebuild:

```sh
docker compose up -d --build
```

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
environment variables above. Keep the data folder out of the repository for a real server:

```sh
KINDRED_DATA_DIR=/var/lib/kindred HOST=0.0.0.0 KINDRED_ORIGIN=https://family.example.org mise run start
```

The server listens on `HOST`:`PORT`, and on SIGTERM or SIGINT it stops accepting connections, finishes the requests in
progress, closes the SQLite files and exits. That is what `docker stop` sends, too.

HTTPS is not part of the server. Put a reverse proxy in front of it, as above.

### Bun

Bun is not supported. Kindred's storage uses Node's `node:sqlite`, and Bun does not provide it. The production build starts under
Bun 1.3.14 and serves the health check and the static files, but any page that reads the database fails. `/setup` returns 500,
with `No such built-in module: node:sqlite` in the log. Kindred does not have a Bun SQLite driver: run it on Node 26.

## Health

`GET /api/health` returns `ok` with status 200 while the server answers. It reads no data. The image's `HEALTHCHECK` uses it, so
`docker compose ps` shows the state, and a load balancer can use the same path.

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

`mise run clean` deletes the databases, so keep a copy of `data/` first if you have edits in it. `mise run data` also imports
the owner's real archive from `../family-archive` when that folder is there. It is skipped with a message otherwise.

## Checking it works

```sh
curl http://127.0.0.1:4901/api/health   # ok
mise run check                          # the types
mise run test                           # the unit tests: accounts, Access, storage, the server's static files
```
