/**
 * Every area module, for the server and the test runner: all three languages, loaded synchronously. The browser build
 * replaces this module with catalog.client.ts (vite.config.ts), which ships English and loads one other language on demand.
 */
import * as accessArea from "./areas/access.ts";
import * as aiArea from "./areas/ai.ts";
import * as aiChatArea from "./areas/ai-chat.ts";
import * as aiPortraitArea from "./areas/ai-portrait.ts";
import * as aiStreamArea from "./areas/ai-stream.ts";
import * as aiThreadsArea from "./areas/ai-threads.ts";
import * as aiTasksArea from "./areas/ai-tasks.ts";
import * as almanacArea from "./areas/almanac.ts";
import * as campaignArea from "./areas/campaign.ts";
import * as atlasArea from "./areas/atlas.ts";
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
import * as panelArea from "./areas/panel.ts";
import * as photosArea from "./areas/photos.ts";
import * as portraitArea from "./areas/portrait.ts";
import * as profileArea from "./areas/profile.ts";
import * as proofArea from "./areas/proof.ts";
import * as remindersArea from "./areas/reminders.ts";
import * as researchArea from "./areas/research.ts";
import * as setupArea from "./areas/setup.ts";
import * as shareArea from "./areas/share.ts";
import * as shellArea from "./areas/shell.ts";
import * as sourcesArea from "./areas/sources.ts";
import * as statisticsArea from "./areas/statistics.ts";
import * as tourArea from "./areas/tour.ts";
import * as treeArea from "./areas/tree.ts";
import type { Locale, Message } from "./types.ts";

/** Every area module. Adding an area means adding it here once; keys go in the area files. */
export const AREAS = [
  commonArea,
  shellArea,
  treeArea,
  panelArea,
  fieldsArea,
  photosArea,
  aiArea,
  aiChatArea,
  aiPortraitArea,
  aiStreamArea,
  aiThreadsArea,
  aiTasksArea,
  exchangeArea,
  housesArea,
  heraldryArea,
  portraitArea,
  profileArea,
  proofArea,
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
  historyArea,
] as const;

/** Tables that exist before any area is merged. The server has every language in AREAS, so none. */
export const PRELOADED: Partial<Record<Locale, Partial<Record<string, Message>>>> = {};

/** On the server nothing loads later: every language is already in AREAS. */
export async function loadTable(locale: Locale): Promise<Partial<Record<string, Message>>> {
  // A code rather than a sentence: no reader can reach this.
  throw new Error(`i18n.unexpected_load:${locale}`);
}
