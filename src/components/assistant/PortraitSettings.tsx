// "Painted portraits from photos", in the AI settings (stewards only: the server checks the same, manage-access). Off by
// default. It has its own OpenRouter key (or reuses the family's, when the family's provider is OpenRouter), and its own
// model, chosen from OpenRouter's live list of picture models: those that take an image in and give one out, with the
// lab and the price per portrait. The recommended model is provisional until the bake-off decides it.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ErrorState, Skeleton, Switch } from '~/components/ui';
import { RECOMMENDED_MODEL, type ImageModel } from '~/lib/ai/portrait-rules';
import { toAiLocale } from '~/lib/ai/types';
import { errorText } from '~/lib/errortext';
import { locales, useT } from '~/lib/i18n';
import { portraitSettingsQuery, savePortraitSettings } from '~/lib/portrait.functions';
import type { PortraitSettings as Saved } from '~/lib/ai/portrait.server';
import './aisettings.css';

const ROW_LIMIT = 150;

export function PortraitSettings({ tree }: { tree: string }) {
  const t = useT();
  const q = useQuery(portraitSettingsQuery(tree));
  return (
    <section className="ui-card ai-step" aria-labelledby="paint-step">
      <h2 id="paint-step" className="ai-step-title">{t('paint.setTitle')}</h2>
      <p className="subtle">{t('paint.setIntro')}</p>
      {q.isPending ? <Skeleton lines={4} /> : null}
      {q.isError ? <ErrorState title={t('paint.setNoList')} message={errorText(q.error, t.locale)} onRetry={() => q.refetch()} /> : null}
      {q.data ? <PortraitForm tree={tree} saved={q.data.settings} choices={q.data.choices} /> : null}
    </section>
  );
}

function PortraitForm({ tree, saved, choices }: { tree: string; saved: Saved; choices: ImageModel[] }) {
  const t = useT();
  const qc = useQueryClient();
  const money = (usd: number) => new Intl.NumberFormat(locales[toAiLocale(t.locale)], { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(usd);

  const [enabled, setEnabled] = useState(saved.enabled);
  const [model, setModel] = useState(saved.model);
  const [reuse, setReuse] = useState(saved.reuseFamilyKey);
  const [apiKey, setApiKey] = useState('');
  const [clearKey, setClearKey] = useState(false);
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const hasKey = saved.keyState === 'own' || saved.keyState === 'family';
  const typed = apiKey.trim();

  const save = useMutation({
    mutationFn: () => savePortraitSettings({
      data: {
        tree,
        enabled,
        model: model.trim(),
        reuseFamilyKey: reuse,
        apiKey: !reuse && typed ? typed : undefined,
        clearKey: !reuse && clearKey && !typed,
      },
    }),
    onSuccess: async () => {
      setApiKey('');
      setClearKey(false);
      setNotice({ ok: true, text: t('paint.setSaved') });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['portrait-settings', tree] }),
        qc.invalidateQueries({ queryKey: ['portrait-status', tree] }),
      ]);
    },
    onError: (e) => setNotice({ ok: false, text: errorText(e, t.locale) }),
  });

  function onSave() {
    setNotice(null);
    if (enabled && !model.trim()) return setNotice({ ok: false, text: t('paint.setNeedModel') });
    if (enabled && !reuse && !hasKey && !typed) return setNotice({ ok: false, text: t('paint.setNeedKey') });
    save.mutate();
  }

  const q = search.trim().toLowerCase();
  const matches = (m: ImageModel) => !q || m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q) || m.labName.toLowerCase().includes(q);
  const recommended = choices.find((m) => m.id === RECOMMENDED_MODEL);
  const rest = choices.filter((m) => m.id !== RECOMMENDED_MODEL && matches(m));
  const shown = rest.slice(0, ROW_LIMIT);

  const row = (m: ImageModel, recommendedTag = false) => (
    <button key={m.id} type="button" className="ai-model" aria-pressed={model === m.id} onClick={() => setModel(m.id)}>
      <span className="ai-model-name">{m.name}</span>
      <span className="ai-model-price">{t('paint.setLab', { lab: m.labName })}</span>
      <span className="ai-model-price">{m.priceUsd !== null ? t('paint.setPrice', { usd: money(m.priceUsd) }) : t('paint.setPriceUnknown')}</span>
      {recommendedTag ? <span className="ai-badges"><span className="ai-badge role">{t('paint.setRecommended')}</span></span> : null}
      <span className="ai-model-id">{m.id}</span>
    </button>
  );

  const keyLine =
    saved.keyState === 'own' ? t('paint.setKeySaved', { tail: saved.keyTail ?? '' })
      : saved.keyState === 'family' ? t('paint.setKeyFamily')
        : saved.keyState === 'family-missing' ? t('paint.setKeyFamilyMissing')
          : saved.keyState === 'unreadable' ? t('paint.setKeyUnreadable')
            : t('paint.setKeyNone');

  return (
    <div className="ai-settings paint-settings">
      <div className="ai-feature">
        <Switch checked={enabled} onChange={setEnabled}>{t('paint.setOn')}</Switch>
        <p className="ai-feature-hint subtle">{t('paint.setOnHint')}</p>
      </div>

      {saved.familyCanReuse ? (
        <div className="ai-feature">
          <Switch checked={reuse} onChange={setReuse}>{t('paint.setKeyFamily')}</Switch>
          <p className="ai-feature-hint subtle">{t('paint.setKeyFamilyHint')}</p>
        </div>
      ) : null}

      {!reuse ? (
        <>
          <label htmlFor="paint-key" className="ai-label">{t('paint.setKeyLabel')}</label>
          <input
            id="paint-key"
            className="input ai-key-input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            aria-describedby="paint-key-state"
          />
          <p id="paint-key-state" className="subtle">{keyLine}</p>
          {saved.keyState === 'own' && !clearKey ? (
            <button type="button" className="btn ghost" onClick={() => setClearKey(true)}>{t('ai.removeKey')}</button>
          ) : null}
        </>
      ) : (
        <p id="paint-key-state" className="subtle">{keyLine}</p>
      )}

      <label htmlFor="paint-model-search" className="ai-label">{t('paint.setModel')}</label>
      <input id="paint-model-search" type="search" className="input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('paint.setModelSearch')} aria-label={t('paint.setModelSearch')} />
      <div className="ai-model-list" role="group" aria-label={t('paint.setModel')}>
        {recommended && matches(recommended) ? row(recommended, true) : null}
        {shown.map((m) => row(m))}
        {!shown.length && !(recommended && matches(recommended)) ? <p className="subtle">{t('paint.setNone')}</p> : null}
      </div>
      {model ? <p className="subtle">{model}</p> : null}

      <p className="ai-privacy">{t('paint.setPrivacy')}</p>
      <p className="subtle">{t('paint.setBudget')}</p>

      {notice ? <p className={notice.ok ? 'ai-card-state ok' : 'ai-card-error'} role={notice.ok ? 'status' : 'alert'}>{notice.text}</p> : null}
      <div className="ai-actions">
        <button type="button" className="btn primary" onClick={onSave} disabled={save.isPending}>{save.isPending ? t('common.saving') : t('paint.setSave')}</button>
      </div>
    </div>
  );
}
