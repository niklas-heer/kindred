// node --test src/lib/research.test.ts — the Research page's pure rules: who may change what, which uploads are refused by
// their bytes, and the derived timeline. The server side (database, privacy, files) is in research.server.test.ts.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { can } from './roles.ts';
import { checkDocument, dateOrder, dateText, documentFileName, mayChangeResearch, MAX_DOCUMENT_BYTES, pdfHasActiveContent, researchTimeline, seesPrivateResearch, sniffDocument, unionEndKey } from './research.ts';

const encode = (s: string) => new TextEncoder().encode(s);
const PDF = (body = '') => encode(`%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n${body}\nxref\n0 1\ntrailer\n<<>>\nstartxref\n9\n%%EOF\n`);

test('roles: viewers read, contributors add and change their own, editors change anyone’s', () => {
  assert.equal(can('viewer', 'add-research'), false);
  assert.equal(can('contributor', 'add-research'), true);
  assert.equal(can('contributor', 'edit-research'), false);
  assert.equal(can('editor', 'edit-research'), true);
  assert.equal(mayChangeResearch('viewer', true), false);
  assert.equal(mayChangeResearch('contributor', false), false);
  assert.equal(mayChangeResearch('contributor', true), true);
  assert.equal(mayChangeResearch('editor', false), true);
  assert.equal(mayChangeResearch('steward', false), true);
});

test('private research is for editors and stewards, as a private field is', () => {
  assert.equal(seesPrivateResearch('viewer'), false);
  assert.equal(seesPrivateResearch('contributor'), false);
  assert.equal(seesPrivateResearch('editor'), true);
  assert.equal(seesPrivateResearch('steward'), true);
  assert.equal(seesPrivateResearch(null), false);
});

test('a script disguised as a PDF is refused, by its bytes and not its name', () => {
  const script = encode('<script>alert(1)</script>');
  assert.deepEqual(checkDocument(script, 'application/pdf'), { refused: 'research.err.file_type' });
  assert.deepEqual(checkDocument(script, ''), { refused: 'research.err.file_type' });
  // A web page with a PDF name, a shell script, and an SVG (which can carry a script) are all something else.
  assert.deepEqual(checkDocument(encode('<!doctype html><title>x</title>'), 'application/pdf'), { refused: 'research.err.file_type' });
  assert.deepEqual(checkDocument(encode('#!/bin/sh\necho hello\n'), 'application/pdf'), { refused: 'research.err.file_type' });
  assert.deepEqual(checkDocument(encode('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>'), 'image/svg+xml'), { refused: 'research.err.file_type' });
});

test('a picture renamed to a PDF is refused: the declared type must match the bytes', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  assert.equal(sniffDocument(jpeg), 'image/jpeg');
  assert.deepEqual(checkDocument(jpeg, 'application/pdf'), { refused: 'research.err.file_type' });
  assert.deepEqual(checkDocument(jpeg, 'image/jpeg'), { mime: 'image/jpeg' });
  // Some systems send no type at all for a known file: the bytes alone decide.
  assert.deepEqual(checkDocument(jpeg, ''), { mime: 'image/jpeg' });
});

test('a sound PDF, a PNG and a WebP are accepted', () => {
  assert.deepEqual(checkDocument(PDF(), 'application/pdf'), { mime: 'application/pdf' });
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
  assert.deepEqual(checkDocument(png, 'image/png'), { mime: 'image/png' });
  const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
  assert.deepEqual(checkDocument(webp, 'image/webp'), { mime: 'image/webp' });
});

test('an empty file, one over the limit and a PDF with its end cut off are refused', () => {
  assert.deepEqual(checkDocument(new Uint8Array(0), 'application/pdf'), { refused: 'research.err.file_empty' });
  const huge = new Uint8Array(MAX_DOCUMENT_BYTES + 1);
  huge.set(encode('%PDF-1.4'));
  assert.deepEqual(checkDocument(huge, 'application/pdf'), { refused: 'research.err.file_large' });
  assert.deepEqual(checkDocument(encode('%PDF-1.4\nno ending here'), 'application/pdf'), { refused: 'research.err.pdf_broken' });
});

test('a PDF with scripts or attachments is refused, even with the name spelled in hex', () => {
  assert.deepEqual(checkDocument(PDF('<< /S /JavaScript /JS (app.alert(1)) >>'), 'application/pdf'), { refused: 'research.err.pdf_active' });
  assert.deepEqual(checkDocument(PDF('<< /S /J#61vaScript >>'), 'application/pdf'), { refused: 'research.err.pdf_active' });
  assert.deepEqual(checkDocument(PDF('<< /Type /EmbeddedFile >>'), 'application/pdf'), { refused: 'research.err.pdf_active' });
  assert.deepEqual(checkDocument(PDF('<< /S /Launch >>'), 'application/pdf'), { refused: 'research.err.pdf_active' });
});

test('compressed bytes that happen to spell /JS do not refuse a good scan, and a normal name does not match', () => {
  assert.equal(pdfHasActiveContent(PDF('stream\n/JS /JavaScript\nendstream\n')), false);
  assert.equal(pdfHasActiveContent(PDF('<< /Type /Page /JSON 1 >>')), false);
});

test('a date sorts by what is known: a year before its months, a month before its days, about-dates in the same place', () => {
  assert.deepEqual(dateOrder('1953'), [1953, 0, 0]);
  assert.deepEqual(dateOrder('1953-08'), [1953, 8, 0]);
  assert.deepEqual(dateOrder('~1953-08-14'), [1953, 8, 14]);
});

const family = () => ({
  byId: new Map([
    ['tobias', { born: '1890-03-02', died: '1961' }],
    ['greta', { born: '~1893' }],
    ['mira', { born: '1921-06-14' }],
  ]),
  unionsOf: new Map([
    ['tobias', [{ id: 'u1', a: 'tobias', b: 'greta', kind: 'marriage', start: '1919-05', end: '1961' }]],
    ['greta', [{ id: 'u1', a: 'tobias', b: 'greta', kind: 'marriage', start: '1919-05', end: '1961' }]],
  ]),
});
const empty = { documents: [], notes: [], pictures: [] };
const person = (id: string) => ({ person: id, private: false, by: '', mine: false });

test('the timeline holds a project’s dated items and its linked people’s events, in order', () => {
  const entries = researchTimeline({
    documents: [{ id: 'd1', key: 'k', mime: 'application/pdf', size: 1, width: 0, height: 0, title: 'Baptism record', date: '1890-04', source: null, notes: '', private: false, by: '', mine: false }],
    notes: [{ id: 'n1', title: 'Family tale', body: '', date: '1919', private: false, by: '', mine: false }, { id: 'n2', title: 'Undated', body: '', date: null, private: false, by: '', mine: false }],
    pictures: [{ key: 'p1', taken: '1919-06', caption: 'The wedding', by: '', mine: false }],
    people: [person('tobias')],
  }, family());
  assert.deepEqual(entries.map((e) => [e.date, e.kind]), [
    ['1890-03-02', 'birth'],
    ['1890-04', 'document'],
    ['1919', 'note'],
    ['1919-05', 'union'],
    ['1919-06', 'picture'],
    ['1961', 'union-end'],
    ['1961', 'death'],
  ]);
  assert.equal(entries.find((e) => e.id === 'note:n2'), undefined, 'an item with no date is not on the timeline');
});

test('a union is one event when both partners are linked, and names the partner when only one is', () => {
  const both = researchTimeline({ ...empty, people: [person('tobias'), person('greta')] }, family());
  assert.equal(both.filter((e) => e.kind === 'union').length, 1);
  assert.equal(both.filter((e) => e.kind === 'union-end').length, 1);

  const one = researchTimeline({ ...empty, people: [person('greta')] }, family());
  const union = one.find((e) => e.kind === 'union')!;
  assert.equal(union.person, 'greta');
  assert.equal(union.other, 'tobias');
});

test('a person the reader may not see adds no events: the view holds only their visible links', () => {
  // The server leaves a private link out for a viewer, so the timeline has nothing to derive.
  assert.deepEqual(researchTimeline({ ...empty, people: [] }, family()), []);
});

test('a saved file gets a safe name with the right extension', () => {
  assert.equal(documentFileName('Taufschein: "Lindholm" / 1890', 'application/pdf'), 'Taufschein Lindholm 1890.pdf');
  assert.equal(documentFileName('***', 'image/png'), 'document.png');
});

test('an approximate date carries one marker, in each language', () => {
  assert.equal(dateText('~1931', 'en'), 'c. 1931');
  assert.equal(dateText('~1931', 'de'), 'ca. 1931');
  assert.equal(dateText('~1931', 'af'), 'ong. 1931');
  assert.equal(dateText('1931', 'de'), '1931');
  assert.equal(dateText(null, 'en'), '');
  assert.ok(!dateText('~1931-05', 'de').includes('~'));
});

test('a union end says why it ended: a death is not a separation', () => {
  const fam = family();
  fam.unionsOf.get('tobias')![0] = { ...fam.unionsOf.get('tobias')![0], endReason: 'death' } as never;
  const end = researchTimeline({ ...empty, people: [person('tobias')] }, fam).find((e) => e.kind === 'union-end')!;
  assert.equal(end.endReason, 'death');
  assert.equal(unionEndKey('death'), 'research.tl_union_end_death');
  assert.equal(unionEndKey('divorce'), 'research.tl_union_end_divorce');
  assert.equal(unionEndKey('other'), 'research.tl_union_end');
  assert.equal(unionEndKey(undefined), 'research.tl_union_end');
});
