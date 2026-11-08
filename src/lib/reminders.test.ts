// node --test src/lib/reminders.test.ts — which occasions fall on a day, what a device's reminder says, and which
// choices are allowed. Pure: no store, no network. The cases are the family site's push.js tests, on v2's graph shape.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { GPerson, GUnion, Graph } from './types.ts';
import { dayKey, fallsOn, fullDate, MAX_LINES, occasionsOn, parseChoices, reminderMessage, testMessage, type Occasion } from './reminders.ts';
import { b64url, encryptPayload, MAX_MESSAGE_BYTES, PUSH_BODY_BYTES, utf8Bytes } from './webpush.ts';

const enc = new TextEncoder();
const strictDecode = (bytes: Uint8Array) => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
const deviceKeys = async () => {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  return { p256dh: b64url(await crypto.subtle.exportKey('raw', pair.publicKey)), auth: b64url(crypto.getRandomValues(new Uint8Array(16))) };
};
const person = (id: string, given: string, extra: Partial<GPerson> = {}): GPerson => ({ id, given, living: false, stories: 0, contacts: 0, ...extra });
const union = (id: string, a: string, b: string, extra: Partial<GUnion> = {}): GUnion => ({ id, a, b, kind: 'marriage', ...extra });
const graphOf = (people: GPerson[], unions: GUnion[] = []) => ({ people, unions }) as Pick<Graph, 'people' | 'unions'>;

const people = [
  person('ada', 'Ada', { surname: 'Linde', living: true, born: '1950-11-02' }),
  person('bo', 'Bo', { surname: 'Linde', living: true, born: '1948-11-08' }),
  person('kid', 'Kid', { surname: 'Linde', living: true, born: '2017' }),
  person('leap', 'Leap', { surname: 'Linde', living: true, born: '1980-02-29' }),
  person('old', 'Old', { surname: 'Linde', living: true, born: '1920-11-02' }),
  person('gone', 'Gone', { surname: 'Linde', born: '1930-01-01', died: '2001-11-02' }),
];
const graph = graphOf(people, [union('m1', 'ada', 'bo', { start: '1975-11-08' })]);
const on = (iso: string) => occasionsOn(graph, new Date(`${iso}T06:00:00Z`)).map((o) => `${o.kind}:${o.ids.join('+')}:${o.years}`);

test('a full ISO date is needed; a year on its own, or a partial one, never matches', () => {
  assert.deepEqual(fullDate('1950-11-02'), { year: 1950, month: 11, day: 2 });
  assert.equal(fullDate('2017'), null);
  assert.equal(fullDate('~1950-05'), null);
  assert.equal(fullDate('1950-13-02'), null);
  const yearOnly = graphOf([person('kid', 'Kid', { living: true, born: '2017' })]);
  assert.deepEqual(occasionsOn(yearOnly, new Date('2017-11-02T06:00:00Z')), [], 'a year-only birth is never remembered');
});

test('occasions come from the living, the departed and living couples, and skip implausible ages', () => {
  assert.deepEqual(on('2026-11-02'), ['birthday:ada:76', 'memorial:gone:25']);
  assert.deepEqual(on('2026-11-08'), ['birthday:bo:78', 'wedding:ada+bo:51']);
  assert.deepEqual(on('2027-02-28'), ['birthday:leap:47'], 'a 29 February is remembered on 28 February in other years');
  assert.deepEqual(on('2028-02-28'), [], 'a leap year keeps 29 February for itself');
  assert.deepEqual(on('2028-02-29'), ['birthday:leap:48']);
  const hundred = graphOf([person('h', 'H', { living: true, born: '1926-11-02' }), person('x', 'X', { living: true, born: '1925-11-02' })]);
  assert.deepEqual(occasionsOn(hundred, new Date('2026-11-02T06:00:00Z')).map((o) => o.years), [100], 'a 100th birthday is remembered, a 101st is not');
});

test('a wedding stops being remembered once the couple has separated', () => {
  const ended = graphOf(people, [union('m1', 'ada', 'bo', { start: '1975-11-08', end: '1990' })]);
  assert.deepEqual(occasionsOn(ended, new Date('2026-11-08T06:00:00Z')).map((o) => o.kind), ['birthday']);
  const widowed = graphOf([...people.slice(0, 2).map((p) => (p.id === 'bo' ? { ...p, living: false, died: '2020-01-01' } : p))], [union('m1', 'ada', 'bo', { start: '1975-11-08' })]);
  assert.deepEqual(occasionsOn(widowed, new Date('2026-11-08T06:00:00Z')), [], 'no anniversary once one of them has died');
});

test('the 29 February rule holds on 28 February in common years only', () => {
  assert.equal(fallsOn({ month: 2, day: 29 }, new Date('2027-02-28T00:00:00Z')), true);
  assert.equal(fallsOn({ month: 2, day: 29 }, new Date('2028-02-28T00:00:00Z')), false);
  assert.equal(fallsOn({ month: 3, day: 1 }, new Date('2027-02-28T00:00:00Z')), false);
});

const day = '2026-11-01';
const occasionsFor = (today: Date) => new Map([0, 1, 7].map((offset) => [offset, occasionsOn(graph, new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + offset)))] as const));
const names = new Map(people.map((p) => [p.id, [p.given, p.surname].join(' ')]));

test('one reminder per device covers its chosen days and kinds, nearest first, in its own language', () => {
  const today = new Date(`${day}T06:00:00Z`);
  const message = reminderMessage({ tree: 'lindes', locale: 'de', choices: { offsets: [1, 7], kinds: ['birthday', 'wedding'] }, day }, occasionsFor(today), names);
  assert.ok(message);
  assert.equal(message.body, 'Morgen: Ada Linde wird 76\nIn einer Woche: Bo Linde wird 78\nIn einer Woche: 51. Hochzeitstag: Ada Linde & Bo Linde');
  assert.equal(message.title, 'Familie: Erinnerung');
  assert.equal(message.url, '/lindes/almanac', 'several occasions open the Almanac');
  assert.equal(message.tag, 'kindred-lindes-2026-11-01');
  assert.equal(reminderMessage({ tree: 'lindes', locale: 'en', choices: { offsets: [0], kinds: ['birthday'] }, day }, occasionsFor(today), names), null, 'nothing due today');
  const single = reminderMessage({ tree: 'lindes', locale: 'en', choices: { offsets: [1], kinds: ['birthday'] }, day }, occasionsFor(today), names);
  assert.ok(single);
  assert.deepEqual([single.body, single.url], ['Tomorrow: Ada Linde turns 76', '/lindes?sel=ada']);
});

test('the same reminder reads in English and Afrikaans as well', () => {
  const at = new Date(`${day}T06:00:00Z`);
  const en = reminderMessage({ tree: 't', locale: 'en', choices: { offsets: [1], kinds: ['memorial'] }, day }, occasionsFor(at), names);
  const af = reminderMessage({ tree: 't', locale: 'af', choices: { offsets: [1], kinds: ['memorial'] }, day }, occasionsFor(at), names);
  assert.equal(en?.body, 'Tomorrow: Gone Linde died 25 years ago');
  assert.equal(af?.body, 'Môre: Gone Linde is al 25 jaar oorlede');
  assert.equal(af?.title, 'Familie-herinnering');
});

test('a long reminder ends with a count instead of growing without bound', () => {
  const many = Array.from({ length: 9 }, (_, index) => person(`p${index}`, `Person ${index}`, { living: true, born: '1950-11-02' }));
  const byOffset = new Map([[1, occasionsOn(graphOf(many), new Date('2026-11-02T06:00:00Z'))]]);
  const message = reminderMessage({ tree: 't', locale: 'de', choices: { offsets: [1], kinds: ['birthday'] }, day }, byOffset, new Map(many.map((p) => [p.id, p.given])));
  assert.ok(message);
  const lines = message.body.split('\n');
  assert.equal(lines.length, MAX_LINES);
  assert.equal(lines.at(-1), 'und 4 weitere');
});

test('choices are validated: at least one day and kind, both from the known sets', () => {
  assert.deepEqual(parseChoices([7, 1, 1], ['wedding', 'birthday', 'wedding']), { offsets: [1, 7], kinds: ['wedding', 'birthday'] });
  assert.equal(parseChoices([], ['birthday']), null);
  assert.equal(parseChoices([3], ['birthday']), null, 'only 0, 1 and 7 days');
  assert.equal(parseChoices([1], []), null);
  assert.equal(parseChoices([1], ['gossip']), null, 'only birthday, wedding and memorial');
  assert.equal(parseChoices('1', ['birthday']), null);
});

test('the test message names no one and says reminders work', () => {
  assert.deepEqual(testMessage('lindes', 'en'), { title: 'Family reminder', body: 'Reminders are working on this device.', tag: 'kindred-test-lindes', url: '/lindes' });
  assert.equal(dayKey(new Date('2026-11-01T06:00:00Z')), '2026-11-01');
});

test('occasions are plain objects, so a test can compare them directly', () => {
  const found: Occasion[] = occasionsOn(graph, new Date('2026-11-02T06:00:00Z'));
  assert.deepEqual(found, [{ kind: 'birthday', ids: ['ada'], years: 76 }, { kind: 'memorial', ids: ['gone'], years: 25 }]);
});

test('a reminder fits the push budget in UTF-8 bytes, however long the names: lines drop, and no character is split', async () => {
  const cjk = '名'.repeat(120);
  const emoji = '😀'.repeat(120);
  // Six births on 2 November 1950, each with a 120-character given name and surname: 6 × 240 characters, three bytes each.
  const long = Array.from({ length: 6 }, (_, index) => person(`long${index}`, cjk, { surname: index % 2 ? cjk : emoji, living: true, born: '1950-11-02' }));
  const byOffset = new Map([[1, occasionsOn(graphOf(long), new Date('2026-11-02T06:00:00Z'))]]);
  const longNames = new Map(long.map((p) => [p.id, `${p.given} ${p.surname}`]));
  for (const locale of ['de', 'en', 'af'] as const) {
    const message = reminderMessage({ tree: 'lindes', locale, choices: { offsets: [1], kinds: ['birthday'] }, day }, byOffset, longNames);
    assert.ok(message);
    assert.ok(utf8Bytes(JSON.stringify(message)) <= MAX_MESSAGE_BYTES, `${locale}: ${utf8Bytes(JSON.stringify(message))} bytes`);
    // Decodes without a replacement character, so every character is whole.
    assert.equal(strictDecode(enc.encode(message.body)), message.body);
    assert.ok(message.body.includes(cjk) || message.body.includes(emoji));
  }
  // The whole message is sent as one encrypted body inside the 4096-byte record the push service must take.
  const keys = await deviceKeys();
  const body = await encryptPayload(JSON.stringify(reminderMessage({ tree: 'lindes', locale: 'de', choices: { offsets: [1], kinds: ['birthday'] }, day }, byOffset, longNames)), keys);
  assert.ok(body.byteLength <= PUSH_BODY_BYTES, `${body.byteLength} bytes`);
});

test('a wedding with two maximal names is one line, whole, and the message still fits', () => {
  const huge = '名'.repeat(120);
  const couple = graphOf([person('a', huge, { surname: huge, living: true, born: '1950-01-01' }), person('b', huge, { surname: huge, living: true, born: '1950-01-01' })], [union('w', 'a', 'b', { start: '1975-11-02' })]);
  const byOffset = new Map([[1, occasionsOn(couple, new Date('2026-11-02T06:00:00Z'))]]);
  const names = new Map([['a', `${huge} ${huge}`], ['b', `${huge} ${huge}`]]);
  const message = reminderMessage({ tree: 'lindes', locale: 'en', choices: { offsets: [1], kinds: ['wedding'] }, day }, byOffset, names);
  assert.ok(message);
  assert.equal(message.body.split('\n').length, 1);
  assert.ok(message.body.includes(`${huge} ${huge} & ${huge} ${huge}`), 'both names stay whole');
  assert.ok(utf8Bytes(JSON.stringify(message)) <= MAX_MESSAGE_BYTES);
  assert.equal(strictDecode(enc.encode(message.body)), message.body);
});
