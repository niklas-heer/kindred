// The date picker's rules: the stored shapes round-trip, the segments compose and decompose, bounds read partial periods,
// typed text parses in the reader's language, and display follows the locale's order.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  birthdayInfo, composeParts, daysIn, displayDate, emptyParts, parseTyped, partsIssue, partsOf, partsOfDay, periodOf,
  storedIssue, withPrecision, weekdayNames, monthNames, isoOfDate,
} from './partial-date.ts';

const TODAY = '2026-11-08';

test('partsOf reads every stored shape, with and without about', () => {
  assert.deepEqual(partsOf(''), emptyParts('day'));
  assert.deepEqual(partsOf('1953'), { about: false, precision: 'year', year: '1953', month: '', day: '' });
  assert.deepEqual(partsOf('1953-08'), { about: false, precision: 'month', year: '1953', month: '08', day: '' });
  assert.deepEqual(partsOf('1953-08-08'), { about: false, precision: 'day', year: '1953', month: '08', day: '08' });
  assert.deepEqual(partsOf('~1953'), { about: true, precision: 'year', year: '1953', month: '', day: '' });
  assert.deepEqual(partsOf('~1953-08'), { about: true, precision: 'month', year: '1953', month: '08', day: '' });
  assert.deepEqual(partsOf('~1953-08-08'), { about: true, precision: 'day', year: '1953', month: '08', day: '08' });
  assert.deepEqual(partsOf('1200'), { about: false, precision: 'year', year: '1200', month: '', day: '' });
  // Reading is lenient, so a picker can show month 13 and flag it; validDate and partsIssue refuse it.
  assert.deepEqual(partsOf('1953-13'), { about: false, precision: 'month', year: '1953', month: '13', day: '' });
  assert.equal(partsIssue(partsOf('1953-13')!), 'month');
  assert.equal(partsOf('53'), null, 'a two-digit year is not stored shape');
  assert.equal(partsOf('next Tuesday'), null);
});

test('composeParts writes each precision and about, and round-trips every stored shape', () => {
  for (const s of ['1953', '1953-08', '1953-08-08', '~1953', '~1953-08', '~1953-08-08', '1200', '~1200', '0980-03-01']) {
    assert.equal(composeParts(partsOf(s)!), s, `round trip ${s}`);
  }
  assert.equal(composeParts(emptyParts('day')), '', 'nothing typed is no date');
  assert.equal(composeParts({ ...emptyParts('year'), about: true }), '', 'about alone is still no date');
});

test('a year is stored as it is written: 886 stays 886, never 0886', () => {
  assert.equal(composeParts({ about: true, precision: 'year', year: '886', month: '', day: '' }), '~886');
  assert.equal(composeParts({ about: false, precision: 'day', year: '880', month: '8', day: '8' }), '880-08-08');
  assert.equal(partsOfDay(880, 8, 8).year, '880', 'a calendar pick keeps the year as written too');
  assert.deepEqual(periodOf('886'), { from: '0886-01-01', to: '0886-12-31' }, 'comparisons pad internally');
  assert.equal(storedIssue('886', { notBefore: '0886-06-01' }), null);
});

test('composeParts pads one-digit segments and marks missing ones so they are never valid', () => {
  assert.equal(composeParts({ about: false, precision: 'day', year: '1953', month: '8', day: '8' }), '1953-08-08');
  assert.equal(composeParts({ about: false, precision: 'day', year: '1953', month: '8', day: '' }), '1953-08-??');
  assert.equal(composeParts({ about: false, precision: 'day', year: '1953', month: '', day: '' }), '1953-??-??');
  assert.equal(composeParts({ about: false, precision: 'month', year: '1953', month: '', day: '' }), '1953-??');
  assert.equal(composeParts({ about: false, precision: 'day', year: '19', month: '08', day: '08' }), '????-08-08');
  assert.equal(composeParts({ about: false, precision: 'day', year: '1953', month: '13', day: '08' }), '1953-??-08');
  assert.equal(composeParts({ about: true, precision: 'month', year: '1953', month: '8', day: '' }), '~1953-08');
});

test('leap days: 29 February exists only in leap years', () => {
  assert.equal(daysIn(1952, 2), 29);
  assert.equal(daysIn(1953, 2), 28);
  assert.equal(daysIn(1600, 2), 29, 'divisible by 400');
  assert.equal(daysIn(1900, 2), 28, 'divisible by 100 but not 400');
  assert.equal(partsIssue({ about: false, precision: 'day', year: '1952', month: '02', day: '29' }), null);
  assert.equal(partsIssue({ about: false, precision: 'day', year: '1953', month: '02', day: '29' }), 'day');
  assert.equal(composeParts({ about: false, precision: 'day', year: '1952', month: '2', day: '29' }), '1952-02-29');
  assert.equal(composeParts({ about: false, precision: 'day', year: '1953', month: '2', day: '29' }), '1953-02-??', 'shown as missing, so the form refuses it');
  assert.equal(storedIssue('1953-02-29'), 'invalid');
  assert.equal(storedIssue('1952-02-29'), null);
  assert.deepEqual(periodOf('1952-02'), { from: '1952-02-01', to: '1952-02-29' });
});

test('partsIssue names the segment that is wrong or still missing', () => {
  assert.equal(partsIssue(emptyParts('day')), null, 'empty is fine');
  assert.equal(partsIssue({ about: false, precision: 'year', year: '19', month: '', day: '' }), 'year');
  assert.equal(partsIssue({ about: false, precision: 'month', year: '1953', month: '', day: '' }), 'month');
  assert.equal(partsIssue({ about: false, precision: 'month', year: '1953', month: '0', day: '' }), 'month');
  assert.equal(partsIssue({ about: false, precision: 'day', year: '1953', month: '08', day: '' }), 'day');
  assert.equal(partsIssue({ about: false, precision: 'day', year: '1953', month: '04', day: '31' }), 'day', '31 April');
  assert.equal(partsIssue({ about: false, precision: 'day', year: '1953', month: '08', day: '31' }), null);
  assert.equal(partsIssue({ about: false, precision: 'year', year: '1953', month: '99', day: '99' }), null, 'a year ignores the other segments');
});

test('periodOf gives the first and last day a partial date could be', () => {
  assert.deepEqual(periodOf('1953'), { from: '1953-01-01', to: '1953-12-31' });
  assert.deepEqual(periodOf('~1953-08'), { from: '1953-08-01', to: '1953-08-31' });
  assert.deepEqual(periodOf('1953-08-08'), { from: '1953-08-08', to: '1953-08-08' });
  assert.deepEqual(periodOf('0980'), { from: '0980-01-01', to: '0980-12-31' });
  assert.equal(periodOf('1953-02-30'), null);
  assert.equal(periodOf(''), null);
});

test('storedIssue: no future birth, no death before the birth, partial dates allowed', () => {
  assert.equal(storedIssue('', { notAfter: TODAY }), null, 'no date is fine');
  assert.equal(storedIssue('1953-08-08', { notAfter: TODAY }), null);
  assert.equal(storedIssue('2026', { notAfter: TODAY }), null, 'this year is not the future');
  assert.equal(storedIssue('2026-11', { notAfter: TODAY }), null, 'this month has started');
  assert.equal(storedIssue('2026-12', { notAfter: TODAY }), 'future');
  assert.equal(storedIssue('2027', { notAfter: TODAY }), 'future');
  assert.equal(storedIssue('2026-11-09', { notAfter: TODAY }), 'future');
  assert.equal(storedIssue('1200', { notAfter: TODAY }), null, 'medieval births are fine');
  assert.equal(storedIssue('1953-07', { notBefore: '1953-08-08' }), 'before', 'died before born');
  assert.equal(storedIssue('1953', { notBefore: '1953-08-08' }), null, 'born and died in one year: the year could hold both');
  assert.equal(storedIssue('1953-08-07', { notBefore: '1953-08-08' }), 'before');
  assert.equal(storedIssue('1953-08-08', { notBefore: '1953-08-08' }), null, 'the same day is not before');
  assert.equal(storedIssue('1953-??-??'), 'invalid', 'a missing segment is never a date');
  assert.equal(storedIssue('1953-02-30'), 'invalid');
});

test('displayDate follows each locale: day, month name, year, and the about word', () => {
  assert.equal(displayDate('1953-08-08', 'en'), '8 August 1953');
  assert.equal(displayDate('1953-08-08', 'de'), '8. August 1953');
  assert.equal(displayDate('1953-08-08', 'af'), '8 Augustus 1953');
  assert.equal(displayDate('1953-08', 'en'), 'August 1953');
  assert.equal(displayDate('1953', 'de'), '1953');
  assert.equal(displayDate('~1200', 'en'), 'c. 1200');
  assert.equal(displayDate('~1200', 'de'), 'ca. 1200');
  assert.equal(displayDate('~1200-03', 'af'), `ong. ${monthNames('af')[2]} 1200`);
  assert.equal(displayDate('', 'en'), '');
  assert.equal(displayDate('1953-08-08', 'en', { weekday: true }), 'Saturday, 8 August 1953');
  assert.equal(displayDate('1953-08', 'en', { weekday: true }), 'August 1953', 'a weekday needs a day');
});

test('weekday and month names come from the locale, Monday first', () => {
  assert.deepEqual(monthNames('de').slice(0, 3), ['Januar', 'Februar', 'März']);
  assert.equal(monthNames('af')[0], 'Januarie');
  assert.equal(weekdayNames('de')[0].startsWith('Mo'), true);
  assert.equal(weekdayNames('en')[6].startsWith('Sun'), true);
});

test('parseTyped reads every partial form in day-first order, with about', () => {
  for (const locale of ['en', 'de', 'af'] as const) {
    assert.equal(parseTyped('08.08.1953', locale), '1953-08-08', `dotted in ${locale}`);
    assert.equal(parseTyped('8/8/1953', locale), '1953-08-08', `slashed in ${locale}`);
    assert.equal(parseTyped('1953-08-08', locale), '1953-08-08', `ISO in ${locale}`);
    assert.equal(parseTyped('1953-8', locale), '1953-08');
    assert.equal(parseTyped('08.1953', locale), '1953-08', 'month and year');
    assert.equal(parseTyped('1953', locale), '1953');
    assert.equal(parseTyped('~1953', locale), '~1953');
    assert.equal(parseTyped('c. 1200', locale), '~1200', 'an about word');
    assert.equal(parseTyped('ca. 1200-03-01', locale), '~1200-03-01');
    assert.equal(parseTyped('29.02.1952', locale), '1952-02-29', `leap day in ${locale}`);
  }
});

test('parseTyped reads a year-first date as Japanese and Chinese write it, and numbers in the language\'s order', () => {
  for (const locale of ['ja', 'zh-Hans'] as const) {
    assert.equal(parseTyped('1953/8/8', locale), '1953-08-08', `slashed in ${locale}`);
    assert.equal(parseTyped('1953.08.08', locale), '1953-08-08', `dotted in ${locale}`);
    assert.equal(parseTyped('1953年8月8日', locale), '1953-08-08', `with 年月日 in ${locale}`);
    assert.equal(parseTyped('1953年8月', locale), '1953-08', 'month and year');
    assert.equal(parseTyped('1953/8', locale), '1953-08');
    assert.equal(parseTyped('8.8.1953', locale), '1953-08-08', 'day first still reads');
  }
  assert.equal(parseTyped('1953年2月30日', 'ja'), null, 'not a real day');
});

test('typing "about" before a date uses the words of every language the page has', () => {
  for (const word of ['c.', 'ca.', 'circa', 'ong.', 'ongeveer', 'ungef.', 'um', 'about', '~']) assert.equal(parseTyped(`${word} 1900`, 'en'), '~1900', word);
});

test('parseTyped reads month names in the reader\'s language, and in English', () => {
  assert.equal(parseTyped('8. August 1953', 'de'), '1953-08-08');
  assert.equal(parseTyped('8 Augustus 1953', 'af'), '1953-08-08');
  assert.equal(parseTyped('8 August 1953', 'en'), '1953-08-08');
  assert.equal(parseTyped('8 August 1953', 'af'), '1953-08-08', 'English names still read in Afrikaans');
  assert.equal(parseTyped('August 1953', 'en'), '1953-08');
  assert.equal(parseTyped('Aug 1953', 'en'), '1953-08', 'three letters are enough');
  assert.equal(parseTyped('März 1953', 'de'), '1953-03');
  assert.equal(parseTyped('marz 1953', 'de'), '1953-03', 'accents need not be typed');
  assert.equal(parseTyped('~ August 1953', 'en'), '~1953-08');
});

test('parseTyped refuses what is not a real date', () => {
  assert.equal(parseTyped('31.04.1953', 'de'), null, '31 April');
  assert.equal(parseTyped('29.02.1953', 'en'), null, 'no leap day');
  assert.equal(parseTyped('1953-02-29', 'en'), null);
  assert.equal(parseTyped('1953-13', 'en'), null, 'no month 13');
  assert.equal(parseTyped('53', 'en'), null, 'two digits are not a year');
  assert.equal(parseTyped('Smarch 1953', 'en'), null);
  assert.equal(parseTyped('', 'en'), null);
  assert.equal(parseTyped('next summer', 'en'), null);
});

test('parse and format agree: every typed date displays in the same reader\'s words', () => {
  assert.equal(displayDate(parseTyped('8. August 1953', 'de')!, 'de'), '8. August 1953');
  assert.equal(displayDate(parseTyped('c. 1200', 'en')!, 'en'), 'c. 1200');
});

test('birthdayInfo: the age today and the next birthday, for a whole birth date only', () => {
  assert.deepEqual(birthdayInfo('1953-08-08', TODAY), { age: 73, turns: 74, next: '2027-08-08' });
  assert.deepEqual(birthdayInfo('1953-12-31', TODAY), { age: 72, turns: 73, next: '2026-12-31' });
  assert.deepEqual(birthdayInfo('1953-08-08', '2026-08-08'), { age: 73, turns: 74, next: '2027-08-08' }, 'on the birthday itself');
  assert.deepEqual(birthdayInfo('1952-02-29', '2026-02-28'), { age: 73, turns: 74, next: '2027-02-28' }, 'leap-day birthday, non-leap year');
  assert.equal(birthdayInfo('1953-08', TODAY), null, 'a month is not enough');
  assert.equal(birthdayInfo('~1953-08-08', TODAY), null, 'about is not a whole date');
  assert.equal(birthdayInfo('', TODAY), null);
});

test('withPrecision clears what the new precision hides, and keeps the rest', () => {
  const full = partsOfDay(1953, 8, 8);
  assert.deepEqual(withPrecision(full, 'month'), { ...full, precision: 'month', day: '' });
  assert.deepEqual(withPrecision(full, 'year'), { ...full, precision: 'year', month: '', day: '' });
  assert.deepEqual(withPrecision({ ...full, precision: 'year', month: '', day: '' }, 'day'), { ...full, precision: 'day', month: '', day: '' });
});

test('isoOfDate uses local calendar days, zero-padded', () => {
  assert.equal(isoOfDate(new Date(2026, 10, 8)), '2026-11-08');
  assert.equal(isoOfDate(new Date(1200, 0, 1)), '1200-01-01');
});
