# The Campaign

A game you play alone, as your own house, on an invented continent that is new each week. The whole family plays the
same continent all week, and a table shows everyone's best. It rewards the research: a house whose people are well
recorded raises more troops.

The family is on the board through its **houses**: you rule your own, and the others are the family's other houses, with
their arms and colours. Nothing else of the family is there. No real place and no person appears on the map: the
continent, its provinces, towns and seas are invented, names and all.

It is only a game. It never changes the family's records, it is off until a steward turns it on, share-link guests never
see it, and it is left out of every export.

## Turning it on

The Campaign can be found while it is off: members have it under **More**, marked "resting", and its page offers a
practice reign. A steward turns it on in any of three places, which all use the same switch: **Games** (account menu, or
More on a phone) with "The Campaign is on for this family"; the Campaign's own page, with "Turn the Campaign on for this
family"; or the card on Today that tells a steward once that the game is there ("Not now" puts the card away in that
browser). This week's challenge opens at once, and a **Campaign** section appears in the bar for every member. Turning
it off hides the section; the reigns already played stay in the tables.

Members of every role can play, viewers too.

## A reign

A **reign** is one game: **12 turns**, about eight minutes.

- **The sides:** four. The family's four largest houses, each with the smaller houses nearest to it by marriage (a small
  house married into none of them sits out); a family with fewer houses gets invented regent companies to fill the four.
- **Your side:** you rule the house of the person you stand for. A member who stands for nobody in a house chooses the
  house they rule for each reign. The other three sides are played by **regents**.
- **The map** is a continent of 16 provinces, laid out from a seed (see "The continent" below). Provinces that share a
  border are neighbours, unless mountains stand on it; two harbours joined by a sea lane are neighbours too.
- **The opening:** every side holds its **seat** (a castle, marked with a crown) and one neighbour; the seats stand as
  far apart as the land allows. The rest are free marches with a small garrison. A seat can never be attacked, so nobody
  is ever out.

### A turn

The turn's three steps are shown above the orders:

1. **Reinforce.** The turn's levy waits to be placed. Press a province of yours to place one troop there; press again for
   the next. Placing costs no order. "Undo" takes the last troop back. Levy you do not place is kept for the next turn.
   After "Done placing", while levy is left, the "Reinforce" step is a button that goes back to placing.
2. **Orders.** Up to **3** marches or attacks:
   - **Choose a province** of yours with at least two troops (one always stays behind). It gets a thick gold outline,
     the provinces it cannot reach dim, and its neighbours are ringed: **footprints** for a march to your own province,
     **crossed swords with the chance** for an attack, and a **lock** for a seat, which cannot be attacked.
   - **Choose a ringed neighbour.** An arrow points from your province to it, and the **order bar** opens: how many
     troops go (− and +, or "All"), and for an attack the exact chance ("61% chance · 4 against 2") with every thing the
     ground does to it listed beneath, such as "Forest: the defender's best die counts one more." and "Across the river:
     2 rounds, not 3."
   - **Confirm** with the bar's button ("March with 4 troops", "Attack with 4 troops"). Nothing moves before that.
   - **Back**, Escape or a press on the sea goes one step back. Pressing another province of yours chooses that one
     instead. A press on any other province only shows what it is.
   - A march can be undone until you end the turn (back to your last battle). A battle cannot: its dice have been rolled.
     Undo closes an open order bar, since the province may spare fewer troops after it.
   - While the order bar is open, its button is the one gold button; "End the turn" is a plain one beside it.
3. **End turn.** The regents move. Their attacks are shown one after another on the map ("Skip" ends that), and listed
   under the orders. Then the next turn's levy arrives.

The twelve turns are three years of four seasons; the turn's head says which ("Autumn, year 2").

The map and the list show the same provinces and work the same way. On a phone the order bar stays at the bottom of the
screen, and while an order is being chosen the map moves in on the province and what it can reach, so their names and
chances are large enough to read.

### What the board shows

- **What is chosen and where it can go:** the chosen province has a thick gold outline; what it can reach is ringed with
  a moving dashed line and carries a badge (footprints, or swords with the chance, with a wave or a sail when a river or
  the sea lies between); the rest of the map dims. While the levy is being placed, your provinces with room carry a
  small plus.
- **What moves:** troops travel from one province to the other as a token; where two armies meet there is a burst, then
  the battle's dialog; a province that changes hands fills with its new holder's colour from the side the attack came
  from; a banner names each new turn and its season.
- **The battle** shows both armies as rows of small figures that thin as they lose, the ground and what it does, the
  chance the attacker had, each round's dice, and the outcome stamped "Taken" or "Held".
- **With "reduce motion"** nothing travels, bursts or flies in: the map shows what is, the battle's rounds are all there
  at once, and the regents' attacks are listed under the orders. Nothing is told by motion alone.
- **Keyboard:** every province is a button (Tab, then Enter or Space), Escape goes one step back, and the list is the
  same board as rows.

### Battles

At most three rounds of Risk's dice: the attacker rolls up to three, the defender up to two, the highest are compared
pair by pair, and a tie goes to the defender. If the defenders are gone, the survivors move in (as many as the province
holds; the rest go home); otherwise they fall back. Three rounds take at most six defenders, so a large garrison needs
more than one attack. The chance the order bar shows is exact: every roll of every round is counted.

### The continent

A continent is laid out from a seed by `src/lib/campaign/geography.ts`: a sheet of small six-sided tiles is cut into land
and sea by a noise field that falls off towards the edges; the land (one piece, lakes filled) is shared out among 16
provinces, each a cluster of tiles around its own centre, so every border wanders and the coast has bays and capes. Then:

- **Rivers** (one or two) run along borders from a meeting of borders deep inland down to the sea.
- **Mountain ridges** (two to four) stand on borders on the highest ground. Nobody crosses one, so the provinces either
  side are not neighbours. A ridge is never placed where it would cut the land in two or leave a province with fewer
  than two ways out.
- **Sea lanes** (one or two) join two harbours that are at least three borders apart by land and lie on the same side
  of the continent.
- **Towns:** every seat, and two free towns as many borders from every seat as the land allows.
- **The rest of the terrain** follows the lie of the land: the two highest provinces are highland, the two lowest by the
  water (on the coast or a river) are marsh, the two wettest of the rest are forest, and what remains is plains.
- **Names** for the continent, every province and the open sea come from `src/lib/campaign/names.ts`: a root of two
  syllables ("Kel" + "an") and an ending for what the thing is ("-wold" and "-holt" for forest, "-fell" and "-crag" for
  highland, "-fen" and "-mire" for marsh, "-mark" and "-vale" for plains, "-hold" and "-keep" for a seat, "-haven" for a
  town on the coast, "Mare …um" for a sea). They are names, so they are the same in every language. No two provinces of
  a map share a root.

The names are invented and none is a real place's: every name the generator can make is listed (`everyName`), and the
whole list was compared with every spelling in GeoNames' cities500 (about a million names). The handful it shared are
in `DENIED` and are never dealt, and a list of rude letter runs in English, German and Afrikaans is refused the same
way. `KINDRED_GEONAMES=<path to cities500.txt> node --test src/lib/campaign/engine.test.ts` makes the comparison again;
do that after changing the syllables or the endings.

The same seed gives the same continent on the server and in the browser, and a continent holds nothing of the family: the
houses are only put on it as the four sides.

### Terrain

Each province has one kind of terrain with one rule and its own picture on the map (little trees, hills, reeds, houses),
and a border may carry a river, a ridge or a sea lane. The legend under the map shows each as the map draws it, and "What
each one does" lists the rules.

| Terrain | How many | Rule |
| --- | --- | --- |
| Plains | the rest, 4 | No special rule. |
| Forest | 2 | The defender's highest die counts one more (six at most). |
| Highland | 2 | The attacker rolls two dice at most. |
| Marsh | 2 | Room for only 6 troops. |
| Town | every seat, and 2 free towns | One more troop of levy a turn, room for 12 troops instead of 10, and it counts double in the score. |

| On a border | Rule |
| --- | --- |
| River | An attack across it is fought for 2 rounds, not 3. Marching across costs nothing more. |
| Mountains | Nobody crosses: no march, no attack. |
| Sea lane | The two harbours are neighbours. An attack by sea is fought for 2 rounds; a march between your own harbours is an ordinary march. |

Two rounds take at most four defenders, so a garrison of five or more behind a river cannot be taken in one attack.
Regents play by the same rules.

### Levy and renown

Each turn's levy is **2**, plus **1 for each town** you hold, plus your house's **renown**: 0 to 2 more. The step
"Reinforce" shows the parts ("Renown +2"), with a link to Information needed.

**Renown** (0 to 100) is the share of a house's people with a portrait, with dates, with a birthplace, and with memories,
life events and sources. From 30 points it adds one troop a turn, from 60 two. The page shows the parts and what would
raise them. It counts what is recorded, never what it says: no number comes from a lifespan, a cause of death or a count
of children. A reign keeps the renown it began with, so what you record counts from your next reign; edits made during a
reign never change it.

A right answer in Today's daily quiz adds **2 troops** to the first turn of your next reign that day (once a day).

### The score

At the end of turn 12: **10 a province, 20 a town, 2 a battle won** (a province taken, or an attack on you thrown back),
**less 1 for every troop lost**. Never below 0.

### The chronicle and the reign's title

When a reign ends the page shows its **chronicle**: the score in its parts, the provinces held turn by turn as a small
line, and up to five things worth telling in the order they happened (a town changing hands, a win against the odds or
across the sea, a province lost). Under a counted reign it also says where you stand this week, whether it is your best
this week or your best ever, and where your house stands among the houses ("House Ash rose to 2nd of 3 houses this
week").

Every reign gets a **title**, the first of these that fits: a conquering reign (nine provinces or more), a reign of towns
(four towns), a bold reign (a province taken with a chance under 40%), a seafaring reign (a province taken across the
sea), an unbroken reign (no province lost, five or more held), a relentless reign (twelve battles won), a prudent reign
(four troops lost at most, with four provinces), a reign the dice disliked (three attacks lost at 60% or better), a
peaceable reign (no attack ordered), a steadfast reign. The title is about the reign, never about the person, so it
needs no "he" or "she" in any language. The family's table shows it beside each score. It is worked out from the moves
(`src/lib/campaign/chronicle.ts`) by the browser for the page and by the server for the table.

## The week's challenge

- **The same continent for everyone:** the continent comes from the week's seed (the family and the ISO week, Monday to
  Sunday, UTC), and the sides are the family's houses as they are when the week's first reign begins. That reign stores
  the field (`campaign_week`), and every later reign that week reads it back, even when a house is renamed, a member
  leaves, or two first reigns begin at the same moment. Next week brings a new continent. The dice are each reign's own,
  so playing the week again is a new game on the same field. The week's page shows the continent as a picture, with its
  name, before a reign begins.
- **Play as often as you like.** The table has three views: **This week** (each member's best, with their count of
  reigns and the reign's title), **All time** (the ten best reigns ever), and **Houses** (each house's total: the sum of
  its members' bests this week, by the house each one ruled). The week's page also says your best reign so far.
- **A reign in progress is kept in the tab.** A reload, or a visit to another page and back, returns to the same turn:
  the tab keeps the reign and its moves (sessionStorage, by family, account and reign) and the page plays them again.
  Closing the tab lets it go, and so does "Leave the reign", which asks first once a move is made: leaving ends the
  reign, and an unfinished reign never counts. The link to Information needed opens in a new tab, so the game stays.
- **Today** shows a small card: "You are 2nd of 5 this week", or an invitation to a first reign.
- **Practice:** any house, on a fresh continent laid out in your browser. It is never counted and nothing is stored, not
  even in the tab: a reload lays out a new one.
- **A demo and a steward's "View as"** can play this week's field, but the reign is not sent or counted; the page says so.

## Rulesets

Changing the map or a rule changes what a score means, so the rules have a version: `RULESET` in
`src/lib/campaign/engine.ts`. A field says which rules it was laid out for (`map.v`), and so do the stored reigns and
weeks (`campaign_run.ruleset`, `campaign_week.ruleset`, tree migration 0035).

| Ruleset | What it was |
| --- | --- |
| 1 | The map made from the family's own places; plains, forest, highland and towns. Everything played before migration 0035. |
| 2 | The invented continent; marsh, rivers, mountain ridges and sea lanes; two free towns. |

- **Scores are only compared within one ruleset.** The weekly table, the all-time list, the houses' totals, "your best"
  and your place count reigns of today's ruleset alone.
- **Earlier reigns stay.** Reigns of an earlier ruleset are listed apart under "Under the earlier rules" (this week's in
  the weekly view, the ten best in the all-time view), with a note that they are never ranked with today's.
- **A week that straddles the change** gets today's field: the first reign begun after the upgrade lays the week's
  continent out and puts it in the week's place; the reigns already played keep their own copy of the old field.
- **A reign in progress under earlier rules cannot be continued.** One kept in the tab is let go with a short message
  ("The Campaign has a new map"); the server refuses to count one begun before the change (`campaign.err.old_rules`).

When you change a rule or the generator in a way that changes scores, raise `RULESET` and add a row here. No migration
is needed for that: the columns are there.

## Seasons of old

The Campaign used to be one long shared game: 28-day seasons, three orders a day, played overnight by regents. When a
family's server is upgraded, a season still running is closed once (on the first visit to the page, or when a steward
switches the game) with its standings as they stood, and every past season is shown read-only as **Seasons of old**. The
nightly job, the push "a province of your house has fallen", the chronicle and the daily orders are gone.

## How it runs

- **One engine.** `src/lib/campaign/engine.ts` holds every rule and is pure: it reads no clock and no database, and
  draws every random number from a seed. The browser plays with it, and the server replays with it. The continent
  (`geography.ts`), its names (`names.ts`) and a reign's chronicle and title (`chronicle.ts`) are pure in the same way.
- **The board** is plain SVG and CSS, with no library: `src/components/campaign/CampaignMap.tsx` draws the map,
  `drawing.ts` holds its geometry (flowing outlines, the coast, where the little pictures stand, the phone's camera),
  `Board.tsx` plays the scenes, and `campaign.css` holds every animation behind `prefers-reduced-motion`. The map keeps
  its parchment in every theme, a little dimmer at night.
- **The server never takes a score.** "Begin a reign" (`startCampaignRun`) stores the reign (account, name, side, week,
  seed, and the field with the renown and the quiz's reward as they were then) and returns what the browser needs. At the
  end the browser sends the list of moves (`finishCampaignRun`); the server plays them again from the stored field and
  keeps the score that comes out. A move the rules refuse, a list that stops early, someone else's reign or a reign
  finished before is refused.
- **The seeds.** The week's field is laid out from an HMAC of the family's id and the week under the server's secret
  (`KINDRED_SECRET`, or the `secret` file on Node), so nobody can work out next week's field. A reign's dice come from an
  HMAC of the reign's own id under the same secret, fixed when the reign begins, so a reign begun again meets other dice.
  A Worker without `KINDRED_SECRET` ranks no reign: "Begin a reign" says the server has no secret, and practice still
  works. The seeds never fall back to a public value.
- **An honour board, not a referee.** The weekly table is the family's honour board. The server rejects every score it
  cannot replay from legal moves, and the daily quiz's reward is given to one reign a day, but the dice are in the
  browser's hands once a reign begins: a determined player with a modified browser could look at them in advance and
  choose their moves by them, or begin reigns until the dice favour them. That is enough for a family; it is not meant
  to stop a determined cheat.
- **For other features:** `<CampaignCard tree={…} />` in `src/components/campaign/CampaignCard.tsx` is a small card that
  fetches its own data and renders nothing while the game is off. `quizRewardOn(tree)` in
  `src/lib/campaign/campaign.server.ts` says whether a right quiz answer earns the levy (the game reads the answer itself
  when a reign begins).

The numbers are in `RULES` in `src/lib/campaign/engine.ts`. They were checked by letting regents play every side,
including yours, on eighty continents (`engine.test.ts`, "a reign between regents"; `CAMPAIGN_STATS=1` prints the
figures): with renown 1 the median score is about 43 and the middle 80% fall between about 14 and 81; the leader after
turn 11 is still the leader after turn 12 in about four reigns of five, and the lead changes hands about three times a
reign; no seat falls, and no place at the table is the lucky one (the four sides' mean scores lie within about twelve
points of each other).

## What is stored

Two tables in the family database: the reigns, `campaign_run` (migration `tree/0032_campaign_run.sql`), and each week's
field, `campaign_week` (migration `tree/0034_campaign_week.sql`, which names nobody), each with its `ruleset` (migration
`tree/0035_campaign_ruleset.sql`); and the five of
the old shared game (migration `tree/0025_campaign.sql`): the switch, the seasons with their result (the hall of fame),
and the old member rows, chronicle and push claims, kept as they were. See [data-model.md](data-model.md). A reign names
the member by their account id and keeps the name they had then. When a member leaves, their reigns are deleted, with
their lines in the tables. See [roles-and-privacy.md](roles-and-privacy.md), "The Campaign".
