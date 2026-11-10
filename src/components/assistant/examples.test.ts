// node --test src/components/assistant/examples.test.ts — which example prompts an empty chat offers.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chatExamples } from './examples.ts';

const none = { viewed: undefined, me: null, canDraft: false, canPhotos: false, canPropose: false, canHouse: false, avatars: false };
const keys = (o: Parameters<typeof chatExamples>[0]) => chatExamples(o).map((e) => e.key);

test('a viewer on a page of no one gets the plain questions', () => {
  assert.deepEqual(keys(none), ['chat.start.birthdays', 'ai.exPhotos', 'ai.exMissing', 'ai.exRelated']);
});

test("on a person's page the questions are about them, and the family session is among the first four", () => {
  const got = chatExamples({ ...none, viewed: { id: 'p', name: 'Ada Vale' }, me: 'me', canDraft: true });
  assert.deepEqual(got.slice(0, 4).map((e) => e.key), ['chat.start.who', 'chat.start.family', 'ai.exFamily', 'chat.start.timeline']);
  assert.equal(got[2].open, true);
  assert.equal(got[0].name, 'Ada Vale');
  assert.ok(got.some((e) => e.key === 'chat.start.relation'));
  // On the reader's own page there is no "how are we related".
  assert.ok(!keys({ ...none, viewed: { id: 'me', name: 'Me' }, me: 'me' }).includes('chat.start.relation'));
  assert.ok(!keys({ ...none, viewed: { id: 'p', name: 'Ada' } }).includes('chat.start.relation'));
});

test('albums, avatars and houses wait for the roles and features they need', () => {
  const all = keys({ ...none, canPhotos: true, canPropose: true, avatars: true, canHouse: true });
  assert.deepEqual(all.slice(-3), ['ai.exAlbum', 'ai.exAvatar', 'ai.exHouse']);
  assert.ok(!keys({ ...none, canPropose: true }).includes('ai.exAvatar'));
  assert.ok(!keys({ ...none, avatars: true }).includes('ai.exAvatar'));
});
