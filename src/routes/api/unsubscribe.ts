// The one-click unsubscribe (RFC 8058) a mail program sends for an email's List-Unsubscribe header: a POST with
// "List-Unsubscribe=One-Click" to this address and the link's own query (r, c, t; src/lib/email/send.server.ts). The proof `t`
// covers the address's hash and the category, so it unsubscribes that pair alone. A GET does nothing: link checkers fetch.
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/api/unsubscribe')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const [{ unsubscribe }, { readOnly }] = await Promise.all([import('~/lib/email/send.server'), import('~/lib/read-only')]);
        const p = new URL(request.url).searchParams;
        const ok = !readOnly() && (await unsubscribe(p.get('r'), p.get('c'), p.get('t')));
        return new Response(null, { status: ok ? 200 : 400, headers: { 'cache-control': 'no-store' } });
      },
    },
  },
});
