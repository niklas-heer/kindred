# Reactions and comments

Members can answer what the family shares: a memory (any story: a memory, a saying, an anecdote, a recipe or a note), a
photo in the gallery, a message in the family's feed, and an event of the feed: people added, a day's updates to the
records, a birthday or a wedding anniversary today ([feed.md](feed.md)). Under each one there is a small row of
reactions and a thread of comments. It is for members only;
a share-link guest sees none of it, not even the counts.

## Reactions

A reaction is an emoji, as in a chat. Under each memory, photo, message and event of the feed there is:

- the emoji given so far, each with how many gave it. Yours shows by its outline and fill as well as its colour, and a
  press takes it back;
- the quick row, the emoji most families reach for: ❤️ 😂 😮 😢 🙏 👏 🕯️ (a candle, for the one remembered). A press gives it;
- a "+" that opens the palette: the quick row again, the emoji you gave lately in this family (the same on every device),
  a search by name, and every emoji by category (smileys, people, nature, food, travel, activities, objects, symbols,
  flags). The search finds an emoji by its name or a keyword in your language and in English, so "Herz", "hart" and
  "heart" all find ❤️; accents are optional. Arrow keys move through the grid, Enter in the search gives the first found,
  Escape closes it.

Resting the pointer on an emoji, a long press on a phone, or moving to it with the keyboard says who gave it. An opened
thread says who gave which.

Every member, viewers included, can give each emoji once to a thing, and take it back; at most twelve different emoji
from one member on one thing. The server takes exactly one emoji as Unicode recommends it (one "RGI" emoji grapheme: a
flag, a family or a skin tone is one), and stores one written without its emoji presentation selector ("❤" from some
keyboards) as the full emoji ("❤️"), so one heart is always one heart. Anything else is refused.

The five named reactions of before became emoji (tree migration 0030): "With love" ❤️, "Made me laugh" 😂, "A candle in
memory" 🕯️, "Thank you for sharing" 🙏, and "I remember this" 💭, the thought balloon: a memory coming back, which no face
in the quick row says.

### Where the emoji come from

The palette asks nobody else for anything. Its data is the app's own: `src/lib/emoji/` holds the emoji (Emoji 15.0 and
older, so phones and computers of the last few years draw them; one form each, without skin tones; about 1,870) and their
names and keywords in English, German and Afrikaans. `scripts/emoji-data.ts` makes them from
[emojibase-data](https://emojibase.dev) 18 (MIT; English and German, from Unicode CLDR) and Unicode CLDR 49's
annotations (Afrikaans, which emojibase does not carry). Neither package is a dependency of the app; the files are
about 25 KB for the emoji and 95 to 110 KB for each language's names (5 KB and about 30 to 36 KB compressed). They load
only when a palette is first opened, with the palette itself: the page's own bundle carries none of it. The emoji are
drawn by the reader's own system font.

## Comments

Contributors, editors and stewards write comments: plain text, up to 1,000 characters, with its line breaks. Nothing in a
comment is read as Markdown or HTML, and links are not made clickable. The name on a comment is the writer's own name in
Kindred, never one the browser sends; when the writer stands for someone in the tree, that person's portrait is beside it.

- The writer can change their comment (it is then marked "changed") and remove it. Removing asks first.
- Editors and stewards can remove anyone's comment, and cannot change it.
- A member whose role is lowered to viewer can still remove their own comments, and no longer write or change them.
- A thread opens on its last five comments, with the earlier ones one click away.

## Where they show

- The Chronicle: every entry, sayings included, has the reactions and the comment count, and opens its thread in place.
- A person's Stories tab: under each story.
- The gallery: a tile shows its number of reactions and comments; the photo's own window has the reactions and the thread.
- The family's feed on Today, and a person's Stories tab: under each message and each memory; on Today also under each
  event, as a smaller row.

The counts for a whole page come from one request that makes two reads of the family database, however many entries there are.

## Telling the author

The person who wrote a memory or a message or shared a photo can be told when someone reacts to it or comments on it. It is off until
they turn it on, in the Reminders dialog ("Answers"), and it arrives on the devices where reminders are on for that family.
At most one such push a day, never for their own answer, and it says who answered and about whom, not the words. Stories
written before this feature, by the assistant or brought in by an import have no account as their writer, so nobody is
told about those. An event is the family's, not one member's: nobody is told about its answers. The push names the emoji
given ("Ada reacted to a photo you shared: 🕯️").

The family's "what's new" reads the `reaction` and `comment` tables for answers to what the reader wrote.

## What is kept, and where it goes

- A memory or a photo takes its reactions and comments with it when it is removed, also when a story goes with its person.
  Undoing the removal of a memory brings it back without them.
- A member who is removed from the family keeps their comments, under the name they wrote them with ("a former member" when
  none was kept). Their reactions go, and so do their opt-in for the answer push and their reminder devices for the family.
  Their portrait is no longer shown beside their comments. See docs/data-model.md, "When a membership ends".
- The Markdown archive has each story with its comments (`memories/`). GEDCOM has neither. Reactions and the comments on
  photos and events are in no export. The D1 transfer copies reactions and comments, and not the push choice.

See [data-model.md](data-model.md) for the tables (migrations `tree/0027`, `0029` and `0030`) and [roles-and-privacy.md](roles-and-privacy.md) for
who may do what.
