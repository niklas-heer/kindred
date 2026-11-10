// The shape an AI provider answers the arms design call with, and how that answer is checked. Zod only, so the
// test runner can load it on its own; canting.ts re-exports everything here.
import { z } from 'zod';
import { clampTo, cutText, firstOf } from '../ai/trim.ts';

export const tinctureZ = z.enum([
  'or', 'argent', 'gules', 'azure', 'vert', 'sable', 'purpure', 'murrey', 'sanguine', 'tenne', 'carnation',
  'ermine', 'ermines', 'erminois', 'vair', 'counter-vair', 'potent', 'proper',
]);

/**
 * One line of a design's symbolism: a colour or charge of the design, and why it stands for the meaning it draws
 * on, in the reader's language ("Argent for the honour your family names").
 */
export const symbolismItemSchema = z.object({
  element: z.string().trim().overwrite(cutText(60)).min(1).describe('The colour or charge, a few words (at most 60 characters).'),
  why: z.string().trim().overwrite(cutText(200)).min(1).describe('One short line on what it stands for (at most 200 characters).'),
});
export type Symbolism = z.infer<typeof symbolismItemSchema>;

/**
 * Validates an AI provider's answer. Lenient: extra keys are dropped, and unknown charge ids are dropped later.
 * `symbolism` is optional. An older or sparse reply has none, and a malformed list is dropped rather than failing
 * the whole answer, so it never costs a retry.
 */
export const cantingResponseSchema = z.object({
  suggestions: z.array(z.object({
    explanation: z.string().trim().overwrite(cutText(200)).min(1).describe('One line on the design (at most 200 characters).'),
    element: z.string().overwrite(cutText(60)).optional(),
    meaningId: z.string().overwrite(cutText(20)).optional(),
    field: z.array(tinctureZ).overwrite(firstOf(3)).min(1).optional().describe('One to three tinctures. At most three.'),
    division: z.enum(['plain', 'per-pale', 'per-fess', 'per-bend', 'per-bend-sinister', 'per-saltire', 'quarterly', 'per-chevron', 'per-pall', 'tierced-pale', 'tierced-fess', 'gyronny', 'paly', 'barry', 'bendy', 'bendy-sinister', 'chequy', 'lozengy', 'fusilly']).optional(),
    base: z.enum(['mount', 'water', 'field']).optional(),
    ordinary: z.object({
      kind: z.enum(['chief', 'base', 'fess', 'pale', 'bend', 'bend-sinister', 'chevron', 'cross', 'saltire', 'pall', 'bordure', 'orle', 'canton', 'pile', 'quarter']),
      tincture: tinctureZ.optional(),
      line: z.enum(['straight', 'wavy', 'indented', 'embattled', 'engrailed', 'invected', 'nebuly', 'dancetty']).optional(),
    }).optional(),
    charges: z.array(z.object({
      charge: z.string().overwrite(cutText(40)),
      tincture: tinctureZ.optional(),
      count: z.number().overwrite(clampTo(1, 9, true)).optional().describe('How many, 1 to 9.'),
      on: z.enum(['field', 'ordinary', 'chief']).optional(),
    })).overwrite(firstOf(3)).optional().describe('At most three charges.'),
    symbolism: z.array(symbolismItemSchema).overwrite(firstOf(6)).optional().catch(undefined).describe('Up to six lines.'),
  })).overwrite(firstOf(8)).describe('At most eight designs.'),
});
