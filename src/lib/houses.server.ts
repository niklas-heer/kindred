// Stored house settings: succession law, optional head and heir, and country. Reads are for the house
// pages and the tree's badges; the one write goes through `once` with guards for everything it checked.
import { db, guard, once, q, type OpKey } from './db.server';
import type { HouseSettings } from './houses';

export async function readHouseSettings(tree: string): Promise<Record<string, HouseSettings>> {
  const rows = await db(tree).all<HouseSettings & { house: string }>('SELECT house, law, head, heir, country FROM house_succession');
  return Object.fromEntries(rows.map(({ house, ...settings }) => [house, settings]));
}

export async function saveHouseSettings(tree: string, id: string, settings: HouseSettings, op: OpKey | undefined) {
  return once(tree, op, 'saveHouseSettings', async (d) => {
    if (!await d.get('SELECT id FROM house WHERE id = ?', id)) throw new Error('House not found');
    const guards = [guard('EXISTS (SELECT 1 FROM house WHERE id = ?)', id)];
    for (const person of [settings.head, settings.heir]) {
      if (!person) continue;
      if (!await d.get('SELECT id FROM person WHERE id = ? AND house = ?', person, id)) throw new Error('Choose a member of this house');
      guards.push(guard('EXISTS (SELECT 1 FROM person WHERE id = ? AND house = ?)', person, id));
    }
    if (settings.head && settings.head === settings.heir) throw new Error('The head and the heir must be different people');
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
