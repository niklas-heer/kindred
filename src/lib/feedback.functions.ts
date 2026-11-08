// Steward feedback's server functions. Every one requires manage-access (stewards only), the same check the Access and AI
// settings pages make; the picture's route (src/routes/api/feedback.$tree.$key.ts) makes it too.
import { queryOptions } from '@tanstack/react-query';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { FEEDBACK_STATUSES, parseFeedbackForm } from './feedback.ts';

const tree = z.string().regex(/^[a-z0-9-]+$/).max(64);
const id = z.string().regex(/^[a-z0-9-]{1,64}$/);
const server = () => import('./feedback.server');
const guard = () => import('./auth/guard.server');

export const submitFeedback = createServerFn({ method: 'POST' })
  .validator((d: unknown) => {
    if (!(d instanceof FormData)) throw new Error('feedback.err_invalid');
    return parseFeedbackForm(d);
  })
  .handler(async ({ data }) => {
    const { user } = await (await guard()).requireCan(data.tree, 'manage-access');
    const picture = data.picture ? new Uint8Array(await data.picture.arrayBuffer()) : null;
    const reportId = await (await server()).addFeedback(data.tree, { id: user.id, name: user.name }, { kind: data.kind, text: data.text, context: data.context, picture });
    return { id: reportId };
  });

export const getFeedback = createServerFn({ method: 'GET' })
  .validator(z.object({ tree }))
  .handler(async ({ data }) => {
    await (await guard()).requireCan(data.tree, 'manage-access');
    return (await server()).listFeedback(data.tree);
  });
export const feedbackQuery = (t: string) => queryOptions({ queryKey: ['feedback', t], queryFn: () => getFeedback({ data: { tree: t } }) });

export const updateFeedbackStatus = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, id, status: z.enum(FEEDBACK_STATUSES) }))
  .handler(async ({ data }) => {
    await (await guard()).requireCan(data.tree, 'manage-access');
    await (await server()).setFeedbackStatus(data.tree, data.id, data.status);
  });

export const removeFeedback = createServerFn({ method: 'POST' })
  .validator(z.object({ tree, id }))
  .handler(async ({ data }) => {
    await (await guard()).requireCan(data.tree, 'manage-access');
    await (await server()).deleteFeedback(data.tree, data.id);
  });
