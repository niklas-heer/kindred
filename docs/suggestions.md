# Suggestions from the family

Anyone in the family can say "this is wrong" or "you are missing someone" without being able to edit the tree. A
**suggestion** is a proposed change that waits until an editor approves or declines it. Until then it is not part of the
tree: it is not in the tree, the feed, the history, the exports or the assistant's answers. Making, attaching a file to and
withdrawing a suggestion write no record and no history. Only an approval changes the family's records.

## Who suggests and who reviews

| Who | What they can do |
| --- | --- |
| **Viewer** and above (every member) | Suggest, from **Suggest a change** on a person's page; see their own suggestions on the **Suggestions** page and what became of them; withdraw their own while it waits (this needs only membership, so it works even if their role changed) |
| **Guest of a share link** | Suggest too, while the family allows it (below); see their own, in the same browser |
| **Editor** and above | Review: see every waiting suggestion and every pending file, approve (as suggested or adjusted) and decline |
| **Steward** | Switch guests' suggestions and files on and off |

A member has at most **50** waiting suggestions. A guest's network has at most **20** waiting per share link, and a link at
most **100**.

## The four kinds

| Kind | What it can change |
| --- | --- |
| **A person's facts** | Given name, surname they go by now, surname at birth, nickname, title, sex, living, birth and death date and place; each to a value or to none. Only the fields it changes are kept. A suggestion that changes nothing is refused |
| **A missing relative** | A person to add (given and further given names, surname, sex, born, died, living) and how they link to the person: parent, child, partner or sibling |
| **A life event** | A new event (a custom one needs its own name), or the correction of an event's date, place or note, or of a couple's kind, start and place |
| **A source** | A source to add (title, author, publication, reference, and the fact it backs), with files |

Every suggestion may have a **note** of up to 1000 characters. Dates, sex, names, places and event types follow the same
rules as the edit forms, and each suggestion is checked against the record as it is when it is made.

## Guests and living people

A steward decides in the family's settings whether **guests may suggest** and whether **guests may attach files** (both on by
default). A guest gives a name (up to 60 characters) with their first suggestion, and it stands for the next ones. A guest is
known only by a cookie (`kindred_voter`, the one the family's votes use), made when they make their first suggestion, so they
see their own suggestions in the same browser and nowhere else.

A share link that **protects living people** ([roles-and-privacy.md](roles-and-privacy.md)) allows its guest no suggestion on
or about a living person: such a person is refused exactly as one who is not there, so the refusal tells nothing. A relative
a guest suggests is never living, and neither is anyone a couple they correct joins. If a person is marked living after a
guest suggested something about them, the guest no longer sees the suggestion or its files.

## Files

A suggestion may carry up to **5** files, each up to **10 MB**, pictures (JPEG, PNG, WebP) or PDFs whose bytes agree with their type.
HEIC is not taken, because it keeps its location data; a phone's picker sends JPEG. A picture's metadata (location, camera) is
taken out when it is attached.

- **Pending**: a file is stored under `suggest/` and counts against the family's storage. Only editors and stewards, and the
  suggester while it waits, can open it. The family's pending files may total at most 200 MB.
- **Approved**: the files move to `source/` and become the files of a source (the one suggested, or one made for the change,
  which cites the facts it changed). Sources and their files are for members only.
- **Deleted** when the suggestion is declined, expires or is withdrawn, and when an approval is closed as partly applied.
- **Stray files**: deleting a person or a source deletes its rows but not the stored objects. The daily `suggestions` job deletes
  an object under `suggest/` or `source/` that no row names, but only once it is **30 days old**, so an upload whose row is about
  to be written and a restore that brings old rows back are both safe.

## Approving

An editor opens **Suggestions** (the count of waiting ones is on the navigation) or a person's page. Each suggestion shows the
record's values next to the suggested ones, "current to suggested".

- **Adjust**: the editor may change the values before approving. The history then says it was approved with changes.
- **Matches**: for a missing relative, Kindred shows people already in the tree who may be the same person. Choosing one links
  them as suggested and adds only the facts they lack; otherwise a new person is added.
- **Changed since**: a correction rests on the values the suggester saw. If the record has moved on since, other than to the
  suggested value, approving is refused ("changed") and nothing is written; the editor reads it again and decides.
- **Who the change is credited to**: an approval is written through the same paths as the edit forms, under the editor's role
  and checks, as the editor's change, and the history says **suggested by** the suggester. A person whose processing is
  restricted ([gdpr.md](gdpr.md)) is not changed.
- **Partial approvals**: an approval runs in steps (a person's facts, then a link, then the source, and last the files), each
  safe to repeat. If it stops half-way, approve it again to finish it; a suggestion whose approval changed records cannot be
  declined or withdrawn. If a later step can no longer be written (the fact it cites was deleted meanwhile, the person is
  restricted), an editor **closes it as partly applied**: what was written stays, the rest is not applied, and its files are
  deleted.
- **Two reviewers** may open the same suggestion. Their steps carry the same retry keys, so the second reviewer's approval
  replays what the first wrote instead of writing it twice. Once a step is written, the approval finishes with the decision it
  was begun with; the other reviewer is told to reload.
- **Decline** takes an optional reason (up to 300 characters), which the suggester sees.

## The suggester's view and outcomes

A suggester sees what they wrote, its state (**waiting**, **approved**, **approved with changes**, **approved in part** after a close as partly applied, **declined** with
the reason, **expired**) and its files. They never see the record's values or who decided. A decided suggestion stays in their
list for **90 days** after it was decided; a withdrawn one goes at once. A member also finds the outcome in **What's new**.

A waiting suggestion **expires after 90 days**, when the daily job marks it expired and deletes its pending files. One that is
partly applied is left for an editor to close.

## Settings

| Setting | Who | Default |
| --- | --- | --- |
| **Guests may suggest** | Steward, Access | On |
| **Guests may attach files** | Steward, Access | On |
| **Suggestions to review** (a device's push) | Each member whose role may review | Off |

No `KINDRED_*` setting is involved: the two switches are the family's own.

## Pushes

A reviewer may turn on **Suggestions to review** for a device, with the other reminders. The push is sent when a suggestion is
made, never by a daily job, and says only **how many** are waiting: no name, person or content. A device is told at most once
every 6 hours however many suggestions arrive. It is never sent to someone who is no longer a member or whose role cannot
review, to a device unopened for 35 days, or to the suggester themselves, and a push that fails never fails the suggestion.

## Retention and privacy

| What | Where it is | How long |
| --- | --- | --- |
| A member's suggestion | the family's database: kind, person, values, note, status, reason, dates, the name shown and the person they stand for | with the family's records, like a story or a post |
| A guest's suggestion | the same, with the **name they gave**, a **hash of their cookie** (different in each family), the share link and a **network value** (18 bits of an HMAC of the network under the server's secret; never the address, and it cannot be matched back to one) | with the family's records; a guest sees it for 90 days after it was decided |
| Files | media storage, under `suggest/` while pending, `source/` once approved | pending files are deleted on decline, expiry, withdrawal or closing; approved files are a source's |

- **Deleting a member's account** ([gdpr.md](gdpr.md)): their suggestions, waiting ones too, are kept (they may hold a fact the
  family wants) under **A former member**: the account id becomes a random pseudonym, the person they stood for in the tree is
  cleared, and so is their name where they decided one. Their files stay with a waiting suggestion. A guest's suggestion is not
  tied to an account, so nothing changes with an account's deletion.
- **A member's data request** lists their own suggestions (kind, person, values, note, status, reason and dates) and the names of
  their files; not the record's values beside them, nor who decided.
- **Erasing a person** ([gdpr.md](gdpr.md)): the suggestions about them are deleted with them, and so are their files in storage
  at once, not left to the sweep. Their full name in other suggestions' notes and values is replaced.
- **Exports** ([exchange.md](exchange.md)): suggestions and their files are not in the Markdown archive, GEDCOM or the nightly
  archive; each says how many are left out.
- Backups keep suggestions like everything else ([gdpr.md](gdpr.md#backups-and-the-nightly-archive)).
