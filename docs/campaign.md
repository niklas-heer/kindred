# The Campaign

A game you play alone, as your own house, on a map made from the family's own places. Each week the whole family plays the
same field, and a table shows everyone's best. It rewards the research: a house whose people are well recorded raises
more troops.

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
- **The map** has 16 provinces, taken from the places most of the family's people are linked to, laid out by their
  coordinates and eased apart. A family with fewer places gets invented marches. Provinces that share a border are
  neighbours.
- **The opening:** every side holds its **seat** (a place of its own people where the map has one, marked with a crown)
  and one neighbour. The rest are free marches with a small garrison. A seat can never be attacked, so nobody is ever out.

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
     troops go (− and +, or "All"), and for an attack the exact chance, such as "4 against 2 · Forest (defender +1): 61%".
   - **Confirm** with the bar's button ("March with 4 troops", "Attack with 4 troops"). Nothing moves before that.
   - **Back**, Escape or a press on the sea goes one step back. Pressing another province of yours chooses that one
     instead. A press on any other province only shows what it is.
   - A march can be undone until you end the turn (back to your last battle). A battle cannot: its dice have been rolled.
     Undo closes an open order bar, since the province may spare fewer troops after it.
   - While the order bar is open, its button is the one gold button; "End the turn" is a plain one beside it.
3. **End turn.** The regents move. Their attacks are shown one after another on the map ("Skip" ends that), and listed
   under the orders. Then the next turn's levy arrives.

The map and the list show the same provinces and work the same way. On a phone the order bar stays at the bottom of the
screen.

### Battles

At most three rounds of Risk's dice: the attacker rolls up to three, the defender up to two, the highest are compared
pair by pair, and a tie goes to the defender. If the defenders are gone, the survivors move in (as many as the province
holds; the rest go home); otherwise they fall back. Three rounds take at most six defenders, so a large garrison needs
more than one attack. The chance the order bar shows is exact: every roll of every round is counted.

### Terrain

Each province has one kind of game terrain, dealt for the game and labelled so: it is not the real country. Each has one
rule, a hatching on the map and an icon, and the legend under the map lists them.

| Terrain | Share | Rule |
| --- | --- | --- |
| Plains | about 45% | No special rule. |
| Forest | half of what is left | The defender's highest die counts one more (six at most). |
| Highland | the other half | The attacker rolls two dice at most. |
| Town | every seat, and the most-peopled real place | One more troop of levy a turn, room for 12 troops instead of 10, and it counts double in the score. |

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

## The week's challenge

- **The same field for everyone:** the map and the opening come from the family and the ISO week (Monday to Sunday,
  UTC). The first reign of a week stores that field (`campaign_week`), and every later reign that week reads it back,
  even when the family's places change, a member leaves, or two first reigns begin at the same moment. Next week brings a
  new one. The dice are each reign's own, so playing the week again is a new game on the same field.
- **Play as often as you like.** The table has three views: **This week** (each member's best, with their count of
  reigns), **All time** (the ten best reigns ever), and **Houses** (each house's total: the sum of its members' bests this
  week, by the house each one ruled).
- **Today** shows a small card: "You are 2nd of 5 this week", or an invitation to a first reign.
- **Practice:** any house, on a fresh field dealt in your browser. It is never counted and nothing is stored.
- **A demo and a steward's "View as"** can play this week's field, but the reign is not sent or counted; the page says so.

## Seasons of old

The Campaign used to be one long shared game: 28-day seasons, three orders a day, played overnight by regents. When a
family's server is upgraded, a season still running is closed once (on the first visit to the page, or when a steward
switches the game) with its standings as they stood, and every past season is shown read-only as **Seasons of old**. The
nightly job, the push "a province of your house has fallen", the chronicle and the daily orders are gone.

## How it runs

- **One engine.** `src/lib/campaign/engine.ts` holds every rule and is pure: it reads no clock and no database, and
  draws every random number from a seed. The browser plays with it, and the server replays with it.
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
including yours, in hundreds of reigns (`engine.test.ts`, "a reign between regents"): with renown 1 the median score is
about 41 and the middle 80% fall between about 11 and 78; the leader after turn 11 is still the leader after turn 12 in
about seven reigns of ten, and the lead changes hands about three times a reign; no seat falls. A side with renown 2
against regents without wins about two reigns in three, one with renown 0 about one in five.

## What is stored

Two tables in the family database: the reigns, `campaign_run` (migration `tree/0032_campaign_run.sql`), and each week's
field, `campaign_week` (migration `tree/0034_campaign_week.sql`, which names nobody); and the five of
the old shared game (migration `tree/0025_campaign.sql`): the switch, the seasons with their result (the hall of fame),
and the old member rows, chronicle and push claims, kept as they were. See [data-model.md](data-model.md). A reign names
the member by their account id and keeps the name they had then. When a member leaves, their reigns are deleted, with
their lines in the tables. See [roles-and-privacy.md](roles-and-privacy.md), "The Campaign".
