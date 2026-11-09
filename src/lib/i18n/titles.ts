import type { Locale } from "./types.ts";

/** The English section words of a page title, and their German and Afrikaans forms. */
const TITLE_WORDS: Record<string, { de: string; af: string }> = {
  "Sign in": { de: "Anmelden", af: "Meld aan" },
  "Set up": { de: "Einrichten", af: "Stel op" },
  Invitation: { de: "Einladung", af: "Uitnodiging" },
  Almanac: { de: "Kalender", af: "Almanak" },
  Contacts: { de: "Kontakte", af: "Kontakte" },
  Register: { de: "Verzeichnis", af: "Register" },
  Houses: { de: "Häuser", af: "Huise" },
  Needed: { de: "Fehlende Angaben", af: "Inligting nodig" },
  "Information needed": { de: "Fehlende Angaben", af: "Inligting nodig" },
  Chronicle: { de: "Chronik", af: "Kroniek" },
  Gallery: { de: "Galerie", af: "Galery" },
  Access: { de: "Zugang", af: "Toegang" },
  Statistics: { de: "Statistik", af: "Statistiek" },
  Tree: { de: "Stammbaum", af: "Stamboom" },
};

/** The English word a title part stands for, whichever language it is written in. */
function englishWord(part: string): string {
  return (
    Object.keys(TITLE_WORDS).find((en) => TITLE_WORDS[en].de === part || TITLE_WORDS[en].af === part) ?? part
  );
}

/** Translates the section word of a document title ("Sign in · Kindred") into the reader's language. */
export function localizeTitle(title: string, locale: Locale): string {
  return title
    .split(" · ")
    .map((part, index) => {
      if (index > 0) return part;
      const english = englishWord(part);
      if (locale === "en") return english;
      return TITLE_WORDS[english]?.[locale] ?? part;
    })
    .join(" · ");
}
