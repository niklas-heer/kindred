// node --test src/lib/ai-portrait-rules.test.ts — the pure rules of painted portraits: the request sent to OpenRouter, the
// reply read back (both shapes), refusing what is not a picture, the models offered and benchmarked, the reservation,
// and when a painted portrait is shown in place of the photo or the drawing. No network, no database.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAX_IMAGE_BYTES,
  ReplyError,
  PORTRAIT_PROMPT,
  benchModels,
  estimateUsd,
  imageModels,
  parsePortraitReply,
  pickableImageModels,
  portraitRequest,
  sniffImage,
  toBase64,
  type RawImageModel,
} from './ai/portrait-rules.ts';
import { chooseFace, photoAge, portraitFits } from './portrait-face.ts';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const b64 = (b: Uint8Array) => toBase64(b);
const decodeB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

test('the request is OpenRouter\'s image endpoint, with the fixed prompt and the photo as a reference image', () => {
  const req = portraitRequest('openai/gpt-image-2', { mime: 'image/png', bytes: PNG });
  assert.equal(req.url, 'https://openrouter.ai/api/v1/images');
  assert.equal(req.body.model, 'openai/gpt-image-2');
  assert.equal(req.body.prompt, PORTRAIT_PROMPT);
  const refs = req.body.input_references as { type: string; image_url: { url: string } }[];
  assert.equal(refs.length, 1);
  assert.equal(refs[0]!.type, 'image_url');
  const url = refs[0]!.image_url.url;
  assert.ok(url.startsWith('data:image/png;base64,'), 'the photo goes as a data URL with its type');
  assert.deepEqual([...decodeB64(url.slice('data:image/png;base64,'.length))], [...PNG], 'the bytes sent are the photo\'s bytes');
  // The prompt keeps the likeness, the apparent age and the plain background, and asks for no text.
  assert.match(PORTRAIT_PROMPT, /Keep this exact person/);
  assert.match(PORTRAIT_PROMPT, /Keep their apparent age/);
  assert.match(PORTRAIT_PROMPT, /No text/);
});

test('an Image API reply gives its picture as bytes, with OpenRouter\'s reported cost', () => {
  const img = parsePortraitReply({ created: 1, data: [{ b64_json: b64(PNG), media_type: 'image/png' }], usage: { cost: 0.0412 } });
  assert.equal(img.mime, 'image/png');
  assert.deepEqual([...img.bytes], [...PNG]);
  assert.equal(img.costUsd, 0.0412);
});

test('a chat-style reply gives its picture from message.images as a data URL, and from content parts too', () => {
  const images = parsePortraitReply({
    choices: [{ message: { content: 'Here it is.', images: [{ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64(JPEG)}` } }] } }],
    usage: { cost: 0.07 },
  });
  assert.equal(images.mime, 'image/jpeg');
  assert.deepEqual([...images.bytes], [...JPEG]);
  assert.equal(images.costUsd, 0.07);
  const parts = parsePortraitReply({
    choices: [{ message: { content: [{ type: 'text', text: 'ok' }, { type: 'image_url', image_url: { url: `data:image/png;base64,${b64(PNG)}` } }] } }],
  });
  assert.equal(parts.mime, 'image/png');
  assert.equal(parts.costUsd, null, 'a reply that does not say what it cost is settled to the estimate, not to zero');
});

test('a reply with no picture, or with something that is not a picture, is refused and named', () => {
  const code = (fn: () => unknown) => {
    try {
      fn();
      return 'no error';
    } catch (e) {
      assert.ok(e instanceof ReplyError, 'a typed error, which the server turns into AiError bad-output (budget: may have billed)');
      return `${e.code}:${e.message}`;
    }
  };
  assert.equal(code(() => parsePortraitReply({ choices: [{ message: { content: 'I cannot paint this.' } }] })), 'bad-output:paint.err_no_image');
  assert.equal(code(() => parsePortraitReply({ data: [{ b64_json: b64(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')) }] })), 'bad-output:paint.err_not_image', 'an SVG or text is not a picture');
  assert.equal(code(() => parsePortraitReply({ data: [{ b64_json: '!!!not base64!!!' }] })), 'bad-output:paint.err_not_image');
  const big = new Uint8Array(MAX_IMAGE_BYTES + 1);
  big.set(PNG.subarray(0, 8));
  assert.equal(code(() => parsePortraitReply({ data: [{ b64_json: b64(big) }] })), 'bad-output:paint.err_too_big');
});

test('pictures are recognised by their first bytes, not by any name they are given', () => {
  assert.equal(sniffImage(PNG), 'image/png');
  assert.equal(sniffImage(JPEG), 'image/jpeg');
  assert.equal(sniffImage(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])), 'image/webp');
  assert.equal(sniffImage(new TextEncoder().encode('GIF89a')), null);
});

const RAW: RawImageModel[] = [
  { id: 'openai/gpt-image-1', created: 100, architecture: { input_modalities: ['text', 'image'], output_modalities: ['image'] }, pricing: { prompt: '0.00001', image_output: '0.00004' } },
  { id: 'openai/gpt-image-2', created: 300, architecture: { input_modalities: ['text', 'image'], output_modalities: ['image'] }, pricing: { prompt: '0.000008', image_output: '0.00003' } },
  { id: 'openai/gpt-image-1-mini', created: 200, architecture: { input_modalities: ['text', 'image'], output_modalities: ['image'] }, pricing: { image_output: '0.000008' } },
  { id: 'google/gemini-3-pro-image', created: 250, architecture: { input_modalities: ['text', 'image'], output_modalities: ['image', 'text'] }, pricing: { prompt: '0.000002', completion: '0.000012' } },
  { id: 'recraft/recraft-v4-vector', created: 400, architecture: { input_modalities: ['text', 'image'], output_modalities: ['image'] }, pricing: { image_output: '0.00001' } },
  { id: 'recraft/recraft-v4.1-flash', created: 500, architecture: { input_modalities: ['text'], output_modalities: ['image'] }, pricing: { image_output: '0.000001' } },
  { id: 'openrouter/auto', created: 600, architecture: { input_modalities: ['text', 'image'], output_modalities: ['text', 'image'] }, pricing: {} },
  { id: 'krea/krea-2-large', created: 50, architecture: { input_modalities: ['text', 'image'], output_modalities: ['image'] }, pricing: { image_output: '0.00001' } },
];

test('the settings page offers the models that take an image in and give one out, without routers', () => {
  const ids = pickableImageModels(imageModels(RAW)).map((m) => m.id);
  assert.deepEqual(ids, ['google/gemini-3-pro-image', 'krea/krea-2-large', 'openai/gpt-image-1', 'openai/gpt-image-1-mini', 'openai/gpt-image-2', 'recraft/recraft-v4-vector']);
});

test('the bake-off runs the newest two image-editing models per lab, skipping vector-only, text-only and routers', () => {
  const picked = benchModels(imageModels(RAW)).map((m) => m.id);
  // Labs in alphabetical order; within a lab, newest first.
  assert.deepEqual(picked, ['google/gemini-3-pro-image', 'krea/krea-2-large', 'openai/gpt-image-2', 'openai/gpt-image-1-mini']);
  assert.ok(!picked.some((id) => id.includes('vector') || id.startsWith('openrouter/') || id === 'recraft/recraft-v4.1-flash'));
});

test('a model\'s reservation comes from its listed prices, with a floor and no price at all', () => {
  const gpt2 = estimateUsd({ prompt: '0.000008', image_output: '0.00003' });
  assert.ok(gpt2 !== null && gpt2 > 0.2 && gpt2 < 0.25, `about 22 cents, got ${gpt2}`);
  assert.equal(estimateUsd({ prompt: '0', image_output: '0' }), 0.02, 'the floor');
  assert.equal(estimateUsd(undefined), null);
  assert.equal(estimateUsd({ image: '0.01' }), 0.02, 'a price per image is used when it is dearer than the floor');
});

test('a painted portrait is shown only near the age in its photo, and in the same era', () => {
  // Photo at 40, shown as a child: the drawing, not an adult's face.
  assert.equal(portraitFits({ born: '1950', shown: 6, photoAge: 40 }), false);
  // Shown at 42, photo at 40, same era: the portrait.
  assert.equal(portraitFits({ born: '1950', shown: 42, photoAge: 40 }), true);
  // The photo's date is unknown: an adult (35) is assumed, so 27 to 43 fits.
  assert.equal(portraitFits({ born: '1950', shown: 30, photoAge: null }), true);
  assert.equal(portraitFits({ born: '1950', shown: 50, photoAge: null }), false);
  assert.equal(portraitFits({ born: '1950', shown: 10, photoAge: null }), false);
  // No age to show (nothing dated, no birth year): the drawing.
  assert.equal(portraitFits({ born: null, shown: undefined, photoAge: null }), false);
  // Same age, different era: born 1790, photo at 10 (1800, a year of the later era), shown at 2 (1792): not shown.
  assert.equal(portraitFits({ born: '1790', shown: 2, photoAge: 10 }), false);
  assert.equal(portraitFits({ born: '1790', shown: 10, photoAge: 10 }), true);
});

test('the photo\'s age comes from its year less the birth year, when both are known', () => {
  assert.equal(photoAge('1950', 1990), 40);
  assert.equal(photoAge('1950', null), null);
  assert.equal(photoAge(null, 1990), null);
  assert.equal(photoAge('1950', 1940), null, 'a photo before the birth has no usable age');
});

test('what a person shows follows their choice, and a painting that does not fit becomes the drawing', () => {
  assert.equal(chooseFace({ shownAs: 'avatar', hasPhoto: true, hasPortrait: true, fits: true }), 'drawing');
  assert.equal(chooseFace({ shownAs: 'photo', hasPhoto: true, hasPortrait: true, fits: true }), 'photo');
  assert.equal(chooseFace({ shownAs: 'photo', hasPhoto: false, hasPortrait: true, fits: true }), 'drawing');
  assert.equal(chooseFace({ shownAs: 'portrait', hasPhoto: true, hasPortrait: true, fits: true }), 'portrait');
  assert.equal(chooseFace({ shownAs: 'portrait', hasPhoto: true, hasPortrait: true, fits: false }), 'drawing', 'a child view never shows the adult painting');
  assert.equal(chooseFace({ shownAs: 'portrait', hasPhoto: true, hasPortrait: false, fits: true }), 'drawing');
});
