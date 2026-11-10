// The fake provider's fixed phrases for the assistant's questions, widgets and sets of changes, so tests and e2e reach every one
// without a model. Each phrase works on any tree: when it needs people it searches first, as a real model would.
//   FAKE-ASK single|multiple|person|date|text   a question card
//   FAKE-WIDGET person|path|tree|timeline|dates|gaps   a widget
//   FAKE-APPLY    three related proposals on one person, for Apply all
//   FAKE-REMOVE   a proposal to remove someone
//   FAKE-THIS     reads the person the reader is looking at (the system prompt's "Looking at" line)
//   FAKE-MY <relation>   finds the reader's relatives of that kind
//   "add that she emigrated in 1952, according to the passenger list" (he/they, any year and source): on a person's page, a
//                 source card for the passenger list and an emigration card that cites it
import type { AiMessage, AiRequest, ToolCall } from './adapters';

const trigger = /^FAKE-(ASK|WIDGET|APPLY|REMOVE|THIS|MY)\b\s*([\w-]*)/;

function sinceLastUser(ms: AiMessage[]): AiMessage[] {
  const at = ms.map((m) => m.role).lastIndexOf('user');
  return at < 0 ? [] : ms.slice(at + 1);
}

function peopleIn(msgs: AiMessage[]): { id: string }[] {
  for (const m of [...msgs].reverse()) {
    if (m.role !== 'tool') continue;
    try {
      const r = JSON.parse(m.content) as { people?: { id: string }[] };
      if (r.people) return r.people;
    } catch { /* a tool's text that is not JSON */ }
  }
  return [];
}

function relativeIn(msgs: AiMessage[]): string | undefined {
  const m = [...msgs].reverse().find((x) => x.role === 'tool');
  if (m?.role !== 'tool') return undefined;
  try {
    const r = JSON.parse(m.content) as Record<string, { id: string }[]>;
    return [...(r.children ?? []), ...(r.parents ?? []), ...(r.partners ?? []), ...(r.siblings ?? [])][0]?.id;
  } catch {
    return undefined;
  }
}

const ASK: Record<string, { question: string; options?: string[] }> = {
  single: { question: 'Which side of the family?', options: ['Father’s side', 'Mother’s side'] },
  multiple: { question: 'Which of these should I add?', options: ['Birth date', 'Birth place', 'Occupation'] },
  person: { question: 'Who do you mean?' },
  date: { question: 'When was that?' },
  text: { question: 'What should the note say?' },
};

/** "add that she emigrated in 1952, according to the passenger list": a life event with its source, as a reader would say it. */
const EMIGRATED = /^add that (?:she|he|they) emigrated in (\d{4}),? according to (?:the |a |her |his |their )?(.+?)\.?$/i;

function emigrated(req: AiRequest, said: string): { text: string; calls: ToolCall[] } | null {
  const m = EMIGRATED.exec(said.trim());
  if (!m) return null;
  if (sinceLastUser(req.messages).some((x) => x.role === 'assistant')) return { text: 'Fake: an event and its source to approve.', calls: [] };
  const person = /Looking at: .*\[id: ([^\]]+)\]/.exec(req.system)?.[1];
  if (!person) return { text: 'Fake: no person on this page.', calls: [] };
  const title = m[2].charAt(0).toUpperCase() + m[2].slice(1);
  const call = (name: string, args: unknown): ToolCall => ({ id: `fake-life-${req.messages.length}-${name}`, name, args });
  return {
    text: '',
    calls: [
      call('propose_source', { title }),
      call('propose_life_event', { person, type: 'emigration', date: m[1], cite: { sourceTitle: title } }),
    ],
  };
}

/** One step of a scripted ability, or null when the message is no such phrase. */
export function abilityStep(req: AiRequest, said: string): { text: string; calls: ToolCall[] } | null {
  const life = emigrated(req, said);
  if (life) return life;
  const m = trigger.exec(said.trim());
  if (!m) return null;
  const [, what, arg] = m;
  const done = sinceLastUser(req.messages);
  const step = done.filter((x) => x.role === 'assistant').length;
  const call = (name: string, args: unknown): ToolCall => ({ id: `fake-ability-${req.messages.length}-${name}`, name, args });
  const say = (text: string) => ({ text, calls: [] });
  const act = (...calls: ToolCall[]) => ({ text: '', calls });
  const search = () => act(call('search_people', { query: 'a', limit: 15 }));

  if (what === 'ASK') {
    if (step) return say('Fake: waiting for your answer.');
    return act(call('ask_reader', { ...(ASK[arg] ?? ASK.text), kind: ASK[arg] ? arg : 'text' }));
  }
  if (what === 'THIS') {
    if (step) return say('Fake: read the person on the page.');
    const id = /Looking at: .*\[id: ([^\]]+)\]/.exec(req.system)?.[1];
    return id ? act(call('read_person', { id })) : say('Fake: no person on this page.');
  }
  if (what === 'MY') {
    if (step) return say('Fake: found your relatives.');
    return act(call('find_relatives', { relation: arg || 'parent' }));
  }
  if (what === 'APPLY') {
    if (step === 0) return search();
    if (step === 1) {
      const person = peopleIn(done)[0]?.id;
      if (!person) return say('Fake: nobody to change.');
      return act(
        call('propose_edit_names', { person, nickname: 'Fake nickname' }),
        call('propose_add_field', { person, type: 'favourites', label: 'colour', value: { text: 'Fake green' } }),
        call('propose_add_story', { person, kind: 'note', body: 'Fake note from one request.' }),
      );
    }
    return say('Fake: three changes to approve together.');
  }
  if (what === 'REMOVE') {
    if (step === 0) return search();
    if (step === 1) {
      const person = peopleIn(done).at(-1)?.id;
      return person ? act(call('propose_remove_person', { person })) : say('Fake: nobody to remove.');
    }
    return say('Fake: a removal to approve.');
  }
  // WIDGET
  if (arg === 'dates') return step ? say('Fake: dates shown.') : act(call('show_dates', { days: 366 }));
  if (arg === 'gaps') return step ? say('Fake: gaps shown.') : act(call('show_gaps', {}));
  const tool = arg === 'tree' ? 'show_family' : arg === 'timeline' ? 'show_timeline' : arg === 'person' ? 'show_person' : arg === 'path' ? 'show_relationship' : null;
  if (!tool) return say('Fake: no such widget.');
  if (step === 0) return search();
  const people = peopleIn(done);
  const first = people[0]?.id;
  if (!first) return say('Fake: nobody to show.');
  if (tool !== 'show_relationship') return step === 1 ? act(call(tool, { person: first })) : say('Fake: widget shown.');
  if (step === 1) return act(call('relatives', { id: first }));
  if (step === 2) return act(call(tool, { from: first, to: relativeIn(done) ?? people[1]?.id ?? first }));
  return say('Fake: widget shown.');
}
