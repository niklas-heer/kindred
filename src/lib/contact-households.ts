// Who shares a contact card. Couples with a shared address do; a child under 18 joins a parent's card only when asked to.
import { ageAt, displayName, parents, type Family } from './graph.ts';
import type { GPerson } from './types.ts';
import { compareText } from './i18n/dictionary.ts';
import type { Locale } from './i18n/types.ts';

import type { Visibility } from './visibility';

export interface Row {
  id: number;
  person: string;
  kind: 'phone' | 'email' | 'address' | 'web' | 'messenger';
  label: string | null;
  value: string;
  visibility: Visibility;
}

export interface Household {
  id: string;
  members: GPerson[];
  rows: Map<string, Row[]>;
  /** Addresses of everyone in the card, shown once. */
  addresses: Row[];
  sortKey: string;
}

const norm = (s: string) => s.toLowerCase().replace(/[\s,.\-/]+/g, '');

export function buildHouseholds(f: Family, rows: Row[], opts: { childrenWithParent?: boolean; locale?: Locale } = {}) {
  const cmp = compareText(opts.locale);
  const by = new Map<string, Row[]>();
  for (const r of rows) {
    if (!f.byId.get(r.person)?.living) continue;
    const a = by.get(r.person);
    if (a) a.push(r);
    else by.set(r.person, [r]);
  }
  // Union-find over people who share a card.
  const root = new Map<string, string>();
  const find = (x: string): string => {
    let r = root.get(x) ?? x;
    while ((root.get(r) ?? r) !== r) r = root.get(r)!;
    root.set(x, r);
    return r;
  };
  const join = (a: string, b: string) => root.set(find(a), find(b));
  const addrs = (id: string) => new Set((by.get(id) ?? []).filter((r) => r.kind === 'address').map((r) => norm(r.value)));

  for (const u of f.graph.unions) {
    if (u.end || !by.has(u.a) || !by.has(u.b)) continue;
    const a = addrs(u.a);
    if ([...addrs(u.b)].some((v) => a.has(v))) join(u.a, u.b);
  }
  const attached = new Set<string>();
  for (const p of opts.childrenWithParent ? f.graph.people : []) {
    if (!p.living) continue;
    const years = ageAt(p.born);
    if (years === undefined || years >= 18) continue;
    const home = parents(f, p.id).find((x) => by.has(x));
    if (home) {
      join(p.id, home);
      attached.add(p.id);
    }
  }

  const groups = new Map<string, GPerson[]>();
  const noDetails: GPerson[] = [];
  for (const p of f.graph.people) {
    if (!p.living) continue;
    if (!by.has(p.id) && !attached.has(p.id)) {
      noDetails.push(p);
      continue;
    }
    const r = find(p.id);
    const g = groups.get(r);
    if (g) g.push(p);
    else groups.set(r, [p]);
  }

  const households: Household[] = [...groups.entries()].map(([id, members]) => {
    members.sort((a, b) => (a.born ?? '9999').replace(/^~/, '').localeCompare((b.born ?? '9999').replace(/^~/, '')));
    const seen = new Set<string>();
    const addresses: Row[] = [];
    for (const m of members)
      for (const r of by.get(m.id) ?? [])
        if (r.kind === 'address' && !seen.has(norm(r.value))) {
          seen.add(norm(r.value));
          addresses.push(r);
        }
    const lead = members[0];
    return { id, members, rows: by, addresses, sortKey: `${lead.surname ?? lead.given} ${lead.given}`.toLowerCase() };
  });
  households.sort((a, b) => cmp(a.sortKey, b.sortKey));
  noDetails.sort((a, b) => cmp(displayName(a, f), displayName(b, f)));
  return { households, noDetails };
}

