// Every language's kinship rules, by locale. A new language gets a module here (a stub at first: neutral.ts).
import type { Locale } from "../languages.ts";
import af from "./af.ts";
import de from "./de.ts";
import en from "./en.ts";
import es from "./es.ts";
import fr from "./fr.ts";
import it from "./it.ts";
import ja from "./ja.ts";
import nl from "./nl.ts";
import pl from "./pl.ts";
import ptBR from "./pt-BR.ts";
import type { KinshipRules } from "./shared.ts";
import zhHans from "./zh-Hans.ts";

export const KINSHIP: Record<Locale, KinshipRules> = { en, de, af, es, fr, it, nl, pl, "pt-BR": ptBR, ja, "zh-Hans": zhHans };
