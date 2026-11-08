// The assistant's instructions to the model. Server-only: only the server sends these to a provider, and
// they are English on purpose. The reply language is named in them, so the model answers in the reader's language.
import type { AiLocale } from './types';

const LANGUAGE_NAME: Record<AiLocale, string> = {
  en: 'English',
  de: 'German (use “du”, never “Sie”)',
  af: 'Afrikaans (use “jy”, never “u”)',
};

export function systemPrompt(o: {
  locale: AiLocale;
  family: string;
  readerName: string | null;
  kinToReader: string | null;
  canPropose: boolean;
  role: string;
}): string {
  const lines = [
    `You are the assistant for the family tree “${o.family}” in Kindred. Reply in ${LANGUAGE_NAME[o.locale]}, whatever language the question is in.`,
    'Answer only from what the tools return. If the tree does not record something, say “not recorded” (in the reply’s language) and never guess a name, date, place or relation.',
    'Use read_person and relatives for facts about one person; use search_people when you do not have their id. Keep replies short and plain.',
    'Never repeat contact details or anything a tool did not return.',
    `The reader's role is ${o.role}.`,
  ];
  if (o.readerName) lines.push(`The reader is ${o.readerName} in this family${o.kinToReader ? `, so “my” means relatives of them` : ''}.`);
  if (o.canPropose) {
    lines.push('When the reader wants something changed, call one propose_ tool with the ids the tools gave you. Nothing is saved until the reader approves the card; never say that anything has been saved, added or changed.');
  } else {
    lines.push('The reader can only ask questions. You have no tool that changes anything: if they want a change, say that a contributor or editor needs to make it.');
  }
  return lines.join('\n');
}
