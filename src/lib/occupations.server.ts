// The AI translation of a free-text occupation, for a reader whose occupation has no vocabulary code.
// The decision (vocabulary, then the tree's cache, then a model) is in occupations.translate.ts. Here the store
// is the tree's database and the model is the family's assistant, gated and budgeted like every other AI call.
// The translation is only ever shown; it never replaces the text the family wrote.
//
// Only a text the family wrote as someone's occupation may be translated. Anything else would let a reader spend
// the family's budget on arbitrary text and write it into the tree's cache.
import { db } from './db.server.ts';
import { AiError } from './ai/adapters.ts';
import { tr } from './ai/labels.ts';
import { adapterForFeature } from './ai/settings.server.ts';
import type { Locale } from './i18n/types.ts';
import { translation } from './occupations.translate.ts';

const LANGUAGE: Record<Locale, string> = { en: 'English', de: 'German', af: 'Afrikaans' };
const REPLY_JSON = {
  type: 'object',
  properties: { label: { type: 'string', maxLength: 80 } },
  required: ['label'],
  additionalProperties: false,
};

/** Whether `text` is the occupation of someone in this family (compared trimmed, as the family wrote it). */
export async function isTreeOccupation(tree: string, text: string): Promise<boolean> {
  return !!(await db(tree).get('SELECT 1 AS found FROM person WHERE TRIM(occupation) = ? LIMIT 1', text.trim()));
}

export async function translateOccupation(tree: string, text: string, locale: Locale): Promise<{ label: string; code: string | null }> {
  if (!(await isTreeOccupation(tree, text))) throw new AiError('bad-input', tr(locale)('ai.errNotOccupation'));
  const store = db(tree);
  const answer = await translation(
    text,
    locale,
    {
      get: async (t, l) => (await store.get<{ label: string }>('SELECT label FROM occupation_translation WHERE text = ? AND locale = ?', t, l))?.label,
      put: async (t, l, label) => {
        await store.run(
          'INSERT INTO occupation_translation (text, locale, label) VALUES (?, ?, ?) ON CONFLICT (text, locale) DO UPDATE SET label = excluded.label',
          t,
          l,
          label,
        );
      },
    },
    async () => {
      // The family's assistant switch gates text work; the AI key and the daily budget are checked there too,
      // and every call is booked against the budget before it is sent.
      const { adapter } = await adapterForFeature(tree, 'assistant', locale);
      const language = LANGUAGE[locale];
      const reply = await adapter.complete({
        system: [
          `You translate one occupation, as a family wrote it in a family tree, into ${language} for the reader.`,
          `Answer with the common name of that job in ${language}: singular, a few words at most, no explanation and no quotation marks.`,
          locale === 'de' ? 'Give the masculine and the feminine form joined with a slash, like "Bäcker/Bäckerin".' : '',
          'For a historical or regional title, give its closest common equivalent.',
        ].filter(Boolean).join('\n'),
        messages: [{ role: 'user', text: text.trim() }],
        json: { name: 'occupation', schema: REPLY_JSON },
        maxTokens: 120,
        timeoutMs: 30_000,
      });
      return reply.json;
    },
  );
  if (!answer) throw new AiError('bad-output', tr(locale)('ai.errBadOutput'));
  return { label: answer.label, code: answer.code };
}
