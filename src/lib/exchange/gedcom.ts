// GEDCOM 5.5.1, read and written. Kindred writes LINEAGE-LINKED with UTF-8, one INDI per person and one
// FAM per partnership (plus one per set of parents without one). Kindred's own facts that GEDCOM lacks ride
// along in _KINDRED_* tags, so a file made here comes back as the same family; other programs skip them.
//
//   INDI  _KINDRED_ID (the person's id), _KINDRED_LIVING, NAME (GIVN, SURN; a second NAME with TYPE married
//         for the current name), SEX, TITL, NICK, OCCU, BIRT/DEAT (DATE, PLAC), NOTE (the biography), OBJE
//         (a portrait, by its media key), FAMC (PEDI, _KINDRED_KIND, _KINDRED_CONFIDENCE), FAMS
//   FAM   _KINDRED_ID, _KINDRED_KIND (marriage, partnership, betrothal, other, or parents for a family with
//         no partnership), HUSB, WIFE, CHIL, MARR (DATE, PLAC), DIV (DATE), _KINDRED_BEGAN, _KINDRED_END
//
// Nothing here touches storage: `writeGedcom` takes an ExTree, `readGedcom` returns what the file says.
import { allGiven } from '../further-given.ts';
import { yearIn } from '../parent-rules.ts';
import { fromGedcomDate, toGedcomDate } from './dates.ts';
import { charsetOf } from './encoding.ts';
import type { Confidence, ExParent, ExPerson, ExTree, ExUnion, Issue, IssueCode, ParentKind, Sex, UnionKind } from './model.ts';

/** The date facts a file can hold, and the words that name them in the report. */
type DateEvent = 'birth' | 'death' | 'marriage' | 'start' | 'divorce' | 'end';
const DATE_EVENT: Record<DateEvent, { word: string; code: IssueCode }> = {
  birth: { word: 'birth date', code: 'exchange.issue.date_birth' },
  death: { word: 'death date', code: 'exchange.issue.date_death' },
  marriage: { word: 'marriage date', code: 'exchange.issue.date_marriage' },
  start: { word: 'start date', code: 'exchange.issue.date_start' },
  divorce: { word: 'divorce date', code: 'exchange.issue.date_divorce' },
  end: { word: 'end date', code: 'exchange.issue.date_end' },
};

const CHUNK = 120; // characters per line, before escaping: keeps every line under GEDCOM's 255
/** Nobody without a death record is taken as living who would be older than this. */
const MAX_AGE = 110;
/** The youngest a parent or a partner is assumed to be, to date a person from their children and partnerships. */
const MIN_PARENT_AGE = 12;
const UNION_KINDS: UnionKind[] = ['marriage', 'partnership', 'betrothal', 'other'];
const PARENT_KINDS: ParentKind[] = ['biological', 'adoptive', 'foster', 'step'];
const CONFIDENCES: Confidence[] = ['certain', 'probable', 'disputed'];
const ID = /^[A-Za-z0-9_.-]{1,80}$/;

/** Tags a Kindred file reads or writes, or that carry nothing of interest. Anything else is reported as skipped. */
const KNOWN = new Set([
  'HEAD', 'INDI', 'FAM', 'TRLR', 'SUBM', 'CHAR', 'GEDC', 'VERS', 'FORM', 'DATE', 'TIME', 'NAME', 'GIVN', 'SURN', 'TYPE',
  'SEX', 'BIRT', 'DEAT', 'PLAC', 'TITL', 'NICK', 'OCCU', 'NOTE', 'OBJE', 'FILE', 'FAMC', 'FAMS', 'PEDI', 'HUSB', 'WIFE',
  'CHIL', 'MARR', 'DIV', 'CONC', 'CONT', 'CHAN', 'REFN', 'RIN',
  '_KINDRED_ID', '_KINDRED_KIND', '_KINDRED_CONFIDENCE', '_KINDRED_LIVING', '_KINDRED_BEGAN', '_KINDRED_END',
  '_KINDRED_TREE', '_KINDRED_NAME',
]);

const pedi = { biological: 'birth', adoptive: 'adopted', foster: 'foster' } as const;

// ---------- writing ----------

const esc = (s: string) => s.replace(/@/g, '@@');
const unesc = (s: string) => s.replace(/@@/g, '@');

/**
 * Splits a line into pieces of at most CHUNK characters (code points, so no surrogate pair is cut). GEDCOM 5.5.1 asks
 * for CONC to be split at a non-space, because many readers trim the spaces around a value: a cut is moved back until
 * neither side of it is whitespace. Only a run of whitespace longer than a whole piece is cut inside it.
 */
function chunks(s: string): string[] {
  const cps = Array.from(s);
  if (cps.length <= CHUNK) return [s];
  const out: string[] = [];
  const space = (c: string | undefined) => c !== undefined && /\s/.test(c);
  let i = 0;
  while (cps.length - i > CHUNK) {
    let end = i + CHUNK;
    while (end > i + 1 && (space(cps[end - 1]) || space(cps[end]))) end--;
    if (end === i + 1 && (space(cps[end - 1]) || space(cps[end]))) end = i + CHUNK;
    out.push(cps.slice(i, end).join(''));
    i = end;
  }
  out.push(cps.slice(i).join(''));
  return out;
}

/** Writes lines with CONT for each newline and CONC for each piece too long for one line. */
function emitText(out: string[], level: number, tag: string, value: string) {
  value.split(/\r\n|\r|\n/).forEach((ln, i) => {
    const lvl = i === 0 ? level : level + 1;
    const t = i === 0 ? tag : 'CONT';
    chunks(ln).forEach((c, j) => {
      if (j === 0) out.push(c === '' ? `${lvl} ${t}` : `${lvl} ${t} ${esc(c)}`);
      else out.push(`${lvl + 1} CONC ${esc(c)}`);
    });
  });
}

/** The Kindred date as a GEDCOM DATE sub-line pair, only when there is a date. */
const dateLine = (out: string[], level: number, date: string | null) => {
  if (date) out.push(`${level} DATE ${toGedcomDate(date)}`);
};

/**
 * A tree as GEDCOM 5.5.1 text (CRLF). `losses` lists what the format cannot carry, for the export's report.
 * People are written in id order and families in the order partnerships are; the output is deterministic.
 */
export function writeGedcom(tree: ExTree, now: Date = new Date()): { text: string; losses: string[] } {
  const out: string[] = [];
  const losses: string[] = [];
  const byId = new Map(tree.people.map((p) => [p.id, p]));
  const people = [...tree.people].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const xrefOf = new Map(people.map((p, i) => [p.id, `@I${i + 1}@`]));
  const named = (id: string) => byId.get(id)?.given ?? id;

  // Families: one per partnership, then one per set of parents without a partnership.
  type Fam = { xref: string; union: ExUnion | null; spouses: string[]; children: string[]; links: Map<string, ExParent> };
  const fams: Fam[] = [];
  const unions = tree.unions
    .filter((u) => u.a !== u.b && byId.has(u.a) && byId.has(u.b))
    .sort((x, y) => (x.start ?? '').localeCompare(y.start ?? '') || x.id.localeCompare(y.id));
  const pairKey = (ids: string[]) => [...ids].sort().join('|');
  const unionFam = new Map<string, Fam>();
  for (const u of unions) {
    const f: Fam = { xref: '', union: u, spouses: [u.a, u.b], children: [], links: new Map() };
    fams.push(f);
    if (!unionFam.has(pairKey([u.a, u.b]))) unionFam.set(pairKey([u.a, u.b]), f);
  }
  // A child's parents are grouped by kind and confidence, and each group is one family for that child. So a birth
  // parent and a step parent are two families (GEDCOM's FAMC is per child and per family), and each keeps its kind.
  const linksOf = new Map<string, ExParent[]>();
  for (const l of tree.parents) {
    if (!byId.has(l.child) || !byId.has(l.parent) || l.child === l.parent) continue;
    linksOf.set(l.child, [...(linksOf.get(l.child) ?? []), l]);
  }
  const parentFam = new Map<string, Fam>();
  for (const child of [...linksOf.keys()].sort()) {
    const groups = new Map<string, ExParent[]>();
    for (const l of linksOf.get(child)!) {
      const k = `${l.kind}|${l.confidence}`;
      groups.set(k, [...(groups.get(k) ?? []), l]);
    }
    for (const group of groups.values()) {
      let ps = [...new Set(group.map((l) => l.parent))].sort();
      if (ps.length > 2) {
        losses.push(`${named(child)} has ${ps.length} parents of one kind; a GEDCOM family holds two, so only the first two are written`);
        ps = ps.slice(0, 2);
      }
      const key = pairKey(ps);
      let f = (ps.length === 2 ? unionFam.get(key) : undefined) ?? parentFam.get(key);
      if (!f) {
        f = { xref: '', union: null, spouses: ps, children: [], links: new Map() };
        fams.push(f);
        parentFam.set(key, f);
      }
      if (!f.children.includes(child)) {
        f.children.push(child);
        f.links.set(child, group[0]);
      }
    }
  }
  fams.forEach((f, i) => (f.xref = `@F${i + 1}@`));

  const famcOf = new Map<string, Fam[]>();
  for (const f of fams) for (const c of f.children) famcOf.set(c, [...(famcOf.get(c) ?? []), f]);
  const famsOf = new Map<string, Fam[]>();
  for (const f of fams) for (const s of f.spouses) famsOf.set(s, [...(famsOf.get(s) ?? []), f]);

  // ----- header -----
  out.push('0 HEAD', '1 SOUR Kindred', '2 VERS 2', '2 NAME Kindred', '1 GEDC', '2 VERS 5.5.1', '2 FORM LINEAGE-LINKED', '1 CHAR UTF-8');
  out.push(`1 DATE ${toGedcomDate(now.toISOString().slice(0, 10))}`, '1 SUBM @SUBM@');
  out.push(`1 _KINDRED_TREE ${tree.id}`);
  emitText(out, 1, '_KINDRED_NAME', tree.name);
  out.push('0 @SUBM@ SUBM', '1 NAME Kindred');

  // ----- people -----
  for (const p of people) {
    out.push(`0 ${xrefOf.get(p.id)} INDI`);
    out.push(`1 _KINDRED_ID ${esc(p.id)}`);
    if (p.living) out.push('1 _KINDRED_LIVING Y');
    writeNames(out, p);
    if (p.sex) out.push(`1 SEX ${p.sex.toUpperCase()}`);
    if (p.title) emitText(out, 1, 'TITL', p.title);
    if (p.nickname) emitText(out, 1, 'NICK', p.nickname);
    if (p.occupation) emitText(out, 1, 'OCCU', p.occupation);
    if (p.born || p.bornPlace) {
      out.push('1 BIRT');
      dateLine(out, 2, p.born);
      if (p.bornPlace) emitText(out, 2, 'PLAC', p.bornPlace);
    }
    if (!p.living || p.died || p.diedPlace) {
      if (p.died || p.diedPlace) {
        out.push('1 DEAT');
        dateLine(out, 2, p.died);
        if (p.diedPlace) emitText(out, 2, 'PLAC', p.diedPlace);
      } else out.push('1 DEAT Y');
    }
    if (p.bio) emitText(out, 1, 'NOTE', p.bio);
    if (p.portrait) out.push('1 OBJE', `2 FORM ${extOf(p.portrait.mime)}`, `2 FILE ${esc(p.portrait.key)}`, '2 TITL portrait');
    for (const f of famcOf.get(p.id) ?? []) {
      const l = f.links.get(p.id);
      out.push(`1 FAMC ${f.xref}`);
      if (l && l.kind in pedi) out.push(`2 PEDI ${pedi[l.kind as keyof typeof pedi]}`);
      if (l) out.push(`2 _KINDRED_KIND ${l.kind}`);
      if (l && l.confidence !== 'certain') out.push(`2 _KINDRED_CONFIDENCE ${l.confidence}`);
    }
    for (const f of famsOf.get(p.id) ?? []) out.push(`1 FAMS ${f.xref}`);
  }

  // ----- families -----
  for (const f of fams) {
    const sp = f.spouses.map((id) => byId.get(id)!);
    const husband = sp.find((p) => p.sex === 'm') ?? sp[0];
    const wife = sp.find((p) => p !== husband);
    out.push(`0 ${f.xref} FAM`);
    if (f.union) out.push(`1 _KINDRED_ID ${esc(f.union.id)}`, `1 _KINDRED_KIND ${f.union.kind}`);
    else out.push('1 _KINDRED_KIND parents');
    out.push(`1 HUSB ${xrefOf.get(husband.id)}`);
    if (wife) out.push(`1 WIFE ${xrefOf.get(wife.id)}`);
    const u = f.union;
    if (u) {
      if (u.kind === 'marriage') {
        out.push('1 MARR');
        dateLine(out, 2, u.start);
        if (u.place) emitText(out, 2, 'PLAC', u.place);
      } else if (u.start || u.place) {
        out.push('1 _KINDRED_BEGAN');
        dateLine(out, 2, u.start);
        if (u.place) emitText(out, 2, 'PLAC', u.place);
      }
      if (u.end) {
        if (u.endReason === 'divorce') {
          out.push('1 DIV', `2 DATE ${toGedcomDate(u.end)}`);
        } else {
          emitText(out, 1, '_KINDRED_END', u.endReason ?? '');
          out.push(`2 DATE ${toGedcomDate(u.end)}`);
        }
      }
    }
    for (const c of f.children) out.push(`1 CHIL ${xrefOf.get(c)}`);
  }
  out.push('0 TRLR');
  const text = out.join('\r\n') + '\r\n';

  // ----- what the format leaves out -----
  // English sentences that the export report translates: each has a key in i18n/areas/exchange.ts.
  const lost = (n: number, one: string, other: string) => {
    if (n) losses.push(`${n} ${n === 1 ? one : other}`);
  };
  lost(tree.extras.stories, 'story, memory or saying is not exported', 'stories, memories and sayings are not exported');
  lost(tree.extras.fields, 'contact detail or other field is not exported (they hold private data)', 'contact details and other fields are not exported (they hold private data)');
  lost(tree.extras.houses, 'house and its arms are not exported', 'houses and their arms are not exported');
  lost(tree.extras.places, 'place coordinate is not exported; place names are', 'place coordinates are not exported; place names are');
  lost(people.filter((p) => p.epithet).length, 'epithet is not exported', 'epithets are not exported');
  lost(people.filter((p) => p.portrait).length, 'portrait is referenced by its media key only; the picture is not included', 'portraits are referenced by their media key only; the pictures are not included');
  return { text, losses };
}

function writeNames(out: string[], p: ExPerson) {
  // A name is one line. In NAME a "/" would end the surname, so it is written as "∕" (U+2215) there and read back as
  // "/"; GIVN and SURN have no such marker and carry the name as it is.
  const line = (s: string) => s.replace(/\s*[\r\n]+\s*/g, ' ');
  const inName = (s: string) => line(s).replace(/\//g, '∕');
  const given = line(p.given);
  const surname = line(p.surname ?? '');
  // Further given names read as one name in the NAME line; GIVN lists them separated by commas (GEDCOM 5.5.1), which is
  // how the reader tells them from a single given name that holds several words, which stays whole.
  const further = p.furtherGiven.map(line);
  out.push(`1 NAME ${esc([given, ...further].map(inName).join(' '))} /${esc(inName(surname))}/`);
  out.push(`2 GIVN ${esc([given, ...further].join(further.length ? ', ' : ' '))}`);
  if (surname) out.push(`2 SURN ${esc(surname)}`);
  const cg = line(p.currentGiven ?? p.given);
  const cs = line(p.currentSurname ?? p.surname ?? '');
  if (cg !== given || cs !== surname) {
    out.push(`1 NAME ${esc(inName(cg))} /${esc(inName(cs))}/`, `2 GIVN ${esc(cg)}`);
    if (cs) out.push(`2 SURN ${esc(cs)}`);
    out.push('2 TYPE married');
  }
}

const extOf = (mime: string) => ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif' })[mime] ?? 'bin';

// ---------- reading ----------

interface GNode {
  level: number;
  tag: string;
  value: string;
  xref: string | null;
  children: GNode[];
}

/** A person as the file gives them. `id` is the file's own key; `preferredId` is the _KINDRED_ID, if it had one. */
export interface IncomingPerson extends ExPerson {
  preferredId: string | null;
}

export interface IncomingUnion extends ExUnion {
  preferredId: string | null;
}

/** What a file says about a family: its people, parent links and partnerships, keyed by the file's own keys. */
export interface Incoming {
  tree: { id: string | null; name: string | null };
  people: IncomingPerson[];
  parents: ExParent[];
  unions: IncomingUnion[];
  /** Portraits the file refers to. Their pictures are not in the text, so they are only counted. */
  pictures: number;
  issues: Issue[];
}

const LINE = /^(\d+)(?:\s+(@[^@\s]+@))?\s+([A-Za-z_][A-Za-z0-9_]*)(?: (.*))?$/;

/**
 * Reads a GEDCOM file. Throws only when it holds no people or families at all; everything else is reported. `now` is
 * the day the file is read, to tell who cannot be living any more.
 */
export function readGedcom(text: string, now: Date = new Date()): Incoming {
  const issues: Issue[] = [];
  const roots: GNode[] = [];
  const stack: GNode[] = [];
  text
    .replace(/^﻿/, '')
    .split(/\r\n|\r|\n/)
    .forEach((raw, i) => {
      if (raw.trim() === '') return;
      // Only the indentation before the level goes: the spaces at the end of a value are part of it (a CONC or CONT
      // line can end with the space before the next word, or with a Markdown hard break).
      const m = LINE.exec(raw.replace(/^\s+/, ''));
      if (!m) {
        issues.push({ level: 'skipped', code: 'exchange.issue.line_skipped', vars: { line: i + 1 }, message: `Line ${i + 1} is not GEDCOM and was skipped` });
        return;
      }
      const level = Number(m[1]);
      const tag = m[3];
      const value = m[4] ?? '';
      if (tag === 'CONC' || tag === 'CONT') {
        const owner = stack[level - 1];
        if (!owner) return;
        owner.value += tag === 'CONT' ? `\n${unesc(value)}` : unesc(value);
        // Lines nested under this one (a CONC under a CONT) still belong to the same owner.
        stack[level] = owner;
        stack.length = level + 1;
        return;
      }
      const isPointer = /^@[^@\s]+@$/.test(value);
      const node: GNode = { level, tag, value: isPointer ? value : unesc(value), xref: m[2] ?? null, children: [] };
      if (level === 0) roots.push(node);
      else {
        const parent = stack[level - 1];
        if (!parent) {
          issues.push({ level: 'skipped', code: 'exchange.issue.line_orphan', vars: { line: i + 1 }, message: `Line ${i + 1} sits under nothing and was skipped` });
          return;
        }
        parent.children.push(node);
      }
      stack[level] = node;
      stack.length = level + 1;
    });

  // Every value but a NOTE is one short fact (a name, a date, a place, a pointer), so the spaces around it are not part
  // of it. A NOTE is a biography and keeps every character.
  const tidy = (n: GNode) => {
    if (n.tag !== 'NOTE') n.value = n.value.trim();
    n.children.forEach(tidy);
  };
  roots.forEach(tidy);

  // Tags Kindred does not read, counted once each.
  const skipped = new Map<string, number>();
  const walk = (n: GNode) => {
    for (const c of n.children) {
      if (!KNOWN.has(c.tag)) skipped.set(c.tag, (skipped.get(c.tag) ?? 0) + 1);
      else walk(c);
    }
  };
  for (const r of roots) {
    if (r.tag === 'HEAD') continue; // the header names the program that wrote the file; that is not data
    if (!KNOWN.has(r.tag)) skipped.set(r.tag, (skipped.get(r.tag) ?? 0) + 1);
    else walk(r);
  }
  for (const [tag, n] of skipped) {
    issues.push({ level: 'skipped', code: 'exchange.issue.tag_skipped', vars: { tag, count: n }, message: `Skipped ${n}× ${tag}: Kindred does not import it` });
  }

  const head = roots.find((r) => r.tag === 'HEAD');
  const charset = head?.children.find((c) => c.tag === 'CHAR')?.value.toUpperCase();
  // The import page decodes the file by its CHAR line before it gets here (encoding.ts); only a character set that
  // decoding does not know was read as UTF-8.
  if (charset && !charsetOf(charset)) {
    issues.push({ level: 'warning', code: 'exchange.issue.charset', vars: { charset }, message: `The file says it uses ${charset}; it was read as UTF-8` });
  }
  const unreadable = text.match(/\uFFFD/g)?.length ?? 0;
  if (unreadable) {
    issues.push({
      level: 'warning',
      code: 'exchange.issue.unreadable',
      vars: { count: unreadable },
      message: `${unreadable} character${unreadable === 1 ? '' : 's'} could not be read and ${unreadable === 1 ? 'is' : 'are'} shown as �`,
    });
  }

  const first = (n: GNode | undefined, tag: string) => n?.children.find((c) => c.tag === tag);
  const all = (n: GNode | undefined, tag: string) => n?.children.filter((c) => c.tag === tag) ?? [];
  const id = (s: string | undefined) => (s && ID.test(s) ? s : null);
  /** A date from the file. A date Kindred cannot hold exactly is kept as near as it can be, and the reader is told why. */
  const parseDate = (text: string | undefined, event: DateEvent, subject: string): string | null => {
    if (!text) return null;
    const p = fromGedcomDate(text);
    if (p.note) {
      const { word, code } = DATE_EVENT[event];
      issues.push({ level: 'warning', code, vars: { subject, note: p.note, noteKey: p.noteKey!, ...p.noteVars }, message: `${word} of ${subject}: ${p.note}` });
    }
    return p.date;
  };

  // ----- people -----
  const indis = roots.filter((r) => r.tag === 'INDI' && r.xref);
  const known = new Set(indis.map((r) => r.xref!));
  const famcKind = new Map<string, Map<string, { kind: ParentKind; confidence: Confidence }>>();
  // People the file says nothing about being alive or dead: no death record and no Kindred living mark.
  const unstated = new Set<string>();
  const people: IncomingPerson[] = indis.map((r) => {
    const key = r.xref!;
    const names = all(r, 'NAME');
    const married = (n: GNode) => n.children.some((c) => c.tag === 'TYPE' && /married/i.test(c.value));
    const birthName = names.find((n) => !married(n)) ?? names[0];
    const currentName = names.find((n) => married(n) && n !== birthName);
    const parseName = (n: GNode | undefined) => {
      if (!n) return { given: '', further: [] as string[], surname: null as string | null };
      const m = /^(.*?)\s*\/([^/]*)\/\s*(.*)$/.exec(n.value);
      // Kindred writes a "/" inside a name as "∕" in NAME, where "/" marks the surname (GIVN and SURN carry it as it is).
      const slash = (s: string) => s.replace(/∕/g, '/');
      let given = slash(m ? m[1] : n.value).trim();
      let surname = slash(m ? m[2] : '').trim();
      const givn = first(n, 'GIVN')?.value.trim();
      const surn = first(n, 'SURN')?.value.trim();
      if (givn) given = givn;
      if (surn) surname = surn;
      // A comma-separated GIVN is a list of given names: the first is the given name, the others are further ones.
      const names = givn?.includes(',') ? givn.split(',').map((x) => x.trim()).filter(Boolean) : [given];
      return { given: names[0] ?? given, further: names.slice(1), surname: surname || null };
    };
    let { given, further, surname } = parseName(birthName);
    if (!given) {
      given = 'Unnamed';
      issues.push({ level: 'warning', code: 'exchange.issue.no_given_name', vars: { id: key }, message: `${key} has no given name; it is called “Unnamed”` });
    }
    const cur = currentName ? parseName(currentName) : null;
    const sexTag = first(r, 'SEX')?.value.toUpperCase();
    const sex: Sex | null = sexTag === 'M' ? 'm' : sexTag === 'F' ? 'f' : sexTag === 'X' ? 'x' : null;
    const birth = first(r, 'BIRT');
    const death = first(r, 'DEAT');
    const dead = !!death && death.value.toUpperCase() !== 'N';
    const livingTag = first(r, '_KINDRED_LIVING')?.value.toUpperCase();
    if (!livingTag && !death) unstated.add(key);
    // One NOTE is the biography exactly as written; several are joined as paragraphs.
    const notes = all(r, 'NOTE').map((n) => n.value);
    const bio = notes.length === 1 ? notes[0] : notes.map((n) => n.trim()).filter(Boolean).join('\n\n');
    for (const f of all(r, 'FAMC')) {
      const kindTag = first(f, '_KINDRED_KIND')?.value.toLowerCase() as ParentKind | undefined;
      const pediTag = first(f, 'PEDI')?.value.toLowerCase();
      const conf = first(f, '_KINDRED_CONFIDENCE')?.value.toLowerCase() as Confidence | undefined;
      const kind: ParentKind = kindTag && PARENT_KINDS.includes(kindTag) ? kindTag : pediTag === 'adopted' ? 'adoptive' : pediTag === 'foster' ? 'foster' : 'biological';
      if (!famcKind.has(key)) famcKind.set(key, new Map());
      famcKind.get(key)!.set(f.value, { kind, confidence: conf && CONFIDENCES.includes(conf) ? conf : 'certain' });
    }
    return {
      id: key,
      preferredId: id(first(r, '_KINDRED_ID')?.value),
      given,
      furtherGiven: further,
      surname,
      // A null current name means "the same as the birth name", as in the database.
      currentGiven: cur && allGiven(cur.given, cur.further) !== allGiven(given, further) ? allGiven(cur.given, cur.further) : null,
      currentSurname: cur && cur.surname !== surname ? cur.surname : null,
      sex,
      born: parseDate(first(birth, 'DATE')?.value, 'birth', given),
      bornPlace: first(birth, 'PLAC')?.value ?? null,
      died: parseDate(first(death, 'DATE')?.value, 'death', given),
      diedPlace: first(death, 'PLAC')?.value ?? null,
      living: livingTag ? livingTag === 'Y' : !dead,
      title: first(r, 'TITL')?.value || null,
      epithet: null,
      occupation: first(r, 'OCCU')?.value || null,
      nickname: first(r, 'NICK')?.value || null,
      bio: bio.trim() ? bio : null,
      portrait: null,
    };
  });
  const pictures = indis.reduce((n, r) => n + all(r, 'OBJE').length, 0);

  // ----- families: parent links and partnerships -----
  const parents: ExParent[] = [];
  const unions: IncomingUnion[] = [];
  const seenLink = new Set<string>();
  for (const f of roots.filter((r) => r.tag === 'FAM' && r.xref)) {
    const xref = f.xref!;
    const spouses = [first(f, 'HUSB')?.value, first(f, 'WIFE')?.value].filter((s): s is string => !!s && known.has(s));
    const children = all(f, 'CHIL').map((c) => c.value).filter((c) => known.has(c));
    for (const bad of [first(f, 'HUSB')?.value, first(f, 'WIFE')?.value, ...all(f, 'CHIL').map((c) => c.value)]) {
      if (bad && !known.has(bad)) {
        issues.push({ level: 'warning', code: 'exchange.issue.unknown_ref', vars: { family: xref, person: bad }, message: `${xref} refers to ${bad}, who is not in the file` });
      }
    }
    for (const c of children) {
      const k = famcKind.get(c)?.get(xref) ?? { kind: 'biological' as ParentKind, confidence: 'certain' as Confidence };
      for (const s of spouses) {
        if (s === c || seenLink.has(`${c}|${s}`)) continue;
        seenLink.add(`${c}|${s}`);
        parents.push({ child: c, parent: s, kind: k.kind, confidence: k.confidence });
      }
    }

    const marr = first(f, 'MARR');
    const div = first(f, 'DIV');
    const ended = first(f, '_KINDRED_END');
    const began = first(f, '_KINDRED_BEGAN');
    const famKind = first(f, '_KINDRED_KIND')?.value.toLowerCase();
    let kind: UnionKind | null = null;
    if (famKind === 'parents') kind = null;
    else if (famKind && UNION_KINDS.includes(famKind as UnionKind)) kind = famKind as UnionKind;
    else if (marr || div) kind = 'marriage';
    if (!kind) continue;
    if (spouses.length !== 2) {
      issues.push({
        level: 'warning',
        code: 'exchange.issue.union_spouses',
        vars: { family: xref },
        message: `${xref}: a marriage or partnership needs two spouses; it was not imported as one`,
      });
      continue;
    }
    const u: IncomingUnion = {
      id: first(f, '_KINDRED_ID')?.value ?? xref,
      preferredId: id(first(f, '_KINDRED_ID')?.value),
      a: spouses[0],
      b: spouses[1],
      kind,
      start: null,
      end: null,
      endReason: null,
      place: null,
    };
    if (kind === 'marriage' && marr) {
      u.start = parseDate(first(marr, 'DATE')?.value, 'marriage', xref);
      u.place = first(marr, 'PLAC')?.value ?? null;
    } else if (began) {
      u.start = parseDate(first(began, 'DATE')?.value, 'start', xref);
      u.place = first(began, 'PLAC')?.value ?? null;
    }
    if (div) {
      u.end = parseDate(first(div, 'DATE')?.value, 'divorce', xref);
      u.endReason = 'divorce';
    } else if (ended) {
      u.end = parseDate(first(ended, 'DATE')?.value, 'end', xref);
      u.endReason = ended.value || null;
    }
    unions.push(u);
  }

  // Other programs often write no death record for an old ancestor. Someone who would be over MAX_AGE now, by their
  // own dates or by their children's, grandchildren's or partnerships' (a parent or partner is at least MIN_PARENT_AGE),
  // is taken as having died on a date not known, which is how Kindred holds that: not living, and no death date.
  const childrenOf = new Map<string, string[]>();
  for (const l of parents) childrenOf.set(l.parent, [...(childrenOf.get(l.parent) ?? []), l.child]);
  const ownYears = new Map<string, number[]>();
  const noteYear = (key: string, y: number) => {
    if (!isNaN(y)) ownYears.set(key, [...(ownYears.get(key) ?? []), y]);
  };
  for (const p of people) [p.born, p.died].forEach((d) => noteYear(p.id, yearIn(d)));
  for (const u of unions) for (const d of [u.start, u.end]) for (const k of [u.a, u.b]) noteYear(k, yearIn(d) - MIN_PARENT_AGE);
  /** The latest year a person can have been born in, by what the file says; NaN when nothing says. */
  const bornBy = new Map<string, number>();
  const latestBirth = (key: string, path: Set<string>): number => {
    if (bornBy.has(key)) return bornBy.get(key)!;
    if (path.has(key)) return NaN; // a loop in the file: the reader reports it elsewhere
    path.add(key);
    const years = [...(ownYears.get(key) ?? [])];
    for (const c of childrenOf.get(key) ?? []) years.push(latestBirth(c, path) - MIN_PARENT_AGE);
    path.delete(key);
    const known = years.filter((y) => !isNaN(y));
    const y = known.length ? Math.min(...known) : NaN;
    bornBy.set(key, y);
    return y;
  };
  let presumedDead = 0;
  for (const p of people) {
    if (!unstated.has(p.id)) continue;
    if (latestBirth(p.id, new Set()) < now.getUTCFullYear() - MAX_AGE) {
      p.living = false;
      presumedDead++;
    }
  }
  if (presumedDead) {
    issues.push({
      level: 'warning',
      code: 'exchange.issue.presumed_dead',
      vars: { count: presumedDead, years: MAX_AGE },
      message: `${presumedDead} ${presumedDead === 1 ? 'person has' : 'people have'} no death record but would be over ${MAX_AGE} now, so ${presumedDead === 1 ? 'is' : 'are'} imported as died, date unknown`,
    });
  }

  const head0 = head ? { id: first(head, '_KINDRED_TREE')?.value ?? null, name: first(head, '_KINDRED_NAME')?.value ?? null } : { id: null, name: null };
  // A file with a header is GEDCOM even when it holds no people (an empty family is still a valid export).
  if (!head && !people.length && !roots.some((r) => r.tag === 'FAM')) throw new Error('No people or families found: this is not a GEDCOM family file.');
  return { tree: head0, people, parents, unions, pictures, issues };
}
