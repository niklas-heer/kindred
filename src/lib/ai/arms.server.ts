// Arms from a surname, in two steps the reader drives from the Designer's "Suggest from the name" tab:
//   1. researchName: what the name may mean across its languages and regions, as distinct candidate meanings,
//      each with the heraldic ideas that follow from it. Web search only when the family allows it, with the
//      surname and country as the only things searched for.
//   2. designArms: 3–5 designs with the full v2 heraldry (the canting hook in components/heraldry/canting.ts),
//      each naming the chosen meaning it draws on and why.
// Both validate what the model sends back, retry once on bad output, and write nothing. The caller keeps what it wants.
import { z } from 'zod';
import { AiError, type AiAdapter, type AiReply, type AiRequest, type JsonSchema } from './adapters';
import { adapterForFeature } from './settings.server';
import { tr, type Tr } from './labels';
import { translate, type Key } from '../i18n/dictionary';
import { ATTESTATIONS, IDEA_KINDS, nameMeaningSchema, type AiLocale, type DesignMeaning, type NameDesign, type NameMeaning, type NameResearch } from './types';
import { cantingFromIdeas, cantingResponseSchema, type CantingRequest } from '../../components/heraldry/canting';
import { CATEGORIES, CHARGES_V2 } from '../../components/heraldry/catalogue';
import { armsV2Schema } from '../../components/heraldry/schema';

const LANG = { en: 'English', de: 'German (du)', af: 'Afrikaans (jy)' } as const;
const WEB_SEARCHES = 3;
const MAX_MEANINGS = 8;
const MAX_DESIGNS = 5;
const MIN_DESIGNS = 3;

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
  sources: z.array(z.string()).max(3).describe('Full URLs of the pages you used for this meaning. Empty when you did not search.'),
});
const modelReply = z.object({
  meanings: z.array(modelMeaning).max(MAX_MEANINGS),
  note: z.string().max(400).optional().describe('One honest sentence on what is uncertain, if anything. Empty when nothing is.'),
});

const NAME_JSON: JsonSchema = jsonOf(modelReply);
const CANTING_JSON: JsonSchema = jsonOf(cantingResponseSchema);

/** The schema as the providers take it: no `$schema` header. */
function jsonOf(schema: z.ZodType): JsonSchema {
  const { $schema: _drop, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  return rest;
}

const WEB_RULES = (on: boolean) => on
  ? `You may search the web, up to ${WEB_SEARCHES} searches. Search only for the surname, with its country when one is given. Never search for the family's own words, and never put anything about a family member into a search. For each meaning, list in "sources" the full URLs of the pages you used for it; leave it empty when you used none.`
  : 'You cannot search the web. Work from your own knowledge only, and say in "note" that the answer is from your own knowledge and not checked online.';

function researchSystem(locale: AiLocale, webSearch: boolean, hint: boolean): string {
  return [
    'You research what a family surname means, for a heraldic designer who makes arms that play on a name. Look across the languages and regions where the name is found, and give each distinct meaning once: no two candidates with the same root and meaning.',
    'For each meaning give the languages or regions, the root word in its own spelling, what it means in a few words, whether it is well attested or speculative, and up to four heraldic ideas that follow from it: a quality (a virtue such as honour or courage), an object, a trade, or a sound (a play on how the name sounds). Ideas must follow from the meaning. Keep them short.',
    'For example, the surname Heer has three candidates: Dutch and German "heer" (lord, gentleman), German "hehr" (noble, honourable) and German "Heer" (army, host). A name may have one candidate or none; do not pad the list.',
    'Be honest about what you know. Mark a meaning speculative when it is a guess, a folk etymology or one you cannot place. If you know nothing reliable, return few or no meanings and say so in "note". Never invent a historic family, an ancestor, a coat of arms, or a place the name comes from.',
    hint ? 'The family\'s own meaning is the most important input. Include it as a meaning with attestation "family", in the family\'s own words, with an empty language, and give it ideas too. Never contradict it or call it wrong; you may add what the dictionaries say as other candidates.' : '',
    `Write the meanings, the ideas and the note in ${LANG[locale]}. Keep roots in their own spelling.`,
    WEB_RULES(webSearch),
    'Answer only in the JSON shape you are given.',
  ].filter(Boolean).join('\n');
}

function researchUser(o: { surname: string; country?: string; familyHint?: string }): string {
  return [
    `Surname: ${o.surname}`,
    o.country ? `Country (ISO code): ${o.country}` : '',
    o.familyHint ? `The family says: "${o.familyHint}"` : '',
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
  // A provider cannot search and answer in a forced JSON tool at once, so with web search the answer is free text
  // holding one JSON object: read from the text, checked against the same schema, retried like any bad output.
  const req: AiRequest = o.webSearch
    ? {
      system: `${researchSystem(o.locale, true, !!hint)}\n${JSON_TEXT_RULE}\n${JSON.stringify(NAME_JSON)}`,
      messages: [{ role: 'user', text: researchUser({ ...o, familyHint: hint }) }],
      maxTokens: 2000,
      timeoutMs: 120_000,
      webSearch: { maxUses: WEB_SEARCHES },
    }
    : {
      system: researchSystem(o.locale, false, !!hint),
      messages: [{ role: 'user', text: researchUser({ ...o, familyHint: hint }) }],
      json: { name: 'name_meaning', schema: NAME_JSON },
      maxTokens: 2000,
      timeoutMs: 60_000,
    };
  return ask(c, o.adapter, req, (reply) => {
    const parsed = modelReply.safeParse(o.webSearch ? jsonFromText(reply.text) : reply.json);
    if (!parsed.success) return undefined;
    // "Checked on the web" only when the provider says it ran a search; a model that did not search says so.
    const webSearched = o.webSearch && reply.searches > 0;
    const webSources = new Map((reply.sources ?? []).map((s) => [s.url, s.title]));
    return {
      meanings: toMeanings(parsed.data.meanings, { familyHint: hint, webSources, webSearched }),
      note: parsed.data.note?.trim() || undefined,
      webSearched,
    };
  });
}

const JSON_TEXT_RULE = 'Answer with one JSON object and nothing else (no prose, no code fence), shaped like this schema:';

/** The JSON object in a free-text answer: the text between its first "{" and last "}", or undefined. */
function jsonFromText(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) return undefined;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

/** Step one for a family: the adapter and the web-search switch come from the family's settings. */
export async function nameMeaning(o: { tree: string; surname: string; country?: string; familyHint?: string; locale: AiLocale }): Promise<NameResearch> {
  const { adapter, webSearch } = await adapterForFeature(o.tree, 'arms', o.locale);
  return researchName({ ...o, adapter, webSearch: webSearch === true });
}

// ---------- step 2: arms from the chosen meanings ----------

let CATALOGUE: string | undefined;
/** The charges the model may use, grouped, as "id (English name; German and other words)". Built once. */
function catalogue(): string {
  if (CATALOGUE) return CATALOGUE;
  const en = (k: Key) => translate('en', k);
  CATALOGUE = CATEGORIES.map((cat) => {
    const items = CHARGES_V2.filter((c) => c.cat === cat.id).map((c) => `${c.id} (${en(c.label)}${c.keys ? `; ${c.keys}` : ''})`);
    return items.length ? `${en(cat.label)}: ${items.join(', ')}` : '';
  }).filter(Boolean).join('\n');
  return CATALOGUE;
}

const meaningLine = (m: DesignMeaning) => {
  const ideas = m.ideas.map((i) => `${i.kind}: ${i.idea}`).join('; ') || 'none';
  const sense = m.attestation === 'family'
    ? `the family's own meaning, in their words: "${m.meaning}"`
    : `${m.root ? `"${m.root}" (${m.language || 'unknown'}): ` : ''}${m.meaning}, ${m.attestation === 'well-attested' ? 'well attested' : 'speculative'}`;
  return `${m.id}: ${sense}. Heraldic ideas: ${ideas}.`;
};

function designSystem(locale: AiLocale): string {
  return [
    'You design coats of arms for a family from what its name means. The reader has chosen the meanings below, and each design must draw on one of them: give its id in "meaningId", and say in "explanation", in ' + LANG[locale] + ', one sentence on why the design follows from that meaning (the sense of the name, or how it sounds).',
    'Make three to five designs, all different. Use only the charges listed below, by their id, and at most three charges in a design. Keep the rule of tincture: metal (or, argent) on colour (gules, azure, vert, sable, purpure), never colour on colour and never metal on metal. Prefer a clear, classic shield: a field, one ordinary or one main charge, and a base only when it helps.',
    'The family\'s own meaning, when chosen, is the most important input: prefer it and never contradict it. Never say that the family bore these arms in history: they are proposals to choose from.',
    'Answer only in the JSON shape you are given.',
    'Charges (id: English name; German and other words):',
    catalogue(),
  ].join('\n');
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
  return ask(c, o.adapter, {
    system: designSystem(o.locale),
    messages: [{ role: 'user', text: designUser({ ...o, familyHint: hint }) }],
    json: { name: 'arms_designs', schema: CANTING_JSON },
    maxTokens: 2500,
    timeoutMs: 60_000,
  }, (reply) => {
    const parsed = cantingResponseSchema.safeParse(reply.json);
    if (!parsed.success) return undefined;
    // cantingFromIdeas keeps the order of the suggestions, so each design lines up with its idea.
    const designs: NameDesign[] = [];
    for (const d of cantingFromIdeas(parsed.data, req)) {
      const m = d.meaningId ? chosen.get(d.meaningId) : undefined;
      if (!m || d.arms.layers.length === 0 || !armsV2Schema.safeParse(d.arms).success) continue;
      const line = m.attestation === 'family' || !m.root ? m.meaning : `${m.root}: ${m.meaning}`;
      designs.push({ arms: d.arms, explanation: d.explanation, meaningId: m.id, meaning: line });
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

// ---------- one call, one retry on bad output ----------

/** Asks once; if the answer is bad (not the shape, or the provider sent no usable answer), asks once more. Other errors pass through. */
async function ask<T>(c: Tr, adapter: AiAdapter, req: AiRequest, read: (reply: AiReply) => T | undefined): Promise<T> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    let reply: AiReply;
    try {
      reply = await adapter.complete(req);
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
