// Houses: their stored settings (succession law, optional head and heir, country), and the changes a steward makes to
// the houses themselves: making one, making one per surname, and adding or removing members. Reads are for the house
// pages and the tree's badges. Every write goes through `once` with guards for everything its check read.
import { db, guard, newId, once, q, type Db, type OpKey, type Query } from './db.server';
import type { HouseSettings } from './houses';

export async function readHouseSettings(tree: string): Promise<Record<string, HouseSettings>> {
  const rows = await db(tree).all<HouseSettings & { house: string }>('SELECT house, law, head, heir, country FROM house_succession');
  return Object.fromEntries(rows.map(({ house, ...settings }) => [house, settings]));
}

export async function saveHouseSettings(tree: string, id: string, settings: HouseSettings, op: OpKey | undefined) {
  return once(tree, op, 'saveHouseSettings', async (d) => {
    if (!await d.get('SELECT id FROM house WHERE id = ?', id)) throw new Error('houses.err.not_found');
    const guards = [guard('EXISTS (SELECT 1 FROM house WHERE id = ?)', id)];
    for (const person of [settings.head, settings.heir]) {
      if (!person) continue;
      if (!await d.get('SELECT id FROM person WHERE id = ? AND house = ?', person, id)) throw new Error('houses.err.not_member');
      guards.push(guard('EXISTS (SELECT 1 FROM person WHERE id = ? AND house = ?)', person, id));
    }
    if (settings.head && settings.head === settings.heir) throw new Error('houses.err.same_person');
    return {
      writes: [
        ...guards,
        q(`INSERT INTO house_succession (house, law, head, heir, country) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(house) DO UPDATE SET law = excluded.law, head = excluded.head, heir = excluded.heir, country = excluded.country`,
          id, settings.law, settings.head, settings.heir, settings.country),
      ],
      result: settings,
    };
  });
}

// ---------- making houses ----------

/** The arms a house gets before its steward draws them: a plain azure field with a gold charge-free blazon. */
export const NEW_HOUSE_ARMS = { field: 'azure', division: 'plain', charge: 'none', chargeTincture: 'or' } as const;
export const HOUSE_NAME_MAX = 80;
export const HOUSE_MOTTO_MAX = 160;

/** The house names as they are, lower-cased, for the "already a house" check. */
async function houseNames(d: Db): Promise<{ count: number; taken: Set<string> }> {
  const rows = await d.all<{ name: string }>('SELECT name FROM house');
  return { count: rows.length, taken: new Set(rows.map((r) => r.name.trim().toLowerCase())) };
}

/** A house with a name and, optionally, a motto and a country. A steward draws its arms afterwards. */
export function createHouse(tree: string, input: { name: string; motto: string | null; country: string | null }, op: OpKey | undefined) {
  return once(tree, op, 'createHouse', async (d) => {
    const { count, taken } = await houseNames(d);
    if (taken.has(input.name.toLowerCase())) throw new Error('houses.err.name_taken');
    const id = newId(input.name);
    const writes: Query[] = [
      // Every house that exists when this was decided: another house made meanwhile means deciding again.
      guard('(SELECT count(*) FROM house) = ?', count),
      q('INSERT INTO house (id, name, motto, arms) VALUES (?, ?, ?, ?)', id, input.name, input.motto, JSON.stringify(NEW_HOUSE_ARMS)),
    ];
    if (input.country) writes.push(q('INSERT INTO house_succession (house, law, head, heir, country) VALUES (?, ?, NULL, NULL, ?)', id, 'absolute-primogeniture', input.country));
    return { writes, result: { id, name: input.name } };
  });
}

export interface SurnameGroup {
  surname: string;
  /** How many people with this surname have no house yet. */
  people: number;
  /** A house already has this name, so the surname cannot make another. */
  taken: boolean;
}

/** The surnames of people who have no house, most people first. */
export async function surnameGroupsOf(d: Db): Promise<{ groups: SurnameGroup[]; unhoused: number }> {
  const [rows, { taken }, [total]] = await Promise.all([
    d.all<{ surname: string; n: number }>(
      "SELECT trim(surname) AS surname, count(*) AS n FROM person WHERE house IS NULL AND trim(coalesce(surname, '')) != '' GROUP BY trim(surname) ORDER BY n DESC, surname",
    ),
    houseNames(d),
    d.all<{ n: number }>('SELECT count(*) AS n FROM person WHERE house IS NULL'),
  ]);
  return {
    groups: rows.map((r) => ({ surname: r.surname, people: r.n, taken: taken.has(r.surname.toLowerCase()) })),
    unhoused: total?.n ?? 0,
  };
}

export const surnameGroups = (tree: string) => surnameGroupsOf(db(tree));

/**
 * One house for each chosen surname, holding every person with that surname who has no house. A surname that has no
 * such person any more is skipped; one that already names a house is refused (the steward leaves it out).
 */
export function createHousesFromSurnames(tree: string, surnames: string[], op: OpKey | undefined) {
  const wanted = [...new Set(surnames.map((s) => s.trim()).filter(Boolean))];
  return once(tree, op, 'createHousesFromSurnames', async (d) => {
    const [{ groups }, { count, taken }] = await Promise.all([surnameGroupsOf(d), houseNames(d)]);
    const writes: Query[] = [guard('(SELECT count(*) FROM house) = ?', count)];
    const made: { id: string; name: string; people: number }[] = [];
    for (const surname of wanted) {
      const group = groups.find((g) => g.surname === surname);
      if (!group) continue;
      if (taken.has(surname.toLowerCase())) throw new Error('houses.err.name_taken');
      const id = newId(surname);
      writes.push(
        q('INSERT INTO house (id, name, motto, arms) VALUES (?, ?, NULL, ?)', id, surname, JSON.stringify(NEW_HOUSE_ARMS)),
        q('UPDATE person SET house = ? WHERE house IS NULL AND trim(surname) = ?', id, surname),
      );
      made.push({ id, name: surname, people: group.people });
    }
    if (!made.length) throw new Error('houses.err.nothing_to_make');
    return { writes, result: made };
  });
}

// ---------- members ----------

/**
 * Adds people to a house and takes people out of it. A person already in the house is left as it is, and so is
 * anyone asked to leave a house they are not in. A person who changes house cannot head or inherit a house they left.
 */
export function setHouseMembers(tree: string, house: string, change: { add: string[]; remove: string[] }, op: OpKey | undefined) {
  const add = [...new Set(change.add)];
  const remove = [...new Set(change.remove)];
  return once(tree, op, 'setHouseMembers', async (d) => {
    if (!await d.get('SELECT id FROM house WHERE id = ?', house)) throw new Error('houses.err.not_found');
    const ids = [...new Set([...add, ...remove])];
    const rows = ids.length
      ? await d.all<{ id: string; house: string | null }>(`SELECT id, house FROM person WHERE id IN (${ids.map(() => '?').join(', ')})`, ...ids)
      : [];
    const at = new Map(rows.map((r) => [r.id, r.house]));
    if (ids.some((id) => !at.has(id))) throw new Error('houses.err.not_person');

    const writes: Query[] = [guard('EXISTS (SELECT 1 FROM house WHERE id = ?)', house)];
    const moved: string[] = [];
    for (const id of add) {
      const was = at.get(id) ?? null;
      if (was === house) continue;
      writes.push(guard('EXISTS (SELECT 1 FROM person WHERE id = ? AND house IS ?)', id, was), q('UPDATE person SET house = ? WHERE id = ?', house, id));
      moved.push(id);
    }
    for (const id of remove) {
      if (at.get(id) !== house) continue;
      writes.push(guard('EXISTS (SELECT 1 FROM person WHERE id = ? AND house = ?)', id, house), q('UPDATE person SET house = NULL WHERE id = ?', id));
      moved.push(id);
    }
    for (const id of moved) {
      writes.push(q('UPDATE house_succession SET head = NULL WHERE head = ?', id), q('UPDATE house_succession SET heir = NULL WHERE heir = ?', id));
    }
    return { writes, result: { added: add.filter((id) => moved.includes(id)).length, removed: remove.filter((id) => moved.includes(id)).length } };
  });
}
