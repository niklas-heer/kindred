// The label words offered in the field editor, such as "Mobile" or "Maiden name". A label is stored as written,
// in English, so the same data reads the same in every language; it is shown in the reader's language here.
// Any other label a family types is shown exactly as written.
import type { Key, Translator } from "~/lib/i18n";

const OFFERED = new Map<string, Key>([
  ["mobile", "preset.mobile"],
  ["home", "preset.home"],
  ["work", "preset.work"],
  ["other", "preset.other"],
  ["personal", "preset.personal"],
  ["holiday", "preset.holiday"],
  ["home page", "preset.home_page"],
  ["blog", "preset.blog"],
  ["Instagram", "preset.instagram"],
  ["Facebook", "preset.facebook"],
  ["LinkedIn", "preset.linkedin"],
  ["X", "preset.x"],
  ["TikTok", "preset.tiktok"],
  ["YouTube", "preset.youtube"],
  ["Bluesky", "preset.bluesky"],
  ["Threads", "preset.threads"],
  ["Mastodon", "preset.mastodon"],
  ["WhatsApp", "preset.whatsapp"],
  ["Signal", "preset.signal"],
  ["Other", "preset.other"],
  ["maiden", "preset.maiden"],
  ["birth", "preset.birth"],
  ["nickname", "preset.nickname"],
  ["religious", "preset.religious"],
  ["alias", "preset.alias"],
  ["anniversary", "preset.anniversary"],
  ["baptism", "preset.baptism"],
  ["confirmation", "preset.confirmation"],
  ["school", "preset.school"],
  ["university", "preset.university"],
  ["training", "preset.training"],
  ["job", "preset.job"],
  ["apprenticeship", "preset.apprenticeship"],
  ["volunteering", "preset.volunteering"],
  ["business", "preset.business"],
  ["army", "preset.army"],
  ["navy", "preset.navy"],
  ["air force", "preset.air_force"],
  ["reserve", "preset.reserve"],
  ["faith", "preset.faith"],
  ["denomination", "preset.denomination"],
  ["citizenship", "preset.citizenship"],
  ["mother tongue", "preset.mother_tongue"],
  ["spoken", "preset.spoken"],
  ["learning", "preset.learning"],
  ["condition", "preset.condition"],
  ["medication", "preset.medication"],
  ["surgery", "preset.surgery"],
  ["food", "preset.food"],
  ["medicine", "preset.medicine"],
  ["drink", "preset.drink"],
  ["music", "preset.music"],
  ["film", "preset.film"],
  ["hobby", "preset.hobby"],
  ["general", "preset.general"],
  ["book", "preset.book"],
  ["friend", "preset.friend"],
  ["godparent", "preset.godparent"],
  ["neighbour", "preset.neighbour"],
  ["colleague", "preset.colleague"],
  ["carer", "preset.carer"],
]);

/** A stored label as the reader sees it: the translated word if it is one of the offered words, else as written. */
export function presetLabel(stored: string, t: Translator): string {
  const key = OFFERED.get(stored);
  return key ? t(key) : stored;
}

/**
 * A summary line with a field's stored label in it, as the reader sees it: "Allergies (food)" reads "Allergies (Essen)"
 * in German, the same word the Edit tab shows. Text without the label is returned as it is.
 */
export function withPresetLabel(summary: string, stored: string, t: Translator): string {
  if (!stored) return summary;
  return summary.replace(`(${stored})`, `(${presetLabel(stored, t)})`);
}
