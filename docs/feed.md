# The family feed

Kindred records the dead well. The feed is for the living: a place for "we have moved", "she passed her exam" and
"photos from Sunday". It is the main part of the [Today](today.md) page, and each visit to it passes the tree on the way.

It is for members. A share-link guest gets no feed, no post and no composer, on the server and in the browser.

## A message

A post is called a **message** on the page. It is a short text from one member to the family:

- plain text of at most 4,000 characters. Line breaks are kept, and an address that starts with `http://`, `https://` or
  `www.` becomes a link (opened in a new tab, with `rel="noopener noreferrer"`). Nothing else is formatting: the text
  is written as text, never as HTML;
- up to six pictures;
- the people from the tree it is about, if any (at most twelve). The message then also shows on each of their pages,
  under their stories.

A message may be pictures alone. A member writes at most twenty in an hour.

| Who | May |
| --- | --- |
| Viewer | read the feed, and react to messages |
| Contributor | also write messages, change their own, and comment |
| Editor, steward | also remove anyone's message |

Everyone may remove their own message, whatever their role is now. Nobody changes another's, an editor included.
Reactions and comments are the ones memories and photographs have ([responses.md](responses.md)): a message is a third
kind of thing they attach to, and they go when it is removed.

### Pictures

A message's pictures are gallery pictures. The composer sends each one through the gallery's own upload (scaled down
and stripped of its location data in the browser, checked again on the server, with a small copy for tiles), marked as
meant for a message from the moment it is stored, and then names them in the message. So each can be opened in the
gallery's window and tagged with who is in it, and is in the members' **Gallery** under "From messages". That is a view,
not an album anyone made: it has no name to change and cannot be deleted.

Only a picture uploaded this way, by the writer and for no other message, can be a message's: an older gallery picture
cannot. Removing a message removes its pictures from the Gallery and from storage, and the page says so before it does.
Like the message, its pictures write no row in the change history, coming or going.

A picture uploaded for a message is the members' from its first second: a guest's Gallery and a person's photos leave it
out, the server does not serve it or its small copy to a guest, research cannot link it and a source cannot cite it.

A picture uploaded for a message that is then not sent (the window closed, the message refused) is a leftover. Nobody
sees it, not even in the Gallery or the feed. The composer deletes its own leftovers when it closes or the message is
refused, and the daily job (`feed`) deletes any left older than a day, from the database and from storage.

### Not in the change history

A message is the family talking, not a record about someone. Writing, changing or removing one writes no row in the
change history. It is news all the same: "What's new" names who wrote since your last visit, the dot in the account
menu counts messages, the weekly push counts them, and comments and reactions on your message are listed with the
replies to your memories.

### When a member leaves

Their messages stay, with their pictures and the comments under them, signed with the name they were written under
and with the face of the person they stood for in the tree. Nobody can change them any more; an editor can remove
them. Their reactions go, as everywhere.

## The feed

One stream, newest first, under the days it falls on ("Today", "Yesterday", "Earlier this week", then the month):

- **messages**;
- **memories, sayings, recipes, notes and anecdotes** from the Chronicle, as the same card the Chronicle
  shows. An answer to the question of the week says that it is one;
- **photographs**: one member's uploads of one day to one album are one entry, with the newest few pictures. A
  message's own pictures are the message's and are not listed twice;
- **people added to the tree**: those one member added on one day, in one line. Someone born within a year of being
  added is welcomed in a line of their own;
- **updates to the records**: what one member did on one day, in one entry, person by person, each name a link to the
  person's page. "Ada updated Carl: has a new address, new phone number" for one person; "Ada updated 3 people:" with a
  short line for each (the first six, then "and 4 more") for more. It names what changed, never a value: contact details
  by their kind (a new address, phone number, email address, website or social media profile), other details by their
  name (born, birthplace, occupation…), life events and sources recorded, a new portrait, photos someone was tagged in,
  and sources about nobody in particular. A GEDCOM import is one line, however many people it brought ("Ada brought in
  500 people from a GEDCOM file"). Removals are not news here; the History page has them;
- **a season of the Campaign ending**, with the house that won;
- at the very top, **whose birthday or wedding anniversary it is today**.

Messages and events are in one stream, by the time they happened. Members react to and comment on an event as on a
message ([responses.md](responses.md)): people added, a day's updates, a birthday or an anniversary today (a new year's
is a new one).

Private research, editors' notes and Personal fields are in none of these. Updates come from the change history and are
read at its levels ([roles-and-privacy.md](roles-and-privacy.md#change-history-and-whats-new)): an update to something only editors read is in an editor's feed alone.
An address, which starts at the editors' level, is news to editors until it is shared with the family. A share-link
guest reads no feed at all, so no contact detail or event reaches one; "Protect living people" has nothing to hide from
a member.

Twenty entries come with the page. Earlier ones follow as you scroll for a few pages, then at the press of "Show
earlier", so the end of the page stays within reach.

### How a page is read

A page is one batch of reads in the family's database (one round trip on D1): posts, stories, gallery uploads, the
"person added" rows of the change history, the change history's other rows for updates (with each field's kind, joined
in the same read), and the Campaign's finished seasons, each limited, plus one read of the
accounts database for the writers' faces. There is no read per entry. Each source hands over its newest entries after
the page's cursor, and the page is the newest twenty of them together. The three sources that group rows by day (uploads,
people added, updates) read a window of rows (400, 120 and 400); when the window was full, the page ends where the window did, so a later page
never skips anything. A day on which one member uploaded more pictures than the window holds (400) is one entry that
says "more than".

## One composer

There is one window for writing. It writes a message, or, with "A memory of someone", a memory, saying or recipe: first
who it is about, then the form the person panel uses. The Today page opens it on the message, the Chronicle's "Add a
memory" on the memory. A memory written from either place is in the Chronicle, on the person's page and in the feed.

A reader who cannot write is told why in place of the button: a Viewer, a visitor of a [demo](self-host.md), and a
steward looking through a ["View as"](roles-and-privacy.md#view-as) preview.

## Being told

Reminders has one more switch for each device, off until it is turned on: **A new message from the family**. The push
says who wrote, never what. A device gets at most one in six hours, however many messages arrive; the others are on
the feed, in "What's new" and in the weekly push. The writer's own devices are not told, nor a device that has not been
opened for a long time, nor anyone who is no longer a member. A demo and a preview send nothing.

The existing answer push ("tell me when someone reacts to or comments on what I wrote or shared") covers messages too.

## Where it is kept

Three tables in the family database (migration `tree/0029_posts.sql`, see [data-model.md](data-model.md)): `post`,
`post_media` and `post_person`, and `media.for_post`, the mark of a picture uploaded for a message. `reaction` and `comment` take `post` as a third kind of target,
and `event` as a fourth (migration `tree/0030`), keyed by the event's own key. Events themselves are not stored: they are
read from the change history and the calendar each time. The device's switch is
two columns on `push_subscription` (migration `accounts/0029_post_push.sql`).

The Markdown archive carries the messages and their comments in `feed/`, one file per year
([exchange.md](exchange.md)); the pictures are the gallery's, which no archive holds. GEDCOM has none of it. The D1
transfer copies the three tables.

## The invented families

`mise run data` and the demo give the two invented families a feed: a dozen messages in the modern family with comments
and reactions, a few in the realm in its own voice, some gallery uploads, and in the modern family two updates of
contact details (a move's new address and phone number, a new work email), with the change history's rows for them. A seed has no accounts, so each of them
speaks as a person of the tree (an account written `seed:<person id>`, which the app reads as that person). No
photograph of anyone is in a seed: the pictures are painted by `scripts/lib/pictures.ts`. The feed is dated back from
the moment of seeding.
