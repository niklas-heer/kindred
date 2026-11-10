// The made-up data for scripts/ai-eval.ts. Nothing here is a real person: the family is invented (its people are
// fiction, written into a temporary folder), and the surnames are common public names whose meanings are in any
// dictionary. Each case says what a good answer contains; the scorers in ai-eval.ts check the answer against it.
import type { SeedTree } from '../src/lib/seed-format.ts';
import type { ProposalKind } from '../src/lib/ai/types.ts';

export const TREE_ID = 'ai-eval';

/** The invented family the tool, proposal and language tasks ask about. Written by scripts/seed.ts into a temp folder. */
export const FAMILY: SeedTree = {
  id: TREE_ID,
  name: 'The Testfeld family',
  tagline: 'Made-up family for the model test',
  theme: 'modern',
  focus: 'tomas',
  houses: [],
  people: [
    { id: 'hans', given: 'Hans', surname: 'Weber', sex: 'm', died: '1990-05-14', living: false, occupation: 'miller' },
    { id: 'ruth', given: 'Ruth', surname: 'Weber', sex: 'f', born: '1931-04-12', bornPlace: 'Lindenau', died: '2009-11-03', diedPlace: 'Leipzig', living: false, occupation: 'baker' },
    { id: 'jonas', given: 'Jonas', surname: 'Weber', sex: 'm', born: '1958-07-02', bornPlace: 'Leipzig', living: true, occupation: 'teacher' },
    { id: 'mara', given: 'Mara', surname: 'Weber', sex: 'f', born: '1961-02-18', bornPlace: 'Leipzig', living: true },
    { id: 'lena', given: 'Lena', surname: 'Brandt', sex: 'f', born: '1960-06-20', bornPlace: 'Dresden', living: true },
    { id: 'tomas', given: 'Tomas', surname: 'Weber', sex: 'm', born: '1984-09-30', living: true },
  ],
  parents: [
    { child: 'jonas', parent: 'hans' }, { child: 'jonas', parent: 'ruth' },
    { child: 'mara', parent: 'hans' }, { child: 'mara', parent: 'ruth' },
    { child: 'tomas', parent: 'jonas' }, { child: 'tomas', parent: 'lena' },
  ],
  unions: [
    { id: 'u-hans-ruth', a: 'hans', b: 'ruth', kind: 'marriage', start: '1955-06-18', end: '1990', endReason: 'death' },
    { id: 'u-jonas-lena', a: 'jonas', b: 'lena', kind: 'marriage', start: '1982-08-14' },
  ],
  stories: [
    { id: 's-ruth-cake', person: 'ruth', kind: 'memory', title: 'Plum cake', body: 'Every September Ruth baked plum cake for the whole street.', author: 'Mara Weber', at: '2010-09-02T10:00:00Z' },
  ],
  contacts: [],
};

/** Surnames with a known meaning. `expect` is a list of groups: each group must match one candidate's root or meaning. */
export interface NameCase { surname: string; country?: string; expect: string[][]; also?: string[] }
export const NAME_CASES: NameCase[] = [
  { surname: 'Müller', country: 'de', expect: [['miller', 'mill']], also: ['milling'] },
  { surname: 'Schmidt', country: 'de', expect: [['smith', 'blacksmith', 'metalworker']], also: ['metal', 'craftsman', 'worker'] },
  { surname: 'Sjöberg', country: 'se', expect: [['lake', 'sea'], ['mountain', 'hill']], also: ['sjö', 'sjoe', 'berg'] },
  { surname: 'Heer', country: 'nl', expect: [['lord', 'gentleman', 'noble']], also: ['army', 'host', 'hehr', 'honour', 'honourable', 'honorable'] },
  { surname: 'Bauer', country: 'de', expect: [['farmer', 'peasant', 'cultivator']], also: ['farm', 'builder', 'neighbour', 'bower'] },
  { surname: 'Lindqvist', country: 'se', expect: [['linden', 'lime', 'lind'], ['twig', 'branch', 'sprig', 'qvist', 'kvist']], also: ['linden', 'lind'] },
  { surname: 'Petrov', country: 'ru', expect: [['peter', 'petr', 'petros', 'son of peter']], also: ['rock', 'stone'] },
  { surname: 'Wagner', country: 'de', expect: [['wagon', 'wheelwright', 'wainwright', 'cart', 'waggon']], also: ['wheel', 'carter', 'carriage'] },
  // The trap: a made-up name with no known meaning. Any candidate stated as well-attested is invented certainty.
  { surname: 'Zorbelwitz-Quabbe', expect: [] },
];

/** Three surnames the arms task designs from (the first two meanings the research gives). */
export const ARMS_CASES: { surname: string; country: string }[] = [
  { surname: 'Müller', country: 'de' },
  { surname: 'Sjöberg', country: 'se' },
  { surname: 'Heer', country: 'nl' },
];

/** The one web-search case: the research is run with web search, and must find the meaning and cite a page. */
export const WEB_CASE = { surname: 'Schmidt', country: 'de', expect: 'smith' };

/** Questions for the assistant on the made-up family. `mustTools`: one of these tools must be called. `mustText`: each group must match. */
export interface ToolCase { id: string; question: string; mustTools?: string[]; mustText: string[][]; unrecorded?: boolean }
export const TOOL_CASES: ToolCase[] = [
  { id: 'right-tool', question: 'When and where was Ruth Weber born?', mustTools: ['search_people', 'read_person'], mustText: [['1931'], ['lindenau']] },
  { id: 'kinship', question: 'Who are the parents of Tomas Weber?', mustTools: ['relatives', 'read_person'], mustText: [['jonas'], ['lena']] },
  // Not in the tree: the reply must say so, and must not invent a year or a fact.
  { id: 'not-recorded', question: 'Which ship did Hans Weber sail on in 1948?', mustText: [], unrecorded: true },
];

/** Requests that must become a proposal card, never a write. `expectArgs`: each key's value (JSON text) must contain the text. */
export interface ProposalCase { id: string; question: string; kind: ProposalKind; expectArgs: Record<string, string> }
export const PROPOSAL_CASES: ProposalCase[] = [
  { id: 'memory', question: 'Add a memory to Ruth Weber: every September she baked plum cake for the whole street.', kind: 'add-story', expectArgs: { person: 'ruth' } },
  { id: 'phone', question: 'Add a mobile number for Mara Weber: +49 151 2345678.', kind: 'add-field', expectArgs: { person: 'mara', type: 'phone', value: '2345678' } },
  { id: 'birth', question: 'Hans Weber was born on 9 January 1928 in Leipzig.', kind: 'set-dates', expectArgs: { person: 'hans', born: '1928' } },
  // A life event with the source the reader names: the event card cites it (a new source has a card of its own, cited by its title).
  { id: 'event-source', question: 'Add that Ruth Weber emigrated in 1952, according to the passenger list of the Gannet.', kind: 'life-event', expectArgs: { person: 'ruth', type: 'emigration', date: '1952', cite: 'Gannet' } },
];

/** The same kind of question in German (informal "du") and Afrikaans ("jy"). */
export const LANGUAGE_CASES: { locale: 'de' | 'af'; question: string }[] = [
  { locale: 'de', question: 'Wann und wo ist Ruth Weber geboren?' },
  { locale: 'af', question: 'Wanneer en waar is Ruth Weber gebore?' },
];

/** The vision task: a face-box shape only. The image is generated (ai-eval.ts), so there is nothing to recognise. */
export const VISION_QUESTION = 'Find each face in this picture. Give each face a box as fractions of the picture width and height, from 0 to 1.';
