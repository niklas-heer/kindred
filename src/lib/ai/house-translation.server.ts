// Fills and reads house_translation: a house's researched name meanings and its arms check, in each language the steward chose.
// Part of the background task "occupations" (background-tasks.server.ts), so the same switch, schedule and budget apply. Only
// the AI-written words go to the provider: never a person, a private field, the family's own words or the surname.
//
// The list is recomputed from the record on each run. A translation is tied to a hash of its source, so a text edited or
// researched again is not shown and is translated again, and a task with nothing left to do does not run.
import { db } from '../db.server';
import { readReviews, toSaved } from '../house-meaning.server';
import { chosenMeanings } from '../house-meaning.ts';
import {
  checkMeanings, checkReview, meaningsSource, reviewSource,
  type HouseTranslations, type MeaningTranslation, type MeaningsSource, type ReviewSource, type ReviewTranslation,
} from '../house-translation.ts';
import type { Locale } from '../i18n/types';
import { AiError, type AiAdapter, type AiReply, type AiRequest, type JsonSchema } from './adapters';
import { tr } from './labels';
import { fakeOn } from './settings.server';

const LANGUAGE: Record<Locale, string> = { en: 'English', de: 'German, in the informal "du" form', af: 'Afrikaans, in the informal "jy" form' };

export type HouseItem =
  | { task: 'occupations'; kind: 'meanings'; house: string; locale: Locale; hash: string; source: MeaningsSource }
  | { task: 'occupations'; kind: 'review'; house: string; locale: Locale; hash: string; source: ReviewSource };

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
const hashOf = async (source: MeaningsSource | ReviewSource) =>
  hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(source)))).slice(0, 40);

export const houseItemKey = (p: HouseItem) => `house\u0000${p.kind}\u0000${p.house}\u0000${p.locale}\u0000${p.hash}`;

type MeaningRow = Parameters<typeof toSaved>[0];

/** Every house text still missing a translation. An arms check is not translated into the language it was written in, nor once it no longer applies. Reads only. */
export async function housePending(tree: string, languages: readonly Locale[]): Promise<HouseItem[]> {
  if (languages.length === 0) return [];
  const d = db(tree);
  const done = new Map((await d.all<{ house: string; kind: string; locale: string; source_hash: string }>('SELECT house, kind, locale, source_hash FROM house_translation')).map((r) => [`${r.house}\u0000${r.kind}\u0000${r.locale}`, r.source_hash]));
  const out: HouseItem[] = [];
  for (const row of await d.all<MeaningRow>("SELECT * FROM house_meaning WHERE meanings <> '[]' ORDER BY house")) {
    const source = meaningsSource(toSaved(row));
    if (!source) continue;
    const hash = await hashOf(source);
    for (const locale of languages) {
      if (done.get(`${row.house}\u0000meanings\u0000${locale}`) !== hash) out.push({ task: 'occupations', kind: 'meanings', house: row.house, locale, hash, source });
    }
  }
  for (const [house, r] of Object.entries(await readReviews(tree))) {
    const source = r.current && !r.chosen ? reviewSource(r) : undefined;
    if (!source) continue;
    const hash = await hashOf(source);
    for (const locale of languages) {
      if (locale !== r.locale && done.get(`${house}\u0000review\u0000${locale}`) !== hash) out.push({ task: 'occupations', kind: 'review', house, locale, hash, source });
    }
  }
  return out;
}

const MEANINGS_JSON: JsonSchema = {
  type: 'object',
  properties: {
    same: { type: 'boolean', description: 'true when all of it is already written in the target language' },
    note: { type: 'string', maxLength: 400, description: 'the translated note; empty when there is none, or when "same" is true' },
    meanings: {
      type: 'array',
      description: 'one entry for each meaning given, with the same ids; empty when "same" is true',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'the id, unchanged' },
          language: { type: 'string', maxLength: 80, description: 'the translated names of the languages or regions; empty when empty in the input' },
          meaning: { type: 'string', maxLength: 200, description: 'the translated meaning' },
          ideas: { type: 'array', items: { type: 'string', maxLength: 160 }, description: 'the translated ideas: as many as given, in the same order' },
        },
        required: ['id', 'language', 'meaning', 'ideas'],
        additionalProperties: false,
      },
    },
  },
  required: ['same', 'note', 'meanings'],
  additionalProperties: false,
};

const REVIEW_JSON: JsonSchema = {
  type: 'object',
  properties: {
    same: { type: 'boolean', description: 'true when all of it is already written in the target language' },
    reason: { type: 'string', maxLength: 400, description: 'the translated reason; empty when "same" is true' },
    advice: { type: 'string', maxLength: 400, description: 'the translated advice; empty when there is none, or when "same" is true' },
  },
  required: ['same', 'reason', 'advice'],
  additionalProperties: false,
};

const KEEP = 'Keep every name, root word, place and date exactly as written. Add nothing and leave nothing out.';

const prefix = (locale: Locale) => `[${LANGUAGE[locale].split(',')[0]}, fake] `;

/** With KINDRED_AI_FAKE=1 the fake provider has no answer for these calls, so it gets the text with a marker in front. Real calls never pass through here. */
export function withHouseFixture(a: AiAdapter, locale: Locale): AiAdapter {
  const mark = (s: string) => (s ? prefix(locale) + s : '');
  const answer = (req: AiRequest): unknown => {
    const last = req.messages.at(-1);
    const input = JSON.parse(last?.role === 'user' ? last.text : '{}') as Partial<MeaningsSource & ReviewSource>;
    if (req.json?.name === 'arms_review_translation') return { same: false, reason: mark(input.reason ?? ''), advice: mark(input.advice ?? '') };
    return { same: false, note: mark(input.note ?? ''), meanings: (input.meanings ?? []).map((m) => ({ id: m.id, language: mark(m.language), meaning: mark(m.meaning), ideas: m.ideas.map(mark) })) };
  };
  return {
    provider: a.provider,
    model: a.model,
    reasoning: a.reasoning,
    complete: (req: AiRequest) => {
      if (req.json?.name !== 'house_meanings_translation' && req.json?.name !== 'arms_review_translation') return a.complete(req);
      const reply: AiReply = { text: '', calls: [], tokens: 60, inputTokens: 30, outputTokens: 30, searches: 0, json: answer(req) };
      return Promise.resolve(reply);
    },
  };
}

const tokensFor = (text: string) => Math.min(4_000, Math.max(600, Math.ceil(text.length / 2) + 400));

/** One model call for one house text, through the budgeted adapter it is given. A reply that is not the shape asked for throws, and nothing is written. */
export async function translateHouseItem(tree: string, p: HouseItem, o: { adapter: AiAdapter; locale: Locale; now: Date }): Promise<void> {
  const adapter = fakeOn() ? withHouseFixture(o.adapter, p.locale) : o.adapter;
  const text = JSON.stringify(p.source);
  let checked: ReturnType<typeof checkMeanings> | ReturnType<typeof checkReview>;
  if (p.kind === 'meanings') {
    const reply = await adapter.complete({
      system: [
        `You translate notes on where a surname may come from into ${LANGUAGE[p.locale]}. The input is JSON.`,
        'Translate each "language" (names of languages or regions), each "meaning", each of the "ideas" (short ideas for a coat of arms) and the "note". Leave anything empty as empty.',
        `Keep each "id" unchanged. ${KEEP}`,
        'When all of it is already written in that language, answer with "same" set to true, an empty note and no meanings.',
        'Answer only in the JSON shape you are given.',
      ].join('\n'),
      messages: [{ role: 'user', text }],
      json: { name: 'house_meanings_translation', schema: MEANINGS_JSON },
      maxTokens: tokensFor(text),
      timeoutMs: 60_000,
    });
    checked = checkMeanings(p.source, reply.json);
  } else {
    const reply = await adapter.complete({
      system: [
        `You translate a herald's short judgement of a coat of arms into ${LANGUAGE[p.locale]}. The input is JSON with a "reason" and "advice". Leave anything empty as empty.`,
        `Use the usual heraldic words of that language. ${KEEP}`,
        'When all of it is already written in that language, answer with "same" set to true, and an empty reason and advice.',
        'Answer only in the JSON shape you are given.',
      ].join('\n'),
      messages: [{ role: 'user', text }],
      json: { name: 'arms_review_translation', schema: REVIEW_JSON },
      maxTokens: tokensFor(text),
      timeoutMs: 60_000,
    });
    checked = checkReview(p.source, reply.json);
  }
  if (!checked) throw new AiError('bad-output', tr(o.locale)('ai.errBadOutput'));
  // The row says which text it was made from, so a text changed while this call was out is simply not shown: one upsert is enough.
  await db(tree).run(
    `INSERT INTO house_translation (house, kind, locale, source_hash, content, same, translated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (house, kind, locale) DO UPDATE SET source_hash = excluded.source_hash, content = excluded.content,
       same = excluded.same, translated_at = excluded.translated_at`,
    p.house, p.kind, p.locale, p.hash, checked.same ? '{}' : JSON.stringify(checked.content), checked.same ? 1 : 0, o.now.toISOString(),
  );
}

function parse<T>(content: string): T | undefined {
  try {
    return JSON.parse(content) as T;
  } catch {
    return undefined;
  }
}

/**
 * One reader's translations, only those made from the text as it is now. A steward gets every meaning and the arms checks.
 * Every other reader gets only the origins that were selected, as with the research itself.
 */
export async function readHouseTranslations(tree: string, locale: Locale, steward: boolean): Promise<HouseTranslations> {
  const out: HouseTranslations = { meanings: {}, reviews: {} };
  const d = db(tree);
  const rows = await d.all<{ house: string; kind: string; source_hash: string; content: string }>('SELECT house, kind, source_hash, content FROM house_translation WHERE locale = ? AND same = 0', locale);
  if (rows.length === 0) return out;
  const saved = new Map((await d.all<MeaningRow>('SELECT * FROM house_meaning')).map((r) => [r.house, toSaved(r)]));
  const reviews = steward ? await readReviews(tree) : {};
  for (const r of rows) {
    if (r.kind === 'meanings') {
      const s = saved.get(r.house);
      const source = s && meaningsSource(s);
      if (!s || !source || (await hashOf(source)) !== r.source_hash) continue;
      const chosen = chosenMeanings(s);
      if (!steward && chosen.length === 0) continue;
      const t = parse<MeaningTranslation>(r.content);
      if (!t?.rows) continue;
      out.meanings[r.house] = steward ? t : { ...t, rows: Object.fromEntries(chosen.flatMap((m) => (t.rows[m.id] ? [[m.id, t.rows[m.id]]] : []))) };
    } else if (steward) {
      const source = reviews[r.house] && reviewSource(reviews[r.house]);
      if (!source || (await hashOf(source)) !== r.source_hash) continue;
      const t = parse<ReviewTranslation>(r.content);
      if (t?.of) out.reviews[r.house] = t;
    }
  }
  return out;
}
