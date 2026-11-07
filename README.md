# Kindred spike: a family tree you can live in

A throwaway UI spike, built to test how a family tree should *feel* to use. It borrows navigation from
Crusader Kings 3 and code editors, stores data in SQLite instead of Markdown, and adds everyday family
features. It is not production code. The good ideas should move into [Kindred](https://github.com/niklas-heer/kindred).

**Private by design:** this repository has no remote. `data/` holds the real Smith family when it is
imported, and both that import and the databases are gitignored.

## Run it

```sh
mise install && npm install
mise run data   # generate the test families; build data/smith.db from ../family-archive only if it doesn't exist
mise run dev    # http://localhost:4517
```

Three trees:

| Tree | People | What it tests |
| --- | --- | --- |
| `realm`: the Realm of Aurelmarch, 880–1210 | 1,627 in 12 houses | Scale and overwhelm; the codex theme; a 12-generation royal house |
| `modern`: the Lindqvist–Ashworth family | 346, 205 living | Everyday use: contacts, birthdays, anniversaries, sayings, divorces, step and adoptive links |
| `smith`: imported from `../family-archive` | 22 | Whether it feels right with your own family |

The generated trees are deterministic (`scripts/gen-realm.ts`, `scripts/gen-modern.ts`, seeded PRNG).

**Your edits are safe:** `scripts/seed.ts` never overwrites an existing database. `--force` rebuilds one,
after copying it to `data/backups/`. `mise run data` force-rebuilds only the two generated trees.

## What to try

- **Click** a card to select it: the panel changes, the tree stays still. **Double-click** or press **Enter** to centre
  the tree on that person.
- **⌘K** or **/** finds anyone by name, nickname, title or house. Every result shows how they are related to you.
- **Arrow keys** walk the tree: ←/→ move within a generation, ↑/↓ go to a parent or child. **F** fits the whole tree,
  **H** goes home, **1/2/3** switch view, and **?** lists every key.
- **Views:** *Family* is an hourglass around one person, *Dynasty* is a CK3-style house tree (pick a house from
  the dropdown), and *Ancestors* is the pedigree.
- **Zoom out:** cards turn into name plates, then into house-coloured tiles with crowns for rulers. The
  **minimap** (bottom right) shows the whole tree; click or drag on it to jump. The **ruler** (left) names
  each generation and its era, the way an editor numbers its lines.
- **Narrow the view:** fold branches (−/+ under cards, or "Fold others"), or use a **lens** to dim everyone
  except a direct line, a house, the living, or the path between you and someone ("How?").
- **Add people** from the dashed **+** marks around the selected card: parent above, child below, partner on
  the right, sibling on the left. Only a name is required.
- **Stories:** add a memory, saying, anecdote or recipe on the panel's Stories tab. The Chronicle shows
  every contribution and a wall of sayings.
- **Everyday:** the Almanac lists upcoming birthdays, anniversaries and memorial days, with `.ics` export and
  "On this day". Contacts is an address book grouped by household, with vCard export.
- **"Be them"** sees the whole tree from someone else's point of view, so every kinship label changes.
- **Themes:** Codex (CK3), Paper and Night, via the shield button or ⌘K. Codex plays small synthesised sound
  effects (speaker button to mute). Adding someone posts a CK3-style notice with **Undo**. Today's birthdays
  get a notice once a day.
- **Atlas:** a world map of where the family was born, died and married (All, Births, Deaths, Weddings).
  - **Replay:** play the family spreading out through time at ½×–4×. Space plays and pauses, and ←/→ step
    through years.
  - **Chronicle:** an event log that narrates the replay and scrolls through everything up to the current
    year.
  - **Arms:** draws each place as its main house's shield.
  - **Moves:** traces the path from a mother's birthplace to her child's.
- **Needed:** the family's research to-do list, nearest relatives first.
  - **What counts?** chooses which gaps count, per tree.
  - **Blaze through** goes one person at a time, asking only for what is missing (dates, places, parents, a
    photo, a memory). ↵ saves and moves on.
  - Cards, the panel and a lens on the tree show the same gaps.
- **Mistakes:** remove someone from their Edit tab, or Undo right after adding them.

## How it is built

TanStack Start (server functions over `node:sqlite`), Router (the canvas state lives in the URL, so
back/forward walks your trail), Query, Form (person editor, quick add, stories), Table and Virtual (the
Register), Hotkeys and Pacer. One SQLite file per tree: `src/lib/schema.ts`. Portraits can be uploaded and
are stored as BLOBs in that file.

The browser loads a tree's whole graph once: for the 1,627-person realm, about 0.5 MB of JSON, or under
100 KB gzipped. Layout, kinship, search, and
the minimap run locally and instantly. Details (stories, contacts) load per person.

- `src/lib/layout.ts`: contour-packed tidy trees for dynasty, hourglass and pedigree views. A person reached
  twice through cousin marriage is drawn twice, and the second card is marked "appears again".
- `src/lib/graph.ts`: relatives, generations and English kinship labels ("half-cousin once removed",
  "sister-in-law").
- `src/components/Canvas.tsx`: pan and zoom, viewport culling, three zoom levels with hysteresis, the minimap
  and the ruler.
- Portraits use DiceBear Lorelei (CC0). Heraldic charges come from [game-icons.net](https://game-icons.net)
  (CC BY 3.0). People with no recorded appearance get a neutral tone rather than a guessed one.

## What the spike taught

- **Separating "select" from "centre"** is the single biggest improvement in feel. It came from the Sol design
  review. Moving the tree on every click was disorienting.
- **A big tree needs an index, not a bigger picture.** The house dropdown, lenses, folding and minimap made the
  1,600-person realm manageable. "Fit everything" is only useful as an overview.
- **Kinship relative to you** on every card and search result is what makes the tree feel personal.
- **SQLite made contributing easy:** adding a person, story or contact is one row, with no merge conflicts and
  no file renames. Whether the long-term store should be SQLite, Cloudflare D1, or Markdown with a database
  index is still open. The spike only shows the editing experience SQLite allows.

Not done: German translation, sources and evidence (Kindred has these), photos in stories, history of who
changed what, permissions for relatives, and a phone layout.
