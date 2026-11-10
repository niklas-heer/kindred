// What the browser receives. The whole graph of a tree comes in one request (a few hundred KB for
// 1,500 people) so layout, search, kinship and the minimap all run locally and instantly.
import type { SeedHouse, SeedPerson, SeedStory, SeedContact } from './seed-format';
import type { PersonField } from '../components/fields/model';

export type House = SeedHouse;
export type Look = NonNullable<SeedPerson['look']>;

export interface TreeMeta {
  id: string;
  name: string;
  tagline: string;
  theme: 'codex' | 'modern';
  focus: string;
  people: number;
  crest?: House['arms'];
  birthdays?: { id: string; name: string }[];
}

/** The slim person record the graph needs. Details (bio, stories, contacts) load per person. */
export interface GPerson {
  id: string;
  given: string;
  surname?: string;
  house?: string;
  sex?: 'm' | 'f' | 'x';
  born?: string;
  died?: string;
  living: boolean;
  epithet?: string;
  title?: string;
  occupation?: string;
  /** The occupation vocabulary id (src/lib/occupations.ts), when the text names one. */
  occupationCode?: string;
  nickname?: string;
  traits?: string[];
  look?: Look;
  photo?: string; // photo timestamp, for cache busting
  stories: number;
  contacts: number;
  bornPlace?: string;
  diedPlace?: string;
  /** The name a person goes by now, when it differs from the birth name. Absent means "same as birth". */
  currentGiven?: string;
  /** Further given names, in order after `given` (second name, third name, ...). Absent means none. Part of the birth name. */
  furtherGiven?: string[];
  currentSurname?: string;
  /** Show the drawn avatar even though a photo is kept (person.prefer_avatar). Absent means false. */
  preferAvatar?: boolean;
  /** Show the accepted painted portrait, when it fits the age shown (person.prefer_portrait). Absent means false. */
  preferPortrait?: boolean;
  /** The accepted painted portrait's media key (portrait/<uuid>.<ext>), when there is one. The picture is fetched by person. */
  portrait?: string;
  /** The age the person was in their photo, from its date and their birth year; null when either is unknown (an adult is then assumed). */
  portraitAge?: number | null;
}

export interface Place {
  name: string;
  lat: number;
  lng: number;
  country?: string;
}

export interface GParent {
  child: string;
  parent: string;
  kind: 'biological' | 'adoptive' | 'foster' | 'step';
  confidence: 'certain' | 'probable' | 'disputed';
}

export interface GUnion {
  id: string;
  a: string;
  b: string;
  kind: 'marriage' | 'partnership' | 'betrothal' | 'other';
  start?: string;
  end?: string;
  endReason?: string;
  place?: string;
}

export interface Graph {
  tree: TreeMeta;
  houses: House[];
  people: GPerson[];
  parents: GParent[];
  unions: GUnion[];
  places: Place[];
  /**
   * Set for a share-link guest whose link protects living people: the living arrive without dates, places or details
   * (src/lib/protect-living.ts), so a page must not read their absence as something the family has yet to find out.
   */
  livingProtected?: true;
}

export type Story = SeedStory;
export type Contact = SeedContact & { id: number };

/** The details of one person: the biography, stories and the list of fields the reader may see. */
export interface PersonDetail {
  id: string;
  bio?: string;
  bornPlace?: string;
  diedPlace?: string;
  updatedAt: string;
  /** Bumps with every change to the person or their fields; a save sends back the one it opened (see person.server.ts). */
  revision?: number;
  stories: Story[];
  /** In the order the family keeps them. Private fields are only here for editors and stewards. */
  fields: PersonField[];
}

export type { PersonField } from '../components/fields/model';
