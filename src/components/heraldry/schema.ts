// The zod schema for a house's arms, v1 fields plus the optional v2 design. Meant for `updateHouse` in
// src/lib/api.ts (wave 2): replace its `arms` object with `armsSchema`, and keep `v2` when storing (db.server.ts
// currently rebuilds the arms from the v1 fields only, which drops it).
import { z } from 'zod';
import type { ArmsV2 } from '~/lib/seed-format';

const tinctureV1 = z.enum(['or', 'argent', 'gules', 'azure', 'vert', 'sable', 'purpure']);
const tinctureV2 = z.enum([
  'or', 'argent', 'gules', 'azure', 'vert', 'sable', 'purpure', 'murrey', 'sanguine', 'tenne', 'carnation',
  'ermine', 'ermines', 'erminois', 'vair', 'counter-vair', 'potent', 'proper',
]);
const line = z.enum(['straight', 'wavy', 'indented', 'embattled', 'engrailed', 'invected', 'nebuly', 'dancetty']);
const chargeId = z.string().regex(/^[a-z0-9-]{1,40}$/);

const ordinaryLayer = z.object({
  type: z.literal('ordinary'),
  kind: z.enum(['chief', 'base', 'fess', 'pale', 'bend', 'bend-sinister', 'chevron', 'cross', 'saltire', 'pall', 'bordure', 'orle', 'canton', 'pile', 'quarter']),
  tincture: tinctureV2,
  line,
  cotised: z.boolean().optional(),
  counterchanged: z.boolean().optional(),
});

const chargeLayer = z.object({
  type: z.literal('charge'),
  charge: chargeId,
  tincture: tinctureV2,
  count: z.number().int().min(1).max(9),
  arrangement: z.enum(['auto', 'pale', 'fess', 'bend', 'bend-sinister', 'two-one', 'one-two', 'two-two', 'saltire', 'cross', 'three-two-one', 'orle', 'seme']),
  on: z.enum(['field', 'ordinary', 'chief', 'base']),
  contourne: z.boolean().optional(),
  counterchanged: z.boolean().optional(),
  scale: z.number().min(0.5).max(1.5).optional(),
});

export const armsV2Schema = z.object({
  shield: z.enum(['heater', 'french', 'iberian', 'lozenge', 'swiss', 'kite']),
  field: z.object({
    division: z.enum(['plain', 'per-pale', 'per-fess', 'per-bend', 'per-bend-sinister', 'per-saltire', 'quarterly', 'per-chevron', 'per-pall', 'tierced-pale', 'tierced-fess', 'gyronny', 'paly', 'barry', 'bendy', 'bendy-sinister', 'chequy', 'lozengy', 'fusilly']),
    tinctures: z.array(tinctureV2).min(1).max(3),
    line,
    pieces: z.number().int().min(4).max(10).optional(),
  }),
  layers: z.array(z.discriminatedUnion('type', [ordinaryLayer, chargeLayer])).max(12),
  achievement: z.object({
    helm: z.enum(['none', 'esquire', 'knight', 'peer', 'royal']),
    mantling: z.tuple([tinctureV2, tinctureV2]).optional(),
    torse: z.boolean().optional(),
    crest: z.object({ charge: chargeId, tincture: tinctureV2 }).optional(),
    motto: z.string().trim().max(80).optional(),
    supporters: z.object({ charge: chargeId, tincture: tinctureV2 }).optional(),
  }).optional(),
});

/** v1 arms, exactly as before, with the optional v2 design beside them. */
export const armsSchema = z.object({
  field: tinctureV1,
  field2: tinctureV1.optional(),
  division: z.enum(['plain', 'per-pale', 'per-fess', 'per-bend', 'quarterly', 'chevron', 'paly', 'bendy', 'saltire', 'cross']),
  charge: z.enum(['none', 'lion', 'eagle', 'tower', 'star', 'crescent', 'fleur', 'key', 'rose', 'boar', 'stag', 'sword']),
  chargeTincture: tinctureV1,
  v2: armsV2Schema.optional(),
});

// Compile-time: the schema and the types in seed-format.ts describe the same shape.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const _sameV2: Same<z.infer<typeof armsV2Schema>, ArmsV2> = true;
void _sameV2;
