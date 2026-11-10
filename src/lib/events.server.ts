// A person's life events: the reads for the timeline and the Atlas, and the editor's changes. Every change is a `once` plan
// whose guards restate what it read (db.server.ts). Who may do what is checked here as well as in the server functions
// (events.functions.ts): reading is every reader's, a guest's included, and changing is an editor's (`edit-person`).
//
// A guest whose link protects living people (src/lib/protect-living.ts) gets no event of a living person: not on their page,
// not on the Atlas, and no place that only such an event names.
import { fail } from './auth/guard.server';
import { forbidden } from './auth/errors';
import { added, change, db, guard, once, personExists, q, removed, type OpKey, type Query } from './db.server';
import { AFTER_DEATH, byDate, MAX_EVENTS, type EventInput, type EventType, type LifeEvent } from './events.ts';
import { LIVING_IDS } from './protect-living.ts';
import { can, type Role } from './roles.ts';
import type { Place } from './types';

/** Who is asking, as the guard established it. A guest has no id. */
export interface LifeReader { id: string; name: string; role: Role; guest?: boolean; protectLiving?: boolean }

interface EventRow { id: string; person: string; type: EventType; label: string | null; date: string | null; end_date: string | null; place: string | null; note: string; ord: number }

const now = () => new Date().toISOString();
export const eventOf = (r: EventRow): LifeEvent => ({ id: r.id, person: r.person, type: r.type, label: r.label, date: r.date, endDate: r.end_date, place: r.place, note: r.note, ord: r.ord });

/** Refuses anyone who may not edit people. A guest is a viewer, so a guest is refused too. */
export function needsEditor(who: LifeReader) {
  if (who.guest || !can(who.role, 'edit-person')) throw fail(forbidden('edit-person', 'editor'));
}

// ---------- reads ----------

/** One person's events in timeline order, as this reader may see them. */
export async function personEvents(tree: string, person: string, who: LifeReader): Promise<LifeEvent[]> {
  const rows = await db(tree).all<EventRow>(
    `SELECT e.* FROM life_event e WHERE e.person = ? ${who.protectLiving ? `AND e.person NOT IN (${LIVING_IDS})` : ''}`,
    person,
  );
  return rows.map(eventOf).sort(byDate);
}

/** Every event that names a place, for the Atlas, with the pins of those places (a guest's graph may not carry them). */
export async function familyEventPlaces(tree: string, who: LifeReader): Promise<{ events: LifeEvent[]; places: Place[] }> {
  const d = db(tree);
  const living = who.protectLiving ? `AND e.person NOT IN (${LIVING_IDS})` : '';
  const [rows, pins] = await Promise.all([
    d.all<EventRow>(`SELECT e.* FROM life_event e WHERE e.place IS NOT NULL AND e.place <> '' ${living} ORDER BY e.date, e.ord, e.id`),
    d.all<{ name: string; lat: number; lng: number; country: string | null }>(
      `SELECT p.name, p.lat, p.lng, p.country FROM place p WHERE p.name IN (SELECT e.place FROM life_event e WHERE e.place IS NOT NULL ${living})`,
    ),
  ]);
  return {
    events: rows.map(eventOf),
    places: pins.map((r) => ({ name: r.name, lat: r.lat, lng: r.lng, ...(r.country ? { country: r.country } : {}) })),
  };
}

// ---------- changes ----------

const clean = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null);

/**
 * Adds an event (no id) or changes one. An event stays with the person it was added to. A custom event needs its own label;
 * a burial or a cremation is only for someone not living. Returns the event's id.
 */
export function saveEvent(tree: string, who: LifeReader, input: EventInput, op: OpKey | undefined): Promise<{ id: string }> {
  return once(tree, op, 'saveLifeEvent', async (d) => {
    needsEditor(who);
    const label = clean(input.label);
    if (input.type === 'custom' && !label) throw new Error('events.err.label_required');
    const person = await d.get<{ living: number }>('SELECT living FROM person WHERE id = ?', input.person);
    if (!person) throw new Error('events.err.person_gone');
    if (AFTER_DEATH.has(input.type) && person.living === 1) throw new Error('events.err.living');
    if (input.date && input.endDate && input.endDate.replace(/^~/, '') < input.date.replace(/^~/, '')) throw new Error('events.err.end_before_start');
    const at = now();
    const values = [input.type, label, clean(input.date), clean(input.endDate), clean(input.place), input.note.trim()];
    const writes: Query[] = [personExists(input.person)];
    if (AFTER_DEATH.has(input.type)) writes.push(guard('EXISTS (SELECT 1 FROM person WHERE id = ? AND living = 0)', input.person));
    const [type, , date, end_date, place, note] = values;
    const next = { type, label, date, end_date, place, note };
    if (input.id) {
      const had = await d.get<{ person: string } & typeof next>('SELECT person, type, label, date, end_date, place, note FROM life_event WHERE id = ?', input.id);
      if (!had || had.person !== input.person) throw new Error('events.err.gone');
      const { person: _, ...was } = had;
      writes.push(
        guard('EXISTS (SELECT 1 FROM life_event WHERE id = ? AND person = ?)', input.id, input.person),
        q('UPDATE life_event SET type = ?, label = ?, date = ?, end_date = ?, place = ?, note = ?, updated_by = ?, updated_at = ? WHERE id = ?', ...values, who.id, at, input.id),
      );
      return { writes, history: change('event', input.id, was, next, { person: input.person, label: label ?? type }), result: { id: input.id } };
    }
    const count = await d.get<{ n: number; last: number }>('SELECT count(*) AS n, coalesce(max(ord), -1) AS last FROM life_event WHERE person = ?', input.person);
    const n = count?.n ?? 0;
    if (n >= MAX_EVENTS) throw new Error('events.err.too_many');
    const id = crypto.randomUUID();
    writes.push(
      guard('(SELECT count(*) FROM life_event WHERE person = ?) = ?', input.person, n),
      q(`INSERT INTO life_event (id, person, type, label, date, end_date, place, note, ord, created_by, created_by_name, created_at, updated_by, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, id, input.person, ...values, (count?.last ?? -1) + 1, who.id, who.name, at, who.id, at),
    );
    return { writes, history: [added('event', id, { person: input.person, label: label ?? input.type })], result: { id } };
  });
}

/** Removes an event; its citations go with it (they cite nothing any more). An event already gone is not an error. */
export function removeEvent(tree: string, who: LifeReader, id: string, op: OpKey | undefined) {
  return once(tree, op, 'removeLifeEvent', async (d) => {
    needsEditor(who);
    const had = await d.get<{ person: string; type: string; label: string | null }>('SELECT person, type, label FROM life_event WHERE id = ?', id);
    if (!had) return { writes: [], history: [], result: undefined };
    return {
      writes: [guard('EXISTS (SELECT 1 FROM life_event WHERE id = ?)', id), q('DELETE FROM life_event WHERE id = ?', id)],
      history: [removed('event', id, { person: had.person, label: had.label ?? had.type })],
      result: undefined,
    };
  });
}

/**
 * Puts one person's events in the given order (it decides only among events with the same date, or none). The list must be
 * exactly the person's events as they are: an event added or removed meanwhile makes the reader look again.
 */
export function reorderEvents(tree: string, who: LifeReader, person: string, ids: string[], op: OpKey | undefined) {
  return once(tree, op, 'reorderLifeEvents', async (d) => {
    needsEditor(who);
    const had = (await d.all<{ id: string }>('SELECT id FROM life_event WHERE person = ?', person)).map((r) => r.id);
    const same = had.length === ids.length && new Set(ids).size === ids.length && ids.every((id) => had.includes(id));
    if (!same) throw new Error('events.err.changed');
    return {
      writes: [
        guard('(SELECT count(*) FROM life_event WHERE person = ?) = ?', person, had.length),
        ...(ids.length ? [guard(`(SELECT count(*) FROM life_event WHERE person = ? AND id IN (${ids.map(() => '?').join(', ')})) = ?`, person, ...ids, ids.length)] : []),
        ...ids.map((id, i) => q('UPDATE life_event SET ord = ? WHERE id = ? AND person = ?', i, id, person)),
      ],
      // A new order among events of the same date changes no fact.
      history: [],
      result: undefined,
    };
  });
}
