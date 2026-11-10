// node --test src/lib/auth/join-rules.test.ts — what a request to join may hold, and how a guest browser's usage is added up.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addUsage, cleanLanguage, cleanMessage, cleanTimeZone, deviceFamily, MAX_ACTIVE_PER_REPORT, MAX_MESSAGE, parseGuestExtras, PEOPLE_KEPT, PEOPLE_SHOWN, placeOf, usageOf,
} from './join-rules.ts';

test('a message keeps its line breaks and loses control characters; it has a length limit', () => {
  assert.equal(cleanMessage('  Hello\r\nI am Ada\u0007.\n\n\n\nBye  '), 'Hello\nI am Ada.\n\nBye');
  assert.equal(cleanMessage('   '), null);
  assert.equal(cleanMessage(42), null);
  assert.equal(cleanMessage('x'.repeat(MAX_MESSAGE + 50))!.length, MAX_MESSAGE);
});

test('the time zone and the language must look like what a browser reports', () => {
  assert.equal(cleanTimeZone('Europe/Berlin'), 'Europe/Berlin');
  assert.equal(cleanTimeZone('America/Argentina/Buenos_Aires'), 'America/Argentina/Buenos_Aires');
  assert.equal(cleanTimeZone('UTC'), 'UTC');
  assert.equal(cleanTimeZone('<script>'), null);
  assert.equal(cleanTimeZone('a'.repeat(80)), null);
  assert.equal(cleanLanguage('de-DE'), 'de-DE');
  assert.equal(cleanLanguage('af'), 'af');
  assert.equal(cleanLanguage('en US'), null);
  assert.equal(cleanLanguage(''), null);
});

test('the device family is the device and the browser, nothing finer', () => {
  assert.equal(deviceFamily('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'), 'iPhone, Safari');
  assert.equal(deviceFamily('Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:131.0) Gecko/20100101 Firefox/131.0'), 'Mac, Firefox');
  assert.equal(deviceFamily('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36'), 'Android phone, Chrome');
  assert.equal(deviceFamily('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0'), 'Windows PC, Edge');
  assert.equal(deviceFamily(''), 'unknown');
  assert.equal(deviceFamily(null), 'unknown');
});

test('the place comes from Cloudflare’s request data, never an address; Node knows nothing unless a trusted proxy names a country', () => {
  const onWorker = Object.assign(new Request('https://x/'), { cf: { city: 'Windhoek', region: 'Khomas', country: 'NA', clientTcpRtt: 3 } });
  assert.deepEqual(placeOf(onWorker, false), { city: 'Windhoek', region: 'Khomas', country: 'NA' });
  const withHeader = new Request('https://x/', { headers: { 'cf-ipcountry': 'DE', 'x-forwarded-for': '203.0.113.9' } });
  assert.equal(placeOf(withHeader, false), null, 'a header from an untrusted client is not believed');
  assert.deepEqual(placeOf(withHeader, true), { city: null, region: null, country: 'DE' });
  assert.equal(placeOf(new Request('https://x/', { headers: { 'cf-ipcountry': 'XX' } }), true), null, 'unknown and Tor are not countries');
  assert.equal(placeOf(new Request('https://x/'), true), null);
  const dump = JSON.stringify(placeOf(Object.assign(new Request('https://x/'), { cf: { city: 'Windhoek', country: 'NA', asn: 1234, latitude: '-22.5' } }), false));
  assert.ok(!dump.includes('1234') && !dump.includes('-22.5'), 'only the city, region and country are kept');
});

test('a guest report adds up: visits, active time within a cap, known sections, and a small tally of people', () => {
  const extras = parseGuestExtras({ active: 10_000, people: ['ada', 'ada', 'bea', 42, '<x>', ...Array.from({ length: 20 }, (_, i) => `p${i}`)] });
  assert.equal(extras.active, MAX_ACTIVE_PER_REPORT, 'a forged report cannot add hours');
  assert.deepEqual(extras.people.slice(0, 2), ['ada', 'bea']);
  assert.ok(extras.people.length <= 10);
  assert.deepEqual(parseGuestExtras(null), { active: 0, people: [] });

  let row = { visits: 0, active_seconds: 0, sections: '{}', people: '{}' };
  row = addUsage(row, { visit: true, views: { tree: 2, atlas: 1, 'not-a-section': 5 }, active: 60, people: ['ada'] });
  row = addUsage(row, { visit: false, views: { tree: 1 }, active: 30, people: ['ada', 'bea'] });
  assert.equal(row.visits, 1);
  assert.equal(row.active_seconds, 90);
  assert.deepEqual(JSON.parse(row.sections), { tree: 3, atlas: 1 });
  assert.deepEqual(JSON.parse(row.people), { ada: 2, bea: 1 });

  for (let i = 0; i < PEOPLE_KEPT + 10; i++) row = addUsage(row, { visit: false, views: {}, active: 0, people: [`x${i}`] });
  assert.equal(Object.keys(JSON.parse(row.people)).length, PEOPLE_KEPT, 'the tally stays small');
  assert.ok('ada' in JSON.parse(row.people), 'the people opened most stay');

  const u = usageOf({ first_seen: 1, last_seen: 2, ...row });
  assert.equal(u.people.length, PEOPLE_SHOWN);
  assert.equal(u.people[0].id, 'ada');
  assert.equal(u.activeMinutes, 2);
});
