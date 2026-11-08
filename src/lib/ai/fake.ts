// The fake provider, for tests: KINDRED_AI_FAKE=1 makes every AI feature use it instead of a real
// provider, so nothing ever calls an API. It answers from fixed fixtures:
//   - chat: "/tool <name> <json>" as a message makes the model call that tool with those arguments;
//     after a tool result it answers with a summary; anything else gets an echo.
//   - faces: the first candidate in the "CANDIDATES:" line (if any) matches the one face it finds.
//   - look (a portrait) and arms: fixed answers that pass the same validation as real ones.
import type { AiAdapter, AiMessage, AiReply, AiRequest } from './adapters';

const lastUser = (ms: AiMessage[]) => [...ms].reverse().find((m): m is Extract<AiMessage, { role: 'user' }> => m.role === 'user')?.text ?? '';

function fixture(name: string, prompt: string): unknown {
  if (name === 'faces') {
    const line = prompt.split('\n').find((l) => l.startsWith('CANDIDATES:'));
    const first = line?.slice('CANDIDATES:'.length).split(',').map((s) => s.trim()).filter(Boolean)[0];
    return {
      faces: [{ box: { x: 0.1, y: 0.15, w: 0.2, h: 0.3 }, suggestions: first ? [{ personId: first, confidence: 0.8, reason: 'Fake: the first candidate' }] : [] }],
    };
  }
  if (name === 'look') {
    return { skin: 1, hair: 2, eyes: 4, hairStyle: 'bob', beardStyle: 'none', clothing: 'cardigan', glasses: 'round', age: 40 };
  }
  if (name === 'arms') {
    const design = (meaning: string, field: 'azure' | 'gules' | 'vert', charge: 'lion' | 'star' | 'tower') => ({
      meaning,
      arms: { field: 'argent', division: 'per-fess', charge, chargeTincture: 'or', field2: field },
    });
    return { designs: [design('Fake: a lion for courage', 'azure', 'lion'), design('Fake: a star for guidance', 'gules', 'star'), design('Fake: a tower for the home', 'vert', 'tower')] };
  }
  return {};
}

export function fakeAdapter(model = 'fake-model'): AiAdapter {
  return {
    provider: 'fake',
    model,
    async complete(req: AiRequest): Promise<AiReply> {
      const user = lastUser(req.messages);
      const prompt = [req.system, ...req.messages.map((m) => ('text' in m ? m.text : m.content))].join('\n');
      if (req.json) return { text: '', calls: [], json: fixture(req.json.name, user + '\n' + prompt), tokens: 50 };
      const last = req.messages.at(-1);
      if (last?.role === 'tool') return { text: `Fake summary: ${last.content.slice(0, 300)}`, calls: [], tokens: 40 };
      const m = /^\/tool\s+(\S+)\s*(\{[\s\S]*\})?\s*$/.exec(user);
      if (m && req.tools?.some((t) => t.name === m[1])) {
        return { text: '', calls: [{ id: `fake-${m[1]}-${req.messages.length}`, name: m[1], args: JSON.parse(m[2] || '{}') }], tokens: 30 };
      }
      return { text: `Fake reply: ${user.slice(0, 200)}`, calls: [], tokens: 20 };
    },
  };
}
