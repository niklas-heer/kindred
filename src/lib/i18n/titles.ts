import type { Locale } from "./types.ts";

/**
 * The English section words of a page title, and each language's form. A translation lane adds its language to every
 * word (`node scripts/i18n-check.ts` lists the gaps); a word without one stays English.
 */
export const TITLE_WORDS: Record<string, Partial<Record<Exclude<Locale, "en">, string>>> = {
  "Sign in": { de: "Anmelden", af: "Meld aan", es: "Iniciar sesión" },
  "Set up": { de: "Einrichten", af: "Stel op", es: "Configurar" },
  Invitation: { de: "Einladung", af: "Uitnodiging", es: "Invitación" },
  Almanac: { de: "Kalender", af: "Almanak", es: "Almanaque" },
  Contacts: { de: "Kontakte", af: "Kontakte", es: "Contactos" },
  Register: { de: "Verzeichnis", af: "Register", es: "Registro" },
  Houses: { de: "Häuser", af: "Huise", es: "Casas" },
  Needed: { de: "Fehlende Angaben", af: "Inligting nodig", es: "Pendientes" },
  "Information needed": { de: "Fehlende Angaben", af: "Inligting nodig", es: "Datos pendientes" },
  Chronicle: { de: "Chronik", af: "Kroniek", es: "Crónica" },
  Gallery: { de: "Galerie", af: "Galery", es: "Galería" },
  Access: { de: "Zugang", af: "Toegang", es: "Acceso" },
  Statistics: { de: "Statistik", af: "Statistiek", es: "Estadísticas" },
  Tree: { de: "Stammbaum", af: "Stamboom", es: "Árbol genealógico" },
};

/** The English word a title part stands for, whichever language it is written in. */
function englishWord(part: string): string {
  return (
    Object.keys(TITLE_WORDS).find((en) => Object.values(TITLE_WORDS[en]).includes(part)) ?? part
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
