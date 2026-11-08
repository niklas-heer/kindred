// The fake provider, for tests: KINDRED_AI_FAKE=1 makes every AI feature use it instead of a real
// provider, so nothing ever calls an API. It answers from fixed fixtures:
//   - chat: "/tool <name> <json>" as a message makes the model call that tool with those arguments;
//     after a tool result it answers with a summary; anything else gets an echo.
//   - faces: the first candidate in the "CANDIDATES:" line (if any) matches the one face it finds.
//   - look (a portrait) and an occupation's translation: fixed answers that pass the same validation as real ones.
//   - arms from a name: step one (name_meaning) answers a Heer-like example with web sources when web search is
//     on, and one generic meaning for any other surname; step two (arms_designs) draws three designs on the
//     meaning ids the reader chose (the "m1", "own1" … lines of its prompt).
import type { AiAdapter, AiMessage, AiReply, AiRequest } from './adapters';

/** The usage a fake call reports: `n` tokens, half sent and half generated, and no search unless the call asked for one. */
const split = (n: number) => ({ tokens: n, inputTokens: Math.ceil(n / 2), outputTokens: Math.floor(n / 2), searches: 0 });

const lastUser = (ms: AiMessage[]) => [...ms].reverse().find((m): m is Extract<AiMessage, { role: 'user' }> => m.role === 'user')?.text ?? '';

/** Pages the fake's Heer example "found". Real dictionary entries, so the links work when a developer clicks one. */
const HEER_SOURCES = [
  { url: 'https://en.wiktionary.org/wiki/heer', title: 'heer: Wiktionary' },
  { url: 'https://de.wiktionary.org/wiki/hehr', title: 'hehr: Wiktionary' },
  { url: 'https://de.wiktionary.org/wiki/Heer', title: 'Heer: Wiktionary' },
];

const HEER_MEANINGS = [
  { language: 'Dutch and German', root: 'heer', meaning: 'lord, gentleman', attestation: 'well-attested', ideas: [{ kind: 'quality', idea: 'a lord’s courage' }, { kind: 'trade', idea: 'a steward of an estate' }], sources: [HEER_SOURCES[0].url] },
  { language: 'German', root: 'hehr', meaning: 'noble, honourable', attestation: 'well-attested', ideas: [{ kind: 'quality', idea: 'honour' }, { kind: 'sound', idea: 'a play on hear' }], sources: [HEER_SOURCES[1].url] },
  { language: 'German', root: 'Heer', meaning: 'army, host', attestation: 'well-attested', ideas: [{ kind: 'object', idea: 'a banner over a host' }], sources: [HEER_SOURCES[2].url] },
];

/** The three designs the fake draws; each names a chosen meaning id (cycled) and uses only catalogue charges. */
const DESIGNS = [
  { explanation: 'Fake: a lion, for a lord’s courage', field: ['azure'], charges: [{ charge: 'lion', tincture: 'or', count: 1 }], symbolism: [{ element: 'azure', why: 'Azure for the loyalty and truth the name stands for' }, { element: 'a lion', why: 'a lion for a lord’s courage' }] },
  { explanation: 'Fake: three stars, for honour', field: ['gules'], ordinary: { kind: 'chevron', tincture: 'argent' }, charges: [{ charge: 'mullet', tincture: 'or', count: 3 }] },
  { explanation: 'Fake: a tower, for a steward’s house', field: ['vert'], charges: [{ charge: 'tower', tincture: 'argent', count: 1 }], symbolism: [{ element: 'a tower', why: 'a tower for the army, Heer' }] },
];

/** What the fake "reads" from any picture: three profiles, as a list on a phone screen would give them. Invented names. */
const PICTURE_DRAFT = {
  people: [
    { ref: 'n1', given: 'Mira', surname: 'Lindqvist', living: true, social: [{ network: 'Instagram', handle: 'mira.lindqvist' }] },
    { ref: 'n2', given: 'Tomas', surname: 'Adeyemi', living: true, social: [{ network: 'instagram', handle: '@tomas_adeyemi' }] },
    { ref: 'n3', given: 'jo_paints', living: true, social: [{ network: 'Instagram', handle: 'jo_paints' }] },
  ],
  links: [],
};

function fixture(name: string, prompt: string, user: string, webSearch: boolean): { json: unknown; sources?: { url: string; title?: string }[] } {
  if (name === 'faces') {
    const line = prompt.split('\n').find((l) => l.startsWith('CANDIDATES:'));
    const first = line?.slice('CANDIDATES:'.length).split(',').map((s) => s.trim()).filter(Boolean)[0];
    return {
      json: {
        faces: [{ box: { x: 0.1, y: 0.15, w: 0.2, h: 0.3 }, suggestions: first ? [{ personId: first, confidence: 0.8, reason: 'Fake: the first candidate' }] : [] }],
      },
    };
  }
  if (name === 'look') {
    return { json: { skin: 1, hair: 2, eyes: 4, hairStyle: 'bob', beardStyle: 'none', clothing: 'cardigan', glasses: 'round', age: 40 } };
  }
  if (name === 'name_meaning') {
    const surname = /Surname: (.+)/.exec(user)?.[1]?.trim() ?? '';
    const heer = surname.toLowerCase() === 'heer';
    const meanings = heer
      ? HEER_MEANINGS
      : [{ language: '', root: surname, meaning: 'Fake: a meaning to choose from', attestation: 'speculative', ideas: [{ kind: 'sound', idea: 'a play on the name' }], sources: [] }];
    // Only the pages the search "found" are cited, and only when web search was on (or its pages are in the prompt).
    const sources = webSearch && heer ? HEER_SOURCES : undefined;
    return {
      json: { meanings: webSearch ? meanings : meanings.map((m) => ({ ...m, sources: [] })), note: webSearch ? undefined : 'Fake: from the model’s own knowledge, not checked online.' },
      sources,
    };
  }
  if (name === 'arms_designs') {
    const ids = [...user.matchAll(/^([\w-]+): /gm)].map((m) => m[1]).filter((id) => /^(m|own)/.test(id));
    const id = (i: number) => ids[i % Math.max(ids.length, 1)] ?? 'm1';
    return { json: { suggestions: DESIGNS.map((d, i) => ({ ...d, meaningId: id(i) })) } };
  }
  if (name === 'arms_revisions') {
    // Refinements add a key in chief, and a garb asked for on the field (which has to find room of its own); the fresh designs are the three above.
    const ids = [...user.matchAll(/^([\w-]+): /gm)].map((m) => m[1]).filter((x) => /^(m|own)/.test(x));
    const id = (i: number) => ids[i % Math.max(ids.length, 1)] ?? 'm1';
    return {
      json: {
        refinements: [
          { meaningId: id(0), explanation: 'Fake: a key, for the steward’s office, beside the house charge', charges: [{ charge: 'key', tincture: 'or', on: 'chief' }], symbolism: [{ element: 'a key', why: 'a key for the steward’s office' }] },
          { meaningId: id(1), explanation: 'Fake: a garb on the field, for the manor farm', charges: [{ charge: 'garb', tincture: 'or', on: 'field' }] },
        ],
        designs: DESIGNS.map((d, i) => ({ ...d, meaningId: id(i) })),
      },
    };
  }
  if (name === 'occupation') return { json: { label: 'Fake translation' } };
  return { json: {} };
}

export function fakeAdapter(model = 'fake-model'): AiAdapter {
  return {
    provider: 'fake',
    model,
    async complete(req: AiRequest): Promise<AiReply> {
      const user = lastUser(req.messages);
      const prompt = [req.system, ...req.messages.map((m) => ('text' in m ? m.text : m.content))].join('\n');
      if (req.json) {
        // A JSON answer built from pages a search returned (arms.server.ts) keeps those pages, as a searched run does.
        const searched = !!req.webSearch || /Pages the search returned/.test(user);
        const f = fixture(req.json.name, user + '\n' + prompt, user, searched);
        return { text: '', calls: [], json: f.json, ...split(50), ...(f.sources ? { sources: f.sources, searches: req.webSearch ? 1 : 0 } : {}) };
      }
      const last = req.messages.at(-1);
      if (last?.role === 'tool') return { text: `Fake summary: ${last.content.slice(0, 300)}`, calls: [], ...split(40) };
      // A family session (its transcript): a line "FAKE-FAMILY {json}" is the draft the fake proposes, so a test can script one.
      const family = /FAKE-FAMILY (\{.*\})/.exec(user);
      if (family && req.tools?.some((t) => t.name === 'propose_family')) {
        return { text: '', calls: [{ id: `fake-family-${req.messages.length}`, name: 'propose_family', args: JSON.parse(family[1]) }], ...split(60) };
      }
      // A message with pictures reads as a screenshot of profiles, so the browser path can be walked without a script in the text.
      const seen = req.messages.at(-1);
      if (seen?.role === 'user' && seen.images?.length && req.tools?.some((t) => t.name === 'propose_family')) {
        return { text: '', calls: [{ id: `fake-pictures-${req.messages.length}`, name: 'propose_family', args: PICTURE_DRAFT }], ...split(60 + seen.images.length * 100) };
      }
      const m = /^\/tool\s+(\S+)\s*(\{[\s\S]*\})?\s*$/.exec(user);
      if (m && req.tools?.some((t) => t.name === m[1])) {
        return { text: '', calls: [{ id: `fake-${m[1]}-${req.messages.length}`, name: m[1], args: JSON.parse(m[2] || '{}') }], ...split(30) };
      }
      // Arms from a name with web search: a free-text answer that holds the one JSON object (arms.server.ts), after some prose.
      if (req.webSearch && /Answer with one JSON object/.test(req.system)) {
        const f = fixture('name_meaning', user + '\n' + prompt, user, true);
        return { text: `Here is the research.\n${JSON.stringify(f.json)}`, calls: [], ...split(50), ...(f.sources ? { sources: f.sources, searches: 1 } : { searches: 0 }) };
      }
      // Arms research in prose with web search (arms.server.ts's Surname: and Country lines): the Heer example is searched, anything else is not.
      if (req.webSearch && /^Surname: /m.test(user)) {
        const surname = /^Surname: (.+)$/m.exec(user)?.[1]?.trim() ?? '';
        const heer = surname.toLowerCase() === 'heer';
        return {
          text: heer ? 'Research notes: Heer is a lord, a host or an army in Dutch and German, with sources.' : 'Research notes: nothing was checked on the web for this surname.',
          calls: [], ...split(40), ...(heer ? { sources: HEER_SOURCES, searches: 1 } : { searches: 0 }),
        };
      }
      // A chat reply with web search on: the fake "searches" once and cites one page, so the search path is exercised.
      if (req.webSearch) {
        return { text: `Fake reply, searched: ${user.slice(0, 200)}`, calls: [], ...split(20), searches: 1, sources: [{ url: 'https://en.wikipedia.org/wiki/Fake_source', title: 'Fake source' }] };
      }
      return { text: `Fake reply: ${user.slice(0, 200)}`, calls: [], ...split(20) };
    },
  };
}
