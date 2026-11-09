// What an assistant turn can carry besides its text and its proposal cards: a question for the reader, and widgets. Shared
// by the server and the browser, so nothing here touches a provider or the database. The model only ever gives ids: a
// widget stores what to show, and the server builds its content from the tree for whoever is reading (blocks.server.ts).
import type { Kinship } from '../graph';
import type { GapKey } from '../gaps';

export const QUESTION_KINDS = ['single', 'multiple', 'person', 'date', 'text'] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];

/** A question card. `answer` is set once, on the server, and the answer then goes to the assistant as the next message. */
export interface QuestionBlock {
  type: 'question';
  id: string;
  kind: QuestionKind;
  question: string;
  /** The choices of a single or multiple choice question. */
  options?: string[];
  /** The people a person question offers first. Without any, the reader searches the whole tree. */
  people?: { id: string; name: string }[];
  answer?: { text: string; at: number; /** The person chosen, for the model. The words are what the reader sees. */ person?: string };
}

export const WIDGET_KINDS = ['person', 'path', 'tree', 'timeline', 'dates', 'gaps'] as const;
export type WidgetKind = (typeof WIDGET_KINDS)[number];

/** What a widget shows. Ids only: everything a reader sees in it is read from the tree when it is shown. */
export type WidgetSpec =
  | { kind: 'person'; person: string }
  | { kind: 'path'; from: string; to: string }
  | { kind: 'tree'; person: string }
  | { kind: 'timeline'; person: string }
  | { kind: 'dates'; days: number }
  | { kind: 'gaps'; person?: string };

export interface WidgetBlock { type: 'widget'; id: string; spec: WidgetSpec }
export type ChatBlock = QuestionBlock | WidgetBlock;

/** A person as a widget names them. The browser draws the portrait from its own copy of the tree, by id. */
export interface PersonRef { id: string; name: string; born?: string; died?: string; living: boolean }

export type TimelineKind = 'born' | 'married' | 'partnered' | 'ended' | 'child' | 'job' | 'school' | 'service' | 'died';
export interface TimelineEvent { date: string; kind: TimelineKind; place?: string; other?: PersonRef; text?: string }
export interface DateRow { on: string; inDays: number; kind: 'birthday' | 'anniversary'; who: PersonRef; other?: PersonRef; years?: number }
export interface GapRow { who: PersonRef; gaps: GapKey[] }

export type WidgetData =
  | { kind: 'person'; person: PersonRef; occupation?: string; bornPlace?: string; diedPlace?: string; title?: string; house?: string; kin?: Kinship }
  | { kind: 'path'; from: PersonRef; to: PersonRef; steps: PersonRef[]; kin?: Kinship }
  | { kind: 'tree'; person: PersonRef; parents: PersonRef[]; partners: PersonRef[]; siblings: PersonRef[]; children: PersonRef[] }
  | { kind: 'timeline'; person: PersonRef; events: TimelineEvent[] }
  | { kind: 'dates'; days: number; rows: DateRow[]; more: number }
  | { kind: 'gaps'; rows: GapRow[]; more: number };

/** How much a widget lists at most: it has to fit a phone. */
export const WIDGET_ROWS = 12;
/** The longest answer a reader can type into a question card. */
export const ANSWER_CHARS = 500;
