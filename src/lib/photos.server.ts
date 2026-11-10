// The gallery's data and changes, for the server functions in photos.functions.ts. Those check who may
// do what first; these trust their callers and keep the data true: every change is a `once` plan whose
// guards hold what it read (db.server.ts), and pictures are written before the rows that point at them.
import type { Album, Box, Face, Gallery, MediaItem, Tag } from '~/components/photos/types';
import { db, guard, media, newMediaKey, once, personExists, q, type Db, type OpKey } from './db.server';
import type { Param } from './store/index.ts';
import { LIVING_IDS } from './protect-living.ts';

// ---------- reads ----------

interface MediaRow {
  key: string; mime: string; width: number; height: number; taken: string | null; place: string | null; caption: string | null;
  album: string | null; uploaded_by: string; uploaded_at: string;
}
interface TagRow { id: number; media: string; person: string; x: number; y: number; w: number; h: number; confirmed: number }

const COLS = 'm.key, m.mime, m.width, m.height, m.taken, m.place, m.caption, m.album, m.uploaded_by, m.uploaded_at';

/**
 * Media rows matching `where` (an SQL condition on `m`), each with its tags, newest upload first. With `protectLiving` (a guest
 * whose link protects living people) the pictures stay, but no living person is tagged on them (src/lib/protect-living.ts).
 */
async function withTags(d: Db, where: string, params: Param[], protectLiving = false): Promise<MediaItem[]> {
  const rows = await d.all<MediaRow>(`SELECT ${COLS} FROM media m WHERE ${where} ORDER BY m.uploaded_at DESC, m.key`, ...params);
  if (!rows.length) return [];
  const tags = await d.all<TagRow>(
    `SELECT id, media, person, x, y, w, h, confirmed FROM media_person WHERE media IN (SELECT m.key FROM media m WHERE ${where})${protectLiving ? ` AND person NOT IN (${LIVING_IDS})` : ''} ORDER BY id`,
    ...params,
  );
  const byMedia = new Map<string, Tag[]>();
  for (const t of tags) {
    const list = byMedia.get(t.media) ?? [];
    list.push({ id: t.id, person: t.person, box: { x: t.x, y: t.y, w: t.w, h: t.h }, confirmed: t.confirmed === 1 });
    byMedia.set(t.media, list);
  }
  return rows.map((r) => ({
    key: r.key,
    mime: r.mime,
    width: r.width,
    height: r.height,
    taken: r.taken,
    place: r.place,
    caption: r.caption,
    album: r.album,
    uploadedBy: r.uploaded_by,
    uploadedAt: r.uploaded_at,
    tags: byMedia.get(r.key) ?? [],
  }));
}

/** The whole gallery for a family: every photo with its tags, and the albums. */
export async function gallery(tree: string, protectLiving = false): Promise<Gallery> {
  const d = db(tree);
  const [items, albums] = await Promise.all([
    withTags(d, '1 = 1', [], protectLiving),
    d.all<{ id: string; name: string; n: number }>('SELECT a.id, a.name, (SELECT count(*) FROM media m WHERE m.album = a.id) AS n FROM album a ORDER BY a.name COLLATE NOCASE'),
  ]);
  return { media: items, albums: albums.map((a): Album => ({ id: a.id, name: a.name, count: a.n })) };
}

/** The photos a person is confirmed in. With `protectLiving`, none for a living person: that list is their tags. */
export function personMedia(tree: string, person: string, protectLiving = false): Promise<MediaItem[]> {
  const where = `m.key IN (SELECT mp.media FROM media_person mp WHERE mp.person = ? AND mp.confirmed = 1${protectLiving ? ` AND mp.person NOT IN (${LIVING_IDS})` : ''})`;
  return withTags(db(tree), where, [person], protectLiving);
}

/** The stored type of a gallery picture, or undefined. The route serves only what this finds. */
export async function pictureMime(tree: string, key: string): Promise<string | undefined> {
  return (await db(tree).get<{ mime: string }>('SELECT mime FROM media WHERE key = ?', key))?.mime;
}

// ---------- files ----------

/** The first bytes of a picture, so the stored type is the real one (a renamed file is refused). */
export function sniff(bytes: Uint8Array): string | null {
  const at = (i: number, ...b: number[]) => b.every((x, j) => bytes[i + j] === x);
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return 'image/png';
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp';
  return null;
}

// ---------- photos ----------

export interface NewPhoto {
  mime: string; width: number; height: number; taken: string | null; place: string | null; caption: string | null; album: string | null;
}

/** Stores a picture and its details. The picture is written first; the row is kept only if the batch commits. */
export function addPhoto(tree: string, by: string, bytes: Uint8Array, p: NewPhoto, op: OpKey | undefined): Promise<MediaItem> {
  return once(tree, op, 'addPhoto', async (d) => {
    if (p.album && !(await d.get('SELECT id FROM album WHERE id = ?', p.album))) throw new Error('photos.err.album_gone');
    const key = newMediaKey('gallery', p.mime);
    await media.put(tree, key, bytes, p.mime);
    const at = new Date().toISOString();
    const item: MediaItem = {
      key, mime: p.mime, width: p.width, height: p.height, taken: p.taken, place: p.place, caption: p.caption, album: p.album,
      uploadedBy: by, uploadedAt: at, tags: [],
    };
    return {
      writes: [
        ...(p.album ? [guard('EXISTS (SELECT 1 FROM album WHERE id = ?)', p.album)] : []),
        q('INSERT INTO media (key, mime, width, height, taken, place, caption, album, uploaded_by, uploaded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          key, p.mime, p.width, p.height, p.taken, p.place, p.caption, p.album, by, at),
      ],
      result: item,
      abandon: () => media.delete(tree, key).catch(() => {}),
    };
  });
}

/** Changes a photo's date, place, caption or album. */
export function editPhoto(tree: string, key: string, patch: Pick<NewPhoto, 'taken' | 'place' | 'caption' | 'album'>, op: OpKey | undefined) {
  return once(tree, op, 'editPhoto', async (d) => {
    if (!(await d.get('SELECT key FROM media WHERE key = ?', key))) throw new Error('photos.err.photo_gone');
    if (patch.album && !(await d.get('SELECT id FROM album WHERE id = ?', patch.album))) throw new Error('photos.err.album_gone');
    return {
      writes: [
        guard('EXISTS (SELECT 1 FROM media WHERE key = ?)', key),
        q('UPDATE media SET taken = ?, place = ?, caption = ?, album = ? WHERE key = ?', patch.taken, patch.place, patch.caption, patch.album, key),
      ],
      result: undefined,
    };
  });
}

/** Deletes a photo with its tags, and its picture from storage once the delete has committed. */
export function removePhoto(tree: string, key: string, op: OpKey | undefined) {
  return once(tree, op, 'removePhoto', async (d) => {
    if (!(await d.get('SELECT key FROM media WHERE key = ?', key))) throw new Error('photos.err.photo_already_gone');
    return {
      writes: [guard('EXISTS (SELECT 1 FROM media WHERE key = ?)', key), q('DELETE FROM media WHERE key = ?', key)],
      result: undefined,
      after: () => media.delete(tree, key).catch((e) => console.error('photos.err.delete_failed', key, e)),
    };
  });
}

// ---------- albums ----------

/** Creates an album (no id) or renames one. Returns its id. */
export function saveAlbum(tree: string, a: { id?: string; name: string }, op: OpKey | undefined): Promise<{ id: string }> {
  return once(tree, op, 'saveAlbum', async (d) => {
    if (a.id) {
      if (!(await d.get('SELECT id FROM album WHERE id = ?', a.id))) throw new Error('photos.err.album_gone');
      return {
        writes: [guard('EXISTS (SELECT 1 FROM album WHERE id = ?)', a.id), q('UPDATE album SET name = ? WHERE id = ?', a.name, a.id)],
        result: { id: a.id },
      };
    }
    const id = crypto.randomUUID();
    return {
      writes: [q('INSERT INTO album (id, name, at) VALUES (?, ?, ?)', id, a.name, new Date().toISOString())],
      result: { id },
    };
  });
}

/** Deletes an album. Its photos stay in the gallery, without an album (the row's album is cleared by the foreign key). */
export function deleteAlbum(tree: string, id: string, op: OpKey | undefined) {
  return once(tree, op, 'deleteAlbum', async (d) => {
    if (!(await d.get('SELECT id FROM album WHERE id = ?', id))) throw new Error('photos.err.album_already_gone');
    return {
      writes: [guard('EXISTS (SELECT 1 FROM album WHERE id = ?)', id), q('DELETE FROM album WHERE id = ?', id)],
      result: undefined,
    };
  });
}

// ---------- tags ----------

/** Someone confirmed in a photo, at a box the reader drew. */
export function addTag(tree: string, by: string, key: string, person: string, box: Box, op: OpKey | undefined) {
  return once(tree, op, 'addTag', async (d) => {
    if (!(await d.get('SELECT id FROM person WHERE id = ?', person))) throw new Error('photos.err.person_not_found');
    if (!(await d.get('SELECT key FROM media WHERE key = ?', key))) throw new Error('photos.err.photo_gone');
    return {
      writes: [
        personExists(person),
        guard('EXISTS (SELECT 1 FROM media WHERE key = ?)', key),
        q('INSERT INTO media_person (media, person, x, y, w, h, confirmed, tagged_by, at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)',
          key, person, box.x, box.y, box.w, box.h, by, new Date().toISOString()),
      ],
      result: undefined,
    };
  });
}

/**
 * Stores the AI finder's suggestions as unconfirmed boxes: nothing is tagged until a person confirms it.
 * One suggestion per person per photo; a person already in the photo is not suggested again.
 */
export function suggestTags(tree: string, by: string, key: string, faces: Face[], op: OpKey | undefined) {
  return once(tree, op, 'suggestTags', async (d) => {
    if (!(await d.get('SELECT key FROM media WHERE key = ?', key))) throw new Error('photos.err.photo_gone');
    const at = new Date().toISOString();
    return {
      writes: [
        guard('EXISTS (SELECT 1 FROM media WHERE key = ?)', key),
        ...faces.map((f) =>
          q(`INSERT INTO media_person (media, person, x, y, w, h, confirmed, tagged_by, at)
             SELECT ?, ?, ?, ?, ?, ?, 0, ?, ? WHERE EXISTS (SELECT 1 FROM person WHERE id = ?)
               AND NOT EXISTS (SELECT 1 FROM media_person WHERE media = ? AND person = ?)`,
            key, f.personId, f.box.x, f.box.y, f.box.w, f.box.h, by, at, f.personId, key, f.personId)),
      ],
      result: undefined,
    };
  });
}

/** A suggestion a person has agreed to: it becomes a confirmed tag. */
export function confirmTag(tree: string, by: string, id: number, op: OpKey | undefined) {
  return once(tree, op, 'confirmTag', async (d) => {
    const t = await d.get<{ confirmed: number }>('SELECT confirmed FROM media_person WHERE id = ?', id);
    if (!t) throw new Error('photos.err.tag_gone');
    return {
      writes: [
        guard('EXISTS (SELECT 1 FROM media_person WHERE id = ? AND confirmed = ?)', id, t.confirmed),
        q('UPDATE media_person SET confirmed = 1, tagged_by = ? WHERE id = ?', by, id),
      ],
      result: undefined,
    };
  });
}

/** Removes a tag, or dismisses a suggestion. */
export function removeTag(tree: string, id: number, op: OpKey | undefined) {
  return once(tree, op, 'removeTag', async (d) => {
    if (!(await d.get('SELECT id FROM media_person WHERE id = ?', id))) throw new Error('photos.err.tag_already_gone');
    return {
      writes: [guard('EXISTS (SELECT 1 FROM media_person WHERE id = ?)', id), q('DELETE FROM media_person WHERE id = ?', id)],
      result: undefined,
    };
  });
}

// ---------- profile pictures ----------

/**
 * Makes a picture the person's portrait (`photo`, read by Portrait). The new picture goes to storage
 * first; the old one is deleted after the row has moved on.
 */
export function setPortrait(tree: string, person: string, bytes: Uint8Array, mime: string, op: OpKey | undefined) {
  return once(tree, op, 'setPortrait', async (d) => {
    if (!(await d.get('SELECT id FROM person WHERE id = ?', person))) throw new Error('photos.err.person_not_found');
    const key = newMediaKey('photo', mime);
    await media.put(tree, key, bytes, mime);
    return {
      writes: [
        personExists(person),
        q('SELECT key FROM photo WHERE person = ?', person), // the picture this one replaces
        q('INSERT INTO photo (person, mime, key, data, at) VALUES (?, ?, ?, NULL, ?) ON CONFLICT(person) DO UPDATE SET mime = excluded.mime, key = excluded.key, data = NULL, at = excluded.at',
          person, mime, key, new Date().toISOString()),
      ],
      result: undefined,
      abandon: () => media.delete(tree, key).catch(() => {}),
      after: async (r) => {
        const old = (r[1].rows[0] as { key: string | null } | undefined)?.key;
        if (old && old !== key) await media.delete(tree, old).catch((e) => console.error('photos.err.delete_failed', old, e));
      },
    };
  });
}

/**
 * Shows the drawn avatar instead of the person's photo, or the photo again. The photo is kept either way,
 * so the choice can be undone without a new upload.
 */
export function setPreferAvatar(tree: string, person: string, prefer: boolean, op: OpKey | undefined) {
  return once(tree, op, 'setPreferAvatar', async (d) => {
    if (!(await d.get('SELECT id FROM person WHERE id = ?', person))) throw new Error('photos.err.person_not_found');
    return {
      writes: [personExists(person), q('UPDATE person SET prefer_avatar = ? WHERE id = ?', prefer ? 1 : 0, person)],
      result: undefined,
    };
  });
}
