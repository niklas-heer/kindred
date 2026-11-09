// Files from other programs: people without a death record who cannot be alive, legacy character sets, and dates in
// the Julian calendar or with a dual year. Every name here is invented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
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
