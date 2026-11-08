// The AI feature's words that are not sentences: provider names, the kind of each proposal, and the
// translator the server uses. Sentences live in the i18n areas (keys `ai.*`), read with `useT()` in components
// and with `tr(locale)` in server code, so the same dictionary serves both.
import { translate, type Key, type Locale, type Vars } from '../i18n/dictionary';
import type { ProposalKind } from './types';

/** A translator bound to one request's locale: `c('ai.errBudget')`. Server code and pure helpers use it. */
export const tr = (locale: Locale) => (key: Key, vars?: Vars) => translate(locale, key, vars);
export type Tr = ReturnType<typeof tr>;

/** Provider brand names are never translated. */
export const PROVIDER_NOTE = { anthropic: 'Anthropic', openai: 'OpenAI', openrouter: 'OpenRouter' } as const;

export const PROPOSAL_KIND_KEY: Record<ProposalKind, Key> = {
  'add-person': 'ai.kindAddPerson',
  'link-relative': 'ai.kindLinkRelative',
  'set-dates': 'ai.kindSetDates',
  'add-story': 'ai.kindAddStory',
  'add-field': 'ai.kindAddField',
  family: 'ai.kindFamily',
  'photo-details': 'ai.kindPhotoDetails',
  'photo-album': 'ai.kindPhotoAlbum',
  'photo-tags': 'ai.kindPhotoTags',
  avatar: 'ai.kindAvatar',
  'set-occupation': 'ai.kindSetOccupation',
  'house-settings': 'ai.kindHouse',
};
