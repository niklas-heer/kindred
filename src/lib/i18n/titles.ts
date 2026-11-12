import type { Locale } from "./types.ts";

/**
 * The English section words of a page title, and each language's form. A translation lane adds its language to every
 * word (`node scripts/i18n-check.ts` lists the gaps); a word without one stays English.
 */
export const TITLE_WORDS: Record<string, Partial<Record<Exclude<Locale, "en">, string>>> = {
  "Sign in": { de: "Anmelden", af: "Meld aan", es: "Iniciar sesión", "pt-BR": "Entrar", ja: "サインイン", "zh-Hans": "登录" },
  "Set up": { de: "Einrichten", af: "Stel op", es: "Configurar", "pt-BR": "Configurar", ja: "設定", "zh-Hans": "设置" },
  Invitation: { de: "Einladung", af: "Uitnodiging", es: "Invitación", "pt-BR": "Convite", ja: "招待", "zh-Hans": "邀请" },
  Almanac: { de: "Kalender", af: "Almanak", es: "Almanaque", "pt-BR": "Almanaque", ja: "暦", "zh-Hans": "年历" },
  Contacts: { de: "Kontakte", af: "Kontakte", es: "Contactos", "pt-BR": "Contatos", ja: "連絡先", "zh-Hans": "联系人" },
  Register: { de: "Verzeichnis", af: "Register", es: "Registro", "pt-BR": "Registro", ja: "名簿", "zh-Hans": "名册" },
  Houses: { de: "Häuser", af: "Huise", es: "Casas", "pt-BR": "Casas", ja: "家系", "zh-Hans": "支系" },
  Needed: { de: "Fehlende Angaben", af: "Inligting nodig", es: "Pendientes", "pt-BR": "Pendentes", ja: "不足", "zh-Hans": "待补" },
  "Information needed": { de: "Fehlende Angaben", af: "Inligting nodig", es: "Datos pendientes", "pt-BR": "Informações pendentes", ja: "足りない情報", "zh-Hans": "待补充信息" },
  Chronicle: { de: "Chronik", af: "Kroniek", es: "Crónica", "pt-BR": "Crônica", ja: "年代記", "zh-Hans": "编年史" },
  Gallery: { de: "Galerie", af: "Galery", es: "Galería", "pt-BR": "Galeria", ja: "ギャラリー", "zh-Hans": "相册" },
  Access: { de: "Zugang", af: "Toegang", es: "Acceso", "pt-BR": "Acesso", ja: "アクセス", "zh-Hans": "访问权限" },
  Statistics: { de: "Statistik", af: "Statistiek", es: "Estadísticas", "pt-BR": "Estatísticas", ja: "統計", "zh-Hans": "统计" },
  Tree: { de: "Stammbaum", af: "Stamboom", es: "Árbol genealógico", "pt-BR": "Árvore genealógica", ja: "家系図", "zh-Hans": "家谱" },
  "Sign in": { de: "Anmelden", af: "Meld aan", fr: "Connexion", it: "Accedi" },
  "Set up": { de: "Einrichten", af: "Stel op", fr: "Installation", it: "Configurazione" },
  Invitation: { de: "Einladung", af: "Uitnodiging", fr: "Invitation", it: "Invito" },
  Almanac: { de: "Kalender", af: "Almanak", fr: "Almanach", it: "Almanacco" },
  Contacts: { de: "Kontakte", af: "Kontakte", fr: "Contacts", it: "Contatti" },
  Register: { de: "Verzeichnis", af: "Register", fr: "Registre", it: "Registro" },
  Houses: { de: "Häuser", af: "Huise", fr: "Maisons", it: "Casate" },
  Needed: { de: "Fehlende Angaben", af: "Inligting nodig", fr: "Infos manquantes", it: "Dati mancanti" },
  "Information needed": { de: "Fehlende Angaben", af: "Inligting nodig", fr: "Infos manquantes", it: "Dati mancanti" },
  Chronicle: { de: "Chronik", af: "Kroniek", fr: "Chronique", it: "Cronaca" },
  Gallery: { de: "Galerie", af: "Galery", fr: "Galerie", it: "Galleria" },
  Access: { de: "Zugang", af: "Toegang", fr: "Accès", it: "Accesso" },
  Statistics: { de: "Statistik", af: "Statistiek", fr: "Statistiques", it: "Statistiche" },
  Tree: { de: "Stammbaum", af: "Stamboom", fr: "Arbre", it: "Albero" },
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
