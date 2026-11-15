import { createFileRoute } from '@tanstack/react-router';
import { FILE_TYPES, MAX_FILE_BYTES } from '~/lib/suggestions/types';

// Attaches a file to a waiting suggestion: POST /api/suggestion-upload/<tree>/<suggestion id>, the file's bytes as the body,
// its type as Content-Type and its name, URI-encoded, as X-File-Name. Its own suggester only: a member (requireMember), or a
// share-link guest by their `kindred_voter` cookie while the family lets guests attach files (suggester.server.ts); the
// same-site check in src/start.ts covers every POST. A body longer than MAX_FILE_BYTES is refused by its declared length
// before a byte is read, or as soon as the bytes read pass it; nothing is stored until the whole file is checked
// (suggest.server.ts `addSuggestionFile`: type, bytes, metadata, the counted media store). Answers `{ id }`, or `{ error }`
// with a translation key or an auth error's text.

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const refuse = (code: string, status: number) => json({ error: `suggest.err.${code}` }, status);
/** The status of each refusal of suggest.server.ts that is not a plain bad request. */
const STATUS: Record<string, number> = { gone: 404, file_size: 413, file_type: 415 };

/** The request's body, read until it is longer than `max` bytes (then null, and the rest is not read). */
async function bodyUpTo(request: Request, max: number): Promise<Uint8Array | null> {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.byteLength;
  }
  return bytes;
}

/** The file's name as the browser sent it; the server shortens and cleans it (suggest.server.ts). */
function nameOf(request: Request): string {
  try {
    return decodeURIComponent(request.headers.get('x-file-name') ?? '');
  } catch {
    return '';
  }
}

export const Route = createFileRoute('/api/suggestion-upload/$tree/$id')({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        if (!/^[a-z0-9-]{1,64}$/.test(params.tree) || !/^[0-9a-f-]{36}$/.test(params.id)) return json({ error: 'not found' }, 404);
        const [{ AuthError }, { refuseReadOnly }, { suggesterOf }, { addSuggestionFile }] = await Promise.all([
          import('~/lib/auth/errors'), import('~/lib/read-only'), import('~/lib/suggestions/suggester.server'), import('~/lib/suggestions/suggest.server'),
        ]);
        try {
          const { by } = await suggesterOf(params.tree, request);
          refuseReadOnly();
          const declared = Number(request.headers.get('content-length'));
          if (Number.isFinite(declared) && declared > MAX_FILE_BYTES) return refuse('file_size', 413);
          const mime = (request.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
          if (!(FILE_TYPES as readonly string[]).includes(mime)) return refuse('file_type', 415);
          const bytes = await bodyUpTo(request, MAX_FILE_BYTES);
          if (!bytes) return refuse('file_size', 413);
          return json(await addSuggestionFile(params.tree, by, params.id, { name: nameOf(request), mime, bytes }));
        } catch (e) {
          if (e instanceof AuthError) return json({ error: e.message }, e.status);
          const code = e instanceof Error && e.message.startsWith('suggest.err.') ? e.message.slice('suggest.err.'.length) : null;
          if (code) return refuse(code, STATUS[code] ?? 400);
          throw e;
        }
      },
    },
  },
});
