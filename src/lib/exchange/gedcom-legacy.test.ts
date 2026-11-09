// Files from other programs: people without a death record who cannot be alive, legacy character sets, and dates in
// the Julian calendar or with a dual year. Every name here is invented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromGedcomDate } from './dates.ts';
import { decodeGedcom } from './encoding.ts';
import { readGedcom } from './gedcom.ts';

const NOW = new Date('2026-11-09T12:00:00Z');
const file = (...lines: string[]) => ['0 HEAD', '1 CHAR UTF-8', ...lines, '0 TRLR'].join('\r\n');
const living = (text: string) => Object.fromEntries(readGedcom(text, NOW).people.map((p) => [p.given, p.living]));

// ---------- who is living ----------

test('a person born more than 110 years ago without a death record is not imported as living', () => {
  const text = file(
    '0 @I1@ INDI', '1 NAME Johann /Schmied/', '1 BIRT', '2 DATE 12 MAR 1788',
    '0 @I2@ INDI', '1 NAME Mia /Schmied/', '1 BIRT', '2 DATE 1990',
    '0 @I3@ INDI', '1 NAME Old /Enough/', '1 BIRT', '2 DATE ABT 1915',
    '0 @I4@ INDI', '1 NAME Just /Young/', '1 BIRT', '2 DATE 1916',
    '0 @I5@ INDI', '1 NAME Nobody /Knows/',
  );
  assert.deepEqual(living(text), { Johann: false, Mia: true, Old: false, Just: true, Nobody: true });
  const issue = readGedcom(text, NOW).issues.find((i) => i.code === 'exchange.issue.presumed_dead');
  assert.equal(issue?.vars.count, 2, 'the reader is told once, with how many');
});

test('a person without dates whose child, grandchild or partnership is old enough is not living', () => {
  const text = file(
    '0 @G@ INDI', '1 NAME Grand /Vater/',
    '0 @P@ INDI', '1 NAME Parent /Vater/',
    '0 @C@ INDI', '1 NAME Child /Vater/', '1 BIRT', '2 DATE 1925',
    '0 @W@ INDI', '1 NAME Wed /Frau/',
    '0 @H@ INDI', '1 NAME Hus /Mann/',
    '0 @N@ INDI', '1 NAME New /Kind/', '1 BIRT', '2 DATE 2010',
    '0 @M@ INDI', '1 NAME Mother /Kind/',
    '0 @F1@ FAM', '1 HUSB @G@', '1 CHIL @P@',
    '0 @F2@ FAM', '1 HUSB @P@', '1 CHIL @C@',
    '0 @F3@ FAM', '1 HUSB @H@', '1 WIFE @W@', '1 MARR', '2 DATE 1890',
    '0 @F4@ FAM', '1 WIFE @M@', '1 CHIL @N@',
  );
  // The child was born in 1925, so the parent was born by about 1913 and the grandparent by about 1901.
  assert.deepEqual(living(text), { Grand: false, Parent: false, Child: true, Wed: false, Hus: false, New: true, Mother: true });
});

test('a death record, DEAT N and a Kindred file’s own living mark are taken as they are', () => {
  const text = file(
    '0 @I1@ INDI', '1 NAME Dead /Known/', '1 BIRT', '2 DATE 1990', '1 DEAT Y',
    '0 @I2@ INDI', '1 NAME Stated /Living/', '1 _KINDRED_LIVING Y', '1 BIRT', '2 DATE 1800',
    '0 @I3@ INDI', '1 NAME Not /Dead/', '1 BIRT', '2 DATE 1990', '1 DEAT N',
  );
  assert.deepEqual(living(text), { Dead: false, Stated: true, Not: true });
});

test('a family with a loop in the file does not hang the reader', () => {
  const text = file(
    '0 @A@ INDI', '1 NAME A /Loop/',
    '0 @B@ INDI', '1 NAME B /Loop/', '1 BIRT', '2 DATE 1800',
    '0 @F1@ FAM', '1 HUSB @A@', '1 CHIL @B@',
    '0 @F2@ FAM', '1 HUSB @B@', '1 CHIL @A@',
  );
  assert.deepEqual(living(text), { A: false, B: false });
});

// ---------- character sets ----------

/** A file's bytes: ASCII text, with `{xx}` standing for one raw byte. */
function bytes(text: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') {
      out.push(parseInt(text.slice(i + 1, i + 3), 16));
      i += 3;
    } else out.push(text.charCodeAt(i));
  }
  return new Uint8Array(out);
}
const legacy = (charset: string, name: string) => bytes(['0 HEAD', `1 CHAR ${charset}`, '0 @I1@ INDI', `1 NAME ${name}`, '0 TRLR', ''].join('\r\n'));
const nameIn = (b: Uint8Array) => {
  const back = readGedcom(decodeGedcom(b), NOW);
  const p = back.people[0];
  return { name: `${p.given} ${p.surname}`, issues: back.issues.map((i) => i.code) };
};

test('UTF-8 is read with and without a byte order mark', () => {
  const utf8 = new TextEncoder().encode(file('0 @I1@ INDI', '1 NAME Jürgen /Weiß/'));
  assert.equal(nameIn(utf8).name, 'Jürgen Weiß');
  assert.equal(nameIn(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8])).name, 'Jürgen Weiß');
});

test('UTF-16 is read in either byte order, with a byte order mark or without one', () => {
  const text = ['0 HEAD', '1 CHAR UNICODE', '0 @I1@ INDI', '1 NAME Zoë /Ærø 😀/', '0 TRLR', ''].join('\r\n');
  const le = new Uint8Array(text.length * 2);
  const be = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    le[2 * i] = c & 0xff;
    le[2 * i + 1] = c >> 8;
    be[2 * i] = c >> 8;
    be[2 * i + 1] = c & 0xff;
  }
  for (const b of [new Uint8Array([0xff, 0xfe, ...le]), new Uint8Array([0xfe, 0xff, ...be]), le, be]) {
    const got = nameIn(b);
    assert.equal(got.name, 'Zoë Ærø 😀');
    assert.deepEqual(got.issues, []);
  }
});

test('ANSI, Windows-1252 and ISO-8859-1 files are read as Windows-1252, with no warning', () => {
  for (const charset of ['ANSI', 'WINDOWS-1252', 'ISO-8859-1', 'CP1252']) {
    const got = nameIn(legacy(charset, 'J{fc}rgen /M{fc}ller {80}/'));
    assert.equal(got.name, 'Jürgen Müller €', charset);
    assert.deepEqual(got.issues, [], charset);
  }
});

test('ANSEL: a combining mark before its letter becomes the accented letter, and the special letters are read', () => {
  // E8 is the diaeresis, E2 the acute, F0 the cedilla; A2 is Ø, CF is ß.
  const got = nameIn(legacy('ANSEL', 'Ren{e2}e /M{e8}uller-Fran{f0}cois {a2}rsted Stra{cf}e/'));
  assert.equal(got.name, 'René Müller-François Ørsted Straße');
  assert.equal(got.name.normalize('NFC'), got.name, 'composed, as typed text is');
  assert.deepEqual(got.issues, []);
});

test('bytes a character set does not have become U+FFFD, and the reader is told once how many', () => {
  const got = nameIn(legacy('ANSEL', 'Ann{bb} /B{ff}rg{fc}/'));
  assert.equal(got.name, 'Ann� B�rg�');
  const back = readGedcom(decodeGedcom(legacy('ANSEL', 'Ann{bb} /B{ff}rg{fc}/')), NOW);
  const unreadable = back.issues.filter((i) => i.code === 'exchange.issue.unreadable');
  assert.equal(unreadable.length, 1);
  assert.equal(unreadable[0].vars.count, 3);
});

test('a character set Kindred cannot read is read as UTF-8, and the reader is told', () => {
  const got = nameIn(legacy('IBMPC', 'Ann /Berg/'));
  assert.equal(got.name, 'Ann Berg');
  assert.deepEqual(got.issues, ['exchange.issue.charset']);
});

// ---------- Julian and dual-year dates ----------

test('a Julian or dual-year date is kept as about its (later) year, and the note quotes the original', () => {
  const cases: [string, string][] = [
    ['@#DJULIAN@ 1 FEB 1700/01', '~1701'],
    ['1 FEB 1699/00', '~1700'],
    ['MAR 1999/00', '~2000'],
    ['@#DJULIAN@ 29 FEB 1700', '~1700'], // a real day in the Julian calendar, not in the Gregorian one
    ['@#DJULIAN@ 1750', '~1750'],
    ['ABT @#DJULIAN@ 1750', '~1750'],
    ['BEF @#DJULIAN@ 3 MAR 1650/51', '~1651'],
  ];
  for (const [text, want] of cases) {
    const p = fromGedcomDate(text);
    assert.equal(p.date, want, text);
    assert.equal(p.noteKey, 'exchange.date.about', text);
    assert.equal(p.noteVars?.shown, text);
    assert.equal(p.noteVars?.value, want.slice(1));
  }
});

test('a Gregorian escape is read as the date it is, and another calendar is still dropped with a reason', () => {
  assert.deepEqual(fromGedcomDate('@#DGREGORIAN@ 8 AUG 1953'), { date: '1953-08-08' });
  const hebrew = fromGedcomDate('@#DHEBREW@ 1 TSH 5700');
  assert.equal(hebrew.date, null);
  assert.equal(hebrew.noteKey, 'exchange.date.unsupported');
});

test('a person born on a Julian dual-year date is imported with that year, and the report says so', () => {
  const back = readGedcom(file('0 @I1@ INDI', '1 NAME René /Dupont/', '1 BIRT', '2 DATE @#DJULIAN@ 1 FEB 1700/01'), NOW);
  assert.equal(back.people[0].born, '~1701');
  const issue = back.issues.find((i) => i.code === 'exchange.issue.date_birth');
  assert.match(issue?.message ?? '', /"@#DJULIAN@ 1 FEB 1700\/01" read as about 1701/);
});
