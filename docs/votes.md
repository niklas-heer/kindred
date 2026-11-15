# Votes

Sometimes the family has a question: where to meet next summer, which cake, who gives the speech. A vote lets any
contributor ask it, lets everyone answer in their own time, and says plainly what came out. It lives on the **Votes**
page of a family and in the feed.

## Single and ranked

- **Single choice**: each person picks one option. The option with the most ballots wins, and a tie is shown as a tie.
- **Ranked choice**: each person puts some or all of the options in order. The count is an *instant runoff*. Each round
  counts every ballot for its highest-ranked option still in the running. A ballot whose options are all out is
  *exhausted* and leaves the count. An option with more than half of the ballots still in play wins. If nobody does, the
  option with the fewest ballots drops out and the next round counts again. A tie for last place is broken by the
  previous round's counts, going back to the first. If they are still tied, all of them drop out, unless that would leave
  nobody: then the vote ends in a tie between them. A closed ranked vote shows each round.

The count is never stored. It is worked out from the ballots each time a vote is read, so a struck ballot or a changed
choice is always reflected, and a closed vote's result stays fixed because its ballots no longer change.

## Open and secret

Chosen when the vote is started, and it cannot be changed after the first ballot.

| | While open | After closing |
| --- | --- | --- |
| **Open** | Options, your own ballot, how many have voted. Once you have voted (vote first, then see), the tallies and each member's ballot with their name and face. | The result and each member's ballot. |
| **Secret** | Options, your own ballot, and who has voted, sorted by name, so people can nudge whoever is missing. **No tallies**: with live tallies, a small family could watch a name appear in the list and an option go up by one. | The result. Never who chose what. |

**What "secret" means.** It is hidden from the family: no member, steward or editor can see who chose what. It does not
mean Kindred's server cannot: the server stores the ballots in order to count them. A ballot is stored under a key made
from the vote, the voter and a secret that is held by the server and kept out of the family's database. So the database and
a steward's backup list *who* voted and *what was chosen*, but never which is whose. The operator, who has both the
database and the server's secret, could still link them. After a move to a server with another secret, the ballots of a
secret vote still count, but their voters can no longer change them.

## Adding options

A vote's creator may allow members to **add options**. Contributors and above may; viewers and guests may vote but add
no text, because viewers write no free text anywhere in Kindred and a guest's text would reach the family under a name
nobody checked. A vote has 2 to 20 options of at most 120 characters, each different from the others.

## Closing time

A vote closes at a time its creator picks: **7 days** from now by default, from **1 hour to 90 days**. After the first
ballot the creator may still move it later or earlier (never into the past) and may close it early. An editor may close or
remove anyone's vote. A vote past its closing time reads as closed straight away, whether or not anything has marked it.

## Changing a vote

Until the first ballot, its creator may change the question, the description, the rules and the options. Saving a new list
of options **replaces** the old one: options other members added are dropped if the creator leaves them out. After the
first ballot only the closing time changes.

## Guests

A guest of a share link may take part only in a vote that **allows guests** (off by default). A guest sees the vote's
options, their own ballot, how many have voted and the result, but never who voted or what any member chose, and never
another guest's name. Comments and reactions stay for members.

- To vote, a guest gives a **name** (1 to 60 characters) and is told it is shown to the family's members, beside their ballot
  in an open vote or in the list of who has voted in a secret one. Other guests never see it.
- The server sets a `kindred_voter` cookie when the guest votes. Only its hash is stored, and it lasts 90 days or until the
  link ends. It is set only because the guest asked to vote, so it needs no consent banner.
- The browser remembers the name the guest gave in its local storage, under `kindred:vote-guest-name:<family>`, so the next
  vote is one tap. It stays in that browser and is sent only when the guest votes.
- No address is kept. To limit abuse the server counts guest voters per vote by an 18-bit hash of the network: at most
  **12 per network** and **40 per link**, per vote.
- Members see guests marked as guests. A **steward** may *strike* a guest's vote while the vote is open (a duplicate, say):
  it stops counting and shows as struck to stewards, and can be restored. In a secret vote the steward strikes from the list
  of who has voted and never sees the choice. A closed vote's result does not change. Replacing or turning off the link
  leaves the guests' ballots as they were; no new ones arrive from the old link.

## In the feed and as pushes

The feed gets an entry when a vote **starts** ("Ada asked the family: Where do we meet next summer?") and one when it
**closes** ("Where do we meet next summer?: Beach"). Only members see them; a guest reads no feed. See [feed.md](feed.md).

A device switch under Reminders, **A new vote, and a reminder before it closes**, is off until turned on:

- a push when a vote starts, at most one in **6 hours** per device, never to the creator's own devices;
- **one reminder** for a vote that closes within the next 24 hours, to a member who has not voted. It comes from the daily
  job (`votes`), so a vote started after a day's run that closes before the next one gets none, and a closing time moved
  later gets no second reminder.

Pushes name the question, never a ballot or the tally of a secret vote. Who has voted is read from the list of voters, never
from a ballot. A demo and a steward's *View as* send nothing.

## Exports and data requests

- The **Markdown archive** has `votes/<year>.md` ([exchange.md](exchange.md)): each vote with its question, options and,
  once closed, its result. A closed open vote lists each ballot by name. A secret vote lists only its totals and who voted,
  never who chose what. A vote still open gets no result, so the archive is no way around the secret tallies. GEDCOM has no
  votes.
- The **steward's backup** and the **D1 transfer** copy the vote tables. A secret ballot carries only its key, so neither
  ties it to a voter.
- A member's **data request** (*Your data*) lists their own ballots, a secret one's too: the server finds it through the
  key only it can compute.
- A member who leaves keeps their ballots: they still count, under the name they had, as comments do.

The tables are in [data-model.md](data-model.md) (migration `tree/0037_votes.sql`; `accounts/0060_vote_push.sql` adds the
push switch), who may do what in [roles-and-privacy.md](roles-and-privacy.md).
