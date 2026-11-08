// Age at a life event, and when a spouse's death is a widowing. Partial dates ("1953") and approximate ones
// ("~1950", "about") are never taken for exact days.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ageOn, compareDates, widowedOn } from './life.ts';
import type { GPerson, GUnion } from './types.ts';

const person = (over: Partial<GPerson> = {}): GPerson => ({ id: 'p', given: 'P', sex: 'm', living: true, stories: 0, contacts: 0, ...over });
const union = (over: Partial<GUnion> = {}): GUnion => ({ id: 'u', a: 'p', b: 'q', kind: 'marriage', ...over });

test('age on an exact date: full years, the birthday not yet reached is not counted', () => {
  assert.deepEqual(ageOn('1928-09-21', '1953-06-13'), { years: 24, approx: false });
  assert.deepEqual(ageOn('1928-09-21', '1953-09-21'), { years: 25, approx: false }, 'on the birthday');
  assert.deepEqual(ageOn('1928-09-21', '1953-09-20'), { years: 24, approx: false }, 'the day before');
  assert.deepEqual(ageOn('1928-09-21', '1928-09-21'), { years: 0, approx: false });
});

test('a partial date makes the age approximate: a year-only birth or event', () => {
  assert.deepEqual(ageOn('1928', '1953-06-13'), { years: 25, approx: true });
  assert.deepEqual(ageOn('1928-09-21', '1953'), { years: 25, approx: true });
  assert.deepEqual(ageOn('1928-09', '1953-06-13'), { years: 25, approx: true }, 'year and month only');
});

test('an "about" date (a leading ~) makes the age approximate', () => {
  assert.deepEqual(ageOn('~1950', '1978-08-19'), { years: 28, approx: true });
  assert.deepEqual(ageOn('1928-09-21', '~1953-06-13'), { years: 25, approx: true });
});

test('no age when either date is unknown, or the event is before the birth', () => {
  assert.equal(ageOn(undefined, '1953-06-13'), undefined);
  assert.equal(ageOn('1928-09-21', undefined), undefined);
  assert.equal(ageOn('1928-09-21', '1920-01-01'), undefined);
  assert.equal(ageOn('1928-09-21', '1928-01'), undefined, 'a month earlier than the birth year is before the birth');
});

test('dates compare as far as both are precise, and not further', () => {
  assert.ok(compareDates('1950-01-01', '1951-01-01') < 0);
  assert.ok(compareDates('1950-06-01', '1950-05-31') > 0);
  assert.equal(compareDates('1962', '1962-04-10'), 0, 'the same year: not known which is first');
  assert.equal(compareDates('1962-04', '1962-04-10'), 0, 'the same month: not known which is first');
  assert.ok(compareDates('~1962', '1963') < 0, 'an approximate date still orders by its year');
});

const richard = person({ id: 'richard', sex: 'm', born: '1928-09-21', living: false, died: '2005-07-20' });
const marianne = person({ id: 'marianne', sex: 'f', born: '1934-02-11', living: false, died: '1962-04-10' });

test('a spouse who dies during the marriage is a widowing on the day they died', () => {
  assert.equal(widowedOn(richard, marianne, union({ start: '1953-06-13', endReason: 'death', end: '1962-04-10' })), '1962-04-10');
});

test('a partial death date is kept as it was written', () => {
  const m = person({ ...marianne, died: '~1962' });
  assert.equal(widowedOn(richard, m, union({ start: '1953' })), '~1962');
  assert.equal(widowedOn(richard, person({ ...marianne, died: '1962' }), union({ start: '1953' })), '1962');
});

test('no widowing when the person died first', () => {
  const early = person({ ...richard, died: '1960-01-05', living: false });
  assert.equal(widowedOn(early, marianne, union({ start: '1953-06-13' })), undefined);
});

test('no widowing when the person died the same year and it cannot be told which first', () => {
  const same = person({ ...richard, died: '1962' });
  assert.equal(widowedOn(same, marianne, union({ start: '1953' })), undefined);
});

test('a living person can be widowed; an unknown death of a dead person is not claimed', () => {
  assert.equal(widowedOn(person({ id: 'p', sex: 'm', born: '1928', living: true }), marianne, union({ start: '1953' })), '1962-04-10');
  assert.equal(widowedOn(person({ id: 'p', sex: 'm', living: false }), marianne, union({ start: '1953' })), undefined);
});

test('no widowing when they had divorced first, or separated first', () => {
  assert.equal(widowedOn(richard, marianne, union({ start: '1953', end: '1960-03-01', endReason: 'divorce' })), undefined);
  assert.equal(widowedOn(richard, marianne, union({ start: '1953', end: '1961', endReason: 'separation' })), undefined);
  assert.equal(widowedOn(richard, marianne, union({ start: '1953', end: '1962-04-10', endReason: 'divorce' })), undefined, 'the same day: not still married');
  assert.equal(widowedOn(richard, marianne, union({ start: '1953', endReason: 'divorce' })), undefined, 'ended, date unknown');
});

test('a union that ended after the death still stood when they died', () => {
  assert.equal(widowedOn(richard, marianne, union({ start: '1953', end: '1970', endReason: 'divorce' })), '1962-04-10');
  assert.equal(widowedOn(richard, marianne, union({ start: '1953', end: '1962-12', endReason: 'separation' })), '1962-04-10');
});

test('no widowing for a partner who is still alive, or a death before the marriage began', () => {
  assert.equal(widowedOn(richard, person({ id: 'q', living: true, born: '1934' }), union({ start: '1953' })), undefined);
  assert.equal(widowedOn(richard, marianne, union({ start: '1963-01-01' })), undefined, 'the marriage began after her death');
});
