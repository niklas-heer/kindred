// The gallery's server functions. Each one checks the reader's role first (requireMember for reads,
// requireCan for changes, with the same Action the browser asks useCan() about), then calls photos.server.ts.
//   upload-photo (contributor): add photos and albums, caption and date them, tag people, confirm suggestions
//   edit-person  (editor):      delete photos, set a person's profile picture, or show their drawn avatar instead
//   delete-album (steward):     delete an album; its photos stay in the gallery
import { queryOptions } from '@tanstack/react-query';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { validDate } from './dates';
import type { Action } from './roles';

const tree = z.string().regex(/^[a-z0-9-]+$/).max(64);
const server = () => import('./photos.server');
const guard = () => import('./auth/guard.server');
const requireReader = async (t: string) => (await guard()).requireReader(t);
const requireCan = async (t: string, action: Action) => (await guard()).requireCan(t, action);

/** A media key as the server makes it: gallery/<uuid>.<ext>. Anything else is refused before it reaches storage. */
const mediaKey = z.string().regex(/^gallery\/[a-z0-9-]{1,80}\.[a-z]{2,4}$/);
const opKey = z.string().regex(/^[A-Za-z0-9_-]{8,80}$/).optional();
const text = (max: number) => z.string().trim().max(max).transform((s) => s || null);
/** An album id, or nothing ('' from a form is nothing). */
const albumId = z.string().max(64).nullable().transform((s) => s || null);
/** A partial date ("1985", "1985-06", "1985-06-14") or nothing. */
const partialDate = z.string().max(10).refine((s) => s === '' || validDate(s), 'photos.err.not_a_date').transform((s) => s || null);
const unit = z.number().min(0).max(1);
const box = z
  .object({ x: unit, y: unit, w: unit.refine((n) => n > 0, 'photos.err.box_small'), h: unit.refine((n) => n > 0, 'photos.err.box_small') })
  .refine((b) => b.x + b.w <= 1.0001 && b.y + b.h <= 1.0001, 'photos.err.box_off');

/** The retry key for a change, bound to who sends it and to everything else they sent (see db.server.ts `once`). */
function opOf<D extends { opKey?: string }>(user: string, data: D) {
  if (!data.opKey) return undefined;
  const { opKey: key, ...payload } = data;
  return { key, user, payload };
}

/** The picture in a form, checked by its first bytes as well as its declared type. */
async function pictureIn(form: FormData, max: number) {
  const file = form.get('file');
  if (!(file instanceof File) || !/^image\/(jpeg|png|webp)$/.test(file.type) || file.size > max) throw new Error('photos.err.picture_type');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { sniff } = await server();
  if (sniff(bytes) !== file.type) throw new Error('photos.err.not_picture');
  return { file, bytes, mime: file.type };
}

const pixels = (v: FormDataEntryValue | null) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 4000) throw new Error('photos.err.pixels');
  return n;
};
const field = (d: FormData, name: string) => {
  const v = d.get(name);
  return typeof v === 'string' ? v : '';
};

// ---------- reads ----------

export const getGallery = createServerFn({ method: 'GET' })
  .validator(z.object({ tree }))
  .handler(async ({ data }) => {
    await requireReader(data.tree);
    return (await server()).gallery(data.tree);
  });
export const galleryQuery = (t: string) => queryOptions({ queryKey: ['gallery', t], queryFn: () => getGallery({ data: { tree: t } }) });

export const getPersonPhotos = createServerFn({ method: 'GET' })
  .validator(z.object({ tree, id: z.string().min(1).max(120) }))
  .handler(async ({ data }) => {
    await requireReader(data.tree);
    return (await server()).personMedia(data.tree, data.id);
  });
export const personPhotosQuery = (t: string, id: string) =>
  queryOptions({ queryKey: ['person-photos', t, id], queryFn: () => getPersonPhotos({ data: { tree: t, id } }) });

// ---------- photos ----------

/** Adds one picture. The browser has already scaled it down and dropped its EXIF and GPS. */
export const addGalleryPhoto = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    if (!(d instanceof FormData)) throw new Error('expected form data');
    return {
      tree: tree.parse(d.get('tree')),
      form: d,
      width: pixels(d.get('width')),
      height: pixels(d.get('height')),
      taken: partialDate.parse(field(d, 'taken')),
      place: text(200).parse(field(d, 'place')),
      caption: text(1000).parse(field(d, 'caption')),
      album: albumId.parse(field(d, 'album')),
      opKey: opKey.parse(field(d, 'opKey') || undefined),
    };
  })
  .handler(async ({ data }) => {
    const m = await requireCan(data.tree, 'upload-photo');
    const { form, tree: t, opKey: k, width, height, taken, place, caption, album: albumOf } = data;
    const { file, bytes, mime } = await pictureIn(form, 12_000_000);
    const details = { width, height, taken, place, caption, album: albumOf };
    return (await server()).addPhoto(t, m.user.id, bytes, { ...details, mime }, opOf(m.user.id, { opKey: k, tree: t, file, ...details }));
  });

export const saveGalleryPhoto = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, key: mediaKey, taken: partialDate, place: text(200), caption: text(1000), album: albumId, opKey }))
  .handler(async ({ data }) => {
    const m = await requireCan(data.tree, 'upload-photo');
    const { tree: t, key, opKey: k, ...patch } = data;
    return (await server()).editPhoto(t, key, patch, opOf(m.user.id, { opKey: k, tree: t, key, ...patch }));
  });

export const removeGalleryPhoto = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, key: mediaKey, opKey }))
  .handler(async ({ data }) => {
    const m = await requireCan(data.tree, 'edit-person');
    return (await server()).removePhoto(data.tree, data.key, opOf(m.user.id, data));
  });

// ---------- albums ----------

export const saveAlbum = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, id: z.string().max(64).optional(), name: z.string().trim().min(1, 'photos.err.name_required').max(80), opKey }))
  .handler(async ({ data }) => {
    const m = await requireCan(data.tree, 'upload-photo');
    return (await server()).saveAlbum(data.tree, { id: data.id, name: data.name }, opOf(m.user.id, data));
  });

/** Stewards delete an album. Its photos stay, without an album. */
export const deleteAlbum = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, id: z.string().min(1).max(64), opKey }))
  .handler(async ({ data }) => {
    const m = await requireCan(data.tree, 'delete-album');
    return (await server()).deleteAlbum(data.tree, data.id, opOf(m.user.id, data));
  });

// ---------- tags ----------

export const tagPhoto = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, key: mediaKey, person: z.string().min(1).max(120), box, opKey }))
  .handler(async ({ data }) => {
    const m = await requireCan(data.tree, 'upload-photo');
    return (await server()).addTag(data.tree, m.user.id, data.key, data.person, data.box, opOf(m.user.id, data));
  });

export const suggestPhotoTags = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, key: mediaKey, faces: z.array(z.object({ box, personId: z.string().min(1).max(120) })).max(30), opKey }))
  .handler(async ({ data }) => {
    const m = await requireCan(data.tree, 'upload-photo');
    return (await server()).suggestTags(data.tree, m.user.id, data.key, data.faces, opOf(m.user.id, data));
  });

export const confirmPhotoTag = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, id: z.number().int().positive(), opKey }))
  .handler(async ({ data }) => {
    const m = await requireCan(data.tree, 'upload-photo');
    return (await server()).confirmTag(data.tree, m.user.id, data.id, opOf(m.user.id, data));
  });

export const removePhotoTag = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, id: z.number().int().positive(), opKey }))
  .handler(async ({ data }) => {
    const m = await requireCan(data.tree, 'upload-photo');
    return (await server()).removeTag(data.tree, data.id, opOf(m.user.id, data));
  });

// ---------- profile pictures ----------

/** Sets a person's portrait from a square crop the browser made. Editors and stewards only. */
export const setPersonPortrait = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    if (!(d instanceof FormData)) throw new Error('expected form data');
    return {
      tree: tree.parse(d.get('tree')),
      id: z.string().min(1).max(120).parse(d.get('id')),
      form: d,
      opKey: opKey.parse(field(d, 'opKey') || undefined),
    };
  })
  .handler(async ({ data }) => {
    const m = await requireCan(data.tree, 'edit-person');
    const { form, tree: t, id, opKey: k } = data;
    const { file, bytes, mime } = await pictureIn(form, 5_000_000);
    return (await server()).setPortrait(t, id, bytes, mime, opOf(m.user.id, { opKey: k, tree: t, id, file }));
  });

/** Shows the drawn avatar instead of the person's photo, or the photo again. Editors and stewards only. */
export const setPreferAvatar = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, id: z.string().min(1).max(120), prefer: z.boolean(), opKey }))
  .handler(async ({ data }) => {
    const m = await requireCan(data.tree, 'edit-person');
    return (await server()).setPreferAvatar(data.tree, data.id, data.prefer, opOf(m.user.id, data));
  });
