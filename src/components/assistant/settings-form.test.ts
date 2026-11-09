// node --test src/components/assistant/settings-form.test.ts — the AI settings page knows exactly what has not been saved yet.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formChanged, formOf, isOn, routeChanged, type FormState } from './settings-form.ts';
import type { AiSettingsData } from '~/lib/ai/types';

const ROUTES = ['assistant', 'arms', 'faces', 'avatar', 'portrait', 'arms-review', 'occupations', 'chronicle', 'names'] as const;
const saved = (): FormState => formOf({
  routes: ROUTES.map((route) => ({ route, provider: route === 'assistant' ? 'anthropic' : null, model: '' })),
  features: { assistant: true, arms: false, faces: false, avatar: false },
  portraitEnabled: false,
  tasks: { arms: false, occupations: false, chronicle: false, names: false },
  webSearch: false,
  monthlyMicros: 5_000_000,
  customPrices: { 'a/model': { inPerM: 1, outPerM: 2 } },
} as unknown as AiSettingsData);

test('the saved form has no changes', () => assert.equal(formChanged(saved(), saved()), false));
test('the budget reads in dollars', () => assert.equal(saved().budgetUsd, 5));

test('a switched-on job is a change on its own row only', () => {
  const now = saved();
  now.features = { ...now.features, arms: true };
  assert.equal(isOn(now, 'arms'), true);
  assert.equal(routeChanged(now, saved(), 'arms'), true);
  assert.equal(routeChanged(now, saved(), 'faces'), false);
  assert.equal(formChanged(now, saved()), true);
});

test('painting and the background tasks use their own switches', () => {
  const now = saved();
  now.portraitEnabled = true;
  now.tasks = { ...now.tasks, chronicle: true };
  assert.equal(routeChanged(now, saved(), 'portrait'), true);
  assert.equal(routeChanged(now, saved(), 'chronicle'), true);
  assert.equal(routeChanged(now, saved(), 'names'), false);
});

test('a provider or model change counts; spaces around a model do not', () => {
  const now = saved();
  now.routes = { ...now.routes, arms: { provider: 'openai', model: '' } };
  assert.equal(routeChanged(now, saved(), 'arms'), true);
  const spaced = saved();
  spaced.routes = { ...spaced.routes, assistant: { provider: 'anthropic', model: '  ' } };
  assert.equal(formChanged(spaced, saved()), false);
});

test('web search, the budget and the prices are changes too', () => {
  assert.equal(formChanged({ ...saved(), webSearch: true }, saved()), true);
  assert.equal(formChanged({ ...saved(), budgetUsd: 6 }, saved()), true);
  assert.equal(formChanged({ ...saved(), customPrices: {} }, saved()), true);
  assert.equal(formChanged({ ...saved(), customPrices: { 'a/model': { inPerM: 1, outPerM: 3 } } }, saved()), true);
});
