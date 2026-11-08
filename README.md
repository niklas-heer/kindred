# Kindred

A family tree your whole family can share, with the stories, photographs and places that go with it.

![The Dynasty view of an invented family: generations of cards under house shields, with a minimap of the whole tree.](docs/images/tree.webp)

In most families, one person keeps the records, in a folder or a program nobody else can open. Kindred puts them somewhere
everyone can reach. Relatives can find themselves, see how they are related to the great-aunt in the old photograph, and
add what they remember: a saying, a recipe, the name of the village. You run it yourself, each family lives in its own
database, and you can take it with you whenever you like.

## Finding your way around the family

The tree opens on one person and the people around them. **Family** is an hourglass of ancestors and descendants,
**Dynasty** follows a house down the generations, and **Ancestors** looks straight back. Zoom out and the cards become name
plates, then small shields, and a **minimap** always shows the whole family and where you are in it.

Press ⌘K or `/` to find anyone by name, nickname, title or house, and each result says how they are related to you. A lens
dims everyone except a direct line, a house, the living, or the path between two people.

A person's page holds their life on a timeline, their relatives, what has been written about them, and a **portrait**. Each
person gets a drawn portrait you can adjust. With AI switched on, it can start from a photo, or be painted in a style the
family shares.

![A person's page beside the tree, with a drawn portrait, a timeline and relatives.](docs/images/person.webp)

## Houses and their arms

A branch of the family can be a **house**, with a shield, a motto, a head and a line of succession. You draw the arms in a
designer. The assistant can look up what a surname means and offer the possible origins for you to choose from, then say
whether the arms suit that meaning and suggest new designs.

![A house page with its coat of arms, its head and the line of succession.](docs/images/house.webp)

## What the family remembers

- The **Chronicle** gathers the family's notes, sayings, anecdotes, recipes and memories.
- The **Gallery** holds photographs and albums, with the people in them tagged. AI can suggest faces, and a person confirms each one.
- The **Atlas** maps where the family was born, married and died, and replays them spreading out over the years.
- The **Almanac** keeps birthdays, anniversaries and memorial days, for your calendar or as reminders on your devices, next to an
  address book grouped by household.
- **Needed** is the to-do list of what is still missing, nearest relatives first, one question at a time if you like.
- **Research** gathers one question, such as where a branch came from, with its documents, pictures, notes, people and places on one timeline.

![The Atlas: a world map with the places an invented family lived.](docs/images/atlas.webp)

## The assistant, if you want one

AI is optional, and nothing is sent anywhere until a steward adds a key and turns a feature on. The assistant answers
questions about the family in plain words and proposes changes, which you approve yourself. Background tasks can collect
name meanings, review arms and translate stories, each with its own switch.

You can connect Anthropic, OpenAI and OpenRouter, and choose a provider and model for each job. The family shares one monthly
budget, $5 by default. [docs/ai.md](docs/ai.md) says exactly what is sent where.

## Who sees what

Everyone signs in with a **passkey**, so there are no passwords to forget, and you can put Cloudflare Access in front as well.
A member is a viewer, contributor, editor or steward, and the server checks every change. Private fields are shown only to
editors and stewards. A relative who doesn't want an account can have a read-only **share link**, protected by a password by default.

New members are offered a short **tour**. Stewards get counts-only **statistics**, which never hold names or what anyone
wrote and can be turned off, and a **feedback** inbox that stays inside the family's own Kindred. The app comes in English,
German and Afrikaans, in the Codex, Paper and Night themes.

[docs/roles-and-privacy.md](docs/roles-and-privacy.md) has the details.

## Try it

You need [mise](https://mise.jdx.dev), which installs the right version of Node.

```sh
mise install && npm install
mise run data   # optional: two invented families to explore
mise run dev    # http://localhost:4517
```

Open the site and create the first account with a passkey. The first account becomes steward of every family that exists,
and you invite everyone else from the Access page. Passkeys need HTTPS or `localhost`.

## Running it for your family

- **Docker**, on your own machine or server: `docker compose up -d --build`, then open <http://localhost:4901/setup>. Each family is a SQLite file. See [docs/self-host.md](docs/self-host.md), which also covers HTTPS, backups and reminders.
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
- [GEDCOM and the Markdown archive](docs/exchange.md)
- [The data model](docs/data-model.md)
- [Release notes for 2.0.0](docs/releases/v2.0.0.md) and [moving from v1](docs/migration-plan.md)

Version 2 is a web app that replaces the earlier Rust CLI and its Markdown archive. It is a migration, not an upgrade.

## Working on Kindred

Kindred is TanStack Start with React 19, on `node:sqlite` or D1 behind one small storage interface.

```sh
mise tasks       # every task, with what it does
mise run check   # the types
mise run test    # the unit tests
mise run e2e     # browser journeys, on scratch data
```

Schema changes are new numbered files in `migrations/`, and a file that has shipped is never edited. Text lives in
`src/lib/i18n/areas/`, in all three languages; [src/lib/i18n/README.md](src/lib/i18n/README.md) says how to add a string.

## Licence and credits

Kindred is open source under the [MIT licence](LICENSE).

- Heraldic charges come from [game-icons.net](https://game-icons.net), under **CC BY 3.0**. Attribution: "Game-icons.net, CC BY 3.0".
- Portraits use DiceBear Lorelei, under CC0.
- Place names for the offline gazetteer come from [GeoNames](https://www.geonames.org), under **CC BY 4.0**.
- Typefaces come from Fontsource: Cinzel, EB Garamond, Inter and IM Fell English, under the SIL Open Font License.
- The Atlas draws its map from `world-atlas`, which is built from Natural Earth data.
