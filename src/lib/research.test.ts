// node --test src/lib/research.test.ts — the Research page's pure rules: who may change what, which uploads are refused by
// their bytes, and the derived timeline. The server side (database, privacy, files) is in research.server.test.ts.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deflateSync } from 'node:zlib';
import { can } from './roles.ts';
import { checkDocument, dateOrder, dateText, documentFileName, mayChangeResearch, MAX_DOCUMENT_BYTES, pdfContentProblem, researchTimeline, seesPrivateResearch, sniffDocument, unionEndKey } from './research.ts';

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

test('a script disguised as a PDF is refused, by its bytes and not its name', async () => {
  const script = encode('<script>alert(1)</script>');
  assert.deepEqual(await checkDocument(script, 'application/pdf'), { refused: 'research.err.file_type' });
  assert.deepEqual(await checkDocument(script, ''), { refused: 'research.err.file_type' });
  // A web page with a PDF name, a shell script, and an SVG (which can carry a script) are all something else.
  assert.deepEqual(await checkDocument(encode('<!doctype html><title>x</title>'), 'application/pdf'), { refused: 'research.err.file_type' });
  assert.deepEqual(await checkDocument(encode('#!/bin/sh\necho hello\n'), 'application/pdf'), { refused: 'research.err.file_type' });
  assert.deepEqual(await checkDocument(encode('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>'), 'image/svg+xml'), { refused: 'research.err.file_type' });
});

test('a picture renamed to a PDF is refused: the declared type must match the bytes', async () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  assert.equal(sniffDocument(jpeg), 'image/jpeg');
  assert.deepEqual(await checkDocument(jpeg, 'application/pdf'), { refused: 'research.err.file_type' });
  assert.deepEqual(await checkDocument(jpeg, 'image/jpeg'), { mime: 'image/jpeg' });
  // Some systems send no type at all for a known file: the bytes alone decide.
  assert.deepEqual(await checkDocument(jpeg, ''), { mime: 'image/jpeg' });
});

test('a sound PDF, a PNG and a WebP are accepted', async () => {
  assert.deepEqual(await checkDocument(PDF(), 'application/pdf'), { mime: 'application/pdf' });
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
  assert.deepEqual(await checkDocument(png, 'image/png'), { mime: 'image/png' });
  const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
  assert.deepEqual(await checkDocument(webp, 'image/webp'), { mime: 'image/webp' });
});

test('an empty file, one over the limit and a PDF with its end cut off are refused', async () => {
  assert.deepEqual(await checkDocument(new Uint8Array(0), 'application/pdf'), { refused: 'research.err.file_empty' });
  const huge = new Uint8Array(MAX_DOCUMENT_BYTES + 1);
  huge.set(encode('%PDF-1.4'));
  assert.deepEqual(await checkDocument(huge, 'application/pdf'), { refused: 'research.err.file_large' });
  assert.deepEqual(await checkDocument(encode('%PDF-1.4\nno ending here'), 'application/pdf'), { refused: 'research.err.pdf_broken' });
});

test('a PDF with scripts or attachments is refused, even with the name spelled in hex', async () => {
  assert.deepEqual(await checkDocument(PDF('<< /S /JavaScript /JS (app.alert(1)) >>'), 'application/pdf'), { refused: 'research.err.pdf_active' });
  assert.deepEqual(await checkDocument(PDF('<< /S /J#61vaScript >>'), 'application/pdf'), { refused: 'research.err.pdf_active' });
  assert.deepEqual(await checkDocument(PDF('<< /Type /EmbeddedFile >>'), 'application/pdf'), { refused: 'research.err.pdf_active' });
  assert.deepEqual(await checkDocument(PDF('<< /S /Launch >>'), 'application/pdf'), { refused: 'research.err.pdf_active' });
});

test('compressed bytes that happen to spell /JS do not refuse a good scan, and a normal name does not match', async () => {
  assert.equal(await pdfContentProblem(PDF('2 0 obj\n<< /Length 20 >>\nstream\n/JS /JavaScript (x\nendstream\nendobj\n')), null);
  assert.equal(await pdfContentProblem(PDF('<< /Type /Page /JSON 1 >>')), null);
});

// The review's way past the old filter: a comment line that says "stream" hid everything after it.
const OPEN_JS = '2 0 obj\n<< /Type /Catalog /OpenAction 3 0 R >>\nendobj\n3 0 obj\n<< /S /JavaScript /JS (app.alert(1)) >>\nendobj\n';

test('a comment cannot hide what follows it from the filter', async () => {
  assert.equal(await pdfContentProblem(PDF(OPEN_JS)), 'active');
  assert.equal(await pdfContentProblem(PDF(`% stream\n${OPEN_JS}`)), 'active');
  assert.equal(await pdfContentProblem(PDF(`%>> stream\n${OPEN_JS}`)), 'active');
  assert.equal(await pdfContentProblem(PDF('% a note that mentions /JavaScript\n')), 'active', 'names in a comment are still checked');
  assert.equal(await pdfContentProblem(PDF('% made by a scanner\n')), null);
});

test('a string cannot start a stream either, and a name ending in "stream" is just a name', async () => {
  assert.equal(await pdfContentProblem(PDF(`4 0 obj\n<< /Title (see >> stream\n) >>\nendobj\n${OPEN_JS}endstream\n`)), 'active');
  assert.equal(await pdfContentProblem(PDF(`4 0 obj\n<< /Title (a \\) >> stream\n) >>\nendobj\n${OPEN_JS}endstream\n`)), 'active', 'an escaped bracket does not end the string');
  assert.equal(await pdfContentProblem(PDF(`4 0 obj\n<< /Mystream 1 >>\nendobj\n${OPEN_JS}endstream\n`)), 'active');
  assert.equal(await pdfContentProblem(PDF('4 0 obj\n<< /Title (Family (letters) 1920) /ID <a1B2> >>\nendobj\n')), null);
});

test('a stream that never ends, or a string that never closes, is refused as broken', async () => {
  assert.equal(await pdfContentProblem(PDF('4 0 obj\n<< /Length 5 >>\nstream\nabcde\n')), 'broken');
  assert.deepEqual(await checkDocument(PDF('4 0 obj\n<< /Length 5 >>\nstream\nabcde\n'), 'application/pdf'), { refused: 'research.err.pdf_broken' });
  assert.equal(await pdfContentProblem(PDF('4 0 obj\n<< /Title (never closed >>\nendobj\n')), 'broken');
});

test('a wrong /Length cannot stretch a stream over the objects after it', async () => {
  assert.equal(await pdfContentProblem(PDF(`4 0 obj\n<< /Length 9999 >>\nstream\nxx\nendstream\nendobj\n${OPEN_JS}`)), 'active');
  // A /Length that ends where `endstream` is ends the body there, even when the body spells endstream earlier on.
  assert.equal(await pdfContentProblem(PDF('4 0 obj\n<< /Length 3 >>\nstream\nabc\nendstream\nendobj\n')), null);
});

test('an open action is refused unless it only opens a page; additional actions are refused', async () => {
  assert.equal(await pdfContentProblem(PDF('2 0 obj\n<< /Type /Catalog /OpenAction [3 0 R /FitH null] >>\nendobj\n')), null, 'a page to open at');
  assert.equal(await pdfContentProblem(PDF('2 0 obj\n<< /Type /Catalog /OpenAction << /S /GoTo /D [3 0 R /Fit] >> >>\nendobj\n')), 'active');
  assert.equal(await pdfContentProblem(PDF('2 0 obj\n<< /Type /Catalog /OpenAction 5 0 R >>\nendobj\n5 0 obj\n[3 0 R /Fit]\nendobj\n')), null, 'a reference to a page to open at, as pdfTeX and Quartz write it');
  assert.equal(await pdfContentProblem(PDF(OPEN_JS)), 'active', 'a reference to a script is refused by the script');
  assert.equal(await pdfContentProblem(PDF('2 0 obj\n<< /Type /Catalog /OpenAction 5 0 Rx >>\nendobj\n')), 'active');
  assert.equal(await pdfContentProblem(PDF('2 0 obj\n<< /Type /Page /AA << /O 6 0 R >> >>\nendobj\n')), 'active');
  assert.equal(await pdfContentProblem(PDF('2 0 obj\n<< /Type /Page /#41A << >> >>\nendobj\n')), 'active');
});

/** An object stream (PDF 1.5+) holding `objects`, compressed as a scanner or a word processor would write it. */
function objectStream(objects: string, { filter = '/Filter /FlateDecode', body }: { filter?: string; body?: Uint8Array } = {}) {
  const packed = body ?? new Uint8Array(deflateSync(Buffer.from(`7 0 ${objects}`)));
  const head = encode(`%PDF-1.7\n%\xe2\xe3\n5 0 obj\n<< /Type /ObjStm /N 1 /First 4 /Length ${packed.length} ${filter} >>\nstream\n`);
  const tail = encode('\nendstream\nendobj\n6 0 obj\n<< /Type /XRef /Size 8 /Length 0 >>\nstream\n\nendstream\nendobj\nstartxref\n9\n%%EOF\n');
  const out = new Uint8Array(head.length + packed.length + tail.length);
  out.set(head);
  out.set(packed, head.length);
  out.set(tail, head.length + packed.length);
  return out;
}

test('a modern PDF that packs its objects into compressed object streams is accepted when they are clean', async () => {
  const clean = objectStream('<< /Type /Catalog /Pages 8 0 R /OpenAction [9 0 R /Fit] >>');
  assert.equal(await pdfContentProblem(clean), null);
  assert.deepEqual(await checkDocument(clean, 'application/pdf'), { mime: 'application/pdf' });
});

test('an encrypted PDF is kept though its packed objects cannot be read, and naming /Encrypt hides nothing in a plain one', async () => {
  const withEncrypt = (pdf: Uint8Array) => {
    const mark = encode('\n9 0 obj\n<< /Encrypt 10 0 R >>\nendobj\n');
    const out = new Uint8Array(pdf.length + mark.length);
    const at = pdf.length - encode('startxref\n9\n%%EOF\n').length;
    out.set(pdf.subarray(0, at));
    out.set(mark, at);
    out.set(pdf.subarray(at), at + mark.length);
    return out;
  };
  assert.equal(await pdfContentProblem(withEncrypt(objectStream('', { body: encode('cipher text, not deflate') }))), null);
  assert.equal(await pdfContentProblem(withEncrypt(objectStream('<< /S /JavaScript /JS (app.alert(1)) >>'))), 'active');
});

test('scripts packed inside a compressed object stream are found and refused', async () => {
  assert.equal(await pdfContentProblem(objectStream('<< /S /JavaScript /JS (app.alert(1)) >>')), 'active');
  assert.equal(await pdfContentProblem(objectStream('<< /Type /Filespec /EF << /F 9 0 R >> /Type /EmbeddedFile >>')), 'active');
  assert.deepEqual(await checkDocument(objectStream('<< /S /Launch /F (calc.exe) >>'), 'application/pdf'), { refused: 'research.err.pdf_active' });
  assert.equal(await pdfContentProblem(objectStream('<< /S /JavaScript >>', { filter: '' , body: encode('7 0 << /S /JavaScript >>') })), 'active', 'an uncompressed object stream is read as it is');
});

test('an object stream that cannot be read is refused rather than trusted', async () => {
  assert.equal(await pdfContentProblem(objectStream('', { body: encode('not deflate at all') })), 'broken');
  const cut = new Uint8Array(deflateSync(Buffer.from('7 0 << /S /JavaScript /JS (x) >>'))).subarray(0, 10);
  assert.equal(await pdfContentProblem(objectStream('', { body: cut })), 'broken', 'cut off');
  assert.equal(await pdfContentProblem(objectStream('<< >>', { filter: '/Filter [/ASCII85Decode /FlateDecode]' })), 'broken', 'a filter this check cannot undo');
  assert.equal(await pdfContentProblem(objectStream('<< >>', { filter: '/Filter /FlateDecode /DecodeParms << /Predictor 12 >>' })), 'broken');
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
