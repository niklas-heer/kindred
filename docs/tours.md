# The tours

Kindred shows itself on the reader's own family. There are two tours, both under **Tours** in the account menu
(on a phone also under **More**, and in the ⌘K palette as "Tours"):

- **Welcome**: two or three minutes, eight steps (nine for a steward). What a relative who has just been invited needs
  on the first day. A new member is offered it once, in a corner of the tree, after they have said who they are.
- **The grand tour**: every part of Kindred, in chapters (nine, and a tenth for stewards), about 25 to 35 steps
  depending on the role. Each chapter can be skipped, the tour can be paused anywhere, and it carries on another day.
  A [public demo](self-host.md#a-public-demo) offers this one to its visitors instead of Welcome, because they came to see what
  Kindred does.

A share-link guest has no tours. In a steward's "View as" preview the tours work and show what that role would be
shown; the first-run offer is left out of a preview.

## How a tour behaves

- **A card and a spotlight.** Each step is a card beside the real element it talks about, with the rest of the page
  dimmed. The card goes to the page it needs by itself. On a phone it docks to the edge away from the element.
- **Your turn.** Some steps ask the reader to do the thing: open the search, select someone on the tree, open a tab,
  open a recipe. While such a step waits, the page under the card can be used as usual. When the reader does it the
  card says so and the tour goes on by itself. **Show me** does it for them, and **Skip this** goes on without.
- **Role-aware.** A viewer is not told how to edit; only stewards get the steps about access. A step whose element is
  not on the page (no recipe yet, nobody else here, a phone without the minimap) is passed over without an error.
- **Keys.** ← and → go back and on, Escape leaves. While a card is read, focus stays inside it. Reduced motion is
  respected: the spotlight and the card then jump instead of gliding, and nothing pulses.
- **Chapters.** The grand tour's card says which chapter it is in, and has **Skip chapter** and **Pause**. Walking a
  chapter to its last step ticks it in the Tours dialog; a skipped chapter stays open. The dialog's main button reads
  "Continue the grand tour, chapter 4: …", any chapter can be started from the list, and **Restart** forgets the ticks.
- **The end.** A closing card, with a seal that draws itself once. Welcome's closing card offers the grand tour.
  **Done** goes back to the page the tour started on.

## What a tour stores

Nothing with the family, and nothing with the account. A tour only shows; "Show me" only presses buttons that open
things (the search, a tab, the emoji palette, a recipe), never one that saves. That is also why the tours work
unchanged in a read-only demo and in a preview.

In the browser (`localStorage`), per device:

| Key | Holds |
|---|---|
| `kindred:tour` | that a tour has been offered here, so it is not offered again |
| `kindred:tour.grand:<family>` | the grand tour's ticked chapters and the chapter to continue at |

So progress does not follow a reader to another device. That was chosen over a column with the account: a tour is a
few minutes long, and it keeps tours out of the databases altogether.

Where the stewards' [usage statistics](roles-and-privacy.md) are on, finishing or leaving **Welcome** is counted once
per member, as a total without names. The grand tour is not counted.

## Welcome

| # | Step | Page | Points at | Your turn | Shown to |
|---|---|---|---|---|---|
| 1 | Welcome to Kindred (`welcome`) | where you are | nothing: a card in the middle |  | everyone |
| 2 | Today (`today`) | `/today` | `feed-compose`, `today-hero` |  | everyone |
| 3 | Find anyone (`find`) | where you are | `search` | open the search | everyone |
| 4 | Tree (`tree`) | the tree | `tree-selected`, `tree-canvas` | select someone else | everyone |
| 5 | A person’s page (`panel`) | the tree | `person-panel` |  | everyone |
| 6 | Add what you remember (`memory`) | `/chronicle` | `chronicle-add`, `page-header` |  | contributors and up |
| 7 | Chronicle (`chronicle`) | `/chronicle` | `chronicle-bar`, `page-header` |  | viewers |
| 8 | Almanac (`almanac`) | `/almanac` | `almanac-strip`, `page-header` |  | everyone |
| 9 | Access (`access`) | `/access` | `access-invite`, `page-header` |  | stewards |
| 10 | Where to get help (`help`) | where you are | `account-menu`, `more` |  | everyone |

## The grand tour

A chapter is left out for a reader none of whose steps remain (the stewards' chapter, for everyone else).

### Chapter 1: Today (`today`)

| # | Step | Page | Points at | Your turn | Shown to |
|---|---|---|---|---|---|
| 1 | The grand tour (`g-intro`) | where you are | nothing: a card in the middle |  | everyone |
| 2 | The family’s feed (`g-feed`) | `/today` | `feed-compose`, `feed` |  | everyone |
| 3 | Reactions (`g-react`) | `/today` | `feed-react` | open the emoji palette | everyone |
| 4 | Something new each week (`g-cards`) | `/today` | `today-cards` |  | everyone |

### Chapter 2: Tree (`tree`)

| # | Step | Page | Points at | Your turn | Shown to |
|---|---|---|---|---|---|
| 5 | Selecting someone (`g-select`) | the tree | `tree-selected`, `tree-canvas` | select someone else | everyone |
| 6 | Views and lenses (`g-views`) | the tree | `tree-toolbar` |  | everyone |
| 7 | The minimap (`g-minimap`) | the tree | `tree-minimap` |  | everyone |
| 8 | Adding relatives (`g-add`) | the tree | `tree-selected`, `tree-canvas` |  | editors, stewards |
| 9 | Who is here now (`g-here`) | the tree | `here-now`, `topbar` |  | everyone |

### Chapter 3: A person (`person`)

| # | Step | Page | Points at | Your turn | Shown to |
|---|---|---|---|---|---|
| 10 | A person’s page (`g-profile`) | `/person/$id` | `person-head` |  | everyone |
| 11 | Everyday details (`g-everyday`) | `/person/$id` | `person-tab-everyday` | open the tab | everyone |
| 12 | Editing (`g-edit`) | `/person/$id` | `person-tab-edit` | open the Edit tab | editors, stewards |
| 13 | Fields that fold away (`g-fields`) | `/person/$id` | `person-edit` |  | editors, stewards |
| 14 | Life events and sources (`g-life`) | `/person/$id` | `life-editor` |  | editors, stewards |
| 15 | A portrait for everyone (`g-look`) | `/person/$id` | `person-appearance` |  | editors, stewards |

### Chapter 4: Chronicle and Cookbook (`chronicle`)

| # | Step | Page | Points at | Your turn | Shown to |
|---|---|---|---|---|---|
| 16 | Chronicle (`g-chronicle`) | `/chronicle` | `chronicle-bar`, `page-header` |  | everyone |
| 17 | Add what you remember (`g-memory`) | `/chronicle` | `chronicle-add` |  | contributors and up |
| 18 | Cookbook (`g-cookbook`) | `/cookbook` | `recipe-card`, `page-header` | open a recipe | everyone |
| 19 | Cooking mode (`g-cook`) | where you are | `recipe-cook`, `recipe` |  | everyone |

### Chapter 5: Gallery and Contacts (`pictures`)

| # | Step | Page | Points at | Your turn | Shown to |
|---|---|---|---|---|---|
| 20 | Gallery (`g-gallery`) | `/gallery` | `page-header` |  | everyone |
| 21 | Contacts (`g-contacts`) | `/contacts` | `page-header` |  | everyone |

### Chapter 6: Atlas and Almanac (`places`)

| # | Step | Page | Points at | Your turn | Shown to |
|---|---|---|---|---|---|
| 22 | Atlas (`g-atlas`) | `/atlas` | `page-header`, `atlas-handle` |  | everyone |
| 23 | Almanac (`g-almanac`) | `/almanac` | `almanac-strip`, `page-header` |  | everyone |

### Chapter 7: Houses and arms (`houses`)

| # | Step | Page | Points at | Your turn | Shown to |
|---|---|---|---|---|---|
| 24 | Houses (`g-houses`) | `/houses` | `page-header` |  | everyone |
| 25 | A coat of arms (`g-arms`) | `/house/$house` | `house-arms` |  | everyone |

### Chapter 8: The Campaign (`campaign`)

| # | Step | Page | Points at | Your turn | Shown to |
|---|---|---|---|---|---|
| 26 | The Campaign (`g-campaign`) | `/campaign` | `page-header` |  | everyone |
| 27 | Try a practice run (`g-practice`) | `/campaign` | `campaign-practice` |  | everyone |

### Chapter 9: Keep and share (`keep`)

| # | Step | Page | Points at | Your turn | Shown to |
|---|---|---|---|---|---|
| 28 | Print and the family book (`g-print`) | `/print` | `page-header` |  | everyone |
| 29 | Export (`g-export`) | `/settings/import` | `export`, `page-header` |  | editors, stewards |
| 30 | History (`g-history`) | `/history` | `page-header` |  | everyone |

### Chapter 10: For stewards (`stewards`)

| # | Step | Page | Points at | Your turn | Shown to |
|---|---|---|---|---|---|
| 31 | Access (`g-access`) | `/access` | `access-invite`, `page-header` |  | stewards |
| 32 | Share links (`g-share`) | `/access` | `share-links` |  | stewards |
| 33 | View as (`g-viewas`) | `/access` | `view-as` |  | stewards |
| 34 | Games (`g-games`) | `/settings/games` | `page-header` |  | stewards |

## Adding or changing a step

A step is data; the player (`src/components/tour/Tour.tsx`) needs no change for a new one.

1. **Name the element.** Put `data-tour="my-name"` on the element the step points at, in its component. Names are
   lower-case with hyphens and say what the thing is, not how it looks. An element may carry several names, separated
   by spaces. A tab takes its name through the `tour` prop of `Tab` and `TabPanel` (`src/components/ui/Tabs.tsx`).
   Every page header already has `page-header`, which is a good second target.
2. **Write the step** in `src/components/tour/steps.ts`: in `WELCOME_TOUR`, or in a chapter of `GRAND_TOUR` (a new
   chapter is an `id`, a `title` and its `steps`).

   ```ts
   { id: 'g-register', page: 'register', targets: ['register-table', 'page-header'], title: 'shell.register', body: 'tour.g.register.body' },
   ```

   - `page` is a key of `TOUR_ROUTES` in the same file; add the route there if it is new. Leave it out for a step
     about something that is on every page (the top bar).
   - `targets` are tried in order; the first one on screen gets the spotlight. Without `targets` the card sits in
     the middle.
   - `needs: 'edit-person'` shows the step only to readers who may do that; `lacks` is the opposite, for the reading
     version of a step. The actions are in `src/lib/roles.ts`. `requires: 'people' | 'house'` skips it for a family
     that has none.
   - `opener: 'person-tab-edit'` is pressed first when the targets are not there yet (they are inside a tab).
   - `task` makes it a "your turn" step: `until` is the name that appears when it is done (`changed: true` if it
     must be another element than before), `click` is what "Show me" presses, `ask` is the line that asks, and
     `tidy` puts away what was opened. A task may only open or select something. It must never save.
3. **Write the words** in `src/lib/i18n/areas/tour.ts`, in English, German (du) and Afrikaans (jy): the step's body,
   and its title unless it reuses a page's own label. Two or three sentences; say what the thing is for.
4. **Run the tests**: `KINDRED_DATA_DIR=$(mktemp -d) node --test src/components/tour/steps.test.ts`. They fail when
   a name a step uses is not set as a `data-tour` anywhere in `src/`, when ids repeat, and when the step counts per
   role change (update those numbers on purpose). `npm test` also fails on a missing translation.
5. **Update the tables above**, and walk the tour once at desktop width and at 390 px. The journey
   `e2e/25-tours.spec.ts` covers both tours' behaviour, not every step.

A page that opens a dialog of its own on a first visit should wait while a tour is showing it
(`isTourRunning()` in `src/components/tour/store.ts`; the Campaign's "How it works" does), or it opens over the card.
