// The family feed: what the server says about a post (its errors, its line in "What's new"), the push about a new one
// and its switch (docs/feed.md). A post is called a "message" on the page.
// Keys are unique across every area. Add a key to en, de and af here, and use it as t('<key>').
// The push.* keys are used on the server, in the language each device registered with (src/lib/feed/post-push.server.ts).
import type { Message } from "../types.ts";

export const en = {
  "feed.news.posts": { one: "{author} wrote to the family", other: "{author} wrote {count} messages to the family" },

  "feed.push.title": "{name} wrote to the family",
  "feed.push.body": "Open {family} to read it.",
  "feed.push.toggle": "A new message from the family",
  "feed.push.toggle_hint": "Who wrote, never what. At most one every few hours on this device, however many arrive.",

  "feed.err.empty": "Write something or add a picture first.",
  "feed.err.long": "That is too long: a message has at most 4,000 characters.",
  "feed.err.pictures": "That is too many pictures for one message.",
  "feed.err.people": "That is too many people for one message.",
  "feed.err.person_gone": "Someone it is about is no longer in the tree.",
  "feed.err.picture_gone": "A picture could not be attached. Add it again.",
  "feed.err.too_many": "That is a lot of messages in one hour. Try again a little later.",
  "feed.err.post_gone": "This message is no longer there.",
} satisfies Record<string, Message>;

export const de: Record<keyof typeof en, Message> = {
  "feed.news.posts": { one: "{author} hat der Familie geschrieben", other: "{author} hat der Familie {count} Nachrichten geschrieben" },

  "feed.push.title": "{name} hat der Familie geschrieben",
  "feed.push.body": "Öffne {family}, um es zu lesen.",
  "feed.push.toggle": "Eine neue Nachricht aus der Familie",
  "feed.push.toggle_hint": "Wer geschrieben hat, nie was. Auf diesem Gerät höchstens eine alle paar Stunden, egal wie viele kommen.",

  "feed.err.empty": "Schreibe zuerst etwas oder füge ein Bild hinzu.",
  "feed.err.long": "Das ist zu lang: Eine Nachricht hat höchstens 4.000 Zeichen.",
  "feed.err.pictures": "Das sind zu viele Bilder für eine Nachricht.",
  "feed.err.people": "Das sind zu viele Menschen für eine Nachricht.",
  "feed.err.person_gone": "Jemand, um den es geht, steht nicht mehr im Stammbaum.",
  "feed.err.picture_gone": "Ein Bild konnte nicht angehängt werden. Füge es noch einmal hinzu.",
  "feed.err.too_many": "Das sind viele Nachrichten in einer Stunde. Versuche es etwas später noch einmal.",
  "feed.err.post_gone": "Diese Nachricht gibt es nicht mehr.",
};

export const af: Record<keyof typeof en, Message> = {
  "feed.news.posts": { one: "{author} het aan die familie geskryf", other: "{author} het {count} boodskappe aan die familie geskryf" },

  "feed.push.title": "{name} het aan die familie geskryf",
  "feed.push.body": "Maak {family} oop om dit te lees.",
  "feed.push.toggle": "’n Nuwe boodskap uit die familie",
  "feed.push.toggle_hint": "Wie geskryf het, nooit wat nie. Hoogstens een elke paar uur op hierdie toestel, maak nie saak hoeveel daar kom nie.",

  "feed.err.empty": "Skryf eers iets of voeg ’n prent by.",
  "feed.err.long": "Dit is te lank: ’n boodskap het hoogstens 4 000 karakters.",
  "feed.err.pictures": "Dit is te veel prente vir een boodskap.",
  "feed.err.people": "Dit is te veel mense vir een boodskap.",
  "feed.err.person_gone": "Iemand oor wie dit gaan, is nie meer in die stamboom nie.",
  "feed.err.picture_gone": "’n Prent kon nie aangeheg word nie. Voeg dit weer by.",
  "feed.err.too_many": "Dit is baie boodskappe in een uur. Probeer weer ’n bietjie later.",
  "feed.err.post_gone": "Hierdie boodskap is nie meer daar nie.",
};
