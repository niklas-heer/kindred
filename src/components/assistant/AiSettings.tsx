// AI settings for one family: provider, model, the one key (written, never read back), the feature
// switches, a daily token budget, a privacy note, and "Test connection". Stewards only; the server
// checks the same (manage-access) on every call.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { errorText } from '~/lib/errortext';
import { Sparkles } from 'lucide-react';
import { useState } from 'react';
import { aiSaveSettings, aiSettingsQuery, aiTestConnection } from '~/lib/ai.functions';
import { PROVIDER_NOTE } from '~/lib/ai/labels';
import { DEFAULT_MODEL, FEATURES, PROVIDERS, PROVIDER_LABEL, toAiLocale, type AiFeatures, type AiSettingsData, type Feature, type Provider } from '~/lib/ai/types';
import { useTreeId } from '~/lib/family';
import { locales, translate, useT, type Key, type Locale } from '~/lib/i18n';
import { useCan } from '~/lib/session';
import { EmptyState, ErrorState, PageHeader, Range, Select, Skeleton, Switch } from '~/components/ui';
import { AssistantButton } from './AssistantDrawer';
import { treeTitle } from '~/lib/title';
import './assistant.css';

const FEATURE_LABEL: Record<Feature, Key> = {
  assistant: 'ai.featureAssistant', faces: 'ai.featureFaces', avatar: 'ai.featureAvatar', arms: 'ai.featureArms',
};
const FEATURE_HINT: Record<Feature, Key> = {
  assistant: 'ai.featureAssistantHint', faces: 'ai.featureFacesHint', avatar: 'ai.featureAvatarHint', arms: 'ai.featureArmsHint',
};
const BUDGET_TICKS = [0, 100_000, 300_000, 1_000_000, 2_000_000];

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
      {q.data && <SettingsForm key={q.data.updated} tree={tree} data={q.data} />}
      {/* A way to try the assistant from here. The drawer itself is mounted once, in the tree layout. */}
      <div className="ai-actions"><AssistantButton tree={tree} /></div>
    </main>
  );
}

function SettingsForm({ tree, data }: { tree: string; data: AiSettingsData }) {
  const t = useT();
  const locale = toAiLocale(t.locale);
  const qc = useQueryClient();
  const [provider, setProvider] = useState<Provider>(data.provider);
  const [model, setModel] = useState(data.model);
  const [apiKey, setApiKey] = useState('');
  const [clearKey, setClearKey] = useState(false);
  const [features, setFeatures] = useState<AiFeatures>(data.features);
  const [budget, setBudget] = useState(data.dailyTokens);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);

  const hasKey = !clearKey && (data.keyState === 'saved' || apiKey.trim().length > 0);
  const number = (n: number) => n.toLocaleString(locales[locale]);

  const save = useMutation({
    mutationFn: () => aiSaveSettings({ data: { tree, provider, model, apiKey: apiKey.trim() || undefined, clearKey, features, dailyTokens: budget, locale } }),
    onSuccess: async () => {
      setApiKey('');
      setNotice({ ok: true, text: t('ai.saved') });
      await Promise.all([qc.invalidateQueries({ queryKey: ['ai-settings', tree] }), qc.invalidateQueries({ queryKey: ['ai-status', tree] })]);
    },
    onError: (e) => setNotice({ ok: false, text: errorText(e, t.locale) }),
  });

  async function test() {
    setTesting(true);
    setNotice(null);
    try {
      const r = await aiTestConnection({ data: { tree, provider, model, apiKey: apiKey.trim() || undefined, locale } });
      setNotice(r.ok ? { ok: true, text: t('ai.testOk', { provider: PROVIDER_LABEL[provider], model: r.model, ms: r.ms }) } : { ok: false, text: errorText(r.message, t.locale) });
    } catch (e) {
      setNotice({ ok: false, text: errorText(e, t.locale) });
    } finally {
      setTesting(false);
    }
  }

  const keyLine = clearKey
    ? t('ai.apiKeyEmpty')
    : data.keyState === 'saved' ? t('ai.keyEnds', { tail: `…${data.keyTail}` })
    : data.keyState === 'unreadable' ? t('ai.keyUnreadable')
    : t('ai.apiKeyEmpty');

  return (
    <div className="ai-settings">
      <section className="ui-card ai-section" aria-labelledby="ai-provider-h">
        <h2 id="ai-provider-h">{t('ai.connection')}</h2>
        <div className="ai-row">
          <span className="ai-label" id="ai-provider-label">{t('ai.provider')}</span>
          <Select
            value={provider}
            onChange={(v) => setProvider(v as Provider)}
            options={PROVIDERS.map((p) => ({ value: p, label: PROVIDER_LABEL[p] }))}
            aria-label={t('ai.provider')}
          />
        </div>
        <div className="ai-row">
          <label htmlFor="ai-model">{t('ai.model')}</label>
          <input id="ai-model" className="input" value={model} placeholder={DEFAULT_MODEL[provider]} onChange={(e) => setModel(e.target.value)} aria-describedby="ai-model-hint" spellCheck={false} autoComplete="off" />
          <p id="ai-model-hint" className="subtle">{t('ai.modelHint')}</p>
        </div>
        <div className="ai-row">
          <label htmlFor="ai-key">{t('ai.apiKey')}</label>
          <input
            id="ai-key"
            className="input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={apiKey}
            placeholder={t('ai.apiKeyNew')}
            onChange={(e) => setApiKey(e.target.value)}
            aria-describedby="ai-key-state"
          />
          <p id="ai-key-state" className="ai-key-state subtle">
            {keyLine}
            {data.keyState === 'saved' && !clearKey && (
              <>{' '}<button type="button" className="btn ghost" onClick={() => setClearKey(true)}>{t('ai.removeKey')}</button></>
            )}
          </p>
        </div>
        <div className="ai-actions">
          <button type="button" className="btn" onClick={test} disabled={testing || save.isPending}>{testing ? t('ai.testing') : t('ai.test')}</button>
        </div>
      </section>

      <section className="ui-card ai-section" aria-labelledby="ai-features-h">
        <h2 id="ai-features-h">{t('ai.features')}</h2>
        {!hasKey && <p className="subtle">{t('ai.needsKey')}</p>}
        {FEATURES.map((f) => (
          <div key={f} className="ai-feature">
            <Switch
              checked={features[f]}
              onChange={(on) => setFeatures((cur) => ({ ...cur, [f]: on }))}
              disabled={!hasKey && !features[f]}
            >
              {t(FEATURE_LABEL[f])}
            </Switch>
            <p className="ai-feature-hint subtle">{t(FEATURE_HINT[f])}</p>
          </div>
        ))}
      </section>

      <section className="ui-card ai-section" aria-labelledby="ai-budget-h">
        <h2 id="ai-budget-h">{t('ai.budget')}</h2>
        <Range
          value={budget}
          onChange={setBudget}
          min={0}
          max={2_000_000}
          step={10_000}
          ticks={BUDGET_TICKS.map((v) => ({ value: v, label: v === 0 ? t('ai.budgetOff') : `${v / 1000}k` }))}
          format={(v) => t('ai.budgetValue', { n: number(v) })}
          aria-label={t('ai.budget')}
        />
        <p className="subtle">{t('ai.budgetHint')}</p>
        <p className="ai-usage">{t('ai.usedToday', { used: number(data.usedToday), limit: number(budget) })}</p>
      </section>

      <section className="ui-card ai-section" aria-labelledby="ai-privacy-h">
        <h2 id="ai-privacy-h">{t('ai.privacyTitle')}</h2>
        <p className="ai-privacy">{t('ai.privacy', { provider: PROVIDER_NOTE[provider] })}</p>
        <p className="ai-privacy">{t('ai.privacyEditors', { provider: PROVIDER_NOTE[provider] })}</p>
      </section>

      {notice && <p className={notice.ok ? 'ai-card-state ok' : 'ai-card-error'} role={notice.ok ? 'status' : 'alert'}>{notice.text}</p>}
      <div className="ai-actions">
        <button type="button" className="btn primary" onClick={() => save.mutate()} disabled={save.isPending || testing}>
          {save.isPending ? t('ai.saving') : t('ai.save')}
        </button>
      </div>
    </div>
  );
}

/** The settings page title, in the reader's language. */
export const aiSettingsHead = (ctx: Parameters<typeof treeTitle>[0]) => ({ meta: [{ title: treeTitle(ctx, translate((ctx.match.context as { locale?: Locale }).locale ?? 'en', 'ai.settings_title')) }] });
