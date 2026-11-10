# Kindred

[![CI](https://github.com/niklas-heer/kindred/actions/workflows/ci.yml/badge.svg)](https://github.com/niklas-heer/kindred/actions/workflows/ci.yml)
[![Licence: MIT](https://img.shields.io/badge/licence-MIT-blue.svg)](LICENSE)
[![Latest release](https://img.shields.io/github/v/release/niklas-heer/kindred)](https://github.com/niklas-heer/kindred/releases)

A family tree your whole family can share, with the stories, photographs and places that go with it.

![The Dynasty view of an invented medieval realm: generations of portrait cards under house shields, a minimap of the whole tree, and the person panel beside it.](docs/images/tree.webp)

In most families, one person keeps the records, in a folder or a program nobody else can open. Kindred puts them somewhere
everyone can reach. Relatives can find themselves, see how they are related to the great-aunt in the old photograph, and
add what they remember: a saying, a recipe, the name of the village. You run it yourself, each family lives in its own
database, and you can take it with you whenever you like.

## Finding your way around the family

The tree opens on one person and the people around them. **Family** is an hourglass of ancestors and descendants,
**Dynasty** follows a house down the generations, and **Ancestors** looks straight back. Zoom out and the cards become name
plates, then shields that keep each person's name, then shields alone, and a **minimap** always shows the whole family and
where you are in it.

Press ⌘K or `/` to find anyone by name, nickname, title or house, and each result says how they are related to you. A lens
dims everyone except a direct line, a house, the living, or the path between two people. On a phone the person panel becomes
a drawer under the tree and the sections move to a tab bar.

<img src="docs/images/phone.webp" alt="The tree on a phone: a family of cards around one person, with a drawer for the person below and a tab bar." width="260">

A person's page holds their life on a timeline, their relatives, what has been written about them, and a **portrait**. Each
person gets a drawn portrait you can adjust. With AI switched on, it can start from a photo, or be painted in a style the
family shares.

![A person's page: a drawn portrait, the life on a timeline, closest family, a memory, and the places on a map.](docs/images/person.webp)

## Houses and their arms

A branch of the family can be a **house**, with a shield, a motto, a head and a line of succession. You draw the arms in a
designer, with its choices of field, division, charges and tinctures explained as you go. The assistant can look up what a surname means and offer the possible origins for you to choose from, then say
whether the arms suit that meaning and suggest new designs.

![A house page with its coat of arms, its head and the line of succession.](docs/images/house.webp)

![The arms designer: a shield beside its layers, a charge picker and the tinctures.](docs/images/arms.webp)

## What the family remembers

- The **Chronicle** gathers the family's notes, sayings, anecdotes, recipes and memories.
- The **Gallery** holds photographs and albums, with the people in them tagged. AI can suggest faces, and a person confirms each one.
- The **Atlas** maps where the family was born, married and died, and replays them spreading out over the years.
- The **Almanac** keeps birthdays, anniversaries and memorial days, for your calendar or as reminders on your devices, next to an
  address book grouped by household.
- **Needed** is the to-do list of what is still missing, nearest relatives first, one question at a time if you like.
- **Research** gathers one question, such as where a branch came from, with its documents, pictures, notes, people and places on one timeline.

![The Atlas: a map of Europe with the places an invented modern family was born, and a slider to replay them through the years.](docs/images/atlas.webp)

## The assistant, if you want one

AI is optional, and nothing is sent anywhere until a steward adds a key and turns a feature on. The assistant answers
questions about the family in plain words and proposes changes, which you approve yourself. Background tasks can collect
name meanings, review arms and translate stories, each with its own switch.

You can connect Anthropic, OpenAI and OpenRouter, and choose a provider and model for each job. The family shares one monthly
budget, $5 by default. [docs/ai.md](docs/ai.md) says exactly what is sent where.

## Who sees what

Everyone signs in with a **passkey**, so there are no passwords to forget. If you already manage people in Cloudflare, you can make Cloudflare Access the only sign-in instead: one method per installation, [your choice](docs/self-host.md#choosing-how-people-sign-in).
A member is a viewer, contributor, editor or steward, and the server checks every change. A person's fields and notes have three levels: personal (only the
account that added them), editors, or the whole family. A relative who doesn't want an account can have a read-only **share link**, protected by a password by default, that by default shows living people only by name, face and place in the tree.

New members are offered a short **tour**. Stewards get counts-only **statistics**, which never hold names or what anyone
wrote and can be turned off, and a **feedback** inbox that stays inside the family's own Kindred. The app comes in English,
German and Afrikaans, in the Codex, Paper and Night themes.

[docs/roles-and-privacy.md](docs/roles-and-privacy.md) has the details.

## Try it

With Docker, from a copy of this repository, there is nothing else to install:

```sh
git clone https://github.com/niklas-heer/kindred && cd kindred
docker compose up -d --build   # then open http://localhost:4901/setup
```

Create the first account with a passkey. The first account becomes steward of every family that exists, and you invite
everyone else from the Access page. Passkeys need HTTPS or `localhost`. From the next release, a ready-made image
(`ghcr.io/niklas-heer/kindred`) skips the build: see [docs/self-host.md](docs/self-host.md).

To work on Kindred, or to run it from source, you need [mise](https://mise.jdx.dev), which installs the right version of Node:

```sh
mise install && mise run install   # `mise run install` is npm install, run with that Node
mise run data                      # optional: two invented families to explore
mise run dev                       # http://localhost:4517
```

If mise is not activated in your shell, run every command as `mise run <task>`, so the right Node is used. The invented
families from `mise run data` appear after you create the first account.

## Running it for your family

Pick how people sign in with `KINDRED_AUTH`. `kindred` (the default) is Kindred's own accounts and passkeys, and needs nothing more than HTTPS.
`cloudflare-access` hands sign-in to a Cloudflare Access policy you manage. It suits people who already run one.

- **Docker**, on your own machine or server: `docker compose up -d --build` (or, from the next release, a published image), then open <http://localhost:4901/setup>. Each family is a SQLite file. See [docs/self-host.md](docs/self-host.md), which also covers HTTPS, backups and reminders.
- **Node**, without a container: `mise run build:node && mise run start`, on Node 26.
- **Cloudflare**, with Workers, D1 and R2 and no server to look after: see [docs/deploy-cloudflare.md](docs/deploy-cloudflare.md).

## Your data is yours

Every family is one database you can read: a SQLite file on Node, a D1 database on Cloudflare. Editors and stewards can export
a family as GEDCOM 5.5.1, for other genealogy programs, or as a Markdown archive. Stewards can import a GEDCOM file, and see
a preview before anything is written. An optional nightly archive can copy each family to a private GitHub repository.
[docs/exchange.md](docs/exchange.md) says what each format keeps and drops.

Exports leave some things out, so back up the databases and pictures as well.

## Documentation

- [Self-hosting](docs/self-host.md) and [deploying on Cloudflare](docs/deploy-cloudflare.md)
- [The AI features](docs/ai.md): what they send, what they cost, and how keys are kept
- [Roles and privacy](docs/roles-and-privacy.md)
- [The Campaign](docs/campaign.md): a game between the family's houses, and how it runs
- [GEDCOM and the Markdown archive](docs/exchange.md)
- [The data model](docs/data-model.md)
- [Changelog](CHANGELOG.md), [release notes for 2.0.0](docs/releases/v2.0.0.md) and [moving from v1](docs/migration-plan.md)
- [The model evaluations](docs/evals/README.md) behind the AI recommendations

Version 2 is a web app that replaces the earlier Rust CLI and its Markdown archive. It is a migration, not an upgrade.

## Working on Kindred

Kindred is TanStack Start with React 19, on `node:sqlite` or D1 behind one small storage interface.

```sh
mise tasks       # every task, with what it does
mise run check   # the types
mise run test    # the unit tests
mise run e2e     # browser journeys, on scratch data
```

[CONTRIBUTING.md](CONTRIBUTING.md) says how to send a change, and [AGENTS.md](AGENTS.md) holds the conventions. Schema changes are new numbered files in `migrations/`, and a file that has shipped is never edited. Text lives in
`src/lib/i18n/areas/`, in all three languages; [src/lib/i18n/README.md](src/lib/i18n/README.md) says how to add a string.

## Licence and credits

Kindred is open source under the [MIT licence](LICENSE).

- Heraldic charges come from [game-icons.net](https://game-icons.net), under **CC BY 3.0**, by Lorc, Delapouite and contributors.
- Portraits are Kindred's own drawing, built from parts in `src/components/portrait/`. Painted portraits, if a steward turns them on, are made by the image model they choose.
- Place names for the offline gazetteer come from [GeoNames](https://www.geonames.org), under **CC BY 4.0**.
- Typefaces come from Fontsource: Cinzel, EB Garamond, Inter and IM Fell English, under the SIL Open Font License.
- The Atlas draws its map from `world-atlas`, which is built from Natural Earth data.

[NOTICE.md](NOTICE.md) lists every third-party licence and the credit each one asks for.
