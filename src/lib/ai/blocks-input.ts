// A reader's answer to a question card, as the browser sends it. In its own file so the server function's validator stays out of server-only code.
import { z } from 'zod';
import { ANSWER_CHARS } from './blocks';

export const answerInput = z.object({
  choices: z.array(z.string().max(120)).max(6).optional(),
  person: z.string().min(1).max(120).optional(),
  date: z.string().trim().max(11).optional(),
  text: z.string().trim().min(1).max(ANSWER_CHARS).optional(),
});
export type AnswerInput = z.infer<typeof answerInput>;
