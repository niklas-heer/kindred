// Arms from a surname, in two steps the reader drives from the Designer's "Suggest from the name" tab:
//   1. researchName: what the name may mean across its languages and regions, as distinct candidate meanings,
//      each with the heraldic ideas that follow from it. The family's words never reach the web. When the family
//      allows web search, a first call searches the web for the surname and country only (a fixed instruction; the
//      surname and country as the only text); a second call, with no web search, turns those notes and the
//      family's own words into the meanings. The family's meaning leads and is never contradicted.
//   2. designArms: 3–5 designs with the full v2 heraldry (the canting hook in components/heraldry/canting.ts),
//      each naming the chosen meaning it draws on and why.
// Both validate what the model sends back, retry once on bad output, and write nothing. The caller keeps what it wants.
import { z } from 'zod';
import { AiError, isolatedSearch, type AiAdapter, type AiReply, type JsonSchema } from './adapters';
import { adapterForFeature } from './settings.server';
import { tr, type Tr } from './labels';
import { translate, type Key } from '../i18n/dictionary';
import { ATTESTATIONS, IDEA_KINDS, nameMeaningSchema, type AiLocale, type ArmsFeedback, type ArmsRevision, type DesignMeaning, type NameDesign, type NameMeaning, type NameResearch } from './types';
import { cantingFromIdeas, cantingResponseSchema, symbolismItemSchema, type CantingRequest } from '../../components/heraldry/canting';
import { tinctureZ } from '../../components/heraldry/canting-schema.ts';
import { candidateCharges, STOCK_CHARGES, termsOf } from '../../components/heraldry/charge-search';
import type { ChargeDef } from '../../components/heraldry/catalogue';
import { blazonV2 } from '../../components/heraldry/blazon';
import { contrastFor } from '../../components/heraldry/rules';
import { chargeDef, chargeLabel, chargeName } from '../../components/heraldry/registry';
import './arms-library.server';
import { armsV2Schema } from '../../components/heraldry/schema';
import type { ArmsV2, ChargeLayer } from '../seed-format';

const LANG = { en: 'English', de: 'German (du)', af: 'Afrikaans (jy)' } as const;
const WEB_SEARCHES = 3;
const MAX_MEANINGS = 8;
const MAX_DESIGNS = 5;
const MIN_DESIGNS = 3;
/** A revision gives this many refinements and this many fresh designs at most; fewer than the minimum of either is bad output. */
const MAX_PER_KIND = 3;
const MIN_PER_KIND = 2;
/** The research notes from the web are cut to this many characters before they go into the second call. */
const FINDINGS_MAX = 6000;

// ---------- step 1: what the name means ----------

/** What the model returns for step one. Checked again, and sanitised, by `toMeanings`. */
const modelMeaning = z.object({
  language: z.string().describe('Where this root is used, as languages and regions, e.g. "Dutch and German". Empty for the family\'s own meaning.'),
  root: z.string().describe('The root word, in its own spelling.'),
  meaning: z.string().describe('What the root means, in a few words, e.g. "lord, gentleman".'),
  attestation: z.enum(ATTESTATIONS).describe('"well-attested" when dictionaries and etymology agree; "speculative" for a guess or a folk etymology; "family" only for the family\'s own meaning.'),
  ideas: z.array(z.object({
    kind: z.enum(IDEA_KINDS).describe('quality: a virtue or trait; object: a thing; trade: an occupation; sound: a play on how the name sounds.'),
    idea: z.string().describe('A short phrase, e.g. "a lord\'s courage".'),
  })).max(4).describe('Heraldic ideas that follow from this meaning. Up to four, each short.'),
  sources: z.array(z.string()).max(3).describe('Full URLs of the pages you used for this meaning, from the list given. Empty when you did not use any.'),
});
const modelReply = z.object({
  meanings: z.array(modelMeaning).max(MAX_MEANINGS),
  // Null is an honest "nothing to add", not a bad answer: it must not cost a retry.
  note: z.string().max(400).nullish().describe('One honest sentence on what is uncertain, if anything. Empty when nothing is.'),
});

const NAME_JSON: JsonSchema = jsonOf(modelReply);
const CANTING_JSON: JsonSchema = jsonOf(cantingResponseSchema);

/** The schema as the providers take it: no `$schema` header. */
function jsonOf(schema: z.ZodType): JsonSchema {
  const { $schema: _drop, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  return rest;
}

/** The web call's instruction. Fixed text: the same for every family, every locale and every hint, so it can carry nothing private. */
const SEARCH_SYSTEM = 'You look up what a surname means in public sources such as dictionaries and etymologies. Search the web for the surname, with its country when one is given, and for nothing else. Then write plain notes: for each distinct meaning you find, its languages or regions, its root in its own spelling, what it means in a few words, and whether the sources agree or it is a guess. Name the full URLs of the pages you used. Say plainly when little is known. Invent nothing.';

/** The only text a web-enabled call carries: the surname and, when there is one, the country. */
const searchPrompt = (surname: string, country?: string) => [
  `Surname: ${surname}`,
  country ? `Country (ISO code): ${country}` : '',
].filter(Boolean).join('\n');

function researchSystem(locale: AiLocale, o: { hint: boolean; findings: boolean }): string {
  return [
    'You research what a family surname means, for a heraldic designer who makes arms that play on a name. Look across the languages and regions where the name is found, and give each distinct meaning once: no two candidates with the same root and meaning.',
    'For each meaning give the languages or regions, the root word in its own spelling, what it means in a few words, whether it is well attested or speculative, and up to four heraldic ideas that follow from it: a quality (a virtue such as honour or courage), an object, a trade, or a sound (a play on how the name sounds). Ideas must follow from the meaning. Keep them short.',
    'For example, the surname Heer has three candidates: Dutch and German "heer" (lord, gentleman), German "hehr" (noble, honourable) and German "Heer" (army, host). A name may have one candidate or none; do not pad the list.',
    'Be honest about what you know. Mark a meaning speculative when it is a guess, a folk etymology or one you cannot place. If you know nothing reliable, return few or no meanings and say so in "note". Never invent a historic family, an ancestor, a coat of arms, or a place the name comes from.',
    o.hint ? 'The family\'s own meaning is the most important input. Include it as a meaning with attestation "family", in the family\'s own words, with an empty language, and give it ideas too. Never contradict it or call it wrong; you may add what the dictionaries say as other candidates.' : '',
    `Write the meanings, the ideas and the note in ${LANG[locale]}. Keep roots in their own spelling.`,
    o.findings
      ? 'The message holds research notes from a public web search for the surname, and the pages that search returned. Build the meanings from those notes. Use your own knowledge only where they say nothing, and then say so in "note". For each meaning list in "sources" the full URLs, taken from that list only, of the pages you used for it; leave it empty when you used none.'
      : 'You cannot search the web. Work from your own knowledge only, and say in "note" that the answer is from your own knowledge and not checked online. Leave "sources" empty.',
    'Answer only in the JSON shape you are given.',
  ].filter(Boolean).join('\n');
}

/** What the public search brought back: its notes, and the pages it returned. */
interface Findings { text: string; sources: { url: string; title?: string }[] }

function researchUser(o: { surname: string; country?: string; familyHint?: string; found?: Findings }): string {
  const f = o.found;
  return [
    `Surname: ${o.surname}`,
    o.country ? `Country (ISO code): ${o.country}` : '',
    o.familyHint ? `The family says: "${o.familyHint}"` : '',
    f ? `Research notes from a public web search for the surname (not from the family):\n${f.text}` : '',
    f ? `Pages the search returned (the only URLs you may list as sources):\n${f.sources.map((s) => (s.title ? `${s.url} (${s.title})` : s.url)).join('\n') || 'none'}` : '',
  ].filter(Boolean).join('\n');
}

/** Turns the model's candidates into the meanings the reader sees: ids, the family's own meaning first, sources only if searched. */
function toMeanings(list: z.infer<typeof modelMeaning>[], o: { familyHint?: string; webSources: Map<string, string | undefined>; webSearched: boolean }): NameMeaning[] {
  const hint = o.familyHint?.trim() || undefined;
  let family = false;
  const rows = list.map((m) => {
    let attestation: NameMeaning['attestation'] = m.attestation;
    let meaning = m.meaning.trim();
    if (attestation === 'family') {
      // Only the first counts as the family's own, and only when the family said something.
      if (!hint || family) attestation = 'speculative';
      else { family = true; meaning = hint; }
    }
    const sources = o.webSearched
      ? m.sources.filter((u) => o.webSources.has(u)).slice(0, 3).map((u) => ({ url: u, title: o.webSources.get(u) }))
      : [];
    return { language: attestation === 'family' ? '' : m.language.trim(), root: m.root.trim(), meaning, attestation, ideas: m.ideas, sources };
  });
  if (hint && !family) rows.unshift({ language: '', root: '', meaning: hint, attestation: 'family', ideas: [], sources: [] });
  // Distinct meanings (the same root and sense once), the family's own first; the rest keep the model's order.
  const seen = new Set<string>();
  const distinct: typeof rows = [];
  for (const r of [...rows.filter((r) => r.attestation === 'family'), ...rows.filter((r) => r.attestation !== 'family')]) {
    const k = `${r.root}|${r.meaning}`.toLowerCase();
    if (!r.meaning || seen.has(k)) continue;
    seen.add(k);
    distinct.push(r);
  }
  const out: NameMeaning[] = [];
  for (const r of distinct.slice(0, MAX_MEANINGS)) {
    // Anything the schema refuses is left out, rather than failing the whole research.
    const parsed = nameMeaningSchema.safeParse({ id: `m${out.length + 1}`, ...r });
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

/**
 * The candidate meanings of a surname. `adapter` and `webSearch` come from adapterForFeature; the caller
 * passes a stub in tests. Retries once on bad output, then throws AiError('bad-output').
 */
export async function researchName(o: { adapter: AiAdapter; webSearch: boolean; surname: string; country?: string; familyHint?: string; locale: AiLocale }): Promise<NameResearch> {
  const c = tr(o.locale);
  const hint = o.familyHint?.trim() || undefined;
  // The web sees the surname and country and nothing else (searchName). Only the second call has the family's words.
  const found = o.webSearch ? await searchName(c, o.adapter, o) : undefined;
  const webSearched = found !== undefined;
  const webSources = new Map((found?.sources ?? []).map((s) => [s.url, s.title]));
  return ask(c, () => o.adapter.complete({
    system: researchSystem(o.locale, { hint: !!hint, findings: webSearched }),
    messages: [{ role: 'user', text: researchUser({ surname: o.surname, country: o.country, familyHint: hint, found }) }],
    json: { name: 'name_meaning', schema: NAME_JSON },
    maxTokens: 2000,
    timeoutMs: 60_000,
  }), (reply) => {
    const parsed = modelReply.safeParse(reply.json);
    if (!parsed.success) return undefined;
    return {
      meanings: toMeanings(parsed.data.meanings, { familyHint: hint, webSources, webSearched }),
      note: parsed.data.note?.trim() || undefined,
      webSearched,
    };
  });
}

/**
 * The public web search for the surname: an isolated request (no family text, no tree data, no other messages). Undefined
 * when the provider ran no search, so the research goes on from the model's own knowledge and says so.
 */
async function searchName(c: Tr, adapter: AiAdapter, o: { surname: string; country?: string }): Promise<Findings | undefined> {
  const reply = await ask(c, () => isolatedSearch(adapter, { system: SEARCH_SYSTEM, prompt: searchPrompt(o.surname, o.country), maxUses: WEB_SEARCHES, maxTokens: 2000, timeoutMs: 120_000 }), (r: AiReply) => (r.text.trim() ? r : undefined));
  if (reply.searches < 1) return undefined;
  return { text: reply.text.trim().slice(0, FINDINGS_MAX), sources: reply.sources ?? [] };
}

/** Step one for a family: the adapter and the web-search switch come from the family's settings. */
export async function nameMeaning(o: { tree: string; surname: string; country?: string; familyHint?: string; locale: AiLocale }): Promise<NameResearch> {
  const { adapter, webSearch } = await adapterForFeature(o.tree, 'arms', o.locale);
  return researchName({ ...o, adapter, webSearch: webSearch === true });
}

// ---------- step two: arms from the chosen meanings ----------

/**
 * The charges the model may use for these meanings: the charges whose names and words answer to the meanings' words,
 * best first, then a general stock. Not the whole library: a long list makes the model reach for the nearest look.
 */
function chargeList(meanings: DesignMeaning[], asked: string[] = []): string {
  // What the check asked for comes first: its words ("a key or staff of office") find the charges it names.
  const askedFit = candidateCharges(termsOf(...asked), 16);
  const askedIds = new Set(askedFit.map((c) => c.id));
  const terms = termsOf(...meanings.flatMap((m) => [m.root, m.meaning, ...m.ideas.map((i) => i.idea)]));
  const fit = candidateCharges(terms, 40).filter((c) => !askedIds.has(c.id));
  const fitIds = new Set([...askedIds, ...fit.map((c) => c.id)]);
  const stock = STOCK_CHARGES.flatMap((id) => {
    const c = chargeDef(id);
    return c && !fitIds.has(c.id) ? [c] : [];
  });
  const line = (c: ChargeDef) => `${c.id} (${chargeLabel(c, 'en')}${c.keys ? `; ${c.keys}` : ''})`;
  return [
    askedFit.length ? `Charges that answer to what the check asks for:\n${askedFit.map(line).join('\n')}` : '',
    fit.length ? `Charges whose names fit the chosen meanings:\n${fit.map(line).join('\n')}` : 'No charge name fits the chosen meanings.',
    `General charges, for any design: ${stock.map((c) => `${c.id} (${chargeLabel(c, 'en')})`).join(', ')}.`,
  ].filter(Boolean).join('\n');
}

const meaningLine = (m: DesignMeaning) => {
  const ideas = m.ideas.map((i) => `${i.kind}: ${i.idea}`).join('; ') || 'none';
  const sense = m.attestation === 'family'
    ? `the family's own meaning, in their words: "${m.meaning}"`
    : `${m.root ? `"${m.root}" (${m.language || 'unknown'}): ` : ''}${m.meaning}, ${m.attestation === 'well-attested' ? 'well attested' : 'speculative'}`;
  return `${m.id}: ${sense}. Heraldic ideas: ${ideas}.`;
};

function designSystem(locale: AiLocale, charges: string): string {
  return [
    'You design coats of arms for a family from what its name means. The reader has chosen the meanings below, and each design must draw on one of them: give its id in "meaningId", and say in "explanation", in ' + LANG[locale] + ', one sentence on why the design follows from that meaning (the sense of the name, or how it sounds).',
    'Make three to five designs, all different. Use only the charges listed below, by their id, and at most three charges in a design. Keep the rule of tincture: metal (or, argent) on colour (gules, azure, vert, sable, purpure), never colour on colour and never metal on metal. Prefer a clear, classic shield: a field, one ordinary or one main charge, and a base only when it helps.',
    ...designRules(locale),
    'Answer only in the JSON shape you are given.',
    'Charges (id: English name; German and other words):',
    charges,
  ].join('\n');
}

/** The rules a design follows whatever its count: a charge shows its meaning, narrow ordinaries, the family's words, and symbolism. */
function designRules(locale: AiLocale): string[] {
  return [
    'A charge must show the meaning, not only look like it or sound like the name. Use the charge that depicts the meaning when one is listed: a boot for a boot-maker, a fish for a fisher, a mill for a miller. Never use an object because it looks or sounds like the name: a boat is not a boot, and a rock is not "sturdy" while a listed charge fits better. Make a pun on the name only when the sound really is the same in that language.',
    'When no listed charge fits the chosen meaning, do not force one. Say so plainly in the explanation, and design with a tincture and an ordinary (a field, a chevron, a cross) instead.',
    'Do not put a detailed charge on a narrow ordinary (a fess, a bend, a bend sinister, a chevron or a pale): it is too small to read there. On a narrow ordinary use a plain, bold charge, or put the detailed charge on the field, in chief or in base.',
    'The family\'s own meaning, when chosen, is the most important input: prefer it and never contradict it. Never say that the family bore these arms in history: they are proposals to choose from.',
    'For each design, add "symbolism": up to three of its colours or charges, each as "element" (its name, a few words) and "why" (in ' + LANG[locale] + ', one short line on what it stands for in the meaning the design draws on, as a reader would say it, e.g. "Argent for the honour your family names" or "a tower for the army, Heer"). Leave it out when there is nothing to say.',
  ];
}

function designUser(o: { surname: string; country?: string; familyHint?: string; meanings: DesignMeaning[]; locale: AiLocale }): string {
  return [
    `Surname: ${o.surname}`,
    o.country ? `Country (ISO code): ${o.country}` : '',
    o.familyHint ? `The family says: "${o.familyHint}"` : '',
    'Chosen meanings:',
    ...o.meanings.map(meaningLine),
  ].filter((l) => l !== '').join('\n');
}

/**
 * 3–5 designs from the chosen meanings, with the full v2 heraldry. Unknown charges are dropped and tincture clashes
 * repaired (cantingFromIdeas does both); a design that names no chosen meaning, or ends with no charge at all, or
 * is not valid arms is dropped. Fewer than three left is bad output: one retry, then AiError('bad-output').
 */
export async function designArms(o: { adapter: AiAdapter; surname: string; country?: string; familyHint?: string; meanings: DesignMeaning[]; locale: AiLocale }): Promise<NameDesign[]> {
  const c = tr(o.locale);
  const hint = o.familyHint?.trim() || undefined;
  const chosen = new Map(o.meanings.map((m) => [m.id, m]));
  const req: CantingRequest = { surname: o.surname, country: o.country?.toLowerCase() };
  return ask(c, () => o.adapter.complete({
    system: designSystem(o.locale, chargeList(o.meanings)),
    messages: [{ role: 'user', text: designUser({ ...o, familyHint: hint }) }],
    json: { name: 'arms_designs', schema: CANTING_JSON },
    maxTokens: 2500,
    timeoutMs: 60_000,
  }), (reply) => {
    const parsed = cantingResponseSchema.safeParse(reply.json);
    if (!parsed.success) return undefined;
    // cantingFromIdeas keeps the order of the suggestions, so each design lines up with its idea.
    const designs: NameDesign[] = [];
    for (const d of cantingFromIdeas(parsed.data, req)) {
      const m = d.meaningId ? chosen.get(d.meaningId) : undefined;
      if (!m || d.arms.layers.length === 0 || !armsV2Schema.safeParse(d.arms).success) continue;
      const line = m.attestation === 'family' || !m.root ? m.meaning : `${m.root}: ${m.meaning}`;
      designs.push({ arms: d.arms, explanation: d.explanation, meaningId: m.id, meaning: line, symbolism: d.symbolism });
    }
    if (designs.length < MIN_DESIGNS) return undefined;
    return designs.slice(0, MAX_DESIGNS);
  });
}

/** Step two for a family: the adapter comes from the family's settings. */
export async function armsDesigns(o: { tree: string; surname: string; country?: string; familyHint?: string; meanings: DesignMeaning[]; locale: AiLocale }): Promise<NameDesign[]> {
  const { adapter } = await adapterForFeature(o.tree, 'arms', o.locale);
  return designArms({ ...o, adapter });
}

// ---------- step three: new arms, from the saved meanings and what the check asked for ----------

/** One refinement: the charges to add to the arms as they are, each by id, with its tincture and where it lies. */
const refinementZ = z.object({
  meaningId: z.string().max(20).optional(),
  explanation: z.string().min(1).max(200),
  charges: z.array(z.object({
    charge: z.string().max(40),
    tincture: tinctureZ.optional(),
    on: z.enum(['field', 'chief', 'base']).optional(),
  })).min(1).max(2),
  symbolism: z.array(symbolismItemSchema).max(4).optional().catch(undefined),
});
/** The answer: refinements of the arms as they are, and fresh designs drawn from the meanings (the design shape, as step two). */
const revisionZ = z.object({
  refinements: z.array(refinementZ).max(8),
  designs: cantingResponseSchema.shape.suggestions,
});
const REVISION_JSON: JsonSchema = jsonOf(revisionZ);

/**
 * The arms as they are, with the charges a refinement adds: each placed on the field, in chief or in base, and tinctured
 * to stand clear of the field. Undefined when no charge is valid, or the result is not valid arms.
 */
function refine(current: ArmsV2, charges: z.infer<typeof refinementZ>['charges']): { arms: ArmsV2; added: string[] } | undefined {
  const arms = structuredClone(current);
  const added: ChargeLayer[] = [];
  for (const c of charges) {
    if (!chargeDef(c.charge) || arms.layers.length + added.length >= 12) continue;
    added.push({ type: 'charge', charge: c.charge, tincture: contrastFor(current.field.tinctures, c.tincture), count: 1, arrangement: 'auto', on: c.on ?? 'field' });
  }
  if (added.length === 0) return undefined;
  arms.layers.push(...added);
  return armsV2Schema.safeParse(arms).success ? { arms, added: added.map((l) => l.charge) } : undefined;
}

/** The meaning line a suggestion shows: "heer: lord, gentleman", or the family's own words alone. */
const meaningTitle = (m: DesignMeaning) => (m.attestation === 'family' || !m.root ? m.meaning : `${m.root}: ${m.meaning}`);

function revisionSystem(locale: AiLocale, charges: string): string {
  return [
    'You help a family change its coat of arms so that it says what its name means. The steward has researched the name and chosen its meanings. A check found that the arms do not yet say them fully: its reason and what to change are in the message, with the arms as they are now.',
    'Make two kinds of suggestion, each in its own list.',
    '"refinements": the arms as they are, with one or two charges added to answer what the check asks for. Keep everything else. Give two or three. Each names the chosen meaning it speaks to in "meaningId", and gives each charge its tincture and where it lies: "field", "chief" or "base".',
    '"designs": two or three new designs from the chosen meanings, all different, that also answer what the check asks for. Each draws on one chosen meaning (its id in "meaningId"), uses at most three charges, and has a field with at most one ordinary or main charge.',
    `For every suggestion, say in "explanation", in ${LANG[locale]}, one sentence on why it says the meaning and answers the check.`,
    'Use only the charges listed below, by their id. Keep the rule of tincture: metal (or, argent) on colour (gules, azure, vert, sable, purpure), never colour on colour and never metal on metal.',
    ...designRules(locale),
    'Answer only in the JSON shape you are given.',
    'Charges (id: English name; German and other words):',
    charges,
  ].join('\n');
}

function revisionUser(o: { surname: string; country?: string; familyHint?: string; meanings: DesignMeaning[]; arms: ArmsV2; feedback: ArmsFeedback }): string {
  const now = o.arms.layers.filter((l) => l.type === 'charge').map((l) => `${l.charge} (${chargeName(l.charge, 'en')})`);
  return [
    `Surname: ${o.surname}`,
    o.country ? `Country (ISO code): ${o.country}` : '',
    o.familyHint ? `The family says: "${o.familyHint}"` : '',
    'Chosen meanings:',
    ...o.meanings.map(meaningLine),
    'The check said:',
    `Reason: ${o.feedback.reason}`,
    o.feedback.advice ? `What to change: ${o.feedback.advice}` : '',
    'The arms as they are now (keep them, unless a refinement adds to them):',
    `Blazon: ${blazonV2(o.arms)}`,
    `Charges now: ${now.length ? now.join(', ') : 'none'}`,
  ].filter((l) => l !== '').join('\n');
}

/**
 * Suggestions for arms the check found do not fully fit their name: 2–3 refinements (the arms as they are, plus the
 * charges the feedback asks for) and 2–3 fresh designs (from the chosen meanings). The feedback's words go into the
 * candidate charges. Fewer than two of either kind is bad output: one retry, then AiError('bad-output').
 */
export async function reviseArms(o: {
  adapter: AiAdapter; surname: string; country?: string; familyHint?: string; meanings: DesignMeaning[]; arms: ArmsV2; feedback: ArmsFeedback; locale: AiLocale;
}): Promise<ArmsRevision[]> {
  const c = tr(o.locale);
  const hint = o.familyHint?.trim() || undefined;
  const chosen = new Map(o.meanings.map((m) => [m.id, m]));
  const req: CantingRequest = { surname: o.surname, country: o.country?.toLowerCase() };
  return ask(c, () => o.adapter.complete({
    system: revisionSystem(o.locale, chargeList(o.meanings, [o.feedback.advice, o.feedback.reason])),
    messages: [{ role: 'user', text: revisionUser({ ...o, familyHint: hint }) }],
    json: { name: 'arms_revisions', schema: REVISION_JSON },
    maxTokens: 3000,
    timeoutMs: 90_000,
  }), (reply) => {
    const parsed = revisionZ.safeParse(reply.json);
    if (!parsed.success) return undefined;
    const refinements: ArmsRevision[] = [];
    for (const r of parsed.data.refinements) {
      const m = r.meaningId ? chosen.get(r.meaningId) : undefined;
      const made = m && refine(o.arms, r.charges);
      if (!m || !made) continue;
      refinements.push({ kind: 'refinement', arms: made.arms, explanation: r.explanation, meaningId: m.id, meaning: meaningTitle(m), symbolism: r.symbolism, added: made.added });
    }
    const designs: ArmsRevision[] = [];
    for (const d of cantingFromIdeas({ suggestions: parsed.data.designs }, req)) {
      const m = d.meaningId ? chosen.get(d.meaningId) : undefined;
      if (!m || d.arms.layers.length === 0 || !armsV2Schema.safeParse(d.arms).success) continue;
      designs.push({ kind: 'fresh', arms: d.arms, explanation: d.explanation, meaningId: m.id, meaning: meaningTitle(m), symbolism: d.symbolism });
    }
    if (refinements.length < MIN_PER_KIND || designs.length < MIN_PER_KIND) return undefined;
    return [...refinements.slice(0, MAX_PER_KIND), ...designs.slice(0, MAX_PER_KIND)];
  });
}

/** Step three for a family: the adapter, the budget and the web-search switch come from the family's settings (no web search). */
export async function armsRevisions(o: {
  tree: string; surname: string; country?: string; familyHint?: string; meanings: DesignMeaning[]; arms: ArmsV2; feedback: ArmsFeedback; locale: AiLocale;
}): Promise<ArmsRevision[]> {
  const { adapter } = await adapterForFeature(o.tree, 'arms', o.locale);
  return reviseArms({ ...o, adapter });
}

// ---------- one call, one retry on bad output ----------

/**
 * Runs one call; if the answer is bad (not the shape, or the provider sent no usable answer), runs it once more.
 * Other errors pass through. `run` makes the call, so the same retry covers a plain request and an isolated search.
 */
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
