// Is a house's coat of arms a good design for what its name means? One call to the family's model, with no web search: the
// saved meanings (the family's own words first), the arms as a blazon with what each colour and charge stands for, and what
// the steward already decided after earlier checks. The answer is "fits" (good enough counts), "partly" (a quiet idea) or,
// rarely, "reconsider" (the arms contradict the name or read badly), with a reason in the reader's language. It is stored with a fingerprint of the arms and the chosen meanings, so the same pair is never asked
// twice; the caller decides when to ask (a steward saves research, or asks again). Nothing runs on a page view.
import { z } from 'zod';
import { blazonV2 } from '../heraldry/blazon';
import './arms-library.server';
import { asV2 } from '../heraldry/convert';
import { chargeMeaning, ordinaryMeaning, tinctureMeaning } from '../heraldry/meanings';
import { translate, type Key, type Vars } from '../i18n/dictionary';
import type { Translator } from '../i18n';
import { db, NOT_A_RECORD, once, q, type OpKey } from '../db.server';
import { chargeGroups, chargesOverlap } from '../heraldry/clear-layout';
import { tinctureClashesV2 } from '../heraldry/rules';
import { FIT_VERDICTS, type ArmsDecision, type ArmsReview, type SavedMeaningRow } from '../house-meaning.ts';
import { parseDecisions, sameArmsAndResearch, snapshot, toReview } from '../house-meaning.server';
import type { ArmsV2 } from '../seed-format';
import { AiError, type AiAdapter, type AiReply, type JsonSchema } from './adapters';
import { tr, type Tr } from './labels';
import { cutText } from './trim';
import { adapterForFeature, fakeOn } from './settings.server';
import { TASK_ROUTE, type AiLocale } from './types';

const LANG = { en: 'English', de: 'German (du)', af: 'Afrikaans (jy)' } as const;
const english = Object.assign((k: Key, vars?: Vars) => translate('en', k, vars), { locale: 'en' as const }) as Translator;

/** What the model returns. Checked again here; a reply that does not match is asked once more. */
export const fitReply = z.object({
  verdict: z.enum(FIT_VERDICTS).describe('"fits" when the design is good enough for the name, the usual answer; "partly" when it is sound and one small change would clearly improve it; "reconsider", rarely, only when the arms contradict the name or read badly.'),
  reason: z.string().trim().overwrite(cutText(400)).min(1).describe('One or two sentences, in the reader\'s language, on why. At most 400 characters.'),
  advice: z.string().trim().overwrite(cutText(400)).nullish().describe('At most 400 characters. When the verdict is not "fits": one sentence, in the reader\'s language, on the one change worth making. Empty when they fit.'),
});
const FIT_JSON: JsonSchema = (() => {
  const { $schema: _drop, ...rest } = z.toJSONSchema(fitReply) as Record<string, unknown>;
  return rest;
})();

export function fitSystem(locale: AiLocale): string {
  return [
    'You are a herald with good taste. You judge whether a family\'s coat of arms is a good design for the family\'s name. The steward has researched the name and chosen its meanings.',
    'Judge the whole design: does it speak to a real meaning of the name, is it simple, can it be read at a glance, do its tinctures stand clear of each other, is it free of clutter. The best arms are simple: one clear charge on a plain field is as good as heraldry gets.',
    'The chosen meanings are a pool to draw on, not a checklist. A name\'s several meanings do not each need a symbol. One clear charge that speaks to one real meaning fits, even when the other meanings have no element. Never mark arms down for leaving a meaning out.',
    'Answer "fits" when the design is good enough. This is the usual answer: good enough counts as fitting, and when you are torn between "fits" and "partly", answer "fits".',
    'Answer "partly" only when the design is sound but says little about the name, or is a little busy, and one small change would clearly make it better.',
    'Answer "reconsider" rarely, and only when the arms contradict what the name means (they say the opposite of it) or read badly (crowded, too many charges to take in, tinctures that do not stand apart). Arms that are merely plain are never "reconsider".',
    'Adding more is never the default advice, because more charges rarely make arms better. When arms are busy, advise taking something away. Advise adding a charge only when nothing in the arms speaks to any meaning of the name and the shield has clear room for it.',
    'If the message says what the steward already decided, that decision stands. Judge the arms as they are now. Never give the same advice again, or a new version of it. Unless these arms contradict the name or read badly, answer "fits".',
    `Write the reason, and any advice, in ${LANG[locale]}. In the reason, say why in one or two sentences. Name the element that matters, by what it stands for. When the answer is not "fits", the advice says in one sentence the one change worth making.`,
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
  const groups = chargeGroups(arms);
  const charges = arms.layers.map((l) => (l.type === 'charge' ? `${l.charge} (${en(chargeMeaning(l.charge))})` : `${l.kind} (${en(ordinaryMeaning(l.kind))})`));
  return [
    `Blazon: ${blazonV2(arms)}`,
    `Tinctures and what they stand for: ${tints.map((t) => `${t} (${en(tinctureMeaning(t))})`).join('; ')}`,
    `Charges and what they stand for: ${charges.length ? charges.join('; ') : 'none'}`,
    `As drawn: ${groups.length} group${groups.length === 1 ? '' : 's'} of charges, ${groups.reduce((n, g) => n + (g.arrangement === 'seme' ? 20 : g.count), 0)} charges in all, ${arms.layers.length - groups.length} ordinar${arms.layers.length - groups.length === 1 ? 'y' : 'ies'}; ${chargesOverlap(arms) ? 'some charges lie on top of each other' : 'no charges overlap'}; the rule of tincture is ${tinctureClashesV2(arms, english).length ? 'broken' : 'kept'}.`,
  ].join('\n');
}

/** What the steward already did after earlier checks, as one line each, so the model cannot repeat itself. */
const decisionLine = (d: ArmsDecision) => {
  const advised = d.advice ? `The check advised: "${d.advice}". ` : '';
  return `- ${advised}The steward then ${d.decision === 'chose' ? 'chose these arms from the suggestions' : 'kept the arms as they were'}: ${d.blazon}.`;
};

export function fitUser(o: { name: string; familyWords: string; chosen: SavedMeaningRow[]; arms: ArmsV2; history: ArmsDecision[] }): string {
  return [
    `House name: ${o.name}`,
    o.familyWords ? `The family says: "${o.familyWords}"` : '',
    'Chosen meanings (possible origins of the name; the arms need to speak to only one of them):',
    ...o.chosen.map(meaningLine),
    'The arms:',
    describeArms(o.arms),
    ...(o.history.length ? ['What the steward already decided:', ...o.history.map(decisionLine)] : []),
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
    const adapter = o.adapter ?? (await adapterForFeature(o.tree, 'arms', o.locale, TASK_ROUTE.arms)).adapter;
    const run = !o.adapter && fakeOn() ? withFitFixture(adapter) : adapter;
    const fit = await ask(c, () => run.complete({
      system: fitSystem(o.locale),
      messages: [{ role: 'user', text: fitUser({ name: s.saved.name, familyWords: s.saved.familyWords, chosen: s.chosen, arms: asV2(JSON.parse(s.armsText)), history: parseDecisions(s.review?.history) }) }],
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
          // A new answer replaces any decision on the old one: a check the steward asked for again may flag the arms again.
          `INSERT INTO house_arms_review (house, fingerprint, verdict, reason, advice, locale, checked_at, checked_by, dismissed_fingerprint)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, '')
           ON CONFLICT(house) DO UPDATE SET fingerprint = excluded.fingerprint, verdict = excluded.verdict, reason = excluded.reason,
             advice = excluded.advice, locale = excluded.locale, checked_at = excluded.checked_at, checked_by = excluded.checked_by,
             dismissed_fingerprint = ''`,
          o.house, s.fingerprint, fit.verdict, fit.reason, advice, o.locale, now, o.by,
        ),
      ],
      // Advice about the arms, not the family's record.
      history: NOT_A_RECORD,
      result: toReview({
        house: o.house, fingerprint: s.fingerprint, verdict: fit.verdict, reason: fit.reason, advice, locale: o.locale,
        checked_at: now, checked_by: o.by, dismissed_fingerprint: '', history: s.review?.history ?? '[]',
      }, s.fingerprint),
    };
  });
}
