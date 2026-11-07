// What the browser receives. The whole graph of a tree comes in one request (a few hundred KB for
// 1,500 people) so layout, search, kinship and the minimap all run locally and instantly.
import type { SeedHouse, SeedPerson, SeedStory, SeedContact } from './seed-format';

export type House = SeedHouse;
export type Look = NonNullable<SeedPerson['look']>;

export interface TreeMeta {
  id: string;
  name: string;
  tagline: string;
  theme: 'codex' | 'modern';
  focus: string;
  people: number;
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
  nickname?: string;
  traits?: string[];
  look?: Look;
  photo?: string; // photo timestamp, for cache busting
  stories: number;
  bornPlace?: string;
  diedPlace?: string;
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
  kind: 'marriage' | 'partnership' | 'betrothal';
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
}

export type Story = SeedStory;
export type Contact = SeedContact & { id: number };

export interface PersonDetail {
  id: string;
  bio?: string;
  bornPlace?: string;
  diedPlace?: string;
  favourite?: string;
  updatedAt: string;
  stories: Story[];
  contacts: Contact[];
}
