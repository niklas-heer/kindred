import type { Graph } from '../types';

export interface TodayEvent { key: string; id: string; name: string; label: string }

/** The Almanac's recurring-event rules, restricted to today's date. */
export function todayEvents(graph: Graph, today = new Date()): TodayEvent[] {
  const year = today.getFullYear();
  const md = `${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const years = (date?: string) => date && /^\d{4}-\d{2}-\d{2}$/.test(date) && date.slice(5) === md ? year - Number(date.slice(0, 4)) : 0;
  const name = (p: Graph['people'][number]) => [p.given, p.surname].filter(Boolean).join(' ');
  const out: TodayEvent[] = [];
  const people = new Map(graph.people.map((p) => [p.id, p]));
  for (const p of graph.people) {
    if (p.living && years(p.born) > 0) out.push({ key: `b:${p.id}`, id: p.id, name: name(p), label: 'Birthday' });
    const n = years(p.died);
    if (!p.living && n > 0 && n <= 30) out.push({ key: `m:${p.id}`, id: p.id, name: name(p), label: `Remembering · ${n} years` });
  }
  for (const u of graph.unions) {
    const a = people.get(u.a), b = people.get(u.b), n = years(u.start);
    if (u.kind === 'marriage' && !u.end && a?.living && b?.living && n > 0) out.push({ key: `a:${u.id}`, id: a.id, name: `${name(a)} & ${name(b)}`, label: `Wedding anniversary · ${n} years` });
  }
  return out;
}
