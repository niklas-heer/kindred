// AI settings for one family: provider, model, the one key (written, never read back), the feature
// switches, a daily token budget, a privacy note, and "Test connection". Stewards only; the server
// checks the same (manage-access) on every call.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import { useState } from 'react';
import { aiSaveSettings, aiSettingsQuery, aiTestConnection } from '~/lib/ai.functions';
import { copyFor, fill, PROVIDER_NOTE } from '~/lib/ai/copy';
import { DEFAULT_MODEL, FEATURES, PROVIDERS, PROVIDER_LABEL, toAiLocale, type AiFeatures, type AiSettingsData, type Feature, type Provider } from '~/lib/ai/types';
import { useTreeId } from '~/lib/family';
import { useT } from '~/lib/i18n';
import { useCan } from '~/lib/session';
import { EmptyState, ErrorState, PageHeader, Range, Select, Skeleton, Switch } from '~/components/ui';
import { AssistantButton, AssistantHost } from './AssistantDrawer';
import { sectionHead } from '~/lib/title';
import './assistant.css';

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));
const FEATURE_LABEL: Record<Feature, 'featureAssistant' | 'featureFaces' | 'featureAvatar' | 'featureArms'> = {
  assistant: 'featureAssistant', faces: 'featureFaces', avatar: 'featureAvatar', arms: 'featureArms',
};
const FEATURE_HINT: Record<Feature, 'featureAssistantHint' | 'featureFacesHint' | 'featureAvatarHint' | 'featureArmsHint'> = {
  assistant: 'featureAssistantHint', faces: 'featureFacesHint', avatar: 'featureAvatarHint', arms: 'featureArmsHint',
};
const BUDGET_TICKS = [0, 100_000, 300_000, 1_000_000, 2_000_000];

export function AiSettingsPage() {
  const tree = useTreeId();
  const t = useT();
  const c = copyFor(toAiLocale(t.locale));
  const steward = useCan('manage-access');
  const q = useQuery({ ...aiSettingsQuery(tree), enabled: steward });
  if (!steward) {
    return (
      <main className="page ai-settings-page">
        <PageHeader title={c.settingsTitle} subtitle={c.settingsSubtitle} icon={<Sparkles size={22} />} />
        <EmptyState title={c.stewardsOnly} text="" />
      </main>
    );
  }
  return (
    <main className="page ai-settings-page">
      <PageHeader title={c.settingsTitle} subtitle={c.settingsSubtitle} icon={<Sparkles size={22} />} />
      {q.isPending && <Skeleton lines={6} />}
      {q.isError && <ErrorState title={c.settingsLoadFailed} message={messageOf(q.error)} onRetry={() => q.refetch()} />}
      {q.data && <SettingsForm key={q.data.updated} tree={tree} data={q.data} />}
      {/* A way to try the assistant from here (the tree layout is where it is meant to mount; see the report). */}
      <div className="ai-actions"><AssistantButton tree={tree} /></div>
      <AssistantHost tree={tree} />
    </main>
  );
}

function SettingsForm({ tree, data }: { tree: string; data: AiSettingsData }) {
  const t = useT();
  const locale = toAiLocale(t.locale);
  const c = copyFor(locale);
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
  const number = (n: number) => n.toLocaleString(locale === 'de' ? 'de-DE' : 'en-GB');

  const save = useMutation({
    mutationFn: () => aiSaveSettings({ data: { tree, provider, model, apiKey: apiKey.trim() || undefined, clearKey, features, dailyTokens: budget, locale } }),
    onSuccess: async () => {
      setApiKey('');
      setNotice({ ok: true, text: c.saved });
      await Promise.all([qc.invalidateQueries({ queryKey: ['ai-settings', tree] }), qc.invalidateQueries({ queryKey: ['ai-status', tree] })]);
    },
    onError: (e) => setNotice({ ok: false, text: messageOf(e) }),
  });

  async function test() {
    setTesting(true);
    setNotice(null);
    try {
      const r = await aiTestConnection({ data: { tree, provider, model, apiKey: apiKey.trim() || undefined, locale } });
      setNotice(r.ok ? { ok: true, text: fill(c.testOk, { provider: PROVIDER_LABEL[provider], model: r.model, ms: r.ms }) } : { ok: false, text: r.message });
    } catch (e) {
      setNotice({ ok: false, text: messageOf(e) });
    } finally {
      setTesting(false);
    }
  }

  const keyLine = clearKey
    ? c.apiKeyEmpty
    : data.keyState === 'saved' ? fill(c.keyEnds, { tail: `…${data.keyTail}` })
    : data.keyState === 'unreadable' ? c.keyUnreadable
    : c.apiKeyEmpty;

  return (
    <div className="ai-settings">
      <section className="ui-card ai-section" aria-labelledby="ai-provider-h">
        <h2 id="ai-provider-h">{c.connection}</h2>
        <div className="ai-row">
          <span className="ai-label" id="ai-provider-label">{c.provider}</span>
          <Select
            value={provider}
            onChange={(v) => setProvider(v as Provider)}
            options={PROVIDERS.map((p) => ({ value: p, label: PROVIDER_LABEL[p] }))}
            aria-label={c.provider}
          />
        </div>
        <div className="ai-row">
          <label htmlFor="ai-model">{c.model}</label>
          <input id="ai-model" className="input" value={model} placeholder={DEFAULT_MODEL[provider]} onChange={(e) => setModel(e.target.value)} aria-describedby="ai-model-hint" spellCheck={false} autoComplete="off" />
          <p id="ai-model-hint" className="subtle">{c.modelHint}</p>
        </div>
        <div className="ai-row">
          <label htmlFor="ai-key">{c.apiKey}</label>
          <input
            id="ai-key"
            className="input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={apiKey}
            placeholder={c.apiKeyNew}
            onChange={(e) => setApiKey(e.target.value)}
            aria-describedby="ai-key-state"
          />
          <p id="ai-key-state" className="ai-key-state subtle">
            {keyLine}
            {data.keyState === 'saved' && !clearKey && (
              <>{' '}<button type="button" className="btn ghost" onClick={() => setClearKey(true)}>{c.removeKey}</button></>
            )}
          </p>
        </div>
        <div className="ai-actions">
          <button type="button" className="btn" onClick={test} disabled={testing || save.isPending}>{testing ? c.testing : c.test}</button>
        </div>
      </section>

      <section className="ui-card ai-section" aria-labelledby="ai-features-h">
        <h2 id="ai-features-h">{c.features}</h2>
        {!hasKey && <p className="subtle">{c.needsKey}</p>}
        {FEATURES.map((f) => (
          <div key={f} className="ai-feature">
            <Switch
              checked={features[f]}
              onChange={(on) => setFeatures((cur) => ({ ...cur, [f]: on }))}
              disabled={!hasKey && !features[f]}
            >
              {c[FEATURE_LABEL[f]] as string}
            </Switch>
            <p className="ai-feature-hint subtle">{c[FEATURE_HINT[f]] as string}</p>
          </div>
        ))}
      </section>

      <section className="ui-card ai-section" aria-labelledby="ai-budget-h">
        <h2 id="ai-budget-h">{c.budget}</h2>
        <Range
          value={budget}
          onChange={setBudget}
          min={0}
          max={2_000_000}
          step={10_000}
          ticks={BUDGET_TICKS.map((v) => ({ value: v, label: v === 0 ? c.budgetOff : `${v / 1000}k` }))}
          format={(v) => fill(c.budgetValue, { n: number(v) })}
          aria-label={c.budget}
        />
        <p className="subtle">{c.budgetHint}</p>
        <p className="ai-usage">{fill(c.usedToday, { used: number(data.usedToday), limit: number(budget) })}</p>
      </section>

      <section className="ui-card ai-section" aria-labelledby="ai-privacy-h">
        <h2 id="ai-privacy-h">{c.privacyTitle}</h2>
        <p className="ai-privacy">{fill(c.privacy, { provider: PROVIDER_NOTE[provider] })}</p>
      </section>

      {notice && <p className={notice.ok ? 'ai-card-state ok' : 'ai-card-error'} role={notice.ok ? 'status' : 'alert'}>{notice.text}</p>}
      <div className="ai-actions">
        <button type="button" className="btn primary" onClick={() => save.mutate()} disabled={save.isPending || testing}>
          {save.isPending ? c.saving : c.save}
        </button>
      </div>
    </div>
  );
}

export const aiSettingsHead = sectionHead('AI settings');
