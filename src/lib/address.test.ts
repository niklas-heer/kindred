import assert from 'node:assert/strict';
import { test } from 'node:test';
import { countryCodeOf, formatAddress, parseAddress, photonHit, photonHits, townQuery } from './address.ts';
import { addressLookupOn, resetLookup, suggestAddresses } from './address-lookup.server.ts';

const parts = (street: string, postcode: string, city: string, country: string) => ({ street, postcode, city, country });

test('reads the ways an address is written', () => {
  const cases: [string, ReturnType<typeof parts>][] = [
    ['Musterweg 12, 70173 Stuttgart, Deutschland', parts('Musterweg 12', '70173', 'Stuttgart', 'Deutschland')],
    ['Musterweg 12, Stuttgart, 70173, Germany', parts('Musterweg 12', '70173', 'Stuttgart', 'Germany')],
    ['12 Long Street, Cape Town, 8001, Suid-Afrika', parts('12 Long Street', '8001', 'Cape Town', 'Suid-Afrika')],
    ['Kerkstraat 1, 1017 GA Amsterdam', parts('Kerkstraat 1', '1017 GA', 'Amsterdam', '')],
    ['1 High Street, London SW1A 2AA, United Kingdom', parts('1 High Street', 'SW1A 2AA', 'London', 'United Kingdom')],
    ['70173 Stuttgart', parts('', '70173', 'Stuttgart', '')],
    ['Stuttgart, Germany', parts('', '', 'Stuttgart', 'Germany')],
    ['Stuttgart', parts('', '', 'Stuttgart', '')],
    ['Musterweg 12', parts('Musterweg 12', '', '', '')],
  ];
  for (const [text, want] of cases) assert.deepEqual(parseAddress(text), want, text);
});

test('a house number in the first part is not taken for a postcode', () => {
  assert.equal(parseAddress('Main Road 1234, Springfield').street, 'Main Road 1234');
  assert.equal(parseAddress('1234 Main Road').street, '1234 Main Road');
});

test('no typed word is lost', () => {
  assert.deepEqual(parseAddress('12 Main St, Springfield, IL 62704, USA'), parts('12 Main St', '62704', 'Springfield, IL', 'USA'));
});

test('what is formatted reads back the same', () => {
  const a = parts('Musterweg 12', '70173', 'Stuttgart', 'Deutschland');
  assert.deepEqual(parseAddress(formatAddress(a)), a);
});

test('the end of a typed address is what the town search asks about', () => {
  assert.deepEqual(townQuery('Musterweg 12, 70173 Stutt'), { street: 'Musterweg 12', postcode: '70173', q: 'Stutt' });
  assert.deepEqual(townQuery('Stutt'), { street: '', postcode: '', q: 'Stutt' });
  assert.equal(townQuery('Musterweg 12').q, '');
});

test('country names in all three languages are known', () => {
  for (const n of ['Germany', 'Deutschland', 'Duitsland', 'de']) assert.equal(countryCodeOf(n), 'DE', n);
});

// Shaped like Photon's answers (docs/api-v1.md), with invented places.
const house = (cc: string, extra: Record<string, unknown> = {}) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [1, 2] },
  properties: { osm_type: 'N', osm_id: 101, type: 'house', housenumber: '12', street: 'Long Street', postcode: '8001', city: 'Exampleton', country: 'Somewhere', countrycode: cc.toUpperCase(), ...extra },
});

test('reads a Photon result into parts, house number where the country writes it', () => {
  assert.deepEqual(photonHit(house('de'))?.parts, parts('Long Street 12', '8001', 'Exampleton', 'Somewhere'));
  assert.equal(photonHit(house('za'))?.parts.street, '12 Long Street');
  assert.equal(photonHit(house('de'))?.id, 'N101');
  // A shop's name is not part of its address.
  assert.equal(photonHit(house('de', { name: 'Corner Bakery' }))?.label, 'Long Street 12, 8001 Exampleton, Somewhere');
  // A street on its own is named by `name`; a place with no town still has its locality.
  const street = { properties: { type: 'street', name: 'Quiet Lane', locality: 'Smallfield', country: 'Somewhere', countrycode: 'GB' } };
  assert.deepEqual(photonHit(street)?.parts, parts('Quiet Lane', '', 'Smallfield', 'Somewhere'));
  assert.equal(photonHit({ properties: { type: 'state', name: 'Region', country: 'Somewhere' } }), null);
  assert.equal(photonHit({ type: 'Feature' }), null);
  assert.equal(photonHit('junk'), null);
});

test('a Photon answer lists each address once, and anything else is no answer', () => {
  const hits = photonHits({ type: 'FeatureCollection', features: [house('de'), house('de', { osm_id: 102 }), house('de', { housenumber: '14' }), 'junk'] });
  assert.deepEqual(hits?.map((h) => h.parts.street), ['Long Street 12', 'Long Street 14']);
  assert.deepEqual(photonHits({ type: 'FeatureCollection', features: [] }), []);
  assert.equal(photonHits([house('de')]), null);
  assert.equal(photonHits(null), null);
});

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const ANSWER = { type: 'FeatureCollection', features: [house('de')] };

function deps(fetchImpl: () => Promise<Response>, env: Record<string, string | undefined> = {}) {
  const clock = { t: 1000 };
  const calls: { url: string; init?: RequestInit }[] = [];
  return {
    calls, clock,
    d: {
      fetch: (async (url: string, init?: RequestInit) => { calls.push({ url, init }); return fetchImpl(); }) as typeof fetch,
      now: () => clock.t,
      sleep: async (ms: number) => { clock.t += ms; },
      env,
    },
  };
}

test('the lookup is on unless the self-hoster switched it off, and then asks nobody', async () => {
  assert.equal(addressLookupOn({}), true);
  assert.equal(addressLookupOn({ KINDRED_ADDRESS_LOOKUP: '' }), true);
  assert.equal(addressLookupOn({ KINDRED_ADDRESS_LOOKUP: 'on' }), true);
  for (const v of ['off', 'OFF', '0', 'false', 'no']) assert.equal(addressLookupOn({ KINDRED_ADDRESS_LOOKUP: v }), false, v);
  resetLookup();
  const { calls, d } = deps(async () => reply(ANSWER), { KINDRED_ADDRESS_LOOKUP: 'off' });
  assert.deepEqual(await suggestAddresses('Long Street 12', 'en', 'a', d), { ok: false, reason: 'off' });
  assert.equal(calls.length, 0);
});

test('sends only the typed text to Photon, says who is asking, and caches the answer', async () => {
  resetLookup();
  const { calls, d } = deps(async () => reply(ANSWER));
  const first = await suggestAddresses('Long Street 12', 'de', 'a', d);
  assert.ok(first.ok && first.hits[0].parts.city === 'Exampleton');
  const url = new URL(calls[0].url);
  assert.equal(url.protocol, 'https:');
  assert.equal(url.hostname, 'photon.komoot.io');
  assert.deepEqual([...new Set(url.searchParams.keys())].sort(), ['lang', 'layer', 'limit', 'q']);
  assert.equal(url.searchParams.get('q'), 'Long Street 12');
  assert.equal(url.searchParams.get('lang'), 'de');
  assert.deepEqual(url.searchParams.getAll('layer'), ['house', 'street']);
  assert.match(new Headers(calls[0].init?.headers).get('User-Agent') ?? '', /Kindred/);
  await suggestAddresses('long street 12', 'de', 'b', d);
  assert.equal(calls.length, 1, 'answered from the cache');
  // Photon has no Afrikaans: the local names come back, and no language is sent.
  await suggestAddresses('Long Street 12', 'af', 'a', d);
  assert.equal(new URL(calls[1].url).searchParams.has('lang'), false);
});

test('keeps a gap between requests, declines rather than queueing for long, and caps one person', async () => {
  resetLookup();
  const { calls, clock, d } = deps(async () => reply(ANSWER));
  await suggestAddresses('First Street', 'en', 'a', d);
  const before = clock.t;
  await suggestAddresses('Second Street', 'en', 'a', d);
  assert.ok(clock.t - before >= 250);
  assert.equal(calls.length, 2);

  resetLookup();
  const held = deps(async () => reply(ANSWER));
  held.d.sleep = () => new Promise(() => {});
  for (let i = 0; i < 6; i++) void suggestAddresses(`Street number ${i}`, 'en', `p${i}`, held.d);
  assert.deepEqual(await suggestAddresses('Street number 9', 'en', 'p9', held.d), { ok: false, reason: 'busy' });

  resetLookup();
  const busy = deps(async () => reply(ANSWER));
  let last;
  for (let i = 0; i < 41; i++) { busy.clock.t += 1000; last = await suggestAddresses(`Street ${i}`, 'en', 'eager', busy.d); }
  assert.deepEqual(last, { ok: false, reason: 'busy' }, 'the 41st in a minute');
  assert.equal((await suggestAddresses('Street 99', 'en', 'someone else', busy.d)).ok, true, 'another person is not held up');
  busy.clock.t += 60_000;
  assert.equal((await suggestAddresses('Street 100', 'en', 'eager', busy.d)).ok, true, 'a minute later');
});

test('any failure is just a failure, and is not cached', async () => {
  for (const f of [async () => reply({}, 500), async () => { throw new Error('offline'); }, async () => reply({ not: 'features' })]) {
    resetLookup();
    const { d } = deps(f);
    assert.deepEqual(await suggestAddresses('Long Street 12', 'en', 'a', d), { ok: false, reason: 'failed' });
  }
  resetLookup();
  let n = 0;
  const { d, clock } = deps(async () => (++n === 1 ? reply({}, 500) : reply(ANSWER)));
  await suggestAddresses('Long Street 12', 'en', 'a', d);
  clock.t += 5000;
  assert.equal((await suggestAddresses('Long Street 12', 'en', 'a', d)).ok, true);
});
