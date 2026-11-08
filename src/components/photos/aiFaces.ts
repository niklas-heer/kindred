// The AI face finder, from src/lib/ai.functions.ts: `aiStatus({ data: { tree } })` says which features are
// on (`features.faces`), and `aiFindFaces({ data: { tree, mediaKey, locale } })` returns
// `{ faces: [{ box, suggestions: [{ personId, confidence, reason }] }] }`. The lookup is a glob, so the
// gallery still builds, and shows no AI controls, while that file is missing.
import type { Box } from './types';

export interface AiSuggestion { personId: string; confidence: number; reason: string }
export interface AiFace { box: Box; suggestions: AiSuggestion[] }

interface AiModule {
  aiStatus: (input: { data: { tree: string } }) => Promise<{ features?: Record<string, boolean | undefined> }>;
  aiFindFaces: (input: { data: { tree: string; mediaKey: string; locale: string } }) => Promise<{ faces: AiFace[]; references: number }>;
}

const modules = import.meta.glob('/src/lib/ai.functions.ts') as Record<string, () => Promise<Partial<AiModule>>>;

async function aiModule(): Promise<AiModule | null> {
  const load = modules['/src/lib/ai.functions.ts'];
  if (!load) return null;
  try {
    const m = await load();
    return typeof m.aiStatus === 'function' && typeof m.aiFindFaces === 'function' ? (m as AiModule) : null;
  } catch {
    return null;
  }
}

/** Whether the face finder is on for this family. False when there is no AI module, or it is off. */
export async function facesOn(tree: string): Promise<boolean> {
  const m = await aiModule();
  if (!m) return false;
  try {
    return (await m.aiStatus({ data: { tree } })).features?.faces === true;
  } catch {
    return false;
  }
}

/**
 * The faces the AI finds in a picture, and how many people it had to recognise them by (`references`: confirmed
 * tags and profile photos). Throws when the feature is unavailable or the search fails.
 */
export async function findFaces(tree: string, mediaKey: string, locale: string): Promise<{ faces: AiFace[]; references: number }> {
  const m = await aiModule();
  if (!m) throw new Error('lb.err_faces');
  return m.aiFindFaces({ data: { tree, mediaKey, locale } });
}
