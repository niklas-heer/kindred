/**
 * Every area module (English, the source of the key type) and every other language's merged table, for the server and the
 * test runner, loaded synchronously. The browser build replaces this module with catalog.client.ts (vite.config.ts), which
 * ships English and loads one other language on demand.
 */
import * as accessArea from "./areas/access.ts";
import * as aiArea from "./areas/ai.ts";
import * as aiChatArea from "./areas/ai-chat.ts";
import * as aiLifeArea from "./areas/ai-life.ts";
import * as aiPortraitArea from "./areas/ai-portrait.ts";
import * as aiStreamArea from "./areas/ai-stream.ts";
import * as aiThreadsArea from "./areas/ai-threads.ts";
import * as aiTasksArea from "./areas/ai-tasks.ts";
import * as almanacArea from "./areas/almanac.ts";
import * as campaignArea from "./areas/campaign.ts";
import * as responsesArea from "./areas/responses.ts";
import * as feedArea from "./areas/feed.ts";
import * as recipesArea from "./areas/recipes.ts";
import * as todayArea from "./areas/today.ts";
import * as todayQuestionsArea from "./areas/today-questions.ts";
import * as atlasArea from "./areas/atlas.ts";
import * as chargeLibraryArea from "./areas/charge-library.ts";
import * as characterArea from "./areas/character.ts";
import * as chronicleArea from "./areas/chronicle.ts";
import * as commonArea from "./areas/common.ts";
import * as contactsArea from "./areas/contacts.ts";
import * as eventsArea from "./areas/events.ts";
import * as exchangeArea from "./areas/exchange.ts";
import * as familiesArea from "./areas/families.ts";
import * as feedbackArea from "./areas/feedback.ts";
import * as fieldsArea from "./areas/fields.ts";
import * as heraldryArea from "./areas/heraldry.ts";
import * as historyArea from "./areas/history.ts";
import * as housesArea from "./areas/houses.ts";
import * as joinArea from "./areas/join.ts";
import * as neededArea from "./areas/needed.ts";
import * as operatorArea from "./areas/operator.ts";
import * as opsArea from "./areas/ops.ts";
import * as policyArea from "./areas/policy.ts";
import * as signupArea from "./areas/signup.ts";
import * as gdprArea from "./areas/gdpr.ts";
import * as panelArea from "./areas/panel.ts";
import * as photosArea from "./areas/photos.ts";
import * as portraitArea from "./areas/portrait.ts";
import * as printArea from "./areas/print.ts";
import * as presenceArea from "./areas/presence.ts";
import * as profileArea from "./areas/profile.ts";
import * as proofArea from "./areas/proof.ts";
import * as passwordArea from "./areas/password.ts";
import * as oidcArea from "./areas/oidc.ts";
import * as remindersArea from "./areas/reminders.ts";
import * as researchArea from "./areas/research.ts";
import * as setupArea from "./areas/setup.ts";
import * as shareArea from "./areas/share.ts";
import * as shellArea from "./areas/shell.ts";
import * as sourcesArea from "./areas/sources.ts";
import * as statisticsArea from "./areas/statistics.ts";
import * as tourArea from "./areas/tour.ts";
import * as treeArea from "./areas/tree.ts";
import * as updateArea from "./areas/update.ts";
import * as viewasArea from "./areas/viewas.ts";
import * as whoisArea from "./areas/whois.ts";
import af from "./locales/af/index.ts";
import de from "./locales/de/index.ts";
import es from "./locales/es/index.ts";
import fr from "./locales/fr/index.ts";
import it from "./locales/it/index.ts";
import ja from "./locales/ja/index.ts";
import nl from "./locales/nl/index.ts";
import pl from "./locales/pl/index.ts";
import ptBR from "./locales/pt-BR/index.ts";
import zhHans from "./locales/zh-Hans/index.ts";
import type { Locale, Message } from "./types.ts";

/**
 * Every area module, each exporting `en`. Adding an area means adding it here once (and running
 * `node scripts/i18n-scaffold.ts`, which gives every other language its file); keys go in the area files.
 */
export const AREAS = [
  commonArea,
  shellArea,
  treeArea,
  panelArea,
  fieldsArea,
  photosArea,
  aiArea,
  aiChatArea,
  aiLifeArea,
  aiPortraitArea,
  aiStreamArea,
  aiThreadsArea,
  aiTasksArea,
  exchangeArea,
  housesArea,
  heraldryArea,
  chargeLibraryArea,
  portraitArea,
  characterArea,
  profileArea,
  presenceArea,
  proofArea,
  passwordArea,
  oidcArea,
  atlasArea,
  almanacArea,
  chronicleArea,
  contactsArea,
  neededArea,
  accessArea,
  shareArea,
  joinArea,
  setupArea,
  remindersArea,
  researchArea,
  tourArea,
  feedbackArea,
  statisticsArea,
  eventsArea,
  sourcesArea,
  campaignArea,
  familiesArea,
  operatorArea,
  opsArea,
  policyArea,
  updateArea,
  signupArea,
  gdprArea,
  historyArea,
  responsesArea,
  feedArea,
  recipesArea,
  todayArea,
  todayQuestionsArea,
  printArea,
  viewasArea,
  whoisArea,
] as const;

type Table = Partial<Record<string, Message>>;

/** Every language but English, each one table of all its areas (`locales/<locale>/index.ts`). */
export const PRELOADED: Partial<Record<Locale, Table>> = {
  de, af, es, fr, it, nl, pl, "pt-BR": ptBR, ja, "zh-Hans": zhHans,
} satisfies Record<Exclude<Locale, "en">, Table>;

/** On the server nothing loads later: every language is already here. */
export async function loadTable(locale: Locale): Promise<Partial<Record<string, Message>>> {
  // A code rather than a sentence: no reader can reach this.
  throw new Error(`i18n.unexpected_load:${locale}`);
}
