// Does a house's coat of arms still fit what its name means? One call to the family's model, with no web search: the
// saved meanings (the family's own words first) and the arms, described as a blazon and as what each colour and charge
// stands for. The answer is "fits", "partly" or "reconsider", a reason in the reader's language, and, when the arms do not
// fit, what to change. It is stored with a fingerprint of the arms and the chosen meanings, so the same pair is never asked
// twice; the caller decides when to ask (a steward saves research, or asks again). Nothing runs on a page view.
import { z } from 'zod';
import { blazonV2 } from '../../components/heraldry/blazon';
import './arms-library.server';
import { asV2 } from '../../components/heraldry/convert';
import { chargeMeaning, ordinaryMeaning, tinctureMeaning } from '../../components/heraldry/meanings';
import { translate, type Key } from '../i18n/dictionary';
import { db, once, q, type OpKey } from '../db.server';
import { FIT_VERDICTS, type ArmsReview, type SavedMeaningRow } from '../house-meaning.ts';
import { sameArmsAndResearch, snapshot, toReview } from '../house-meaning.server';
import type { ArmsV2 } from '../seed-format';
import { AiError, type AiAdapter, type AiReply, type JsonSchema } from './adapters';
import { tr, type Tr } from './labels';
import { adapterForFeature, fakeOn } from './settings.server';
import type { AiLocale } from './types';

const LANG = { en: 'English', de: 'German (du)', af: 'Afrikaans (jy)' } as const;

/** What the model returns. Checked again here; a reply that does not match is asked once more. */
const fitReply = z.object({
  verdict: z.enum(FIT_VERDICTS).describe('"fits" when the arms express the chosen meanings; "partly" when some do and some have no element; "reconsider" when no element speaks to the name.'),
  reason: z.string().trim().min(1).max(400).describe('One or two sentences, in the reader\'s language, on why.'),
  advice: z.string().trim().max(400).nullish().describe('When the verdict is not "fits": one sentence on what to change in the arms, in the reader\'s language. Empty when they fit.'),
});
const FIT_JSON: JsonSchema = (() => {
  const { $schema: _drop, ...rest } = z.toJSONSchema(fitReply) as Record<string, unknown>;
  return rest;
})();

function fitSystem(locale: AiLocale): string {
  return [
    'You check whether a family\'s coat of arms still fits what the family\'s name means. The steward has researched the name and chosen its meanings. Each design element stands for something, and a fit means the arms say what the chosen meanings say.',
    'Answer "fits" when the arms express the chosen meanings. Answer "partly" when some of them do and others have no element. Answer "reconsider" when no element speaks to the name\'s meaning at all.',
    `Write the reason, and any advice, in ${LANG[locale]}. In the reason, say why in one or two sentences. Name the element that matters, by what it stands for. When the answer is not "fits", the advice says in one sentence what to change, for example "no element speaks to the trade the name comes from", and what kind of charge or tincture would.`,
    'The family\'s own words, when they gave some, are the most important input: never contradict them. Use only the facts given. Invent no history, no ancestor and no coat of arms the family bore.',
    'Answer only in the JSON shape you are given.',
  ].join('\n');
}

/** A chosen meaning as the model reads it: the family's own words, or a root with its language and sense. */
const meaningLine = (m: SavedMeaningRow) =>
  m.attestation === 'family'
    ? `- the family's own meaning, in their words: "${m.meaning}"`
    : `- "${m.root}" (${m.language || 'unknown language'}): ${m.meaning}, ${m.attestation === 'well-attested' ? 'well attested' : 'speculative'}`;

/** The arms, in words a reader would use: the blazon, then what each tincture and charge stands for (in English). */
export function describeArms(arms: ArmsV2): string {
  const en = (k: Key) => translate('en', k);
  const tints = [...new Set([...arms.field.tinctures, ...arms.layers.map((l) => l.tincture)])];
  const charges = arms.layers.map((l) => (l.type === 'charge' ? `${l.charge} (${en(chargeMeaning(l.charge))})` : `${l.kind} (${en(ordinaryMeaning(l.kind))})`));
  return [
    `Blazon: ${blazonV2(arms)}`,
    `Tinctures and what they stand for: ${tints.map((t) => `${t} (${en(tinctureMeaning(t))})`).join('; ')}`,
    `Charges and what they stand for: ${charges.length ? charges.join('; ') : 'none'}`,
  ].join('\n');
}

function fitUser(o: { name: string; familyWords: string; chosen: SavedMeaningRow[]; arms: ArmsV2 }): string {
  return [
    `House name: ${o.name}`,
    o.familyWords ? `The family says: "${o.familyWords}"` : '',
    'Chosen meanings:',
    ...o.chosen.map(meaningLine),
    'The arms:',
    describeArms(o.arms),
  ].filter((l) => l !== '').join('\n');
}

/** Runs one call; a reply that is not the shape, or no usable answer, is asked once more (as in arms.server). */
async function ask<T>(c: Tr, run: () => Promise<AiReply>, read: (reply: AiReply) => T | undefined): Promise<T> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    let reply: AiReply;
    try {
      reply = await run();
    } catch (e) {
      if (e instanceof AiError && e.code === 'bad-output') {
        if (attempt === 1) continue;
        throw new AiError('bad-output', c('ai.errBadOutput'));
      }
      throw e;
    }
    const value = read(reply);
    if (value !== undefined) return value;
  }
  throw new AiError('bad-output', c('ai.errBadOutput'));
}

/**
 * With KINDRED_AI_FAKE=1 the fake provider has no answer for this check, so it gets this fixed one. It is the one place this
 * module knows about the fake: real calls go through the budget like any other, and so does this one's caller.
 */
export function withFitFixture(a: AiAdapter): AiAdapter {
  return {
    provider: a.provider,
    model: a.model,
    reasoning: a.reasoning,
    complete: (req) => req.json?.name !== 'arms_fit'
      ? a.complete(req)
      : Promise.resolve({
        text: '', calls: [], tokens: 40, inputTokens: 20, outputTokens: 20, searches: 0,
        json: { verdict: 'partly', reason: 'Fake: the arms speak to courage, but nothing in them speaks to the trade the name comes from.', advice: 'Add a charge that stands for the trade the name comes from.' },
      }),
  };
}

export interface FitInput {
  tree: string;
  house: string;
  locale: AiLocale;
  /** Ask again even when the arms and meanings are the ones last checked. */
  force: boolean;
  /** The steward who asked: recorded with the check. */
  by: string;
  op: OpKey;
  /** A caller's own adapter (tests pass a stub, budgeted as the app's would be). The app leaves it out: adapterForFeature gives it. */
  adapter?: AiAdapter;
}

/**
 * The house's latest check, asked again only when it is missing, out of date, or forced. Refused (nothing asked, nothing
 * booked) when the name is not researched or no meaning is chosen, and when the arms feature is off or the budget is spent.
 */
export async function checkArms(o: FitInput): Promise<ArmsReview> {
  const c = tr(o.locale);
  const first = await snapshot(db(o.tree), o.house);
  if (!first) throw new Error('houses.meaning.err_not_researched');
  if (!first.chosen.length) throw new Error('houses.meaning.err_none_chosen');
  if (!o.force && first.review && first.review.fingerprint === first.fingerprint) return toReview(first.review, first.fingerprint);

  return once(o.tree, o.op, 'checkArmsFit', async (d) => {
    // Read again inside the plan: a retry after a guard failure must ask about the arms as they are now.
    const s = await snapshot(d, o.house);
    if (!s) throw new Error('houses.meaning.err_not_researched');
    if (!s.chosen.length) throw new Error('houses.meaning.err_none_chosen');
    const adapter = o.adapter ?? (await adapterForFeature(o.tree, 'arms', o.locale)).adapter;
    const run = !o.adapter && fakeOn() ? withFitFixture(adapter) : adapter;
    const fit = await ask(c, () => run.complete({
      system: fitSystem(o.locale),
      messages: [{ role: 'user', text: fitUser({ name: s.saved.name, familyWords: s.saved.familyWords, chosen: s.chosen, arms: asV2(JSON.parse(s.armsText)) }) }],
      json: { name: 'arms_fit', schema: FIT_JSON },
      maxTokens: 700,
      timeoutMs: 60_000,
    }), (reply) => {
      const parsed = fitReply.safeParse(reply.json);
      return parsed.success ? parsed.data : undefined;
    });
    const now = Date.now();
    const advice = fit.verdict === 'fits' ? '' : (fit.advice ?? '');
    return {
      writes: [
        ...sameArmsAndResearch(o.house, s),
        q(
          `INSERT INTO house_arms_review (house, fingerprint, verdict, reason, advice, locale, checked_at, checked_by, dismissed_fingerprint)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, '')
           ON CONFLICT(house) DO UPDATE SET fingerprint = excluded.fingerprint, verdict = excluded.verdict, reason = excluded.reason,
             advice = excluded.advice, locale = excluded.locale, checked_at = excluded.checked_at, checked_by = excluded.checked_by`,
          o.house, s.fingerprint, fit.verdict, fit.reason, advice, o.locale, now, o.by,
        ),
      ],
      result: toReview({
        house: o.house, fingerprint: s.fingerprint, verdict: fit.verdict, reason: fit.reason, advice, locale: o.locale,
        checked_at: now, checked_by: o.by, dismissed_fingerprint: s.review?.dismissed_fingerprint ?? '',
      }, s.fingerprint),
    };
  });
}
