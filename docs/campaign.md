# The Campaign

A slow, friendly game between a family's houses, on a map made from the family's own places. It is there to give
relatives a reason to come back, and it rewards the research: a house whose people are well recorded raises more troops.

It is only a game. It never changes the family's records, it is off until a steward turns it on, share-link guests never
see it, and it is left out of every export.

## Turning it on

A steward opens **Games** (account menu, or More on a phone) and turns on "The Campaign is on for this family". The first
season starts at once, and a **Campaign** section appears in the navigation for every member. Turning it off hides the
section and stops the game: nothing is played while it is off, and the season's calendar keeps running, so the regents
play the missed nights when it is turned on again. "End the season now" closes the season on the spot.

Members of every role can play, viewers too. The **practice skirmish** needs no switch: it runs in the browser against
regents, stores nothing, and is over in ten turns.

## The rules

- **The map** has four provinces for each side (10 to 24), taken from the places most of the family's people are linked
  to, laid out by their coordinates and eased apart. A family with fewer places gets invented marches. Provinces that
  share a border are neighbours.
- **The sides** are the family's six largest houses. A smaller house fights beside the house it is nearest to by
  marriage, or sits out. A family with fewer than three houses plays against regent companies.
- **Who fights for whom:** a member fights for the house of the person they stand for. A member who stands for nobody
  in a house chooses one, once a season.
- **The opening:** every house holds its seat (a place of its own people where the map has one) and one neighbour. The
  rest are free marches with a small garrison. A seat can never be attacked, so no house is ever out of the game.
- **Orders:** every member gets 3 a day, and they save up to 6. *Muster* places up to 5 troops of the house's waiting
  levy on a province it holds. *March* moves troops to a neighbouring province of the house. *Attack* sends troops
  against a neighbour. One troop always stays behind, and a province holds at most 10.
- **A battle** is at most three rounds of Risk's dice: the attacker rolls up to three, the defender up to two, the
  highest are compared pair by pair, and a tie goes to the defender. If the defenders are gone the survivors move in;
  otherwise they fall back. A battle cry of up to 80 characters can go with an order.
- **The levy** arrives each day: 2 for every house, up to 2 more for **renown**, and 1 more for each province the house
  trails the leader by (up to 2). Holding more land brings no more levy.
- **Renown** (0 to 100) is the share of a house's people with a portrait, with dates, with a birthplace, and with
  memories (and, once the app records them, life events and sources). From 30 points it adds one troop a day, from 60
  two. The page shows the parts and what would raise them, with a link to "Information needed". It counts what is
  recorded, never what it says: no number comes from a lifespan, a cause of death or a count of children.
- **Regents:** a regent plays a house on every day none of its members gave an order. It musters, attacks once at
  most, and never does anything a member could not.
- **A season** lasts 28 days. The house holding the most provinces (then the most troops) takes the laurel in the hall
  of fame, and a new season starts on a fresh map.

These numbers are in `RULES` in `src/lib/campaign/engine.ts`. They were set by letting regents play some thousands of
seasons: the winner ends with about a third of a four-house map, about two provinces change hands a day, and the lead
changes several times after the first week.

## How it runs

- **One engine.** `src/lib/campaign/engine.ts` holds every rule and is pure: it reads no clock and no database, and
  draws every random number from a seed. The server and the practice skirmish both use it.
- **Dice are the server's.** A browser sends an order (`giveCampaignOrder`), never a result. The server checks who the
  member fights for and how many orders they have, makes the seed, rolls, and writes the new position, the member's
  count and the chronicle entry in one batch with guards, so two requests cannot spend the same order. The seed is kept
  with the battle. The same retry key returns the same battle.
- **Days are UTC days, and nothing runs on its own timer.** Opening the game, or the daily job (`campaign`, see
  `src/lib/jobs/campaign.ts`), plays every night that has passed, in order. The regents draw from the season's seed, so
  a night comes out the same whoever plays it, and requests that arrive together play it once. A server with
  `KINDRED_JOBS=off` still plays correctly; the nights are just played when someone next looks.
- **Push.** A member with reminders on gets at most one message a day, when a province of their house falls. It needs
  the same VAPID keys as the reminders.
- **For other features:** `grantOrder(tree, accountId, reason)` in `src/lib/campaign/campaign.server.ts` gives a member
  one extra order (at most one a day, whatever the reason; nothing while the game is off). `<CampaignCard tree={…} />`
  in `src/components/campaign/CampaignCard.tsx` is a small card that fetches its own data and renders nothing while the
  game is off.

## What is stored

Five tables in the family database (migration `tree/0025_campaign.sql`, see [data-model.md](data-model.md)): the switch,
the seasons with their map and position, each member's orders, the chronicle, and the push claims. Members are named by
their account id, and the chronicle keeps the name they had. The last two seasons keep their chronicle; older seasons
keep only their result. See [roles-and-privacy.md](roles-and-privacy.md), "The Campaign".
