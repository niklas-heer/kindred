// The AI settings page, on the server: what it shows (AiSettingsData) and what one save changes. The rules live in the modules
// it calls (providers for keys and routes, settings for the switches and budget, background and portrait for their own
// switches). This file puts them in order, and checks every switch that is turned on against the route it will use before
// anything is written, so a refused save changes nothing.
import { AiError } from './adapters';
import { projectedConnected, providerStates, resolveRoutes, type RouteInput } from './providers.server';
import { readSettings, saveSettings, spentThisMonth, resetsOn } from './settings.server';
import { readBackground, setTaskEnabled } from './background.server';
import { checkPaintModel, readPortraitSettings, setPortraitEnabled } from './portrait.server';
import { PAINT_PROVIDERS, ROUTES, TASK_ROUTE, type AiFeatures, type AiSettingsData, type CustomPrice, type Route, type RouteState, type TaskName } from './types';

/** What the page sends for one save: every route, every switch, the budget and the prices. */
export interface PageSave {
  features: AiFeatures;
  webSearch: boolean;
  monthlyMicros: number;
  customPrices: Record<string, CustomPrice>;
  routes: RouteInput[];
  portraitEnabled: boolean;
  tasks: Record<TaskName, boolean>;
}

/** The settings page's data. Never a key: each provider shows only its state and last four characters. */
export async function settingsPage(tree: string): Promise<AiSettingsData> {
  const [s, providers, routes, bg, portrait] = await Promise.all([
    readSettings(tree),
    providerStates(tree),
    resolveRoutes(tree),
    readBackground(tree),
    readPortraitSettings(tree),
  ]);
  const tasks = { arms: bg.tasks.arms.enabled, occupations: bg.tasks.occupations.enabled, chronicle: bg.tasks.chronicle.enabled };
  const switched: Record<Route, boolean> = {
    assistant: s.features.assistant,
    arms: s.features.arms,
    faces: s.features.faces,
    avatar: s.features.avatar,
    portrait: portrait.enabled,
    'arms-review': tasks.arms,
    occupations: tasks.occupations,
    chronicle: tasks.chronicle,
  };
  const rows: RouteState[] = ROUTES.map((route) => {
    const r = routes[route];
    const state: RouteState['state'] = !switched[route] ? 'off' : !r.effective || !r.connected ? 'needs-provider' : r.needsModel ? 'needs-model' : 'ready';
    return { route, provider: r.provider, model: r.model, effective: r.effective, state };
  });
  return {
    providers,
    routes: rows,
    features: s.features,
    portraitEnabled: portrait.enabled,
    tasks,
    webSearch: s.webSearch,
    monthlyMicros: s.monthlyMicros,
    spentMicros: await spentThisMonth(tree),
    resetsOn: resetsOn(),
    customPrices: s.customPrices,
    updated: s.updated,
  };
}

/**
 * Saves the page. Every switch that is turned on must have a route that runs once the save is applied; the portrait's model
 * must be one the painter lists. All of that is checked first, then the routes and the family's settings, then the portrait
 * and task switches.
 */
export async function saveSettingsPage(tree: string, by: string, input: PageSave): Promise<void> {
  const [bg, portrait, routes] = await Promise.all([readBackground(tree), readPortraitSettings(tree), resolveRoutes(tree)]);
  const portraitInput = input.routes.find((r) => r.route === 'portrait');
  if (portraitInput) await checkPaintModel(portraitInput.model);

  // Checks, before anything is written.
  for (const task of Object.keys(TASK_ROUTE) as TaskName[]) {
    if (input.tasks[task] && !bg.tasks[task].enabled && !(await projectedConnected(tree, TASK_ROUTE[task], input.routes))) {
      throw new AiError('not-configured', 'ai.needsKey');
    }
  }
  if (input.portraitEnabled && !portrait.enabled) {
    const provider = portraitInput ? portraitInput.provider : routes.portrait.effective?.provider ?? null;
    const model = portraitInput ? portraitInput.model : routes.portrait.effective?.model ?? '';
    if (!provider || !(PAINT_PROVIDERS as readonly string[]).includes(provider) || !(await projectedConnected(tree, 'portrait', input.routes))) {
      throw new AiError('not-configured', 'paint.err_no_key');
    }
    if (!model) throw new AiError('bad-input', 'paint.err_model_needed');
  }

  // Writes: the routes and the family's switches (features, budget, web search, prices) first; each of them checks its own switch.
  await saveSettings(tree, by, {
    features: input.features,
    webSearch: input.webSearch,
    monthlyMicros: input.monthlyMicros,
    customPrices: input.customPrices,
    routes: input.routes,
  });
  await setPortraitEnabled(tree, by, input.portraitEnabled);
  for (const task of Object.keys(TASK_ROUTE) as TaskName[]) {
    if (input.tasks[task] !== bg.tasks[task].enabled) await setTaskEnabled(tree, task, input.tasks[task]);
  }
}
