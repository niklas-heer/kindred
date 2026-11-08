// Exports of a family, for the export route and the Node scripts' shared logic: the GEDCOM text, the Markdown
// archive as a ZIP, and the list of what each format leaves out. Server-only where it reads the family's
// database and its pictures; the writers themselves (gedcom.ts, markdown.ts, zip.ts) are pure.
import { db, media } from '../db.server.ts';
import type { ArchiveFile } from './markdown.ts';
import { markdownArchive, noteNames, portraitPath } from './markdown.ts';
import { writeGedcom } from './gedcom.ts';
import { readTree, type ExTree } from './model.ts';
import { storeZip } from './zip.ts';

export type ExportFormat = 'gedcom' | 'markdown';

const stamp = (now: Date) => now.toISOString().slice(0, 10);

/** The GEDCOM file for a family, as text, with its name and what the format leaves out. */
export async function gedcomExport(tree: string, now: Date = new Date()) {
  const t = await readTree(db(tree));
  const { text, losses } = writeGedcom(t, now);
  return { body: text, losses, filename: `${tree}-${stamp(now)}.ged`, contentType: 'text/plain; charset=utf-8' };
}

/** Each portrait the family has, read from media storage, at the path its Markdown note refers to. */
async function portraitFiles(tree: string, t: ExTree): Promise<ArchiveFile[]> {
  const names = noteNames(t.people);
  const out: ArchiveFile[] = [];
  for (const p of t.people) {
    const path = portraitPath(p, names);
    if (!path || !p.portrait) continue;
    const got = await media.get(tree, p.portrait.key);
    if (!got) continue;
    const bytes = got.body instanceof Uint8Array ? got.body : new Uint8Array(await new Response(got.body).arrayBuffer());
    out.push({ path, data: bytes });
  }
  return out;
}

/**
 * The Markdown archive as a ZIP: the notes, the README, and each portrait the family has (read from media
 * storage). The whole file is built in memory before it is sent, which suits a family's size.
 */
export async function markdownExport(tree: string, now: Date = new Date()) {
  const t = await readTree(db(tree));
  const attachments = await portraitFiles(tree, t);
  const have = new Set(attachments.map((a) => a.path));
  const { files, losses } = markdownArchive(t, have, now);
  return { body: storeZip([...files, ...attachments], now), losses, filename: `${tree}-markdown-${stamp(now)}.zip`, contentType: 'application/zip' };
}

/** A family as the nightly archive reads it: the model, and its portraits as archive files. */
export interface FamilySnapshot {
  tree: ExTree;
  portraits: ArchiveFile[];
}

/** The family's current data, read from its database and media storage. Read-only. */
export async function familySnapshot(tree: string): Promise<FamilySnapshot> {
  const t = await readTree(db(tree));
  return { tree: t, portraits: await portraitFiles(tree, t) };
}

/** What the format leaves out, without building the file: the export page shows it before the download. */
export async function exportLosses(tree: string, format: ExportFormat): Promise<string[]> {
  const t = await readTree(db(tree));
  return format === 'gedcom' ? writeGedcom(t).losses : markdownArchive(t).losses;
}
