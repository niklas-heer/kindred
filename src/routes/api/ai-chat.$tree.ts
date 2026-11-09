import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { CHAT_MESSAGE_CHARS, FAMILY_SESSION_CHARS, PROVIDERS } from '~/lib/ai/types';

// The assistant's reply as it is written, as server-sent events (src/lib/ai/stream.ts). The same checks as aiChatSend: signed in,
// a member of this family, and the same-site check in src/start.ts, which covers every POST. The history, the tool results
// and the proposals come from the server; the browser sends only the new message and which chat it is in.
const common = {
  conv: z.string().uuid(),
  locale: z.string().max(8).optional(),
  model: z.object({ provider: z.enum(PROVIDERS), model: z.string().trim().min(1).max(120) }).optional(),
};
const input = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('message'),
    ...common,
    /** The browser's id for this message. A retry repeats it, and finds the turn if it was stored after all. */
    turnId: z.string().uuid(),
    text: z.string().trim().max(FAMILY_SESSION_CHARS),
    images: z.array(z.object({ base64: z.string().min(1) })).optional(),
    keepImages: z.boolean().optional(),
    session: z.boolean().optional(),
    speaker: z.string().max(120).nullable().optional(),
    /** What the reader is looking at. The server checks the person is in this family. */
    page: z.object({ path: z.string().max(300), personId: z.string().max(120).optional() }).nullable().optional(),
  }),
  z.object({ kind: z.literal('continue'), ...common }),
]);

const refuse = (error: string, status: number) => new Response(JSON.stringify({ error }), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export const Route = createFileRoute('/api/ai-chat/$tree')({
  server: {
    handlers: {
      POST: async ({ params, request }) => {
        if (!/^[a-z0-9-]{1,64}$/.test(params.tree)) return refuse('not found', 404);
        const parsed = input.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return refuse('ai.err_bad_request', 400);
        const data = parsed.data;
        const [{ requireMember }, { AuthError }, { chatEventStream }, chat, stats] = await Promise.all([
          import('~/lib/auth/guard.server'), import('~/lib/auth/errors'), import('~/lib/ai/chat-stream.server'), import('~/lib/ai/chat.server'), import('~/lib/stats/store.server'),
        ]);
        let m;
        try {
          m = await requireMember(params.tree);
        } catch (e) {
          if (e instanceof AuthError) return refuse(e.message, e.status);
          throw e;
        }
        if (data.kind === 'message') {
          if (!data.session && data.text.length > CHAT_MESSAGE_CHARS) return refuse('ai.err_message_long', 400);
          if (data.session && data.text.length > FAMILY_SESSION_CHARS) return refuse('ai.err_session_long', 400);
        }
        const reader = { tree: params.tree, user: m.user.id, role: m.role, me: m.person, locale: data.locale ?? 'en', conv: data.conv };
        const body = chatEventStream(async (sink) => {
          if (data.kind === 'continue') return chat.continueAfterDecisions({ ...reader, sink });
          const reply = await chat.sendMessage({
            ...reader, sink, turnId: data.turnId, text: data.text, modelOverride: data.model,
            session: data.session, speaker: data.speaker ?? null, images: data.images, keepImages: data.keepImages, page: data.page,
          });
          await stats.countFeature(params.tree, m.user.id, 'assistant.asked').catch(() => {});
          return reply;
        }, { fn: 'ai-chat-stream' });
        return new Response(body, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store, no-transform', 'X-Accel-Buffering': 'no' } });
      },
    },
  },
});
