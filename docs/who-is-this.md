# Who is this?

A gallery fills with photographs faster than anyone tags them. "Who is this?" turns the untagged ones into a short game
for members: one photograph at a time, tap a face if you like, then say who it is, or "I don't know", or Skip. A few
photographs make a round; "More photographs" deals the next few. Each name given is a proposal, and the family's
records only change when a second person agrees.

It is called "Who is this?" in the three languages ("Wer ist das?", "Wie is dit?").

## Where it is

- **On Today**, as a card beside the feed (and a button in the phone's strip), while there is a photograph for the reader
  to answer or a proposal waiting for them.
- **On its own page**, `/<family>/who-is-this`, with more room for the photograph. The Gallery and the Needed page link
  to it while it has something for the reader.

## What a round shows

A photograph is in the game while nobody is confirmed in it (a suggestion of the AI face finder does not count). A member
is not shown a photograph again after naming someone in it or answering "I don't know". A skipped photograph comes back
after the ones the member has not seen, and never twice in a row: what a visit has shown is not dealt again in that visit.
The newest uploads come first. The caption and the year it was taken are shown as hints. Pictures uploaded for a post
that was never made are never shown.

## From proposal to tag

The rule, in one sentence: **a proposal becomes a tag when someone who may tag photographs agrees, and that someone is not
the member who proposed it.**

- Any member may play and propose, viewers too. A proposal is not a tag: nobody sees it in the gallery, on a person's
  page or in the history.
- "Someone who may tag photographs" is the gallery's own right (`upload-photo`: Contributor, Editor, Steward), so the
  game gives nobody a power they did not have. A contributor or editor who names someone first still makes a proposal:
  the game asks for a second opinion, and the gallery is still there to tag directly.
- Agreeing is one of two things: naming the same person in the same photograph while playing, or pressing **Confirm**
  in "Waiting for your confirmation", the list the card and the page show such a member. **Not right** sets every open
  proposal of that person in that photograph aside.
- A viewer naming the same person as another member adds a second proposal: the confirmer sees "Gramps, named by Ada,
  Bo".
- A tag made this way is credited to the first member who named the person, by the name they had then: the lightbox
  says "Named by Ada". The tag is at the face that member tapped (or the agreeing member's, or the whole photograph when
  nobody tapped one). When the AI face finder had already suggested that person in the photograph, its box is confirmed
  instead of a second one being added.
- Confirming writes the tag through `once` with an `added` history row of kind `tag`, made by the confirming member, so
  it appears in History and anywhere the history is read. If someone tagged the person in the gallery meanwhile, the
  proposal is closed as confirmed and nothing else is written.

## The small count

The card says "You named 7 people this month. 5 of them are confirmed." for the calendar month (UTC). There is no
leaderboard.

## Who sees what

- **Members only.** Every server function needs a membership (`requireMember`); confirming and declining need
  `upload-photo` (`requireCan`). A share-link guest gets no card, no page (the layout sends them back to the tree) and no
  answer from the server, and the gallery does not tell a guest who named someone.
- **Demo and View as:** the game is dealt and played, and nothing is kept. An answer says "Nothing is kept here", and
  Confirm in a preview does the same.
- **Protecting living people** is unchanged: it governs what a guest gets, and a guest gets nothing of this. Members see
  the photographs and the people they already see in the gallery.

## What is stored

Tree migration `0033_who_is_this.sql` (see [data-model.md](data-model.md)):

- `tag_proposal`: one row per member, photograph and person named: the box tapped, the member's account and name, and
  whether it is `open`, `confirmed` or `declined`, by whom and when.
- `tag_pass`: a photograph a member answered "I don't know" to (`unknown`) or skipped (`skip`).
- `media_person.named_by`: the name of the member a confirmed tag came from.

`tag_proposal` and `tag_pass` are the game's: they name members by account id, write no history, are in no export and
are left out of the D1 transfer. A confirmed tag is an ordinary `media_person` row and travels with the family.

## For developers

- `src/lib/whois/rules.ts` is the rule (`mayConfirm`, `onNaming`), plain code with its tests in
  `src/lib/whois/whois.server.test.ts`.
- `src/lib/whois/whois.server.ts` deals a round, keeps an answer and decides a proposal; `whois.functions.ts` are the
  server functions. The card and the page are `src/components/whois/WhoIsThis.tsx`; the page is
  `src/routes/$tree/who-is-this.tsx`.
- The Playwright journey is `e2e/25-who-is-this.spec.ts`.
