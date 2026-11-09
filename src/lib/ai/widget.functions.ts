// The server functions behind a question card and a widget. Both work only on the reader's own stored turn: the question and
// the widget's ids come from there, never from the browser. A person's data in a widget is read for this reader, now.
import { queryOptions } from '@tanstack/react-query';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { answerInput } from './blocks-input';

const tree = z.string().regex(/^[a-z0-9-]{1,64}$/);
const ref = z.string().min(1).max(64);
const guard = () => import('../auth/guard.server');

/** What one widget on a stored turn shows now. Null when it is gone, or not this reader's to read. */
export const aiWidget = createServerFn({ method: 'GET' })
  .validator(z.object({ tree, itemId: ref, blockId: ref, conv: ref.optional() }))
  .handler(async ({ data }) => {
    const m = await (await guard()).requireMember(data.tree);
    const { widgetFor } = await import('./blocks.server');
    const { mayRead } = await import('./conversations.server');
    return widgetFor({ tree: data.tree, user: m.user.id, role: m.role, me: m.person, conv: data.conv, itemId: data.itemId, blockId: data.blockId, mayRead: mayRead as never });
  });

export const aiWidgetQuery = (t: string, itemId: string, blockId: string, conv?: string) =>
  queryOptions({ queryKey: ['ai-widget', t, itemId, blockId], queryFn: () => aiWidget({ data: { tree: t, itemId, blockId, conv } }), staleTime: 30_000 });

/** Answers a question card, once. Returns the words to send as the reader's next message. */
export const aiAnswerQuestion = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, itemId: ref, questionId: ref, conv: ref.optional(), answer: answerInput }))
  .handler(async ({ data }) => {
    const m = await (await guard()).requireMember(data.tree);
    const { answerQuestion } = await import('./blocks.server');
    const { mayRead } = await import('./conversations.server');
    return answerQuestion({ tree: data.tree, user: m.user.id, role: m.role, conv: data.conv, itemId: data.itemId, questionId: data.questionId, answer: data.answer, mayRead: mayRead as never });
  });
