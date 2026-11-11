// Shared by both generators: integrity checks on a SeedTree, summary counts, and JSON output.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { reactionOf } from '../../src/lib/responses.ts';
import type { SeedTree } from '../../src/lib/seed-format.ts';

export interface Summary {
  people: number;
  unions: number;
  stories: number;
  contacts: number;
  living: number;
  maxGenerationDepth: number;
  largestHouse: { name: string; members: number };
}

/** Throws on the first broken reference, self-parent, or parent cycle. */
export function validate(tree: SeedTree): void {
  const fail = (msg: string): never => {
    throw new Error(`${tree.id}: ${msg}`);
  };

  const ids = <T extends { id: string }>(list: T[], label: string): Set<string> => {
    const set = new Set<string>();
    for (const item of list) {
      if (set.has(item.id)) fail(`duplicate ${label} id ${item.id}`);
      set.add(item.id);
    }
    return set;
  };

  const houses = ids(tree.houses, 'house');
  const people = ids(tree.people, 'person');
  ids(tree.unions, 'union');
  ids(tree.stories, 'story');

  const needPerson = (id: string, where: string) => {
    if (!people.has(id)) fail(`${where} references missing person ${id}`);
  };

  for (const p of tree.people) {
    if (p.house && !houses.has(p.house)) fail(`person ${p.id} references missing house ${p.house}`);
  }
  for (const h of tree.houses) {
    if (h.founder) needPerson(h.founder, `house ${h.id} founder`);
  }
  for (const u of tree.unions) {
    needPerson(u.a, `union ${u.id}`);
    needPerson(u.b, `union ${u.id}`);
    if (u.a === u.b) fail(`union ${u.id} pairs ${u.a} with itself`);
  }
  for (const s of tree.stories) needPerson(s.person, `story ${s.id}`);
  for (const c of tree.contacts) needPerson(c.person, 'contact');
  needPerson(tree.focus, 'focus');
  // The feed: whoever writes, comments or reacts, and whoever a post is about, is in the family.
  for (const [i, post] of (tree.posts ?? []).entries()) {
    needPerson(post.by, `post ${i + 1}`);
    for (const id of post.people ?? []) needPerson(id, `post ${i + 1} about`);
    for (const c of post.comments ?? []) needPerson(c.by, `post ${i + 1} comment`);
    for (const r of post.reactions ?? []) needPerson(r.by, `post ${i + 1} reaction`);
    if (!post.body.trim() && !post.pictures?.length) fail(`post ${i + 1} says nothing`);
    for (const r of post.reactions ?? []) if (!reactionOf(r.kind)) fail(`post ${i + 1}: "${r.kind}" is not one emoji`);
  }
  for (const [i, u] of (tree.updates ?? []).entries()) {
    needPerson(u.by, `update ${i + 1}`);
    needPerson(u.person, `update ${i + 1} about`);
  }
  for (const [i, upload] of (tree.uploads ?? []).entries()) needPerson(upload.by, `upload ${i + 1}`);

  // Parent graph: no self-parents, no cycles.
  const parentsOf = new Map<string, string[]>();
  for (const link of tree.parents) {
    needPerson(link.child, 'parent link child');
    needPerson(link.parent, 'parent link parent');
    if (link.child === link.parent) fail(`self-parent on ${link.child}`);
    const list = parentsOf.get(link.child) ?? [];
    list.push(link.parent);
    parentsOf.set(link.child, list);
  }
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (id: string): void => {
    const s = state.get(id);
    if (s === 'done') return;
    if (s === 'visiting') fail(`parent cycle through ${id}`);
    state.set(id, 'visiting');
    for (const par of parentsOf.get(id) ?? []) visit(par);
    state.set(id, 'done');
  };
  for (const p of tree.people) visit(p.id);
}

/** Longest chain of parent links, counting the person as generation 1. */
export function generationDepth(tree: SeedTree): number {
  const parentsOf = new Map<string, string[]>();
  for (const link of tree.parents) {
    const list = parentsOf.get(link.child) ?? [];
    list.push(link.parent);
    parentsOf.set(link.child, list);
  }
  const memo = new Map<string, number>();
  const depth = (id: string): number => {
    const cached = memo.get(id);
    if (cached !== undefined) return cached;
    let best = 1;
    for (const par of parentsOf.get(id) ?? []) best = Math.max(best, depth(par) + 1);
    memo.set(id, best);
    return best;
  };
  let max = 0;
  for (const p of tree.people) max = Math.max(max, depth(p.id));
  return max;
}

export function summarize(tree: SeedTree): Summary {
  const perHouse = new Map<string, number>();
  for (const p of tree.people) {
    if (p.house) perHouse.set(p.house, (perHouse.get(p.house) ?? 0) + 1);
  }
  let largest = { name: '', members: 0 };
  for (const h of tree.houses) {
    const members = perHouse.get(h.id) ?? 0;
    if (members > largest.members) largest = { name: h.name, members };
  }
  return {
    people: tree.people.length,
    unions: tree.unions.length,
    stories: tree.stories.length,
    contacts: tree.contacts.length,
    living: tree.people.filter((p) => p.living === true).length,
    maxGenerationDepth: generationDepth(tree),
    largestHouse: largest,
  };
}

/** Pretty JSON with a trailing newline. Key order is the object's insertion order, so output is stable. */
export function writeTree(tree: SeedTree, path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(tree, null, 2) + '\n');
}
