// The gallery's data and changes, for the server functions in photos.functions.ts. Those check who may
// do what first; these trust their callers and keep the data true: every change is a `once` plan whose
// guards hold what it read (db.server.ts), and pictures are written before the rows that point at them.
import type { Album, Box, Face, Gallery, MediaItem, Tag } from '~/lib/photos/types';
import { added, change, db, guard, media, newMediaKey, once, personExists, q, removed, type Db, type OpKey } from './db.server';
import type { Param } from './store/index.ts';
import { LIVING_IDS, pictureColumn } from './protect-living.ts';

// ---------- reads ----------

interface MediaRow {
  key: string; mime: string; width: number; height: number; taken: string | null; place: string | null; caption: string | null;
  album: string | null; uploaded_by: string; uploaded_at: string; post: string | null;
}
interface TagRow { id: number; media: string; person: string; x: number; y: number; w: number; h: number; confirmed: number }

/** The columns of a picture. With `protectLiving`, a picture with a living person in it comes without caption, date or place. */
const cols = (protectLiving: boolean) =>
  `m.key, m.mime, m.width, m.height, ${pictureColumn('m.taken', protectLiving)} AS taken, ${pictureColumn('m.place', protectLiving)} AS place, ` +
  `${pictureColumn('m.caption', protectLiving)} AS caption, m.album, m.uploaded_by, m.uploaded_at, ` +
  '(SELECT pm.post FROM post_media pm WHERE pm.media = m.key) AS post';

/**
 * The pictures a share-link guest may see, as a condition on `m`: not the ones shared in a post. A post is the family
 * talking among themselves (docs/feed.md), and a guest sees none of it, so not its pictures in the Gallery either.
 */
export const NOT_FROM_A_POST = 'm.key NOT IN (SELECT media FROM post_media)';

/**
 * Media rows matching `where` (an SQL condition on `m`), each with its tags, newest upload first. With `protectLiving` (a guest
 * whose link protects living people) the pictures stay, but no living person is tagged on them, and a picture one is in has no
 * caption, date or place (src/lib/protect-living.ts).
 */
async function withTags(d: Db, where: string, params: Param[], protectLiving = false): Promise<MediaItem[]> {
  const rows = await d.all<MediaRow>(`SELECT ${cols(protectLiving)} FROM media m WHERE ${where} ORDER BY m.uploaded_at DESC, m.key`, ...params);
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
    ...(r.post ? { post: r.post } : {}),
  }));
}

/** The whole gallery for a family: every photo with its tags, and the albums. A `guest` gets no picture that came with a post. */
export async function gallery(tree: string, protectLiving = false, guest = false): Promise<Gallery> {
  const d = db(tree);
  const [items, albums] = await Promise.all([
    withTags(d, guest ? NOT_FROM_A_POST : '1 = 1', [], protectLiving),
    d.all<{ id: string; name: string; n: number }>('SELECT a.id, a.name, (SELECT count(*) FROM media m WHERE m.album = a.id) AS n FROM album a ORDER BY a.name COLLATE NOCASE'),
  ]);
  return { media: items, albums: albums.map((a): Album => ({ id: a.id, name: a.name, count: a.n })) };
}

/**
 * The photos a person is confirmed in. With `protectLiving`, none for a living person: that list is their tags. A `guest`
 * gets no picture that came with a post.
 */
export function personMedia(tree: string, person: string, protectLiving = false, guest = false): Promise<MediaItem[]> {
  const where = `m.key IN (SELECT mp.media FROM media_person mp WHERE mp.person = ? AND mp.confirmed = 1${protectLiving ? ` AND mp.person NOT IN (${LIVING_IDS})` : ''})${guest ? ` AND ${NOT_FROM_A_POST}` : ''}`;
  return withTags(db(tree), where, [person], protectLiving);
}

/**
 * The stored picture to serve for a gallery key, or undefined: the photo itself, or for `thumb` its small copy when it has
 * one (photos uploaded before migration 0023 have none, and get the photo). The route serves only what this finds.
 */
export async function pictureFor(tree: string, key: string, thumb: boolean, guest = false): Promise<{ key: string; mime: string } | undefined> {
  // A guest is not served a picture that came with a post, as if it were not there.
  const row = await db(tree).get<{ mime: string; thumb: string | null }>(`SELECT m.mime, m.thumb FROM media m WHERE m.key = ?${guest ? ` AND ${NOT_FROM_A_POST}` : ''}`, key);
  if (!row) return undefined;
  // Thumbnails are always made as JPEG by the browser (and checked as a picture on the way in).
  return thumb && row.thumb ? { key: row.thumb, mime: thumbMime(row.thumb) } : { key, mime: row.mime };
}

const thumbMime = (key: string) => (key.endsWith('.png') ? 'image/png' : key.endsWith('.webp') ? 'image/webp' : 'image/jpeg');

// ---------- files ----------

// The type check lives with the upload's other checks; the feedback form uses it from here.
export { sniff } from './picture-in.ts';

// ---------- photos ----------

export interface NewPhoto {
  mime: string; width: number; height: number; taken: string | null; place: string | null; caption: string | null; album: string | null;
}

/**
 * Stores a picture, its thumbnail when the browser made one, and its details. The pictures are written first; the row is
 * kept only if the batch commits.
 */
export function addPhoto(tree: string, by: string, bytes: Uint8Array, p: NewPhoto, op: OpKey | undefined, thumb?: { bytes: Uint8Array; mime: string }): Promise<MediaItem> {
  return once(tree, op, 'addPhoto', async (d) => {
    if (p.album && !(await d.get('SELECT id FROM album WHERE id = ?', p.album))) throw new Error('photos.err.album_gone');
    const key = newMediaKey('gallery', p.mime);
    const thumbKey = thumb ? newMediaKey('thumb', thumb.mime) : null;
    await media.put(tree, key, bytes, p.mime);
    if (thumb && thumbKey) {
      try {
        await media.put(tree, thumbKey, thumb.bytes, thumb.mime);
      } catch (e) {
        await media.delete(tree, key).catch(() => {});
        throw e;
      }
    }
    const at = new Date().toISOString();
    const item: MediaItem = {
      key, mime: p.mime, width: p.width, height: p.height, taken: p.taken, place: p.place, caption: p.caption, album: p.album,
      uploadedBy: by, uploadedAt: at, tags: [],
    };
    return {
      writes: [
        ...(p.album ? [guard('EXISTS (SELECT 1 FROM album WHERE id = ?)', p.album)] : []),
        q('INSERT INTO media (key, mime, width, height, taken, place, caption, album, uploaded_by, uploaded_at, thumb) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          key, p.mime, p.width, p.height, p.taken, p.place, p.caption, p.album, by, at, thumbKey),
      ],
      history: [added('photo', key, { label: p.caption })],
      result: item,
      abandon: () => Promise.all([key, thumbKey].filter((k): k is string => !!k).map((k) => media.delete(tree, k).catch(() => {}))).then(() => {}),
    };
  });
}

/** Changes a photo's date, place, caption or album. */
export function editPhoto(tree: string, key: string, patch: Pick<NewPhoto, 'taken' | 'place' | 'caption' | 'album'>, op: OpKey | undefined) {
  return once(tree, op, 'editPhoto', async (d) => {
    const had = await d.get<{ taken: string | null; place: string | null; caption: string | null; album: string | null }>('SELECT taken, place, caption, album FROM media WHERE key = ?', key);
    if (!had) throw new Error('photos.err.photo_gone');
    if (patch.album && !(await d.get('SELECT id FROM album WHERE id = ?', patch.album))) throw new Error('photos.err.album_gone');
    return {
      writes: [
        guard('EXISTS (SELECT 1 FROM media WHERE key = ?)', key),
        q('UPDATE media SET taken = ?, place = ?, caption = ?, album = ? WHERE key = ?', patch.taken, patch.place, patch.caption, patch.album, key),
      ],
      history: change('photo', key, had, patch, { label: patch.caption ?? had.caption }),
      result: undefined,
    };
  });
}

/** Deletes a photo with its tags, and its picture from storage once the delete has committed. */
export function removePhoto(tree: string, key: string, op: OpKey | undefined) {
  return once(tree, op, 'removePhoto', async (d) => {
    const row = await d.get<{ thumb: string | null; caption: string | null }>('SELECT thumb, caption FROM media WHERE key = ?', key);
    if (!row) throw new Error('photos.err.photo_already_gone');
    return {
      writes: [guard('EXISTS (SELECT 1 FROM media WHERE key = ?)', key), q('DELETE FROM media WHERE key = ?', key)],
      history: [removed('photo', key, { label: row.caption })],
      result: undefined,
      // The photo and its thumbnail both go.
      after: async () => {
        for (const k of [key, row.thumb]) if (k) await media.delete(tree, k).catch((e) => console.error('photos.err.delete_failed', k, e));
      },
    };
  });
}

// ---------- albums ----------

/** Creates an album (no id) or renames one. Returns its id. */
export function saveAlbum(tree: string, a: { id?: string; name: string }, op: OpKey | undefined): Promise<{ id: string }> {
  return once(tree, op, 'saveAlbum', async (d) => {
    if (a.id) {
      const had = await d.get<{ name: string }>('SELECT name FROM album WHERE id = ?', a.id);
      if (!had) throw new Error('photos.err.album_gone');
      return {
        writes: [guard('EXISTS (SELECT 1 FROM album WHERE id = ?)', a.id), q('UPDATE album SET name = ? WHERE id = ?', a.name, a.id)],
        history: change('album', a.id, had, { name: a.name }, { label: a.name }),
        result: { id: a.id },
      };
    }
    const id = crypto.randomUUID();
    return {
      writes: [q('INSERT INTO album (id, name, at) VALUES (?, ?, ?)', id, a.name, new Date().toISOString())],
      history: [added('album', id, { label: a.name })],
      result: { id },
    };
  });
}

/** Deletes an album. Its photos stay in the gallery, without an album (the row's album is cleared by the foreign key). */
export function deleteAlbum(tree: string, id: string, op: OpKey | undefined) {
  return once(tree, op, 'deleteAlbum', async (d) => {
    const had = await d.get<{ name: string }>('SELECT name FROM album WHERE id = ?', id);
    if (!had) throw new Error('photos.err.album_already_gone');
    return {
      writes: [guard('EXISTS (SELECT 1 FROM album WHERE id = ?)', id), q('DELETE FROM album WHERE id = ?', id)],
      history: [removed('album', id, { label: had.name })],
      result: undefined,
    };
  });
}

// ---------- tags ----------

/** Someone confirmed in a photo, at a box the reader drew. */
export function addTag(tree: string, by: string, key: string, person: string, box: Box, op: OpKey | undefined) {
  return once(tree, op, 'addTag', async (d) => {
    if (!(await d.get('SELECT id FROM person WHERE id = ?', person))) throw new Error('photos.err.person_not_found');
    const photo = await d.get<{ caption: string | null }>('SELECT caption FROM media WHERE key = ?', key);
    if (!photo) throw new Error('photos.err.photo_gone');
    return {
      history: [added('tag', key, { person, label: photo.caption })],
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
      // Suggestions are not tags: nobody sees them until someone confirms one, which is when the history hears of it.
      history: [],
      result: undefined,
    };
  });
}

/** A suggestion a person has agreed to: it becomes a confirmed tag. */
export function confirmTag(tree: string, by: string, id: number, op: OpKey | undefined) {
  return once(tree, op, 'confirmTag', async (d) => {
    const t = await d.get<{ confirmed: number; media: string; person: string; caption: string | null }>(
      'SELECT t.confirmed, t.media, t.person, m.caption FROM media_person t JOIN media m ON m.key = t.media WHERE t.id = ?', id);
    if (!t) throw new Error('photos.err.tag_gone');
    return {
      history: t.confirmed ? [] : [added('tag', t.media, { person: t.person, label: t.caption })],
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
    const t = await d.get<{ confirmed: number; media: string; person: string; caption: string | null }>(
      'SELECT t.confirmed, t.media, t.person, m.caption FROM media_person t JOIN media m ON m.key = t.media WHERE t.id = ?', id);
    if (!t) throw new Error('photos.err.tag_already_gone');
    return {
      // Dismissing a suggestion removes nothing anyone saw.
      history: t.confirmed ? [removed('tag', t.media, { person: t.person, label: t.caption })] : [],
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
      history: change('portrait', person, { photo: 0 }, { photo: 1 }, { person, opaque: ['photo'] }),
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
    const had = await d.get<{ prefer_avatar: number }>('SELECT prefer_avatar FROM person WHERE id = ?', person);
    if (!had) throw new Error('photos.err.person_not_found');
    return {
      writes: [personExists(person), q('UPDATE person SET prefer_avatar = ? WHERE id = ?', prefer ? 1 : 0, person)],
      history: change('portrait', person, had, { prefer_avatar: prefer ? 1 : 0 }, { person }),
      result: undefined,
    };
  });
}
