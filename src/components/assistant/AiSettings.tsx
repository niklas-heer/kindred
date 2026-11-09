// AI settings for one family, as guided sections: the providers (a card each: connect with its key, test, remove), "What uses
// what" (one row per job: on or off, which connected provider, which model, what it roughly costs), the monthly budget, the
// privacy notes (which provider each feature sends to), then the background tasks' schedules and the painting notes. Stewards
// only; the server checks the same (manage-access) on every call. A key is sent to the server to save or check, and never kept
// by the page: the page only ever shows a provider's last four characters.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { errorText } from '~/lib/errortext';
import { aiListModels, aiRemoveProvider, aiSaveProvider, aiSaveSettings, aiSettingsQuery, aiTestConnection, type ModelsResult } from '~/lib/ai.functions';
import { PROVIDER_NOTE } from '~/lib/ai/labels';
import { conversationsForDollar, tablePrice, type Price } from '~/lib/ai/prices';
import { RECOMMENDED_PORTRAIT, portraitModelOr, portraitPicks, recommendedFor, type Role } from '~/lib/ai/recommended';
import { DEFAULT_MODEL, PAINT_PROVIDERS, PROVIDERS, PROVIDER_LABEL, ROUTES, followsAssistant, toAiLocale, type AiFeatures, type AiSettingsData, type CustomPrice, type Feature, type ModelInfo, type Provider, type ProviderState, type Route, type TaskName } from '~/lib/ai/types';
import type { ImageModel } from '~/lib/ai/portrait-rules';
import { portraitSettingsQuery } from '~/lib/portrait.functions';
import { useTreeId } from '~/lib/family';
import { locales, translate, useT, type Key, type Locale } from '~/lib/i18n';
import { useCan } from '~/lib/session';
import { EmptyState, ErrorState, PageHeader, Range, Select, Skeleton, Switch, type SelectOption } from '~/components/ui';
import { AssistantButton } from './AssistantDrawer';
import { PortraitSettings } from './PortraitSettings';
import { formChanged, formOf, isOn, routeChanged, TASK_OF_ROUTE, type Draft, type FormState } from './settings-form';
import { BackgroundSettings } from './BackgroundSettings';
import { treeTitle } from '~/lib/title';
import './assistant.css';
import './aisettings.css';

type Drafts = Record<Route, Draft>;

const ROUTE_LABEL: Record<Route, Key> = {
  assistant: 'ai.routeAssistant', arms: 'ai.routeArms', faces: 'ai.routeFaces', avatar: 'ai.routeAvatar',
  portrait: 'ai.routePortrait', 'arms-review': 'ai.routeArmsReview', occupations: 'ai.routeOccupations', chronicle: 'ai.routeChronicle', names: 'ai.routeNames',
};
/** What each job sends, in a line. The privacy notes say which provider it goes to. */
const ROUTE_HINT: Record<Route, Key> = {
  assistant: 'ai.routeAssistantHint', arms: 'ai.routeArmsHint', faces: 'ai.routeFacesHint', avatar: 'ai.routeAvatarHint',
  portrait: 'ai.routePortraitHint', 'arms-review': 'ai.routeArmsReviewHint', occupations: 'ai.routeOccupationsHint', chronicle: 'ai.routeChronicleHint', names: 'ai.routeNamesHint',
};
/** Why a recommended painter is recommended, and the mark it carries in the model list. */
const PORTRAIT_REASON: Partial<Record<Role, Key>> = { best: 'ai.paintWhyBest', cheap: 'ai.paintWhyBudget' };
const PORTRAIT_MARK: Partial<Record<Role, Key>> = { best: 'ai.modelRecommended', cheap: 'ai.modelBudget' };
const FEATURE_HINT: Record<Feature | 'webSearch', Key> = {
  assistant: 'ai.featureAssistantHint', faces: 'ai.featureFacesHint', avatar: 'ai.featureAvatarHint', arms: 'ai.featureArmsHint', webSearch: 'ai.featureWebSearchHint',
};
const PROVIDER_BLURB: Record<Provider, Key> = { anthropic: 'ai.providerAnthropic', openai: 'ai.providerOpenai', openrouter: 'ai.providerOpenrouter' };
const KEY_PAGE: Record<Provider, string> = {
  anthropic: 'https://platform.claude.com/settings/keys',
  openai: 'https://platform.openai.com/api-keys',
  openrouter: 'https://openrouter.ai/keys',
};
/** Budget ticks in dollars, and how many model options are listed before the rest are left to the search. */
const BUDGET_TICKS = [0, 5, 20, 50, 100];
const MODEL_LIMIT = 200;
/** The most the monthly budget may be, in dollars: the server's own limit (aiSaveSettings), checked here first. */
const BUDGET_MAX_USD = 10_000;
const OTHER = '__other__';

/** A key is worth checking once it has the length of a real one; anything shorter is still being typed. */
const looksLikeKey = (s: string) => /^\S{8,400}$/.test(s.trim());

/** A failed call's line: a translated message when the server sent one, never the raw JSON of a validation error. */
const failureText = (e: unknown, locale: Locale, fallback: string) => {
  const m = e instanceof Error ? e.message : String(e ?? '');
  return !m || /^[[{]/.test(m) ? fallback : errorText(e, locale);
};

export function AiSettingsPage() {
  const tree = useTreeId();
  const t = useT();
  const steward = useCan('manage-access');
  const q = useQuery({ ...aiSettingsQuery(tree), enabled: steward });
  if (!steward) {
    return (
      <main className="page"><div className="page-inner ai-settings-page">
        <PageHeader title={t('ai.settingsTitle')} subtitle={t('ai.settingsSubtitle')} icon={<Sparkles size={22} />} />
        <EmptyState title={t('ai.stewardsOnly')} text="" />
      </div></main>
    );
  }
  return (
    <main className="page"><div className="page-inner ai-settings-page">
      <PageHeader title={t('ai.settingsTitle')} subtitle={t('ai.settingsSubtitle')} icon={<Sparkles size={22} />} />
      {q.isPending && <Skeleton lines={6} />}
      {q.isError && <ErrorState title={t('ai.settingsLoadFailed')} message={errorText(q.error, t.locale)} onRetry={() => q.refetch()} />}
      {/* Not keyed on the data's version: a save refetches the settings, and a remount would drop the "Saved." notice. */}
      {q.data && <SettingsForm tree={tree} data={q.data} />}
      {/* A way to try the assistant from here. The drawer itself is mounted once, in the tree layout. */}
      <div className="ai-actions"><AssistantButton tree={tree} /></div>
    </div></main>
  );
}

/** One provider's model list, read with its own saved key (or nothing, when it is not connected). Cached for five minutes. */
function useModels(tree: string, provider: Provider, enabled: boolean, locale: string) {
  return useQuery({
    queryKey: ['ai-models', tree, provider],
    queryFn: () => aiListModels({ data: { tree, provider, locale } }),
    enabled,
    staleTime: 5 * 60_000,
  });
}

function SettingsForm({ tree, data }: { tree: string; data: AiSettingsData }) {
  const t = useT();
  const locale = toAiLocale(t.locale);
  const qc = useQueryClient();
  const number = (n: number, digits = 0) => n.toLocaleString(locales[locale], { maximumFractionDigits: digits });
  const money = (usd: number, digits = 2) => new Intl.NumberFormat(locales[locale], { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: digits }).format(usd);

  const connected = (p: Provider) => data.providers.find((x) => x.provider === p)?.keyState === 'saved';
  const lists: Record<Provider, ReturnType<typeof useModels>> = {
    anthropic: useModels(tree, 'anthropic', connected('anthropic'), t.locale),
    openai: useModels(tree, 'openai', connected('openai'), t.locale),
    openrouter: useModels(tree, 'openrouter', connected('openrouter'), t.locale),
  };
  const painting = useQuery({ ...portraitSettingsQuery(tree) });
  const choices: ImageModel[] = painting.data?.choices ?? [];

  const [drafts, setDrafts] = useState<Drafts>(() => Object.fromEntries(data.routes.map((r) => [r.route, { provider: r.provider, model: r.model }])) as Drafts);
  const [features, setFeatures] = useState<AiFeatures>(data.features);
  const [portraitOn, setPortraitOn] = useState(data.portraitEnabled);
  const [tasks, setTasks] = useState(data.tasks);
  const [webSearch, setWebSearch] = useState(data.webSearch);
  const [budgetUsd, setBudgetUsd] = useState(data.monthlyMicros / 1_000_000);
  const [customPrices, setCustomPrices] = useState<Record<string, CustomPrice>>(data.customPrices);
  const [otherOpen, setOtherOpen] = useState<Partial<Record<Route, boolean>>>({});
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  // ---------- what is on screen, and what is saved ----------
  const form: FormState = { routes: drafts, features, portraitEnabled: portraitOn, tasks, webSearch, budgetUsd, customPrices };
  const saved = useMemo(() => formOf(data), [data]);
  const dirty = formChanged(form, saved);
  const latest = useRef(form);
  latest.current = form;
  const load = (next: FormState) => {
    setDrafts(next.routes);
    setFeatures(next.features);
    setPortraitOn(next.portraitEnabled);
    setTasks(next.tasks);
    setWebSearch(next.webSearch);
    setBudgetUsd(next.budgetUsd);
    setCustomPrices(next.customPrices);
    setPriceText({});
    setOtherOpen({});
  };
  // "Saved." has done its job after a moment; a failure stays until the next try.
  useEffect(() => {
    if (!notice?.ok) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  // ---------- what each job resolves to, in a given state of the form (the server checks the same on save) ----------
  const effectiveIn = (state: FormState, route: Route): { provider: Provider; model: string } | null => {
    const d = state.routes[route];
    if (route === 'assistant') return d.provider ? { provider: d.provider, model: d.model.trim() || DEFAULT_MODEL[d.provider] } : null;
    if (d.provider) return { provider: d.provider, model: route === 'portrait' ? portraitModelOr(d.model, choices) : d.model.trim() || DEFAULT_MODEL[d.provider] };
    if (followsAssistant(route)) return effectiveIn(state, 'assistant');
    return null;
  };
  const effective = (route: Route) => effectiveIn(form, route);
  const switchedOn = (route: Route) => isOn(form, route);
  const stateIn = (state: FormState, route: Route): 'off' | 'ready' | 'needs-provider' | 'needs-model' => {
    if (!isOn(state, route)) return 'off';
    const e = effectiveIn(state, route);
    if (!e || !connected(e.provider)) return 'needs-provider';
    if (route === 'portrait' && !e.model) return 'needs-model';
    return 'ready';
  };
  /** A row reports what is saved. A row with a change waiting says so, unless the change cannot work as it stands. */
  const stateOf = (route: Route): 'off' | 'ready' | 'needs-provider' | 'needs-model' | 'unsaved' => {
    if (!routeChanged(form, saved, route)) return stateIn(saved, route);
    const now = stateIn(form, route);
    return now === 'needs-provider' || now === 'needs-model' ? now : 'unsaved';
  };
  const setDraft = (route: Route, next: Partial<Draft>) => setDrafts((cur) => ({ ...cur, [route]: { ...cur[route], ...next } }));

  /** Price per 1M tokens: the steward's own first (the server books it first too), then the table, then the provider's list. */
  const priceOf = (p: Provider, model: string): Price | null => {
    const mine = customPrices[model];
    if (mine) return { ...mine, searchEach: 0.01 };
    const table = tablePrice(p, model);
    if (table) return table;
    const info = (lists[p].data?.ok ? lists[p].data.models : []).find((m) => m.id === model);
    if (info && info.inPerM != null && info.outPerM != null) return { inPerM: info.inPerM, outPerM: info.outPerM, searchEach: info.searchEach ?? 0.01 };
    return null;
  };
  const setCustom = (model: string, inText: string, outText: string) => {
    const i = Number(inText);
    const o = Number(outText);
    setCustomPrices((cur) => {
      const next = { ...cur };
      if (inText.trim() !== '' && outText.trim() !== '' && Number.isFinite(i) && Number.isFinite(o) && i >= 0 && o >= 0) next[model] = { inPerM: i, outPerM: o };
      else delete next[model];
      return next;
    });
  };
  const draftPrice = (model: string, which: 'inPerM' | 'outPerM') => (customPrices[model] ? String(customPrices[model][which]) : '');
  const [priceText, setPriceText] = useState<Record<string, { i: string; o: string }>>({});

  // ---------- providers: connect, test, remove ----------
  const [keyDrafts, setKeyDrafts] = useState<Partial<Record<Provider, string>>>({});
  const [cardNotice, setCardNotice] = useState<Partial<Record<Provider, { ok: boolean; text: string }>>>({});
  const [busy, setBusy] = useState<Provider | null>(null);
  const refreshAll = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['ai-settings', tree] }),
      qc.invalidateQueries({ queryKey: ['ai-status', tree] }),
      qc.invalidateQueries({ queryKey: ['portrait-settings', tree] }),
    ]);
  };
  const connect = useMutation({
    mutationFn: (p: Provider) => aiSaveProvider({ data: { tree, provider: p, apiKey: (keyDrafts[p] ?? '').trim(), locale } }),
    onSuccess: async (_r, p) => {
      setKeyDrafts((cur) => ({ ...cur, [p]: '' }));
      setCardNotice((cur) => ({ ...cur, [p]: { ok: true, text: t('ai.providerSaved') } }));
      await Promise.all([refreshAll(), qc.invalidateQueries({ queryKey: ['ai-models', tree, p] })]);
    },
    onError: (e, p) => setCardNotice((cur) => ({ ...cur, [p]: { ok: false, text: failureText(e, t.locale, t('ai.saveInvalid')) } })),
  });
  const remove = useMutation({
    mutationFn: (p: Provider) => aiRemoveProvider({ data: { tree, provider: p } }),
    onSuccess: async (_r, p) => {
      setCardNotice((cur) => ({ ...cur, [p]: { ok: true, text: t('ai.providerRemoved') } }));
      await refreshAll();
    },
    onError: (e, p) => setCardNotice((cur) => ({ ...cur, [p]: { ok: false, text: failureText(e, t.locale, t('ai.saveInvalid')) } })),
  });
  async function test(p: Provider) {
    setBusy(p);
    setCardNotice((cur) => ({ ...cur, [p]: undefined }));
    const typed = (keyDrafts[p] ?? '').trim();
    const model = effectiveFor(p);
    try {
      const r = await aiTestConnection({ data: { tree, provider: p, model, apiKey: looksLikeKey(typed) ? typed : undefined, locale } });
      if (r.ok) setCardNotice((cur) => ({ ...cur, [p]: { ok: true, text: t('ai.testOk', { provider: PROVIDER_LABEL[p], model: r.model, ms: r.ms }) } }));
      else setCardNotice((cur) => ({ ...cur, [p]: { ok: false, text: failureText(r.message, t.locale, t('ai.keyErrOther')) } }));
    } catch (e) {
      setCardNotice((cur) => ({ ...cur, [p]: { ok: false, text: failureText(e, t.locale, t('ai.keyErrOther')) } }));
    } finally {
      setBusy(null);
    }
  }
  /** The model a test uses: the provider's default, or the model a job already uses with it. */
  // The steps that search the web, each with its own route's provider: the assistant, arms research and name research.
  const webSearchVars = (() => {
    const of = (route: Route) => PROVIDER_NOTE[effectiveIn(saved, route)?.provider ?? 'anthropic'];
    const searchers = [...new Set((['assistant', 'arms', 'names'] as const).map(of))];
    return { provider: of('arms'), searchers: new Intl.ListFormat(t.locale, { style: 'long', type: 'conjunction' }).format(searchers) };
  })();
  const effectiveFor = (p: Provider): string => ROUTES.map((r) => effective(r)).find((e) => e?.provider === p)?.model || DEFAULT_MODEL[p];

  // ---------- save ----------
  const sent = useRef(form);
  const save = useMutation({
    mutationFn: () => { sent.current = form; return aiSaveSettings({
      data: {
        tree,
        // A job with no provider chosen that cannot follow the assistant (the assistant itself, painting) is not set yet:
        // it is left out, so a family that uses only some jobs can still save the rest.
        routes: ROUTES.filter((route) => drafts[route].provider !== null || followsAssistant(route)).map((route) => {
          const d = drafts[route];
          // A portrait route with no model yet takes the default here, so a saved choice is never replaced.
          return { route, provider: d.provider, model: !d.provider ? '' : route === 'portrait' ? portraitModelOr(d.model, choices) : d.model.trim() };
        }),
        features,
        webSearch,
        monthlyUsd: budgetUsd,
        customPrices,
        portraitEnabled: portraitOn,
        tasks,
        locale,
      },
    }); },
    onSuccess: async () => {
      setNotice({ ok: true, text: t('ai.saved') });
      await Promise.all([refreshAll(), qc.invalidateQueries({ queryKey: ['ai-activity', tree] })]);
      // The page now shows what the server kept, unless the steward has already changed something else while it saved.
      const stored = qc.getQueryState<AiSettingsData>(aiSettingsQuery(tree).queryKey);
      if (stored?.status === 'success' && stored.data && !formChanged(latest.current, sent.current)) load(formOf(stored.data));
    },
    onError: (e) => setNotice({ ok: false, text: failureText(e, t.locale, t('ai.saveInvalid')) }),
  });

  // ---------- the routing table ----------
  const providerName = (p: Provider) => PROVIDER_LABEL[p];
  const modelOptions = (route: Route, p: Provider): SelectOption[] => {
    const isPaint = route === 'portrait';
    const current = drafts[route].model.trim();
    const opts: SelectOption[] = [];
    if (isPaint) {
      const picks = portraitPicks(choices);
      for (const r of picks) {
        const m = choices.find((x) => x.id === r.model)!;
        opts.push({ value: m.id, label: `${m.name} · ${m.labName}`, group: t('ai.modelRecommended'), hint: `${t(PORTRAIT_MARK[r.role]!)} · ${t('ai.costImage', { usd: money(r.usd, 3) })}` });
      }
      for (const m of choices.filter((x) => !picks.some((r) => r.model === x.id))) {
        opts.push({ value: m.id, label: `${m.name} · ${m.labName}`, group: picks.length ? t('ai.modelAll') : undefined, hint: t('ai.costImage', { usd: money(m.priceUsd ?? 0) }) });
      }
    } else {
      opts.push({ value: '', label: t('ai.modelDefault', { model: DEFAULT_MODEL[p] }) });
      const listing: ModelsResult | undefined = lists[p].data;
      const list: ModelInfo[] = listing?.ok ? listing.models : [];
      const rec = recommendedFor(p);
      const recIds = new Set(rec.map((r) => r.model));
      for (const r of rec) {
        const info = list.find((m) => m.id === r.model);
        opts.push({ value: r.model, label: info?.name ?? r.model, group: t('ai.modelRecommended'), hint: priceLabel(p, r.model) });
      }
      for (const m of list.filter((x) => !recIds.has(x.id)).slice(0, MODEL_LIMIT)) {
        opts.push({ value: m.id, label: m.name, group: t('ai.modelAll'), hint: priceLabel(p, m.id) });
      }
    }
    if (current && !opts.some((o) => o.value === current)) opts.push({ value: current, label: current });
    opts.push({ value: OTHER, label: t('ai.modelOther') });
    return opts;
  };
  const priceLabel = (p: Provider, model: string): string | undefined => {
    const pr = priceOf(p, model);
    return pr ? t('ai.priceLine', { input: money(pr.inPerM), output: money(pr.outPerM) }) : undefined;
  };
  const providerOptions = (route: Route): SelectOption[] => {
    const allowed = route === 'portrait' ? PAINT_PROVIDERS : PROVIDERS;
    const opts: SelectOption[] = [];
    if (followsAssistant(route)) opts.push({ value: '', label: t('ai.sameAsAssistant') });
    else opts.push({ value: '', label: t('ai.chooseProvider') });
    for (const p of allowed) {
      opts.push({ value: p, label: providerName(p), hint: connected(p) ? t('ai.providerConnected') : t('ai.providerNotConnected'), disabled: !connected(p) });
    }
    return opts;
  };
  const costCell = (route: Route, e: { provider: Provider; model: string } | null) => {
    if (!e) return null;
    if (route === 'portrait') {
      const m = choices.find((x) => x.id === e.model);
      const measured = RECOMMENDED_PORTRAIT.find((r) => r.model === e.model)?.usd;
      return m ? <span className="ai-model-estimate">{t('ai.costImage', { usd: measured !== undefined ? money(measured, 3) : money(m.priceUsd ?? 0) })}</span> : null;
    }
    const pr = priceOf(e.provider, e.model);
    if (!pr) {
      const text = priceText[e.model] ?? { i: draftPrice(e.model, 'inPerM'), o: draftPrice(e.model, 'outPerM') };
      return (
        <span className="ai-cost-unknown">
          <span className="ai-model-price unknown">{t('ai.priceUnknown')}</span>
          <span className="ai-custom-grid">
            <label>
              {t('ai.customIn')}
              <input className="input" inputMode="decimal" value={text.i} aria-label={t('ai.customIn')} onChange={(ev) => { setPriceText((cur) => ({ ...cur, [e.model]: { i: ev.target.value, o: text.o } })); setCustom(e.model, ev.target.value, text.o); }} />
            </label>
            <label>
              {t('ai.customOut')}
              <input className="input" inputMode="decimal" value={text.o} aria-label={t('ai.customOut')} onChange={(ev) => { setPriceText((cur) => ({ ...cur, [e.model]: { i: text.i, o: ev.target.value } })); setCustom(e.model, text.i, ev.target.value); }} />
            </label>
          </span>
          <span className="ai-model-estimate subtle">{t('ai.costHintUnknown')}</span>
        </span>
      );
    }
    const per = conversationsForDollar(pr);
    return <span className="ai-model-estimate">{t('ai.estimate', { n: number(per) })}</span>;
  };

  const stateChip = (route: Route) => {
    const s = stateOf(route);
    const label = s === 'off' ? t('ai.stateOff') : s === 'ready' ? t('ai.stateReady') : s === 'unsaved' ? t('ai.stateUnsaved') : s === 'needs-provider' ? t('ai.stateNeedsProvider') : t('ai.stateNeedsModel');
    return <span className={`ai-state ${s}`}>{label}</span>;
  };

  const row = (route: Route) => {
    const d = drafts[route];
    const e = effective(route);
    const task = TASK_OF_ROUTE[route];
    const on = switchedOn(route);
    const toggle = (v: boolean) => {
      if (route === 'portrait') setPortraitOn(v);
      else if (task) setTasks((cur) => ({ ...cur, [task]: v }));
      else setFeatures((cur) => ({ ...cur, [route]: v }));
    };
    const followsOnly = followsAssistant(route) && d.provider === null;
    const options = modelOptions(route, d.provider ?? 'anthropic');
    const modelValue = otherOpen[route] ? OTHER : route === 'portrait' && d.provider ? portraitModelOr(d.model, choices) : d.model.trim();
    const pick = route === 'portrait' && d.provider ? portraitPicks(choices).find((r) => r.model === modelValue) : undefined;
    return (
      <tr key={route} className={`ai-route ${on ? '' : 'is-off'}`} data-route={route}>
        <td className="ai-route-job" data-label={t('ai.routeColJob')}>
          <Switch checked={on} onChange={toggle}>{t(ROUTE_LABEL[route])}</Switch>
          <p className="ai-feature-hint subtle">{t(ROUTE_HINT[route])}</p>
          {stateChip(route)}
        </td>
        <td data-label={t('ai.routeColProvider')}>
          <Select
            value={d.provider ?? ''}
            onChange={(v) => { setDraft(route, { provider: (v || null) as Provider | null, model: '' }); setOtherOpen((cur) => ({ ...cur, [route]: false })); }}
            options={providerOptions(route)}
            aria-label={`${t(ROUTE_LABEL[route])}: ${t('ai.routeColProvider')}`}
            size="sm"
          />
        </td>
        <td data-label={t('ai.routeColModel')} className="ai-route-model">
          {followsOnly
            ? <span className="subtle">{t('ai.followsAssistant', { model: e?.model ?? '' })}</span>
            : (
              <>
                <Select
                  value={modelValue}
                  onChange={(v) => {
                    if (v === OTHER) setOtherOpen((cur) => ({ ...cur, [route]: true }));
                    else { setOtherOpen((cur) => ({ ...cur, [route]: false })); setDraft(route, { model: v }); }
                  }}
                  options={options}
                  aria-label={`${t(ROUTE_LABEL[route])}: ${t('ai.routeColModel')}`}
                  size="sm"
                />
                {pick && PORTRAIT_REASON[pick.role] && <p className="ai-route-reason subtle">{t(PORTRAIT_REASON[pick.role]!)}</p>}
                {otherOpen[route] && (
                  <input
                    className="input ai-route-custom"
                    value={d.model}
                    placeholder={t('ai.modelIdPlaceholder')}
                    aria-label={`${t(ROUTE_LABEL[route])}: ${t('ai.model')}`}
                    spellCheck={false}
                    autoComplete="off"
                    onChange={(ev) => setDraft(route, { model: ev.target.value })}
                  />
                )}
              </>
            )}
        </td>
        <td data-label={t('ai.routeColCost')} className="ai-route-cost">
          {on && e ? costCell(route, e) : <span className="subtle">{t('ai.routeNoCost')}</span>}
        </td>
      </tr>
    );
  };

  // ---------- budget ----------
  const overBudget = budgetUsd > BUDGET_MAX_USD;
  const spentUsd = data.spentMicros / 1_000_000;
  const pct = saved.budgetUsd > 0 ? Math.min(100, (spentUsd / saved.budgetUsd) * 100) : spentUsd > 0 ? 100 : 0;
  const resets = new Date(`${data.resetsOn}T00:00:00Z`).toLocaleDateString(locales[locale], { day: 'numeric', month: 'long', timeZone: 'UTC' });

  // ---------- privacy: which provider each feature goes to ----------
  const privacyLine = (route: Route) => {
    const on = isOn(saved, route);
    const feature = t(ROUTE_LABEL[route]);
    if (!on) return t('ai.privacyOff', { feature });
    const e = effectiveIn(saved, route);
    if (!e || !connected(e.provider) || (route === 'portrait' && !e.model)) return t('ai.privacyNeedsProvider', { feature });
    return t('ai.privacyUse', { feature, provider: PROVIDER_LABEL[e.provider], model: e.model || DEFAULT_MODEL[e.provider], what: t(ROUTE_HINT[route]) });
  };

  const cardFor = (p: Provider, s: ProviderState) => {
    const draft = keyDrafts[p] ?? '';
    const valid = looksLikeKey(draft);
    const n = cardNotice[p];
    const status = s.keyState === 'saved' ? 'ok' : s.keyState === 'unreadable' ? 'bad' : '';
    return (
      <section key={p} className="ui-card ai-provider-card" data-connected={s.keyState === 'saved' || undefined} aria-labelledby={`ai-provider-${p}`}>
        <div className="ai-provider-head">
          <h3 id={`ai-provider-${p}`} className="ai-provider-name">{PROVIDER_LABEL[p]}</h3>
          <span className={`ai-state ${status || 'off'}`}>
            {s.keyState === 'saved' ? t('ai.providerConnected') : s.keyState === 'unreadable' ? t('ai.providerUnreadable') : t('ai.providerNotConnected')}
          </span>
        </div>
        <p className="subtle ai-provider-blurb">{t(PROVIDER_BLURB[p])}</p>
        {s.keyState === 'saved' && <p className="ai-key-masked">{t('ai.keyMasked', { tail: s.keyTail ?? '' })}</p>}
        <label htmlFor={`ai-key-${p}`} className="ai-label">{s.keyState === 'saved' ? t('ai.providerKeyReplace') : t('ai.apiKey')}</label>
        <input
          id={`ai-key-${p}`}
          className="input ai-key-input"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={draft}
          placeholder={s.keyState === 'saved' ? t('ai.providerKeyReplaceHint') : t('ai.apiKeyNew')}
          onChange={(e) => setKeyDrafts((cur) => ({ ...cur, [p]: e.target.value }))}
        />
        <div className="ai-key-row">
          <button type="button" className="btn primary" disabled={!valid || connect.isPending} onClick={() => connect.mutate(p)}>
            {s.keyState === 'saved' ? t('ai.providerReplace') : t('ai.providerSave')}
          </button>
          <button type="button" className="btn" disabled={busy === p || (!valid && s.keyState !== 'saved')} onClick={() => test(p)}>
            {busy === p ? t('ai.testing') : t('ai.test')}
          </button>
          {s.keyState !== 'none' && (
            <button type="button" className="btn ghost" disabled={remove.isPending} onClick={() => remove.mutate(p)}>{t('ai.providerRemove')}</button>
          )}
          <a className="ai-provider-key" href={KEY_PAGE[p]} target="_blank" rel="noreferrer">{t('ai.getKey')} ↗</a>
        </div>
        {draft.trim() && !valid && <p className="subtle">{t('ai.keyTypeHint')}</p>}
        {n && <p className={n.ok ? 'ai-card-state ok' : 'ai-card-error'} role={n.ok ? 'status' : 'alert'}>{n.text}</p>}
      </section>
    );
  };

  return (
    <div className="ai-settings">
      {/* 1 · Providers */}
      <section className="ai-step" aria-labelledby="ai-step-providers">
        <h2 id="ai-step-providers" className="rule ai-step-title">{t('ai.stepProviders')}</h2>
        <p className="subtle">{t('ai.providersHint')}</p>
        <div className="ai-provider-grid">
          {PROVIDERS.map((p) => cardFor(p, data.providers.find((x) => x.provider === p) ?? { provider: p, keyState: 'none', keyTail: null, updated: 0 }))}
        </div>
      </section>

      {/* 2 · What uses what */}
      <section className="ui-card ai-step" aria-labelledby="ai-step-routing">
        <h2 id="ai-step-routing" className="rule ai-step-title">{t('ai.stepRouting')}</h2>
        <p className="subtle">{t('ai.routingHint')}</p>
        <div className="ai-routes-wrap">
          <table className="ai-routes">
            <thead>
              <tr>
                <th scope="col">{t('ai.routeColJob')}</th>
                <th scope="col">{t('ai.routeColProvider')}</th>
                <th scope="col">{t('ai.routeColModel')}</th>
                <th scope="col">{t('ai.routeColCost')}</th>
              </tr>
            </thead>
            <tbody>
              {ROUTES.map((r) => row(r))}
            </tbody>
          </table>
        </div>
        <div className="ai-feature">
          <Switch checked={webSearch} onChange={setWebSearch} disabled={!webSearch && !(connected('anthropic') || connected('openai') || connected('openrouter'))}>
            {t('ai.featureWebSearch')}
          </Switch>
          <p className="ai-feature-hint subtle">{t(FEATURE_HINT.webSearch, webSearchVars)}</p>
        </div>
      </section>

      {/* 3 · Monthly budget */}
      <section className="ui-card ai-step" aria-labelledby="ai-step-budget">
        <h2 id="ai-step-budget" className="rule ai-step-title">{t('ai.stepBudget')}</h2>
        <div className="ai-budget-head">
          <label htmlFor="ai-budget-usd" className="ai-label">{t('ai.budget')}</label>
          <input
            id="ai-budget-usd"
            className="input ai-budget-input"
            type="number"
            inputMode="decimal"
            min={0}
            max={BUDGET_MAX_USD}
            step={0.5}
            value={budgetUsd}
            aria-invalid={overBudget || undefined}
            aria-describedby={overBudget ? 'ai-budget-max' : undefined}
            onChange={(e) => setBudgetUsd(Math.max(0, Number(e.target.value) || 0))}
          />
        </div>
        {overBudget && <p id="ai-budget-max" className="ai-key-status bad" role="alert">{t('ai.budgetTooHigh', { max: money(BUDGET_MAX_USD, 0) })}</p>}
        <Range
          value={Math.min(budgetUsd, 100)}
          onChange={setBudgetUsd}
          min={0}
          max={100}
          step={1}
          ticks={BUDGET_TICKS.map((v) => ({ value: v, label: v === 0 ? t('ai.budgetOff') : money(v, 0) }))}
          format={(v) => t('ai.budgetValue', { amount: money(v) })}
          aria-label={t('ai.budget')}
          className="ai-budget-range"
        />
        <p className="subtle">{t('ai.budgetHint')}</p>
        <div
          className="ai-meter"
          role="meter"
          aria-label={t('ai.budget')}
          aria-valuemin={0}
          aria-valuemax={Math.max(saved.budgetUsd, spentUsd, 0.01)}
          aria-valuenow={spentUsd}
          aria-valuetext={t('ai.budgetSpent', { spent: money(spentUsd), limit: money(saved.budgetUsd) })}
        >
          <span style={{ width: `${pct}%` }} />
        </div>
        <p className="ai-usage">
          {t('ai.budgetSpent', { spent: money(spentUsd), limit: money(saved.budgetUsd) })}
          {' · '}
          {t('ai.budgetResets', { date: resets })}
        </p>
      </section>

      {/* 4 · Privacy: each feature, and the provider it goes to */}
      <section className="ui-card ai-step" aria-labelledby="ai-privacy-h">
        <h2 id="ai-privacy-h" className="rule ai-step-title">{t('ai.privacyTitle')}</h2>
        <ul className="ai-privacy-list">
          {ROUTES.map((r) => <li key={r} className="ai-privacy">{privacyLine(r)}</li>)}
        </ul>
        <p className="ai-privacy">{t('ai.privacyEditors', { provider: PROVIDER_LABEL[effectiveIn(saved, 'assistant')?.provider ?? 'anthropic'] })}</p>
      </section>

      <BackgroundSettings tree={tree} />
      <PortraitSettings tree={tree} />

      {(dirty || save.isPending || notice) && (
        <div className="ai-savebar" role="group" aria-label={t('edit.barLabel')}>
          {notice && !notice.ok && !save.isPending
            ? <p className="ai-savebar-status ai-card-error" role="alert">{notice.text}</p>
            : <p className="ai-savebar-status" role="status">{save.isPending ? t('ai.saving') : dirty ? (overBudget ? t('ai.budgetTooHigh', { max: money(BUDGET_MAX_USD, 0) }) : t('draft.unsaved')) : notice?.text}</p>}
          {(dirty || save.isPending) && (
            <>
              <button type="button" className="btn" onClick={() => { load(saved); setNotice(null); }} disabled={save.isPending}>{t('common.cancel')}</button>
              <button type="button" className="btn primary" onClick={() => { setNotice(null); save.mutate(); }} disabled={save.isPending || overBudget}>{t('ai.save')}</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** The settings page title, in the reader's language. */
export const aiSettingsHead = (ctx: Parameters<typeof treeTitle>[0]) => ({ meta: [{ title: treeTitle(ctx, translate((ctx.match.context as { locale?: Locale }).locale ?? 'en', 'ai.settings_title')) }] });
