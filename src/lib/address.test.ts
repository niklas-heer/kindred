import assert from 'node:assert/strict';
import { test } from 'node:test';
import { countryCodeOf, formatAddress, osmHit, parseAddress, townQuery } from './address.ts';
import { lookupAddress, resetLookup } from './address-lookup.server.ts';

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

test('reads an OpenStreetMap result into parts, house number where the country writes it', () => {
  const at = (cc: string) => ({ place_id: 1, address: { road: 'Long Street', house_number: '12', postcode: '8001', town: 'Exampleton', country: 'Somewhere', country_code: cc } });
  assert.deepEqual(osmHit(at('de'))?.parts, parts('Long Street 12', '8001', 'Exampleton', 'Somewhere'));
  assert.equal(osmHit(at('za'))?.parts.street, '12 Long Street');
  assert.equal(osmHit({ place_id: 2 }), null);
  assert.equal(osmHit('junk'), null);
});

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const HIT = { place_id: 7, address: { road: 'Long Street', house_number: '12', city: 'Exampleton', country: 'Somewhere', country_code: 'de' } };

function deps(fetchImpl: () => Promise<Response>) {
  const clock = { t: 1000 };
  const calls: { url: string; init?: RequestInit }[] = [];
  return {
    calls, clock,
    d: {
      fetch: (async (url: string, init?: RequestInit) => { calls.push({ url, init }); return fetchImpl(); }) as typeof fetch,
      now: () => clock.t,
      sleep: async (ms: number) => { clock.t += ms; },
    },
  };
}

test('sends only the typed text, says who is asking, and caches the answer', async () => {
  resetLookup();
  const { calls, d } = deps(async () => reply([HIT]));
  const first = await lookupAddress('Long Street 12', 'de', d);
  assert.ok(first.ok && first.hits[0].parts.city === 'Exampleton');
  const url = new URL(calls[0].url);
  assert.equal(url.protocol, 'https:');
  assert.equal(url.hostname, 'nominatim.openstreetmap.org');
  assert.deepEqual([...url.searchParams.keys()].sort(), ['accept-language', 'addressdetails', 'format', 'limit', 'q']);
  assert.equal(url.searchParams.get('q'), 'Long Street 12');
  assert.match(new Headers(calls[0].init?.headers).get('User-Agent') ?? '', /Kindred/);
  await lookupAddress('long street 12', 'de', d);
  assert.equal(calls.length, 1, 'answered from the cache');
});

test('keeps a second between requests, and declines rather than queueing for long', async () => {
  resetLookup();
  const { calls, clock, d } = deps(async () => reply([]));
  await lookupAddress('First Street', 'en', d);
  const before = clock.t;
  await lookupAddress('Second Street', 'en', d);
  assert.ok(clock.t - before >= 1000);
  assert.equal(calls.length, 2);

  resetLookup();
  const held = deps(async () => reply([]));
  held.d.sleep = () => new Promise(() => {});
  for (let i = 0; i < 4; i++) void lookupAddress(`Street number ${i}`, 'en', held.d);
  assert.deepEqual(await lookupAddress('Street number 9', 'en', held.d), { ok: false });
});

test('any failure is just a failure, and is not cached', async () => {
  for (const f of [async () => reply({}, 500), async () => { throw new Error('offline'); }, async () => reply({ not: 'a list' })]) {
    resetLookup();
    const { d } = deps(f);
    assert.deepEqual(await lookupAddress('Long Street 12', 'en', d), { ok: false });
  }
  resetLookup();
  let n = 0;
  const { d, clock } = deps(async () => (++n === 1 ? reply({}, 500) : reply([HIT])));
  await lookupAddress('Long Street 12', 'en', d);
  clock.t += 5000;
  assert.equal((await lookupAddress('Long Street 12', 'en', d)).ok, true);
});
