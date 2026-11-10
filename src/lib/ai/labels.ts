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

/** A story's kind, as its name in the reader's language. */
export const STORY_KIND_KEY: Record<string, Key> = {
  note: 'ai.storyKindNote', quote: 'ai.storyKindQuote', anecdote: 'ai.storyKindAnecdote', recipe: 'ai.storyKindRecipe', memory: 'ai.storyKindMemory',
};

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
  'edit-person': 'chat.kind.editPerson',
  'update-field': 'chat.kind.updateField',
  'remove-field': 'chat.kind.removeField',
  'remove-story': 'chat.kind.removeStory',
  unlink: 'chat.kind.unlink',
  partnership: 'chat.kind.partnership',
  'partnership-end': 'chat.kind.partnershipEnd',
  'remove-person': 'chat.kind.removePerson',
  'house-details': 'chat.kind.houseDetails',
  'house-create': 'chat.kind.houseCreate',
  'house-members': 'chat.kind.houseMembers',
  'house-words': 'chat.kind.houseWords',
  'album-rename': 'chat.kind.albumRename',
  'album-delete': 'chat.kind.albumDelete',
  'photo-remove': 'chat.kind.photoRemove',
  'photo-untag': 'chat.kind.photoUntag',
  'person-display': 'chat.kind.personDisplay',
  'place-pin': 'chat.kind.placePin',
  'research-project': 'chat.kind.researchProject',
  'research-note': 'chat.kind.researchNote',
  'research-document': 'chat.kind.researchDocument',
  'research-link': 'chat.kind.researchLink',
  'research-remove': 'chat.kind.researchRemove',
  'family-details': 'chat.kind.familyDetails',
  'life-event': 'ailife.kind.event',
  source: 'ailife.kind.source',
  citation: 'ailife.kind.citation',
  'life-remove': 'ailife.kind.remove',
};
