// The background tasks: what is still waiting in a family's record, and how one item of it is done. An item is one model
// call, or for a name its research (a web search first when the family has that on). The only things written are the arms
// review (house_arms_review, through checkArms), the occupation cache (occupation_translation), the chronicle translations
// (story_translation, beside the story) and collected, unchosen name meanings (house_meaning). No task reads a private
// field (person_field) or changes a story, a person or a house. Only the name research may search the web, and only the
// surname and the house's country go out.
//
// The lists are recomputed from the record on each run, so a run that stops early simply leaves the rest waiting: the next
// run finds it again (resumable by construction).
import { z } from 'zod';
import { db } from '../db.server';
import { MAX_COLLECT_FAILURES, surnameOf } from '../house-meaning.ts';
import { noteCollectFailure, saveCollected, snapshot } from '../house-meaning.server';
import { occupationForText } from '../occupations';
import { askForOccupation } from '../occupations.server';
import { translation } from '../occupations.translate';
import type { Locale } from '../i18n/types';
import { checkArms, withFitFixture } from './arms-fit.server';
import { researchName } from './arms.server';
import { AiError, type AiAdapter, type AiReply, type AiRequest } from './adapters';
import { tr } from './labels';
import { fakeOn } from './settings.server';
import type { Task } from './background';

export type Pending =
  | { task: 'arms'; house: string; fingerprint: string }
  | { task: 'occupations'; text: string; locale: Locale }
  | { task: 'chronicle'; story: string; title: string | null; body: string; locale: Locale; hash: string }
  | { task: 'names'; house: string; surname: string; country?: string };

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');

/** What a story translation was made from: a short hash of its title and body. Changes when the story is edited. */
export async function sourceHash(title: string | null, body: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([title ?? '', body])))).slice(0, 40);
}

/** Everything the task still has to do in this family, oldest-first where order matters. Reads only. */
export async function pending(tree: string, task: Task, languages: readonly Locale[]): Promise<Pending[]> {
  const d = db(tree);
  if (task === 'arms') {
    const out: Pending[] = [];
    const houses = await d.all<{ house: string }>('SELECT house FROM house_meaning ORDER BY house');
    for (const { house } of houses) {
      const s = await snapshot(d, house);
      // Only a house with chosen meanings is checked, and only when its arms or chosen meanings changed since the last check.
      if (!s || !s.chosen.length || s.review?.fingerprint === s.fingerprint) continue;
      out.push({ task: 'arms', house, fingerprint: s.fingerprint });
    }
    return out;
  }
  if (task === 'names') {
    // A house with no row at all, or with only failed tries: new names first, so a name that fails cannot hold the others up.
    const rows = await d.all<{ id: string; name: string; country: string | null }>(
      `SELECT h.id, h.name, s.country FROM house h
         LEFT JOIN house_meaning m ON m.house = h.id
         LEFT JOIN house_succession s ON s.house = h.id
        WHERE m.house IS NULL OR (m.meanings = '[]' AND m.collect_failures BETWEEN 1 AND ?)
        ORDER BY COALESCE(m.collect_failures, 0), h.name, h.id`,
      MAX_COLLECT_FAILURES - 1,
    );
    return rows.flatMap((r) => {
      const surname = surnameOf(r.name);
      const country = r.country && /^[A-Z]{2}$/.test(r.country) ? r.country : undefined;
      return surname ? [{ task: 'names' as const, house: r.id, surname, country }] : [];
    });
  }
  if (task === 'occupations') {
    const out: Pending[] = [];
    const rows = await d.all<{ text: string }>("SELECT DISTINCT TRIM(occupation) AS text FROM person WHERE TRIM(COALESCE(occupation, '')) <> '' ORDER BY text");
    const have = new Set((await d.all<{ text: string; locale: string }>('SELECT text, locale FROM occupation_translation')).map((r) => `${r.locale}\u0000${r.text}`));
    for (const { text } of rows) {
      // The vocabulary knows these in every language, so they are never asked.
      if (occupationForText(text)) continue;
      for (const locale of languages) if (!have.has(`${locale}\u0000${text}`)) out.push({ task: 'occupations', text, locale });
    }
    return out;
  }
  const stories = await d.all<{ id: string; title: string | null; body: string }>('SELECT id, title, body FROM story ORDER BY at DESC');
  const done = new Map((await d.all<{ story: string; locale: string; source_hash: string }>('SELECT story, locale, source_hash FROM story_translation')).map((r) => [`${r.story}\u0000${r.locale}`, r.source_hash]));
  const out: Pending[] = [];
  for (const s of stories) {
    const hash = await sourceHash(s.title, s.body);
    for (const locale of languages) {
      if (done.get(`${s.id}\u0000${locale}`) === hash) continue;
      out.push({ task: 'chronicle', story: s.id, title: s.title, body: s.body, locale, hash });
    }
  }
  return out;
}

const LANGUAGE: Record<Locale, string> = { en: 'English', de: 'German, in the informal "du" form', af: 'Afrikaans, in the informal "jy" form' };

const storyReply = z.object({
  same: z.boolean(),
  title: z.string().max(200),
  body: z.string().max(20_000),
});
const STORY_JSON = {
  type: 'object',
  properties: {
    same: { type: 'boolean', description: 'true when the story is already written in the target language' },
    title: { type: 'string', maxLength: 200, description: 'the translated title; empty when the story has none' },
    body: { type: 'string', maxLength: 20000, description: 'the translated body, in Markdown' },
  },
  required: ['same', 'title', 'body'],
  additionalProperties: false,
};

/**
 * With KINDRED_AI_FAKE=1 the fake provider has no answer for a story translation, so it gets this one: the story with
 * a marker in front, enough for a browser check to show the label and the original. Real calls never pass through here.
 */
export function withStoryFixture(a: AiAdapter, locale: Locale): AiAdapter {
  return {
    provider: a.provider,
    model: a.model,
    reasoning: a.reasoning,
    complete: (req: AiRequest) => {
      if (req.json?.name !== 'story_translation') return a.complete(req);
      const text = [...req.messages].reverse().find((m) => m.role === 'user')?.text ?? '';
      const reply: AiReply = {
        text: '', calls: [], tokens: 60, inputTokens: 30, outputTokens: 30, searches: 0,
        json: { same: false, title: '', body: `[${LANGUAGE[locale].split(',')[0]}, fake] ${text}` },
      };
      return Promise.resolve(reply);
    },
  };
}

/** Failures that say nothing about the name: the same name would have the same trouble, so they do not count against it. */
const NOT_THE_NAME: ReadonlySet<AiError['code']> = new Set(['budget', 'auth', 'key-unreadable', 'not-configured', 'rate-limited']);

/**
 * Does one item: one model call at most (a name: its research, with a web search first when the family has that on). `adapter` is budgeted (see background.server.ts), so a call past the cap throws
 * AiError('budget') and nothing is written. Any other failure throws too, and the caller counts it.
 */
export async function perform(tree: string, p: Pending, o: { adapter: AiAdapter; locale: Locale; now: Date; webSearch?: boolean }): Promise<void> {
  const c = tr(o.locale);
  if (p.task === 'names') {
    try {
      const research = await researchName({ adapter: o.adapter, webSearch: o.webSearch === true, surname: p.surname, country: p.country, locale: o.locale });
      await saveCollected(tree, p.house, { name: p.surname, research, now: o.now.getTime() });
    } catch (e) {
      if (!(e instanceof AiError && NOT_THE_NAME.has(e.code))) await noteCollectFailure(tree, p.house, p.surname, o.now.getTime()).catch(() => undefined);
      throw e;
    }
    return;
  }
  if (p.task === 'arms') {
    // The same check the steward runs, with its own retry key: a fingerprint that changes again is checked again, not replayed.
    await checkArms({
      tree,
      house: p.house,
      locale: o.locale,
      force: false,
      by: 'AI background',
      op: { key: `ai-background:arms:${tree}:${p.house}:${p.fingerprint}:${crypto.randomUUID()}`, user: 'ai-background', payload: { house: p.house, fingerprint: p.fingerprint } },
      adapter: fakeOn() ? withFitFixture(o.adapter) : o.adapter,
    });
    return;
  }
  if (p.task === 'occupations') {
    const store = db(tree);
    const answer = await translation(
      p.text,
      p.locale,
      {
        get: async (text, l) => (await store.get<{ label: string }>('SELECT label FROM occupation_translation WHERE text = ? AND locale = ?', text, l))?.label,
        put: async (text, l, label) => {
          await store.run(
            'INSERT INTO occupation_translation (text, locale, label) VALUES (?, ?, ?) ON CONFLICT (text, locale) DO UPDATE SET label = excluded.label',
            text, l, label,
          );
        },
      },
      () => askForOccupation(o.adapter, p.text, p.locale),
    );
    if (!answer) throw new AiError('bad-output', c('ai.errBadOutput'));
    return;
  }
  // The chronicle: the story as its author wrote it, translated into one language.
  const adapter = fakeOn() ? withStoryFixture(o.adapter, p.locale) : o.adapter;
  const reply = await adapter.complete({
    system: [
      `You translate one story from a family's record into ${LANGUAGE[p.locale]}. It is a memory, note, quote, anecdote or recipe that a relative wrote.`,
      'Keep every name, date and place exactly as written. Keep the Markdown and the sense. Add nothing and leave nothing out.',
      'Translate the title too; leave it empty when the story has none.',
      'When the story is already written in that language, answer with "same" set to true and empty title and body.',
      'Answer only in the JSON shape you are given.',
    ].join('\n'),
    messages: [{ role: 'user', text: p.title ? `${p.title}\n\n${p.body}` : p.body }],
    json: { name: 'story_translation', schema: STORY_JSON },
    maxTokens: Math.min(8_000, Math.max(800, Math.ceil(p.body.length / 2) + 400)),
    timeoutMs: 90_000,
  });
  const parsed = storyReply.safeParse(reply.json);
  if (!parsed.success || (!parsed.data.same && !parsed.data.body.trim())) throw new AiError('bad-output', c('ai.errBadOutput'));
  const v = parsed.data;
  // The row is keyed by the story and the language and says which text it was made from, so a story edited while this
  // call was out is simply not shown until the next run translates it again: a single upsert is enough.
  await db(tree).run(
    `INSERT INTO story_translation (story, locale, source_hash, title, body, same, translated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (story, locale) DO UPDATE SET source_hash = excluded.source_hash, title = excluded.title, body = excluded.body,
       same = excluded.same, translated_at = excluded.translated_at`,
    p.story,
    p.locale,
    p.hash,
    v.same ? null : v.title.trim() || null,
    v.same ? '' : v.body.trim(),
    v.same ? 1 : 0,
    o.now.toISOString(),
  );
}

/**
 * The translations a reader sees, for one language: each story's translated title and body, keyed by story id. A story
 * translation whose source has changed since it was made is left out (the reader sees the original). `same` ones are left
 * out too: the story is already in that language.
 */
export async function storyTranslations(tree: string, locale: Locale): Promise<Record<string, { title: string | null; body: string }>> {
  const rows = await db(tree).all<{ id: string; title: string | null; body: string; source_hash: string; t_title: string | null; t_body: string; same: number }>(
    `SELECT s.id, s.title, s.body, t.source_hash, t.title AS t_title, t.body AS t_body, t.same
       FROM story_translation t JOIN story s ON s.id = t.story WHERE t.locale = ?`,
    locale,
  );
  const out: Record<string, { title: string | null; body: string }> = {};
  for (const r of rows) {
    if (r.same) continue;
    if ((await sourceHash(r.title, r.body)) !== r.source_hash) continue;
    out[r.id] = { title: r.t_title, body: r.t_body };
  }
  return out;
}
