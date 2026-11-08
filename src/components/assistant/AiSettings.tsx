// AI settings for one family, as five guided steps: the provider (cards, each with a link to its key page), the API
// key (checked as soon as it is typed; the saved one is shown masked), the model (a searchable list from the provider,
// recommended first, with prices and capabilities), the features (one switch each, web search included), and the
// monthly budget in dollars with this month's spend. Stewards only; the server checks the same (manage-access) on
// every call. Keys are sent to the server to check or save, never kept by the page.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { errorText } from '~/lib/errortext';
import { aiListModels, aiSaveSettings, aiSettingsQuery, aiTestConnection, type ModelsResult } from '~/lib/ai.functions';
import { PROVIDER_NOTE } from '~/lib/ai/labels';
import { conversationsForDollar, tablePrice, type Price } from '~/lib/ai/prices';
import { recommendedFor, type Role } from '~/lib/ai/recommended';
import { DEFAULT_MODEL, FEATURES, PROVIDERS, PROVIDER_LABEL, toAiLocale, type AiFeatures, type AiSettingsData, type CustomPrice, type Feature, type ModelInfo, type Provider } from '~/lib/ai/types';
import { useTreeId } from '~/lib/family';
import { locales, translate, useT, type Key, type Locale } from '~/lib/i18n';
import { useCan } from '~/lib/session';
import { EmptyState, ErrorState, PageHeader, Range, Skeleton, Switch } from '~/components/ui';
import { AssistantButton } from './AssistantDrawer';
import { PortraitSettings } from './PortraitSettings';
import { BackgroundSettings } from './BackgroundSettings';
import { treeTitle } from '~/lib/title';
import './assistant.css';
import './aisettings.css';

const FEATURE_LABEL: Record<Feature | 'webSearch', Key> = {
  assistant: 'ai.featureAssistant', faces: 'ai.featureFaces', avatar: 'ai.featureAvatar', arms: 'ai.featureArms', webSearch: 'ai.featureWebSearch',
};
const FEATURE_HINT: Record<Feature | 'webSearch', Key> = {
  assistant: 'ai.featureAssistantHint', faces: 'ai.featureFacesHint', avatar: 'ai.featureAvatarHint', arms: 'ai.featureArmsHint', webSearch: 'ai.featureWebSearchHint',
};
const PROVIDER_BLURB: Record<Provider, Key> = { anthropic: 'ai.providerAnthropic', openai: 'ai.providerOpenai', openrouter: 'ai.providerOpenrouter' };
const KEY_PAGE: Record<Provider, string> = {
  anthropic: 'https://platform.claude.com/settings/keys',
  openai: 'https://platform.openai.com/api-keys',
  openrouter: 'https://openrouter.ai/keys',
};
const ROLE_LABEL: Record<Role, Key> = { balanced: 'ai.roleBalanced', cheap: 'ai.roleCheap', best: 'ai.roleBest' };
const KEY_ERROR: Record<string, Key> = { auth: 'ai.keyErrAuth', 'rate-limited': 'ai.keyErrRate', unreachable: 'ai.keyErrNetwork', timeout: 'ai.keyErrNetwork' };
/** Budget ticks in dollars, and how many model rows are drawn before the page asks for a search. */
const BUDGET_TICKS = [0, 5, 20, 50, 100];
const ROW_LIMIT = 150;
/** The most the monthly budget may be, in dollars: the server's own limit (aiSaveSettings), checked here first. */
const BUDGET_MAX_USD = 10_000;

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
      <main className="page ai-settings-page">
        <PageHeader title={t('ai.settingsTitle')} subtitle={t('ai.settingsSubtitle')} icon={<Sparkles size={22} />} />
        <EmptyState title={t('ai.stewardsOnly')} text="" />
      </main>
    );
  }
  return (
    <main className="page ai-settings-page">
      <PageHeader title={t('ai.settingsTitle')} subtitle={t('ai.settingsSubtitle')} icon={<Sparkles size={22} />} />
      {q.isPending && <Skeleton lines={6} />}
      {q.isError && <ErrorState title={t('ai.settingsLoadFailed')} message={errorText(q.error, t.locale)} onRetry={() => q.refetch()} />}
      {/* Not keyed on the data's version: a save refetches the settings, and a remount would drop the "Saved." notice. */}
      {q.data && <SettingsForm tree={tree} data={q.data} />}
      {/* A way to try the assistant from here. The drawer itself is mounted once, in the tree layout. */}
      <div className="ai-actions"><AssistantButton tree={tree} /></div>
    </main>
  );
}

function SettingsForm({ tree, data }: { tree: string; data: AiSettingsData }) {
  const t = useT();
  const locale = toAiLocale(t.locale);
  const qc = useQueryClient();
  const number = (n: number, digits = 0) => n.toLocaleString(locales[locale], { maximumFractionDigits: digits });
  const money = (usd: number, digits = 2) => new Intl.NumberFormat(locales[locale], { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: digits }).format(usd);

  const [provider, setProvider] = useState<Provider>(data.provider);
  const [model, setModel] = useState(data.model);
  const [search, setSearch] = useState('');
  const [typedKey, setTypedKey] = useState('');
  const [checkKey, setCheckKey] = useState('');
  const [clearKey, setClearKey] = useState(false);
  const [features, setFeatures] = useState<AiFeatures>(data.features);
  const [webSearch, setWebSearch] = useState(data.webSearch);
  const [budgetUsd, setBudgetUsd] = useState(data.monthlyMicros / 1_000_000);
  const [customPrices, setCustomPrices] = useState<Record<string, CustomPrice>>(data.customPrices);
  const [draftIn, setDraftIn] = useState('');
  const [draftOut, setDraftOut] = useState('');
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);

  const current = model.trim() || DEFAULT_MODEL[provider];
  const typedValid = looksLikeKey(typedKey);
  const typedPartial = typedKey.trim().length > 0 && !typedValid;
  // A saved key belongs to the provider it was saved for. Another provider needs a key typed here before anything runs.
  const providerChanged = provider !== data.provider;
  const needsKey = providerChanged && !typedValid;
  const hasKey = typedValid || (!clearKey && data.keyState === 'saved' && !providerChanged);
  const overBudget = budgetUsd > BUDGET_MAX_USD;
  // Only a saved key can belong to another provider. With none saved, the text asks for a key and names no saved one.
  const keyNeededText = data.keyState === 'saved'
    ? t('ai.keyNeeded', { provider: PROVIDER_LABEL[provider], saved: PROVIDER_LABEL[data.provider] })
    : t('ai.keyNeededNone', { provider: PROVIDER_LABEL[provider] });

  // The typed key is checked once typing pauses: the provider's model list comes back (or the reason it doesn't).
  useEffect(() => {
    const h = window.setTimeout(() => setCheckKey(typedKey.trim()), 700);
    return () => window.clearTimeout(h);
  }, [typedKey]);
  const keyActive = looksLikeKey(checkKey);
  const check = useMutation({
    mutationFn: (v: { provider: Provider; key: string }) => aiListModels({ data: { tree, provider: v.provider, key: v.key, locale } }),
  });
  useEffect(() => {
    if (keyActive) check.mutate({ provider, key: checkKey });
    // Only a new key or a new provider starts a check.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkKey, provider]);
  const typedResult: ModelsResult | undefined = keyActive && check.variables?.key === checkKey && check.variables.provider === provider ? check.data : undefined;

  // With no typed key, the saved key lists the saved provider's models.
  const savedEnabled = data.keyState === 'saved' && !keyActive && provider === data.provider;
  const savedList = useQuery({
    queryKey: ['ai-models', tree, data.provider],
    queryFn: () => aiListModels({ data: { tree, provider: data.provider, locale } }),
    enabled: savedEnabled,
    staleTime: 5 * 60_000,
  });
  const listing: ModelsResult | undefined = typedResult ?? (savedEnabled ? savedList.data : undefined);
  const listingLoading = keyActive ? check.isPending && !typedResult : savedEnabled && savedList.isPending;
  const models: ModelInfo[] = listing?.ok ? listing.models : [];
  const keyBlocked = keyActive && typedResult?.ok === false && typedResult.code === 'auth';
  /** What a model costs here: the steward's own price first (the server books it first too), then the table, then the list. */
  const priceOf = (id: string): Price | null => {
    const mine = customPrices[id];
    if (mine) return { ...mine, searchEach: 0.01 };
    const table = tablePrice(provider, id);
    if (table) return table;
    const info = models.find((m) => m.id === id);
    if (info && info.inPerM != null && info.outPerM != null) return { inPerM: info.inPerM, outPerM: info.outPerM, searchEach: info.searchEach ?? 0.01 };
    return null;
  };
  const selectedPrice = priceOf(current);

  // The steward's own prices for the selected model, as typed (the draft keeps a half-typed "0." intact).
  useEffect(() => {
    setDraftIn(customPrices[current] ? String(customPrices[current].inPerM) : '');
    setDraftOut(customPrices[current] ? String(customPrices[current].outPerM) : '');
    // Re-read when the selected model changes, not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);
  const setCustom = (inText: string, outText: string) => {
    setDraftIn(inText);
    setDraftOut(outText);
    const i = Number(inText);
    const o = Number(outText);
    setCustomPrices((cur) => {
      const next = { ...cur };
      if (inText.trim() !== '' && outText.trim() !== '' && Number.isFinite(i) && Number.isFinite(o) && i >= 0 && o >= 0) next[current] = { inPerM: i, outPerM: o };
      else delete next[current];
      return next;
    });
  };

  const pickProvider = (p: Provider) => {
    setProvider(p);
    setModel('');
    setSearch('');
  };

  const save = useMutation({
    mutationFn: () => aiSaveSettings({
      data: {
        tree,
        provider,
        model: model.trim(),
        apiKey: typedValid ? typedKey.trim() : undefined,
        // A typed key is the new key: it is saved, and the removal is not sent with it.
        clearKey: clearKey && !typedValid,
        features,
        webSearch,
        monthlyUsd: budgetUsd,
        customPrices,
        locale,
      },
    }),
    onSuccess: async () => {
      // A removal is done once saved: the next key typed is saved as it is, not dropped by a stale "remove" flag.
      setTypedKey('');
      setClearKey(false);
      setNotice({ ok: true, text: t('ai.saved') });
      await Promise.all([qc.invalidateQueries({ queryKey: ['ai-settings', tree] }), qc.invalidateQueries({ queryKey: ['ai-status', tree] })]);
    },
    onError: (e) => setNotice({ ok: false, text: failureText(e, t.locale, t('ai.saveInvalid')) }),
  });

  async function test() {
    setTesting(true);
    setNotice(null);
    try {
      const r = await aiTestConnection({ data: { tree, provider, model: current, apiKey: typedValid ? typedKey.trim() : undefined, locale } });
      if (r.ok) setNotice({ ok: true, text: t('ai.testOk', { provider: PROVIDER_LABEL[provider], model: r.model, ms: r.ms }) });
      else if (r.code === 'key-required') setNotice({ ok: false, text: keyNeededText });
      else setNotice({ ok: false, text: failureText(r.message, t.locale, t('ai.keyErrOther')) });
    } catch (e) {
      setNotice({ ok: false, text: failureText(e, t.locale, t('ai.keyErrOther')) });
    } finally {
      setTesting(false);
    }
  }

  // ---------- the key line ----------
  let keyLine: { cls: string; text: string } | null = null;
  if (typedKey.trim() && !typedValid) keyLine = { cls: 'subtle', text: t('ai.keyTypeHint') };
  else if (needsKey) keyLine = { cls: 'subtle', text: keyNeededText };
  else if (typedValid && checkKey !== typedKey.trim()) keyLine = { cls: 'subtle', text: t('ai.keyChecking') };
  else if (keyActive && check.isPending) keyLine = { cls: 'subtle', text: t('ai.keyChecking') };
  else if (keyActive && typedResult?.ok) keyLine = { cls: 'ai-key-status ok', text: models.length ? t('ai.keyOk', { n: number(models.length) }) : t('ai.keyOkNoList') };
  else if (keyActive && typedResult && !typedResult.ok) keyLine = { cls: 'ai-key-status bad', text: t(KEY_ERROR[typedResult.code] ?? 'ai.keyErrOther') };
  else if (keyActive && check.isError) keyLine = { cls: 'ai-key-status bad', text: t('ai.keyErrOther') };

  // ---------- the model rows ----------
  const q = search.trim().toLowerCase();
  const matches = (id: string, name: string) => !q || id.toLowerCase().includes(q) || name.toLowerCase().includes(q);
  const recs = recommendedFor(provider);
  const recRows = recs.filter((r) => matches(r.model, models.find((m) => m.id === r.model)?.name ?? r.model));
  const recIds = new Set(recs.map((r) => r.model));
  const otherAll = models.filter((m) => !recIds.has(m.id) && matches(m.id, m.name));
  const otherRows = otherAll.slice(0, ROW_LIMIT);

  const row = (id: string, role?: Role) => {
    const info = models.find((m) => m.id === id);
    const name = info?.name ?? id;
    const p = priceOf(id);
    const perConversation = p ? conversationsForDollar(p) : 0;
    const selected = current === id;
    const badges: Key[] = [];
    if (info?.vision === true) badges.push('ai.badgeVision');
    if (info?.tools === true) badges.push('ai.badgeTools');
    if (info?.webSearch === true) badges.push('ai.badgeSearch');
    return (
      <button
        key={id}
        type="button"
        className="ai-model"
        aria-pressed={selected}
        onClick={() => setModel(id)}
      >
        <span className="ai-model-name">{name}</span>
        {p
          ? <span className="ai-model-price">{t('ai.priceLine', { input: money(p.inPerM), output: money(p.outPerM) })}</span>
          : <span className="ai-model-price unknown">{t('ai.priceUnknown')}</span>}
        {name !== id && <span className="ai-model-id">{id}</span>}
        {(role || badges.length > 0 || info?.contextTokens) && (
          <span className="ai-badges">
            {role && <span className="ai-badge role">{t(ROLE_LABEL[role])}</span>}
            {badges.map((b) => <span key={b} className="ai-badge">{t(b)}</span>)}
            {info?.contextTokens ? <span className="ai-badge">{t('ai.badgeContext', { n: new Intl.NumberFormat(locales[locale], { notation: 'compact' }).format(info.contextTokens) })}</span> : null}
          </span>
        )}
        {p && perConversation > 0 && <span className="ai-model-estimate">{t('ai.estimate', { n: number(perConversation) })}</span>}
      </button>
    );
  };

  // ---------- budget ----------
  const spentUsd = data.spentMicros / 1_000_000;
  const pct = budgetUsd > 0 ? Math.min(100, (spentUsd / budgetUsd) * 100) : spentUsd > 0 ? 100 : 0;
  const resets = new Date(`${data.resetsOn}T00:00:00Z`).toLocaleDateString(locales[locale], { day: 'numeric', month: 'long', timeZone: 'UTC' });

  return (
    <div className="ai-settings">
      {/* 1 · Provider */}
      <section className="ui-card ai-step" aria-labelledby="ai-step-provider">
        <h2 id="ai-step-provider" className="ai-step-title">{t('ai.stepProvider')}</h2>
        <div className="ai-providers">
          {PROVIDERS.map((p) => (
            <div key={p} className="ai-provider" data-active={p === provider || undefined}>
              <button type="button" className="ai-provider-pick" aria-pressed={p === provider} onClick={() => pickProvider(p)}>
                <span className="ai-provider-name">{PROVIDER_LABEL[p]}</span>
                <span className="ai-provider-blurb subtle">{t(PROVIDER_BLURB[p])}</span>
              </button>
              <a className="ai-provider-key" href={KEY_PAGE[p]} target="_blank" rel="noreferrer">{t('ai.getKey')} ↗</a>
            </div>
          ))}
        </div>
      </section>

      {/* 2 · API key */}
      <section className="ui-card ai-step" aria-labelledby="ai-step-key">
        <h2 id="ai-step-key" className="ai-step-title">{t('ai.stepKey')}</h2>
        <label htmlFor="ai-key" className="ai-label">{t('ai.apiKey')}</label>
        <input
          id="ai-key"
          className="input ai-key-input"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={typedKey}
          placeholder={t('ai.apiKeyNew')}
          onChange={(e) => setTypedKey(e.target.value)}
          aria-describedby="ai-key-state"
          aria-invalid={keyActive && typedResult?.ok === false ? true : undefined}
        />
        <p id="ai-key-state" className={keyLine?.cls ?? 'subtle'} role={keyLine?.cls.includes('bad') ? 'alert' : 'status'}>
          {keyLine?.text ?? (clearKey ? t('ai.apiKeyEmpty') : data.keyState === 'unreadable' ? t('ai.keyUnreadable') : data.keyState === 'none' ? t('ai.apiKeyEmpty') : '')}
        </p>
        <div className="ai-key-row">
          {data.keyState === 'saved' && !clearKey && !providerChanged && <span className="ai-key-masked">{t('ai.keyMasked', { tail: data.keyTail ?? '' })}</span>}
          {data.keyState === 'saved' && !clearKey && !providerChanged && <button type="button" className="btn ghost" onClick={() => setClearKey(true)}>{t('ai.removeKey')}</button>}
          {clearKey && <button type="button" className="btn ghost" onClick={() => setClearKey(false)}>{t('ai.keepKey')}</button>}
          <button type="button" className="btn" onClick={test} disabled={testing || save.isPending || needsKey}>{testing ? t('ai.testing') : t('ai.test')}</button>
        </div>
      </section>

      {/* 3 · Model */}
      <section className="ui-card ai-step" aria-labelledby="ai-step-model">
        <h2 id="ai-step-model" className="ai-step-title">{t('ai.stepModel')}</h2>
        {!hasKey && !listing && <p className="subtle">{t('ai.modelsNeedKey')}</p>}
        {listingLoading && <p className="subtle" role="status">{t('ai.modelsLoading')}</p>}
        {listing && !listing.ok && !listingLoading && <p className="ai-key-status bad" role="alert">{t('ai.modelsFailed')}</p>}
        <input type="search" className="input" aria-label={t('ai.modelSearch')} placeholder={t('ai.modelSearch')} value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="ai-model-list" role="group" aria-label={t('ai.modelAll')}>
          <h3 className="ai-model-group">{t('ai.modelRecommended')}</h3>
          <p className="subtle ai-model-note">{t(recs.some((r) => r.provisional) ? 'ai.recommendedNote' : 'ai.recommendedMeasured')}</p>
          {recRows.map((r) => row(r.model, r.role))}
          {otherRows.length > 0 && <h3 className="ai-model-group">{t('ai.modelAll')}</h3>}
          {otherRows.map((m) => row(m.id))}
          {otherAll.length > ROW_LIMIT && <p className="subtle ai-model-more">{t('ai.modelMore', { n: number(otherAll.length - ROW_LIMIT) })}</p>}
          {q && recRows.length === 0 && otherRows.length === 0 && <p className="subtle">{t('ai.modelNone', { q: search.trim() })}</p>}
        </div>
        <label htmlFor="ai-model" className="ai-label">{t('ai.model')}</label>
        <input id="ai-model" className="input" value={model} placeholder={DEFAULT_MODEL[provider]} onChange={(e) => setModel(e.target.value)} aria-describedby="ai-model-hint" spellCheck={false} autoComplete="off" />
        <p id="ai-model-hint" className="subtle">{t('ai.modelHint')}</p>
        {provider === 'openrouter' && <p className="subtle">{t('ai.modelOnlineNote')}</p>}
        <div className="ai-selected" aria-live="polite">
          <div className="ai-selected-head">
            <span><strong>{current}</strong></span>
            <span className={selectedPrice ? 'subtle' : 'ai-key-status bad'}>
              {selectedPrice ? `${t('ai.priceLine', { input: money(selectedPrice.inPerM), output: money(selectedPrice.outPerM) })}` : t('ai.priceUnknown')}
            </span>
          </div>
          {/* Open while the model has no price, and whenever it has the steward's own: a half-typed number must not close it. */}
          {(!selectedPrice || customPrices[current]) && (
            <>
              {!customPrices[current] && <p className="ai-privacy">{t('ai.budgetUnenforced')}</p>}
              <p className="subtle">{t('ai.customPriceHint')}</p>
              <div className="ai-custom-grid">
                <label>
                  {t('ai.customIn')}
                  <input className="input" inputMode="decimal" value={draftIn} onChange={(e) => setCustom(e.target.value, draftOut)} aria-label={t('ai.customIn')} />
                </label>
                <label>
                  {t('ai.customOut')}
                  <input className="input" inputMode="decimal" value={draftOut} onChange={(e) => setCustom(draftIn, e.target.value)} aria-label={t('ai.customOut')} />
                </label>
              </div>
            </>
          )}
        </div>
      </section>

      {/* 4 · Features */}
      <section className="ui-card ai-step" aria-labelledby="ai-step-features">
        <h2 id="ai-step-features" className="ai-step-title">{t('ai.stepFeatures')}</h2>
        {!hasKey && <p className="subtle">{t('ai.needsKey')}</p>}
        {FEATURES.map((f) => (
          <div key={f} className="ai-feature">
            <Switch checked={features[f]} onChange={(on) => setFeatures((cur) => ({ ...cur, [f]: on }))} disabled={!hasKey && !features[f]}>
              {t(FEATURE_LABEL[f])}
            </Switch>
            <p className="ai-feature-hint subtle">{t(FEATURE_HINT[f])}</p>
          </div>
        ))}
        <div className="ai-feature">
          <Switch checked={webSearch} onChange={setWebSearch} disabled={!hasKey && !webSearch}>
            {t(FEATURE_LABEL.webSearch)}
          </Switch>
          <p className="ai-feature-hint subtle">{t('ai.featureWebSearchHint', { provider: PROVIDER_NOTE[provider] })}</p>
        </div>
      </section>

      {/* 5 · Monthly budget */}
      <section className="ui-card ai-step" aria-labelledby="ai-step-budget">
        <h2 id="ai-step-budget" className="ai-step-title">{t('ai.stepBudget')}</h2>
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
        />
        <p className="subtle">{t('ai.budgetHint')}</p>
        <div
          className="ai-meter"
          role="meter"
          aria-label={t('ai.budget')}
          aria-valuemin={0}
          aria-valuemax={Math.max(budgetUsd, spentUsd, 0.01)}
          aria-valuenow={spentUsd}
          aria-valuetext={t('ai.budgetSpent', { spent: money(spentUsd), limit: money(budgetUsd) })}
        >
          <span style={{ width: `${pct}%` }} />
        </div>
        <p className="ai-usage">
          {t('ai.budgetSpent', { spent: money(spentUsd), limit: money(budgetUsd) })}
          {' · '}
          {t('ai.budgetResets', { date: resets })}
        </p>
      </section>

      {/* Privacy */}
      <section className="ui-card ai-step" aria-labelledby="ai-privacy-h">
        <h2 id="ai-privacy-h" className="ai-step-title">{t('ai.privacyTitle')}</h2>
        <p className="ai-privacy">{t('ai.privacy', { provider: PROVIDER_NOTE[provider] })}</p>
        <p className="ai-privacy">{t('ai.privacyEditors', { provider: PROVIDER_NOTE[provider] })}</p>
      </section>

      <PortraitSettings tree={tree} />
      <BackgroundSettings tree={tree} />
      {notice && <p className={notice.ok ? 'ai-card-state ok' : 'ai-card-error'} role={notice.ok ? 'status' : 'alert'}>{notice.text}</p>}
      <div className="ai-actions">
        {(keyBlocked || typedPartial || needsKey) && (
          <p className="ai-save-hint ai-key-status bad" role="alert">
            {keyBlocked ? t('ai.keyErrAuth') : typedPartial ? t('ai.keyTypeHint') : keyNeededText}
          </p>
        )}
        <button
          type="button"
          className="btn primary"
          onClick={() => save.mutate()}
          disabled={save.isPending || testing || keyBlocked || typedPartial || needsKey || overBudget}
        >
          {save.isPending ? t('ai.saving') : t('ai.save')}
        </button>
      </div>
    </div>
  );
}

/** The settings page title, in the reader's language. */
export const aiSettingsHead = (ctx: Parameters<typeof treeTitle>[0]) => ({ meta: [{ title: treeTitle(ctx, translate((ctx.match.context as { locale?: Locale }).locale ?? 'en', 'ai.settings_title')) }] });
