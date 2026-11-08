import { isLocale, type Locale } from '../i18n/types';
// Types and schemas the AI features share between the server and the browser. Nothing here touches a
// provider, a key or the database: keep it that way, since the browser imports this file.
import { z } from 'zod';
import { FIELD_TYPES } from '~/components/fields/model';
import type { ArmsV2 } from '~/lib/seed-format';

export const PROVIDERS = ['anthropic', 'openai', 'openrouter'] as const;
export type Provider = (typeof PROVIDERS)[number];
export const PROVIDER_LABEL: Record<Provider, string> = { anthropic: 'Anthropic', openai: 'OpenAI', openrouter: 'OpenRouter' };
/** The default model per provider. OpenRouter takes any model id it lists, so its default is only a suggestion. */
export const DEFAULT_MODEL: Record<Provider, string> = {
  anthropic: 'claude-sonnet-5-5',
  openai: 'gpt-6.1-sol',
  openrouter: 'anthropic/claude-sonnet-5-5',
};

export const FEATURES = ['assistant', 'faces', 'avatar', 'arms'] as const;
export type Feature = (typeof FEATURES)[number];
export type AiFeatures = Record<Feature, boolean>;

/** The reader's locale as the assistant speaks it. Anything else answers in English. */
export type AiLocale = Locale;
/** Any locale the app ships; anything else answers in English. */
export const toAiLocale = (l: string | undefined): AiLocale => (isLocale(l) ? l : 'en');

/** What the browser needs to decide which AI controls to show: a feature is on only when switched on and configured. */
export interface AiStatus {
  configured: boolean;
  provider: Provider | 'fake' | null;
  features: AiFeatures;
}

/** A price the family typed in for a model Kindred has no price for: USD per 1M tokens. */
export interface CustomPrice { inPerM: number; outPerM: number }

/** What the AI settings page reads: never the key itself, only its masked tail. Money is in micro-dollars (1 USD = 1,000,000). */
export interface AiSettingsData {
  provider: Provider;
  model: string;
  defaultModel: string;
  keyState: 'none' | 'saved' | 'unreadable';
  keyTail: string | null;
  features: AiFeatures;
  /** Web search for the assistant: the model may search the web, and the search queries go to the provider. */
  webSearch: boolean;
  /** The monthly budget. 0 turns AI off. */
  monthlyMicros: number;
  /** What this UTC month has booked so far. */
  spentMicros: number;
  /** The first day of next month (UTC, YYYY-MM-DD): when the budget starts again. */
  resetsOn: string;
  /** The family's own prices, by model id. */
  customPrices: Record<string, CustomPrice>;
  updated: number;
}

/** A model a provider offers, with what Kindred knows about it. Null means unknown, never "no". */
export interface ModelInfo {
  id: string;
  name: string;
  /** The largest input the model takes, in tokens, when the provider says. */
  contextTokens: number | null;
  /** USD per 1M tokens, when Kindred knows the price (its table, or OpenRouter's list). */
  inPerM: number | null;
  outPerM: number | null;
  /** USD per web search, when known. */
  searchEach: number | null;
  vision: boolean | null;
  tools: boolean | null;
  webSearch: boolean | null;
}

export const PROPOSAL_KINDS = ['add-person', 'link-relative', 'set-dates', 'add-story', 'add-field'] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];

/** Serialisable, so it can travel to the browser and back: flat values, and a field's value as text keys. */
export type ProposalArg = string | boolean | Record<string, string>;
export type ProposalArgs = Record<string, ProposalArg>;

/** One change the assistant suggests. Nothing is written until the reader approves it (see components/assistant/apply.ts). */
export interface Proposal {
  id: string;
  kind: ProposalKind;
  /** One line, in the reader's language. */
  summary: string;
  /** What changes, for the card: "Born — → 3 May 1902". Display only. */
  diff: { label: string; from?: string; to: string }[];
  /** The arguments approval sends to the existing server function. Text fields listed in `editable` may be changed first. */
  args: ProposalArgs;
  editable: string[];
  status: 'open' | 'done' | 'dismissed';
}

export interface ChatItem {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  proposals?: Proposal[];
  /** The pages a web search drew on for this reply, when the family allowed web search. */
  sources?: { url: string; title?: string }[];
  at: number;
}

// ---------- what the assistant may propose (validated on the server, and again by the server function approval calls) ----------

const iso = z.string().trim().min(4).max(10);
const sex = z.enum(['m', 'f', 'x']);
const id = z.string().min(1).max(100);
const text = (max: number) => z.string().trim().min(1).max(max);

export const proposalArgs = {
  'add-person': z.object({
    anchor: id,
    relation: z.enum(['child', 'parent', 'partner', 'sibling']),
    coParent: id.optional(),
    given: text(120),
    surname: z.string().trim().max(120).optional(),
    sex: sex.optional(),
    born: iso.optional(),
    died: iso.optional(),
    living: z.boolean(),
  }),
  'link-relative': z.object({
    anchor: id,
    person: id,
    relation: z.enum(['child', 'parent', 'partner', 'sibling']),
    coParent: id.optional(),
  }),
  'set-dates': z.object({
    person: id,
    born: iso.optional(),
    bornPlace: z.string().trim().max(200).optional(),
    died: iso.optional(),
    diedPlace: z.string().trim().max(200).optional(),
  }),
  'add-story': z.object({
    person: id,
    kind: z.enum(['note', 'quote', 'anecdote', 'recipe', 'memory']),
    title: z.string().trim().max(200).optional(),
    body: text(20_000),
  }),
  'add-field': z.object({
    person: id,
    type: z.enum(FIELD_TYPES),
    label: z.string().trim().max(60).optional(),
    value: z.record(z.string(), z.string().max(5000)),
    /** Set by the server to the type's default (privateByDefault); the approver may change it on the card. */
    private: z.boolean().optional(),
  }),
} as const;

// ---------- vision and generation results ----------

/** A portrait look, as stored on a person (SeedLook in seed-format.ts). Indices are palette positions (look.ts). */
export const lookSchema = z.object({
  skin: z.number().int().min(0).max(8),
  hair: z.number().int().min(0).max(9),
  eyes: z.number().int().min(0).max(6),
  beard: z.boolean().optional(),
  headwear: z.enum(['none', 'crown', 'circlet', 'mitre', 'veil', 'wimple', 'hood', 'coif', 'beret', 'mobcap', 'tricorn', 'tophat', 'bonnet', 'flatcap', 'fedora', 'cloche', 'headscarf', 'beanie']).optional(),
  hairStyle: z.enum(['tuft', 'cropped', 'short', 'side-part', 'swept', 'curly', 'afro', 'quiff', 'bowl', 'shoulder', 'long', 'wavy', 'braid', 'bun', 'chignon', 'bob', 'pixie', 'ponytail', 'pigtails', 'periwig', 'powdered', 'receding', 'bald']).optional(),
  hairGreys: z.boolean().optional(),
  beardStyle: z.enum(['none', 'stubble', 'short', 'full', 'long', 'goatee', 'vandyke', 'muttonchops']).optional(),
  moustache: z.enum(['none', 'thin', 'chevron', 'handlebar', 'walrus']).optional(),
  brows: z.enum(['soft', 'straight', 'arched', 'thick', 'thin', 'bushy']).optional(),
  glasses: z.enum(['none', 'round', 'oval', 'square', 'browline', 'half']).optional(),
  clothing: z.enum(['tunic', 'cotehardie', 'gown', 'doublet', 'bodice', 'ruff', 'lace-collar', 'coat', 'stays', 'frock', 'victorian', 'suit', 'blouse', 'suit-slim', 'pearls', 'shirt', 'turtleneck', 'sweater', 'tshirt', 'hoodie', 'cardigan', 'smock', 'sailor', 'pinafore', 'knit', 'stripes', 'onesie']).optional(),
  marks: z.array(z.enum(['freckles', 'mole', 'blush', 'dimples', 'scar'])).max(5).optional(),
  age: z.number().int().min(0).max(120).optional(),
});

export const faceResultSchema = z.object({
  faces: z.array(z.object({
    box: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }),
    suggestions: z.array(z.object({ personId: z.string(), confidence: z.number(), reason: z.string() })).max(5),
  })).max(40),
});
export type FaceResult = z.infer<typeof faceResultSchema>;


// ---------- arms from a name, in two steps: what the name means, then the arms that follow ----------

/** Well attested: dictionaries and etymology agree. Speculative: a guess or folk etymology. Family: the family's own meaning. */
export const ATTESTATIONS = ['well-attested', 'speculative', 'family'] as const;
export type Attestation = (typeof ATTESTATIONS)[number];
export const IDEA_KINDS = ['quality', 'object', 'trade', 'sound'] as const;
export type IdeaKind = (typeof IDEA_KINDS)[number];

/** One candidate meaning of a surname, as the reader sees and selects it. `id` is set by the server (or by the browser for a reader's own). */
export const nameMeaningSchema = z.object({
  id: z.string().trim().min(1).max(20),
  /** The languages or regions it belongs to, in the reader's language, e.g. "Dutch and German". Empty for the family's own. */
  language: z.string().trim().max(80),
  root: z.string().trim().max(60),
  meaning: z.string().trim().min(1).max(200),
  attestation: z.enum(ATTESTATIONS),
  ideas: z.array(z.object({ kind: z.enum(IDEA_KINDS), idea: z.string().trim().min(1).max(160) })).max(6),
  /** Web pages the research drew on for this meaning. Only ever the pages a search returned. */
  sources: z.array(z.object({ url: z.string().min(8).max(400), title: z.string().max(200).optional() })).max(3).optional(),
});
export type NameMeaning = z.infer<typeof nameMeaningSchema>;
/** The meanings the reader chose to design from: the research's fields without the sources. */
export const designMeaningSchema = nameMeaningSchema.omit({ sources: true });
export type DesignMeaning = z.infer<typeof designMeaningSchema>;

/** What step one returns: the candidate meanings, and whether the web was searched for them. */
export interface NameResearch {
  meanings: NameMeaning[];
  /** The model's own honest note, e.g. that the name is rare and little is written about it. */
  note?: string;
  /** True when the family allows web search and it was offered to the model; false means the model's own knowledge only. */
  webSearched: boolean;
}

/** One design from step two: the arms, what it draws on, and why, in the reader's language. */
export interface NameDesign {
  arms: ArmsV2;
  explanation: string;
  /** The id of the chosen meaning it draws on, and that meaning's line for display ("heer: lord, gentleman"). */
  meaningId: string;
  meaning: string;
}
