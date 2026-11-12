// The operator console's Policies and Announcements tabs (docs/hosting-many-families.md, "Policies", "Announcements"). A
// policy is saved only after its impact has been shown for exactly what is about to be saved: how many families and
// accounts it changes. The server checks the operator and refuses in a demo or a preview, whatever this page shows.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Megaphone, Save, Search } from 'lucide-react';
import { useId, useState } from 'react';
import { EmptyState, ErrorState, Skeleton } from '~/components/ui';
import { errorText } from '~/lib/errortext';
import { formatDate, useT, type Key } from '~/lib/i18n';
import {
  announcementsAdminQuery, createAnnouncement, endAnnouncement, policiesQuery, previewPolicy, saveOperatorAiKey, savePolicy, type PoliciesData,
} from '~/lib/operator/policy.functions';
import {
  AI_PROVIDERS, AI_SOURCES, ANNOUNCEMENT_AUDIENCES, ANNOUNCEMENT_BODY_MAX, ANNOUNCEMENT_TITLE_MAX, DEFAULT_AI_SOURCE, POLICY_SCOPES,
  type AiProviderName, type AiSourceValue, type Announcement, type OperatorKeyState, type PolicyEntry, type PolicyImpact, type PolicyKey, type PolicyScope,
} from '~/lib/operator/policy';
import type { OperatorFamily } from '~/lib/operator/shared';

const LABEL: Record<PolicyKey, [Key, Key]> = {
  'feature.campaign': ['policy.key_campaign', 'policy.key_campaign_hint'],
  'feature.assistant': ['policy.key_assistant', 'policy.key_assistant_hint'],
  'feature.portraits': ['policy.key_portraits', 'policy.key_portraits_hint'],
  'feature.address_lookup': ['policy.key_address_lookup', 'policy.key_address_lookup_hint'],
  'feature.push': ['policy.key_push', 'policy.key_push_hint'],
  'ai.source': ['policy.key_ai_source', 'policy.key_ai_source_hint'],
};
const UNAVAILABLE: Partial<Record<PolicyKey, Key>> = { 'feature.push': 'policy.unavailable_push', 'feature.address_lookup': 'policy.unavailable_address' };
const PROVIDER_NAME: Record<AiProviderName, string> = { anthropic: 'Anthropic', openai: 'OpenAI', openrouter: 'OpenRouter' };

/** Micro-dollars as dollars for a field, and back: a field left empty or unreadable is 0. */
const usdText = (micros: number) => String(Math.round(micros / 10_000) / 100);
const microsOf = (text: string) => Math.max(0, Math.round((Number(text) || 0) * 1_000_000));

const useUsd = () => {
  const t = useT();
  return (micros: number) => new Intl.NumberFormat(t.locale, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(micros / 1_000_000);
};

export function PoliciesTab({ families }: { families: OperatorFamily[] }) {
  const t = useT();
  const { data, isPending, isError, refetch } = useQuery(policiesQuery);
  // A saved card is drawn anew from what the server now holds (its key changes with the save), so it is told it was just
  // saved: otherwise its "Saved." would go with the card it replaces.
  const [justSaved, setJustSaved] = useState<PolicyKey | null>(null);
  if (isPending) return <div aria-busy="true" aria-label={t('operator.loading')}><Skeleton lines={6} /></div>;
  if (isError) return <ErrorState title={t('operator.err_load')} onRetry={() => { void refetch(); }} />;
  return (
    <div className="operator-panel">
      <p className="families-hint">{t('policy.intro')}</p>
      {!data.contact.trim() && <p className="operator-warning">{t('policy.no_contact')}</p>}
      {data.entries.map((e) => (
        <PolicyCard key={`${e.key}:${e.updatedAt}`} entry={e} families={families} data={data} justSaved={justSaved === e.key} onSaved={() => setJustSaved(e.key)} />
      ))}
      <OperatorKeys keys={data.keys} />
    </div>
  );
}

function PolicyCard({ entry, families, data, justSaved, onSaved }: {
  entry: PolicyEntry; families: OperatorFamily[]; data: PoliciesData; justSaved: boolean; onSaved: () => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const ids = useId();
  const usd = useUsd();
  const [scope, setScope] = useState<PolicyScope>(entry.scope);
  const [listed, setListed] = useState<string[]>(entry.families);
  const [ai, setAi] = useState<AiSourceValue>(entry.ai ?? DEFAULT_AI_SOURCE);
  // The budgets as typed (dollars), so "1." or an empty field can be edited; the micro-dollars are worked out from them.
  const [familyUsd, setFamilyUsd] = useState(() => usdText((entry.ai ?? DEFAULT_AI_SOURCE).familyMicros));
  const [ceilingUsd, setCeilingUsd] = useState(() => usdText((entry.ai ?? DEFAULT_AI_SOURCE).ceilingMicros));
  const [impact, setImpact] = useState<{ for: string; value: PolicyImpact } | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(() => (justSaved ? { ok: true, text: t('policy.saved') } : null));
  const aiValue = { ...ai, familyMicros: microsOf(familyUsd), ceilingMicros: microsOf(ceilingUsd) };
  const input = { key: entry.key, scope, ai: entry.key === 'ai.source' ? aiValue : null, families: scope === 'off' ? [] : listed };
  const draft = JSON.stringify(input);
  const saved = JSON.stringify({ key: entry.key, scope: entry.scope, ai: entry.ai, families: entry.scope === 'off' ? [] : entry.families });
  const dirty = draft !== saved;
  const previewed = impact?.for === draft;
  const onError = (e: unknown) => setStatus({ ok: false, text: errorText(e, t.locale) });
  const preview = useMutation({ mutationFn: () => previewPolicy({ data: input }), onSuccess: (value) => { setStatus(null); setImpact({ for: draft, value }); }, onError });
  const save = useMutation({
    mutationFn: () => savePolicy({ data: input }),
    onSuccess: async () => { setStatus({ ok: true, text: t('policy.saved') }); onSaved(); await qc.invalidateQueries({ queryKey: ['operator'] }); },
    onError,
  });
  const change = (f: () => void) => { setStatus(null); f(); };
  const [title, hint] = LABEL[entry.key];
  return (
    <section className="ui-card families-card policy-card" aria-labelledby={`${ids}-h`}>
      <h3 id={`${ids}-h`}>{t(title)}</h3>
      <p className="families-hint">{t(hint)}</p>
      {!entry.available && UNAVAILABLE[entry.key] && <p className="operator-warning">{t(UNAVAILABLE[entry.key]!)}</p>}
      <fieldset className="operator-fieldset">
        <legend>{t('policy.scope')}</legend>
        {POLICY_SCOPES.map((s) => (
          <label key={s} className="operator-radio">
            <input type="radio" name={`${ids}-scope`} value={s} checked={scope === s} onChange={() => change(() => setScope(s))} />
            <span><b>{t(`policy.scope_${s}` as Key)}</b></span>
          </label>
        ))}
      </fieldset>
      {scope !== 'off' && (
        <fieldset className="operator-fieldset">
          <legend>{t(scope === 'selected' ? 'policy.families_selected' : 'policy.families_withheld')}</legend>
          {families.length === 0 ? <p className="muted">{t('policy.families_none')}</p> : (
            <div className="policy-families">
              {families.map((f) => (
                <label key={f.id} className="policy-family">
                  <input type="checkbox" checked={listed.includes(f.id)}
                    onChange={(e) => change(() => setListed(e.target.checked ? [...listed, f.id] : listed.filter((x) => x !== f.id)))} />
                  <span>{f.name} <span className="families-id muted">/{f.id}</span></span>
                </label>
              ))}
            </div>
          )}
        </fieldset>
      )}
      {entry.key === 'ai.source' && scope !== 'off' && (
        <fieldset className="operator-fieldset">
          <legend>{t('policy.source')}</legend>
          {AI_SOURCES.map((s) => (
            <label key={s} className="operator-radio">
              <input type="radio" name={`${ids}-source`} value={s} checked={ai.source === s} onChange={() => change(() => setAi({ ...ai, source: s }))} />
              <span><b>{t(`policy.source_${s}` as Key)}</b></span>
            </label>
          ))}
          <p className="families-hint">{t('policy.source_hint')}</p>
          {(ai.source === 'operator' || ai.source === 'either') && (
            <div className="operator-grid">
              <label className="field">
                <span>{t('policy.ai_provider')}</span>
                <select className="input" value={ai.provider ?? ''} onChange={(e) => change(() => setAi({ ...ai, provider: (e.target.value || null) as AiProviderName | null }))}>
                  <option value="">{t('policy.ai_provider_none')}</option>
                  {AI_PROVIDERS.map((p) => <option key={p} value={p}>{PROVIDER_NAME[p]}</option>)}
                </select>
              </label>
              <label className="field">
                <span>{t('policy.ai_model')}</span>
                <input className="input" value={ai.model} maxLength={120} spellCheck={false} autoComplete="off" onChange={(e) => change(() => setAi({ ...ai, model: e.target.value.trim() }))} aria-describedby={`${ids}-model`} />
                <small className="families-hint" id={`${ids}-model`}>{t('policy.ai_model_hint')}</small>
              </label>
              <label className="field">
                <span>{t('policy.ai_family_budget')}</span>
                <input className="input" type="number" min={0} step={0.5} inputMode="decimal" value={familyUsd} onChange={(e) => change(() => setFamilyUsd(e.target.value))} />
              </label>
              <label className="field">
                <span>{t('policy.ai_ceiling')}</span>
                <input className="input" type="number" min={0} step={1} inputMode="decimal" value={ceilingUsd} onChange={(e) => change(() => setCeilingUsd(e.target.value))} />
              </label>
            </div>
          )}
          <p className="families-hint">{t('policy.ai_spent', { spent: usd(data.spentMicros), ceiling: usd(aiValue.ceilingMicros) })}</p>
        </fieldset>
      )}
      <div className="families-row">
        <button type="button" className="btn" disabled={!dirty || preview.isPending} onClick={() => preview.mutate()}><Search size={15} aria-hidden /> {t('policy.preview')}</button>
        <button type="button" className="btn primary" disabled={!dirty || !previewed || save.isPending} onClick={() => save.mutate()}><Save size={15} aria-hidden /> {t('policy.save')}</button>
      </div>
      {previewed && dirty && impact && (
        <div role="status" className="policy-impact">
          <p>{impact.value.losing + impact.value.gaining === 0 ? t('policy.impact_none')
            : t('policy.impact', { changed: impact.value.losing + impact.value.gaining, losing: impact.value.losing, gaining: impact.value.gaining, accounts: impact.value.accounts })}</p>
          {impact.value.names.length > 0 && <p className="muted">{t('policy.impact_names', { names: impact.value.names.join(', ') })}</p>}
        </div>
      )}
      {status && <p role={status.ok ? 'status' : 'alert'} className={status.ok ? 'families-hint' : 'families-error'}>{status.text}</p>}
    </section>
  );
}

function OperatorKeys({ keys }: { keys: OperatorKeyState[] }) {
  const t = useT();
  const ids = useId();
  return (
    <section className="ui-card families-card policy-card" aria-labelledby={`${ids}-h`}>
      <h3 id={`${ids}-h`}>{t('policy.ai_keys')}</h3>
      <p className="families-hint">{t('policy.ai_keys_hint')}</p>
      {keys.map((k) => <OperatorKey key={k.provider} state={k} />)}
    </section>
  );
}

function OperatorKey({ state }: { state: OperatorKeyState }) {
  const t = useT();
  const qc = useQueryClient();
  const ids = useId();
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (apiKey: string | null) => saveOperatorAiKey({ data: { provider: state.provider, apiKey } }),
    onSuccess: async () => { setKey(''); setError(null); await qc.invalidateQueries({ queryKey: ['operator', 'policies'] }); },
    onError: (e) => setError(errorText(e, t.locale)),
  });
  const shown = !state.saved ? t('policy.key_state_none') : state.readable ? t('policy.key_state_saved', { tail: state.keyTail ?? '' }) : t('policy.key_state_unreadable');
  return (
    <form className="families-row operator-cap" onSubmit={(e) => { e.preventDefault(); if (key.trim() && !save.isPending) save.mutate(key); }}>
      <label className="operator-inline" htmlFor={`${ids}-key`}><b>{PROVIDER_NAME[state.provider]}</b> <span className="muted">{shown}</span></label>
      <input id={`${ids}-key`} className="input" type="password" autoComplete="off" spellCheck={false} placeholder={t('policy.key_placeholder')} value={key} onChange={(e) => setKey(e.target.value)} />
      <button type="submit" className="btn" disabled={!key.trim() || save.isPending}>{t('policy.key_save')}</button>
      {state.saved && <button type="button" className="btn ghost" disabled={save.isPending} onClick={() => save.mutate(null)}>{t('policy.key_remove')}</button>}
      {error && <p role="alert" className="families-error">{error}</p>}
    </form>
  );
}

// ---------- announcements ----------

/** A datetime-local value (the reader's own time zone) as epoch ms, and back. */
const toLocalInput = (ms: number) => {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
};
const fromLocalInput = (v: string) => (v ? new Date(v).getTime() : NaN);

export function AnnouncementsTab() {
  const t = useT();
  const { data, isPending, isError, refetch } = useQuery(announcementsAdminQuery);
  return (
    <div className="operator-panel">
      <p className="families-hint">{t('policy.ann_hint')}</p>
      <div className="ui-card families-card"><NewAnnouncement /></div>
      {isPending ? <Skeleton lines={4} /> : isError ? <ErrorState title={t('operator.err_load')} onRetry={() => { void refetch(); }} />
        : data.length === 0 ? <EmptyState title={t('policy.ann_empty')} />
        : <ul className="families-list">{data.map((a) => <AnnouncementRow key={a.id} a={a} />)}</ul>}
    </div>
  );
}

function NewAnnouncement() {
  const t = useT();
  const qc = useQueryClient();
  const ids = useId();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState<(typeof ANNOUNCEMENT_AUDIENCES)[number]>('stewards');
  const [starts, setStarts] = useState(() => toLocalInput(Date.now()));
  const [ends, setEnds] = useState('');
  const [error, setError] = useState<string | null>(null);
  const make = useMutation({
    mutationFn: () => createAnnouncement({ data: { title, body, audience, startsAt: fromLocalInput(starts), endsAt: ends ? fromLocalInput(ends) : null } }),
    onSuccess: async () => {
      setTitle(''); setBody(''); setEnds(''); setError(null);
      await qc.invalidateQueries({ queryKey: ['operator', 'announcements'] });
      await qc.invalidateQueries({ queryKey: ['announcements'] });
    },
    onError: (e) => setError(errorText(e, t.locale)),
  });
  const ready = title.trim() && Number.isFinite(fromLocalInput(starts));
  return (
    <form className="families-form" onSubmit={(e) => { e.preventDefault(); if (ready && !make.isPending) make.mutate(); }}>
      <h3>{t('policy.ann_new')}</h3>
      <label className="field">
        <span>{t('policy.ann_field_title')}</span>
        <input className="input" value={title} maxLength={ANNOUNCEMENT_TITLE_MAX} required onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="field">
        <span>{t('policy.ann_field_body')}</span>
        <textarea className="input operator-text" value={body} maxLength={ANNOUNCEMENT_BODY_MAX} onChange={(e) => setBody(e.target.value)} />
      </label>
      <fieldset className="operator-fieldset">
        <legend>{t('policy.ann_audience')}</legend>
        {ANNOUNCEMENT_AUDIENCES.map((a) => (
          <label key={a} className="operator-radio">
            <input type="radio" name={`${ids}-audience`} checked={audience === a} onChange={() => setAudience(a)} />
            <span><b>{t(a === 'stewards' ? 'policy.ann_stewards' : 'policy.ann_everyone')}</b></span>
          </label>
        ))}
      </fieldset>
      <div className="operator-grid">
        <label className="field"><span>{t('policy.ann_starts')}</span><input className="input" type="datetime-local" value={starts} required onChange={(e) => setStarts(e.target.value)} /></label>
        <label className="field"><span>{t('policy.ann_ends')}</span><input className="input" type="datetime-local" value={ends} onChange={(e) => setEnds(e.target.value)} /></label>
      </div>
      <div className="families-row">
        <button type="submit" className="btn primary" disabled={!ready || make.isPending}><Megaphone size={15} aria-hidden /> {t('policy.ann_create')}</button>
      </div>
      {error && <p role="alert" className="families-error">{error}</p>}
    </form>
  );
}

function AnnouncementRow({ a }: { a: Announcement }) {
  const t = useT();
  const qc = useQueryClient();
  const now = Date.now();
  const end = useMutation({
    mutationFn: () => endAnnouncement({ data: { id: a.id } }),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ['operator', 'announcements'] }), qc.invalidateQueries({ queryKey: ['announcements'] })]),
  });
  const state = a.endsAt !== null && a.endsAt <= now ? 'ended' : a.startsAt > now ? 'scheduled' : 'live';
  const when = (ms: number) => formatDate(ms, t.locale, { dateStyle: 'medium', timeStyle: 'short' });
  return (
    <li className="ui-card families-card">
      <h3>{a.title} <span className="chip">{t(`policy.ann_${state}` as Key)}</span></h3>
      <p className="muted">
        {t(a.audience === 'stewards' ? 'policy.ann_stewards' : 'policy.ann_everyone')} ·{' '}
        <span suppressHydrationWarning>{a.endsAt === null ? t('policy.ann_when', { start: when(a.startsAt) }) : t('policy.ann_when_until', { start: when(a.startsAt), end: when(a.endsAt) })}</span>
      </p>
      {a.body && <p className="operator-message">{a.body}</p>}
      {state !== 'ended' && <div className="families-row"><button type="button" className="btn" disabled={end.isPending} onClick={() => end.mutate()}>{t('policy.ann_end')}</button></div>}
    </li>
  );
}
