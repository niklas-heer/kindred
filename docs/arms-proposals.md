# Coat-of-arms proposals

A house's arms used to be changed by a steward alone. Now any contributor can design arms and propose them, and the
family decides how proposals are settled: the steward decides, the family votes, or the steward chooses each time.
Proposals are for a house's **arms** only, never its name or motto.

## Who proposes

A **contributor** (and above) opens the designer on a house in *propose mode*: the same designer, with the house's name
and motto hidden, and the button **Propose these arms**. A proposal needs a **name** for the design (1 to 60 characters,
for example "The linden and the stag") and may have a **note** (up to 500 characters). The name is what the family sees in a
vote, so it must differ, in any case, from the name of every other open proposal for the house and from the vote's
**Keep our current arms** in every language. Arms equal to the house's current arms are refused.

A member has at most **3 open proposals per house** (waiting, or in a vote). Withdrawing or a decision frees a place. A
member may **withdraw** their own proposal while it waits, or while it is in a vote that has no ballot yet; this needs only
membership, so it works even if their role has changed since.

Every member sees a house's waiting and voting proposals (shield, name, note, proposer, date) on the house page, and their
own with their state: waiting, in a vote, accepted, declined (with the steward's reason, if one was given) or withdrawn.
Stewards also see a count on the Houses page.

## How a proposal is settled

A steward chooses the family's setting **How arms proposals are settled** (the setting acts when a proposal is made;
changing it later leaves votes that are running alone and gives waiting proposals the new mode's actions):

| Mode | A new proposal | What a steward can do with a waiting proposal |
| --- | --- | --- |
| **Steward decides** | waits | **Accept**, **Decline** |
| **Always a vote** | goes to the house's arms vote at once, or waits for the next one | **Decline**, **Put to a vote** |
| **Steward chooses each time** (default) | waits | **Accept**, **Decline**, **Put to a vote** |

- **Accept** (after the steward confirms it) gives the house the proposal's arms, as the steward saw them: if the house's arms changed meanwhile, or are
  frozen by a running arms vote, it is refused. A design equal to the current arms is refused too.
- **Decline** takes an optional reason (up to 300 characters) that the proposer sees. It is allowed while the proposal
  waits, or while its vote has no ballot.
- **Put to a vote** starts the house's arms vote, or joins the one that has no ballot yet (see below).

A second setting, **Guests may vote on arms** (on by default), says whether guests of a share link take part in arms votes.

## Arms votes

An arms vote is an ordinary [family vote](votes.md) with fixed rules, so every family member can read the same way what is
at stake:

- **Ranked** (instant runoff) and **secret**: nobody sees who chose what. It runs **7 days**.
- Its options are the proposals, shown as shields with the design's name, and always **Keep our current arms**, a snapshot
  of the arms when the vote started.
- **Guests** take part when the family's setting allows it.
- A house has at most one unsettled arms vote. A proposal **joins** it only before the first ballot, and only while it has
  fewer than **19 proposals** (20 options with Keep). Otherwise it waits. After the first ballot the options never change.
- **The house's arms are frozen** while its arms vote is unsettled: a steward cannot save different arms or Accept a
  proposal (the name and motto still save). The vote cannot overwrite arms saved after it started either.
- **Same arms** means the same design, as the designer draws it: older arms stored without a design are the same as the
  designer's drawing of them. So a save that only changes the name or motto is never frozen, and while a vote runs it keeps
  the stored arms exactly as they are, so the vote's Keep still matches them. A proposal or Accept of the arms the house
  bears is refused on the same comparison.
- **Chained votes in vote mode.** Each time a vote is settled, and on every daily run, a house that has waiting proposals
  and no unsettled arms vote gets a new vote: the oldest nineteen, with the proposer of the oldest as its starter. A
  proposal that came back from a removed vote (reason `vote_removed`) waits until a steward puts it to a vote. A waiting
  proposal equal to the house's arms by now is declined, not chosen.

### Settlement

When the vote closes (on time, or early by a steward) it is settled once, automatically, as the next read of the votes, a
house page or the daily job runs:

- **A proposal wins**: the house takes its arms. That proposal is *accepted*; every other one is *declined* ("not chosen").
- **Keep wins, nobody voted, or there is any tie**: the arms stay as they are, and every proposal is declined ("not
  chosen"). Their proposers may propose again.
- The change in the house's history is credited to **"the family's vote"**, never to whoever opened the page, and its label
  carries only the house's name, never a proposer's.

### What differs from an ordinary vote

- Only a **steward** closes an arms vote early, changes its closing time (the only thing about it that can change) or
  removes it. Whoever started it has no such right.
- **Nobody adds an option**: the options are the proposals.
- The **question** ("Which arms should House Birch bear?") and the Keep option are shown translated for each reader.
- A steward may still strike a guest's ballot while it is open, as in any vote.
- Removing an unsettled arms vote returns its proposals to waiting, with the reason `vote_removed`. Removing a settled one
  deletes only the vote; the outcomes and the house's arms stay.

## What guests see

A guest never sees a proposal list, a proposer's name or a note. In an arms vote that allows guests they see the options as
shields with the design's name, their own ballot, how many voted and the result, as in any vote.

## Limits

| What | Limit |
| --- | --- |
| Open proposals per member and house | 3 |
| Design name | 1 to 60 characters, unique among the house's open proposals and unlike Keep (any case) |
| Note | 500 characters |
| Decline reason | 300 characters |
| Proposals in one arms vote | 19 (and Keep) |
| An arms vote | 7 days |

## Retention and privacy

- A proposal stays with its house, whatever its state, until the house is deleted. Nothing expires.
- A member who **deletes their account** ([gdpr.md](gdpr.md)) keeps their proposals, shown as by "A former member": the
  account, the name beside it and the name of a steward who decided it are replaced by the deletion's pseudonym and
  "A former member", and the person they stood for in the tree is cleared, so no face of theirs is shown beside it. The
  design's name, the note and the arms stay.
- A member's **data request** lists their own proposals: the house, the design's name, the note, the state, the reason, the
  dates and the arms as JSON.
- The **Markdown archive** and GEDCOM do not hold proposals; their report lists them as "coat-of-arms proposals" among what
  is left out ([exchange.md](exchange.md)). The steward's backup and the D1 transfer copy `arms_proposal`.

The tables are in [data-model.md](data-model.md) (migration `tree/0038_arms_proposals.sql`); who may do what is in
[roles-and-privacy.md](roles-and-privacy.md).
