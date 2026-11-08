import { isLocale, type Locale } from '../i18n/types';
// Types and schemas the AI features share between the server and the browser. Nothing here touches a
// provider, a key or the database: keep it that way, since the browser imports this file.
import { z } from 'zod';
import { cutText, firstOf } from './trim';
import { FIELD_TYPES } from '~/components/fields/model';
import { VISIBILITIES } from '../visibility';
import type { ArmsV2 } from '~/lib/seed-format';

export const PROVIDERS = ['anthropic', 'openai', 'openrouter'] as const;
export type Provider = (typeof PROVIDERS)[number];
export const PROVIDER_LABEL: Record<Provider, string> = { anthropic: 'Anthropic', openai: 'OpenAI', openrouter: 'OpenRouter' };
/** The default model per provider. OpenRouter takes any model id it lists, so its default is only a suggestion. */
export const DEFAULT_MODEL: Record<Provider, string> = {
  anthropic: 'claude-haiku-5-5', // the measured best value: docs/ai-model-test.md
  openai: 'gpt-6.1-sol',
  openrouter: 'google/gemini-3.8-flash', // the measured best: docs/ai-model-test-openrouter.md
};

export const FEATURES = ['assistant', 'faces', 'avatar', 'arms'] as const;
export type Feature = (typeof FEATURES)[number];
export type AiFeatures = Record<Feature, boolean>;

/**
 * The jobs that can each use their own provider and model (a route). The assistant's route is the base: the others
 * follow it, unless a steward picks one. Painted portraits have their own route and only offer image-capable providers.
 */
export const ROUTES = ['assistant', 'arms', 'faces', 'avatar', 'portrait', 'arms-review', 'occupations', 'chronicle', 'names'] as const;
export type Route = (typeof ROUTES)[number];
/** Whether a route may follow the assistant's provider and model (the "same as the assistant" choice). Painting never does. */
export const followsAssistant = (r: Route): boolean => r !== 'assistant' && r !== 'portrait';
/** The providers that can paint a portrait: Kindred has an adapter for their image models (OpenRouter's, today). */
export const PAINT_PROVIDERS: readonly Provider[] = ['openrouter'];
/** The background tasks, and the route each one uses. */
export const TASK_ROUTE = { arms: 'arms-review', occupations: 'occupations', chronicle: 'chronicle', names: 'names' } as const;
export type TaskName = keyof typeof TASK_ROUTE;

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

/** One connected provider as the settings page shows it: never the key itself, only its masked tail. */
export interface ProviderState {
  provider: Provider;
  keyState: 'none' | 'saved' | 'unreadable';
  keyTail: string | null;
  updated: number;
}

/** A route as the settings page shows it: what the steward chose, where the job goes now, and whether it can run. */
export interface RouteState {
  route: Route;
  /** The steward's choice. Null provider: the same as the assistant (and its model). */
  provider: Provider | null;
  model: string;
  /** The provider and model the job uses now, after "same as the assistant" is applied. Null when no provider is chosen. */
  effective: { provider: Provider; model: string } | null;
  /** ready: the job's switch is on and its provider is connected. needs-provider: its provider is not connected (never rerouted). */
  state: 'off' | 'ready' | 'needs-provider' | 'needs-model';
}

/** What the AI settings page reads. Money is in micro-dollars (1 USD = 1,000,000). */
export interface AiSettingsData {
  providers: ProviderState[];
  routes: RouteState[];
  features: AiFeatures;
  /** The painted-portrait switch and each background task's switch: their routes are in `routes`. */
  portraitEnabled: boolean;
  tasks: Record<TaskName, boolean>;
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
  /** Whether the model reasons before it answers, when the provider's list says so (OpenRouter). Absent: unknown. */
  reasoning?: boolean;
}

export const PROPOSAL_KINDS = [
  'add-person', 'link-relative', 'set-dates', 'add-story', 'add-field',
  'family', 'photo-details', 'photo-album', 'photo-tags', 'avatar', 'set-occupation', 'house-settings',
] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];

/** A JSON value: what a proposal's arguments may hold, so they travel to the browser and back unchanged. */
export type ProposalArg = string | number | boolean | null | ProposalArg[] | { [key: string]: ProposalArg };
export type ProposalArgs = Record<string, ProposalArg>;

/**
 * What the card shows beyond the diff, computed on the server and never sent back on approval: thumbnails of photos,
 * the names of people the draft refers to, and the checks that found a likely duplicate or a loop.
 */
export interface ProposalView {
  /** Thumbnail addresses of the photos a card shows, by media key. */
  thumbs?: Record<string, string>;
  /** Names of existing people the card refers to, by id. */
  names?: Record<string, string>;
  /** People in a family draft who may already be in the tree: the draft row's ref, and the existing person. */
  duplicates?: { ref: string; id: string; name: string; born?: string | null }[];
  /** Indices of the draft's links that would make someone their own ancestor. */
  loops?: number[];
  /** Short questions for the reader, when something in the draft is uncertain ("Which Hans?"). */
  questions?: string[];
  /** The list may hold strangers (it was read from a picture or holds profiles): the reader ticks who is added. */
  pick?: boolean;
  /** People in the tree a draft row may be, by the row's ref, best first. `sure`: the same profile, or the same full name. */
  matches?: Record<string, { id: string; name: string; born?: string | null; sure: boolean }[]>;
  /** People the draft left out because the tree already has them with this profile. */
  known?: { name: string; handle: string }[];
  /** The person's name, for a drawn avatar. */
  personName?: string;
  /** The photos' details as they are now, by key, so a card can show what changes. */
  before?: Record<string, { taken?: string | null; place?: string | null; caption?: string | null; album?: string | null }>;
}

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
  /** Display-only data for the card (see ProposalView). Never sent on approval. */
  view?: ProposalView;
}

/** A temporary id for a person who is not in the tree yet: "n1", "n2"… Only meaningful inside one family draft. */
export const NEW_REF = /^n\d{1,3}$/;

export interface ChatItem {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /** A family session's transcript (its text), shown as a summary rather than in full. */
  session?: boolean;
  /** Pictures sent with this message: how many, and the ids of those the reader chose to keep. */
  images?: { count: number; kept: string[] };
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

const baseProposalArgs = {
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
    /** Set by the server to the type's default (defaultVisibility); the approver may change it on the card. */
    visibility: z.enum(VISIBILITIES).optional(),
    /** The older form, on proposals saved before there were levels. Read by apply.ts only. */
    private: z.boolean().optional(),
  }),
} as const;

// ---------- vision and generation results ----------

/** A 0–10 face measure (portrait/look.ts). */
const level = z.number().int().min(0).max(10);

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
  // The face: its shape, nose, eyes, and the 0–10 measures (see portrait/look.ts). Dropped here, a path through this
  // schema would lose them, so they are listed with the portrait's own values.
  face: z.enum(['round', 'oval', 'square', 'long', 'heart']).optional(),
  noseShape: z.enum(['straight', 'aquiline', 'broad', 'snub']).optional(),
  eyeShape: z.enum(['round', 'almond', 'hooded']).optional(),
  jaw: level.optional(),
  noseSize: level.optional(),
  mouthWidth: level.optional(),
  mouthFullness: level.optional(),
  eyeSize: level.optional(),
  eyeSpacing: level.optional(),
  browHeight: level.optional(),
  earSize: level.optional(),
  hairline: level.optional(),
});

// ---------- the family draft, photos, avatars and the fill-in proposals (see ai/family.server.ts) ----------

const mediaKey = z.string().regex(/^gallery\/[a-z0-9-]{1,80}\.[a-z]{2,4}$/);
const relationKind = z.enum(['child', 'parent', 'partner', 'sibling']);
const picBox = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), w: z.number().gt(0).max(1), h: z.number().gt(0).max(1) });
/** A photo's details as the gallery stores them: `null` clears a field, an absent one is left as it is. */
const photoItem = z.object({
  key: mediaKey,
  taken: z.string().max(10).nullable().optional(),
  place: z.string().trim().max(200).nullable().optional(),
  caption: z.string().trim().max(1000).nullable().optional(),
  album: z.string().max(64).nullable().optional(),
});

/** One person in a family draft. A new person has a temporary `ref`; an approximate date is written with a leading ~. */
export const familyPersonSchema = z.object({
  ref: z.string().regex(NEW_REF),
  given: text(120),
  surname: z.string().trim().max(120).optional(),
  sex: sex.optional(),
  born: iso.optional(),
  bornPlace: z.string().trim().max(200).optional(),
  died: iso.optional(),
  diedPlace: z.string().trim().max(200).optional(),
  living: z.boolean(),
  occupation: z.string().trim().max(200).optional(),
  /** One memory, note or story for the person, added once they exist. */
  story: z.object({ kind: z.enum(['note', 'quote', 'anecdote', 'recipe', 'memory']), title: z.string().trim().max(200).optional(), body: text(20_000), /** Who told it, as an id in the tree. Without one it is saved under the approver's name. */ teller: id.optional() }).optional(),
  /** Social profiles to save on the person: the network's name, and the handle without its @. */
  social: z.array(z.object({ network: text(40), handle: text(300) })).max(5).optional(),
});
/** A relationship in a family draft: `anchor` and `person` are a new person's ref or an id in the tree. */
export const familyLinkSchema = z.object({ anchor: id, person: id, relation: relationKind, coParent: id.optional() });
export type FamilyPerson = z.infer<typeof familyPersonSchema>;
export type FamilyLink = z.infer<typeof familyLinkSchema>;

const fillArgs = {
  family: z.object({ people: z.array(familyPersonSchema).max(40), links: z.array(familyLinkSchema).max(80) }),
  'photo-details': z.object({ items: z.array(photoItem).min(1).max(40) }),
  'photo-album': z.object({
    name: text(80).optional(),
    albumId: id.optional(),
    items: z.array(photoItem).min(1).max(40),
  }).refine((a) => !!a.name || !!a.albumId, 'Name the album, or pick one'),
  'photo-tags': z.object({ key: mediaKey, people: z.array(z.object({ person: id, box: picBox.optional() })).min(1).max(20) }),
  avatar: z.object({ person: id, look: lookSchema }),
  'set-occupation': z.object({ person: id, occupation: text(200) }),
  'house-settings': z.object({
    house: id,
    law: z.enum(['absolute-primogeniture', 'seniority', 'elective']),
    head: id.nullable(),
    heir: id.nullable(),
    country: z.string().regex(/^[A-Z]{2}$/).nullable(),
  }),
};

export const proposalArgs = { ...baseProposalArgs, ...fillArgs } as typeof baseProposalArgs & typeof fillArgs;

export const faceResultSchema = z.object({
  faces: z.array(z.object({
    box: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }),
    suggestions: z.array(z.object({ personId: z.string(), confidence: z.number(), reason: z.string().overwrite(cutText(200)).describe('One short sentence, at most 200 characters.') })).overwrite(firstOf(5)).describe('At most five.'),
  })).overwrite(firstOf(40)).describe('At most forty faces.'),
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
  /** What its colours and charges stand for, in the reader's language. Optional: an older or sparse answer has none. */
  symbolism?: { element: string; why: string }[];
}

/** Why the arms do not yet fit their name, as the steward's check said it, and what to change. */
export interface ArmsFeedback { reason: string; advice: string }
/** A refinement keeps the arms as they are and adds the charges in `added` or swaps those in `replaced`; a fresh design starts again from the meanings. */
export type RevisionKind = 'refinement' | 'fresh';
export interface ArmsRevision extends NameDesign { kind: RevisionKind; added?: string[]; replaced?: { from: string; to: string }[] }

/** How many pictures one chat message may carry. */
export const CHAT_IMAGE_COUNT = 6;
/** The largest one picture may be after the browser has scaled it down. Small enough to keep as one database row. */
export const CHAT_IMAGE_BYTES = 1_200_000;
/** The largest file the browser will try to open at all: a phone's camera stays well under it. */
export const CHAT_IMAGE_FILE_BYTES = 40_000_000;
/** The longer side of a picture as it is sent, in pixels: the names in a screenshot stay readable. */
export const CHAT_IMAGE_EDGE = 2000;

/** The longest chat message the assistant takes. */
export const CHAT_MESSAGE_CHARS = 4_000;
/** The longest family session transcript sent in one go (a whole session, about an hour of talk). */
export const FAMILY_SESSION_CHARS = 20_000;
