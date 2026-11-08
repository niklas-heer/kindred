# Self-hosting Kindred

On your own machine, Kindred keeps every family in a SQLite file. Nothing needs an account with a cloud provider.
This guide covers the local setup, where the data is, and the limits of running it as a server today.

## The short version

```sh
mise install && npm install
mise run dev       # http://localhost:4517
```

That runs Kindred on Node with `node:sqlite`, reading and writing the files in `data/`. Anyone who can reach that
address can reach the site, so keep it on your own machine or behind a proxy that adds sign-in (see below).

## Where the data lives

| What | Where | Notes |
| --- | --- | --- |
| Each family | `data/<id>.db` | One SQLite file per family. The id is the file name. |
| Accounts, passkeys, sessions, memberships, AI settings | `data/accounts.db` | Separate from the families, so one family's key and a person's chats never travel with the family's data. |
| Portraits and gallery pictures | `data/media/<id>/` | The database holds only each picture's key. |
| The AI key sealing secret | `data/secret` (or `KINDRED_SECRET`) | Made on first use with mode 600. Back it up with the data: without it, a saved AI key cannot be read. |
| Backups | `data/backups/` | Copies made before a migration runs on a file that holds data, and before `seed.ts --force` rebuilds a family. |
| The offline place search | `data/gazetteer.db` | Optional (`mise run gazetteer`). |

SQLite runs in WAL mode, so you will see `-wal` and `-shm` files next to each database. Leave them in place while the
server runs; they belong to the database.

To move the data, stop the server, copy the whole `data/` folder, and start the server on the other machine. Files
made earlier are brought up to date with the migrations when they are opened, after a backup is taken.

### Changing where the data is

- `KINDRED_DATA_DIR`: the folder for the families, the media and the secret (default `data`).
- `KINDRED_ACCOUNTS_DB`: the accounts file, if it should be somewhere else. Useful for tests.

## Setting up the first account

Open the site and create the first account with a passkey. That account becomes steward of every family that exists,
and setup closes once it exists. Concurrent attempts can create only one first steward.

To protect a server that strangers could reach, set a setup code. On Node you can use:

```sh
KINDRED_SETUP_CODE=required mise run dev     # or KINDRED_REQUIRE_SETUP_CODE=1
```

The server then prints a one-time code in its console, and `/setup` asks for it. The code changes on every restart, so
the first person to set up after a restart needs the new one.

## Behind a reverse proxy

Set `KINDRED_ORIGIN` to the public address the browser uses, for example `https://family.example.org`:

```sh
KINDRED_ORIGIN=https://family.example.org mise run dev
```

It is used for the passkey origin and host name, and it turns on secure session cookies. Passkeys work only on HTTPS
or on `localhost`. Changing the host name later means new passkeys for everyone.

## Running it as a server: what exists and what does not

`mise run dev` runs Vite's development server. It is what the repository runs, and it is fine for a family on a
home network. It is not a production server.

`KINDRED_TARGET=node mise run build` builds for Node into the build output folder, but the output is a fetch handler (its server
entry exports one), and nothing in this repository serves it. A production Node server would need a small runner
that listens on a port and calls that handler. That runner is not written yet. Until it is, the supported way to run
Kindred for others is on Cloudflare, see [deploy-cloudflare.md](deploy-cloudflare.md).

## Test families and resets

```sh
mise run data      # generate the two test families (realm, modern) and rebuild their databases
mise run seed      # build any missing data/<id>.db from data/seed/; existing databases are kept
node scripts/seed.ts --force data/seed/modern.json   # rebuild one family; the old file is copied to data/backups/
mise run clean     # remove dist/, .output/, .tanstack/, .wrangler/, the generated databases and data/media
```

`mise run clean` deletes the databases, so keep a copy of `data/` first if you have edits in it.

`mise run data` also imports the owner's real archive from `../family-archive` when that folder is there. It is
skipped with a message otherwise.

## Exports as a backup

A GEDCOM or Markdown export is a readable copy of a family, but it is not a full backup: it leaves out stories,
contact details, houses and the pictures. For a complete backup, copy the `data/` folder. See
[exchange.md](exchange.md) for what each export keeps.

## Checking it works

```sh
mise run check     # the types
mise run test      # the unit tests: accounts, Access, storage
```
