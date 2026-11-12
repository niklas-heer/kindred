// "New in Kindred": who reads the highlights (the page /whats-new and the card), and dismissing the card. The highlights
// themselves are plain data (./index.ts); only the reader's role and the card's once-only state come from the server.
import { queryOptions } from '@tanstack/react-query';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import type { Reader, Release } from './index';

/** Who is reading: an operator, a steward of any family, or anyone else (a member, a guest, nobody signed in). */
async function readerNow(): Promise<{ reader: Reader; user: { id: string; created: number } | null; preview: boolean; demo: boolean }> {
  const [{ currentSession, myRealMemberships }, { isDemo }] = await Promise.all([import('../auth/guard.server'), import('../demo')]);
  const s = await currentSession();
  const demo = isDemo() || s.via === 'demo';
  if (!s.user || demo) return { reader: 'everyone', user: null, preview: false, demo };
  const preview = !!s.viewAs;
  if (s.user.operator === 1) return { reader: 'operators', user: s.user, preview, demo };
  const steward = (await myRealMemberships()).some((m) => m.role === 'steward');
  return { reader: steward ? 'stewards' : 'everyone', user: s.user, preview, demo };
}

export const fetchReleaseReader = createServerFn({ method: 'GET' }).handler(async (): Promise<{ reader: Reader }> => ({ reader: (await readerNow()).reader }));
export const releaseReaderQuery = queryOptions({ queryKey: ['releases', 'reader'], queryFn: () => fetchReleaseReader(), staleTime: 10 * 60_000 });

/** The release to show a card for, or null (a guest, a demo, a preview, nothing new, already seen). */
export const fetchReleaseCard = createServerFn({ method: 'GET' }).handler(async (): Promise<{ version: string; reader: Reader } | null> => {
  const r = await readerNow();
  if (!r.user || r.preview || r.demo) return null;
  const [{ cardFor }, { appVersion }] = await Promise.all([import('./releases.server'), import('../version')]);
  const release: Release | null = await cardFor(r.user, r.reader, appVersion());
  return release ? { version: release.version, reader: r.reader } : null;
});
export const releaseCardQuery = queryOptions({ queryKey: ['releases', 'card'], queryFn: () => fetchReleaseCard(), staleTime: 60 * 60_000 });

export const dismissReleaseCard = createServerFn({ method: 'POST' })
  .validator(z.object({ version: z.string().regex(/^\d+\.\d+\.\d+$/) }))
  .handler(async ({ data }) => {
    const [{ requireUser, fail }, { refuseReadOnly }, { AuthError }] = await Promise.all([import('../auth/guard.server'), import('../read-only'), import('../auth/errors')]);
    const user = await requireUser();
    try {
      refuseReadOnly();
    } catch (e) {
      throw e instanceof AuthError ? fail(e) : e;
    }
    await (await import('./releases.server')).markSeen(user.id, data.version);
    return { ok: true as const };
  });
