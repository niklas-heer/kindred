// What the AI settings page holds, and how what is on screen compares with what is saved. Every state the page reports
// ("Ready", the privacy notes, the budget meter) is read from the saved side, so nothing claims to be on before Save is pressed.
import type { AiFeatures, AiSettingsData, CustomPrice, Feature, Provider, Route, TaskName } from '~/lib/ai/types';

export type Draft = { provider: Provider | null; model: string };

export interface FormState {
  routes: Record<Route, Draft>;
  features: AiFeatures;
  portraitEnabled: boolean;
  tasks: Record<TaskName, boolean>;
  webSearch: boolean;
  budgetUsd: number;
  customPrices: Record<string, CustomPrice>;
}

/** The background task each route's switch belongs to. */
export const TASK_OF_ROUTE: Partial<Record<Route, TaskName>> = { 'arms-review': 'arms', occupations: 'occupations', chronicle: 'chronicle', names: 'names' };

export const formOf = (data: AiSettingsData): FormState => ({
  routes: Object.fromEntries(data.routes.map((r) => [r.route, { provider: r.provider, model: r.model }])) as Record<Route, Draft>,
  features: data.features,
  portraitEnabled: data.portraitEnabled,
  tasks: data.tasks,
  webSearch: data.webSearch,
  budgetUsd: data.monthlyMicros / 1_000_000,
  customPrices: data.customPrices,
});

export function isOn(form: FormState, route: Route): boolean {
  if (route === 'portrait') return form.portraitEnabled;
  const task = TASK_OF_ROUTE[route];
  return task ? form.tasks[task] : form.features[route as Feature];
}

/** Whether a job's own row (its switch, provider or model) differs between the two. */
export function routeChanged(a: FormState, b: FormState, route: Route): boolean {
  return isOn(a, route) !== isOn(b, route)
    || a.routes[route].provider !== b.routes[route].provider
    || a.routes[route].model.trim() !== b.routes[route].model.trim();
}

const samePrices = (a: Record<string, CustomPrice>, b: Record<string, CustomPrice>) => {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => b[k] && a[k].inPerM === b[k].inPerM && a[k].outPerM === b[k].outPerM);
};

/** Whether anything Save would send differs: the rows, web search, the budget or the family's own prices. */
export function formChanged(a: FormState, b: FormState): boolean {
  return (Object.keys(a.routes) as Route[]).some((route) => routeChanged(a, b, route))
    || (Object.keys(a.features) as Feature[]).some((k) => a.features[k] !== b.features[k])
    || a.webSearch !== b.webSearch
    || a.budgetUsd !== b.budgetUsd
    || !samePrices(a.customPrices, b.customPrices);
}
