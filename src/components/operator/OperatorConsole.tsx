// The operator console's frame and its Families tab (src/routes/operator.tsx). The other tabs are in ./OperatorRequests.tsx
// and ./OperatorInstance.tsx. Everything shown is how a family is run, never what it holds.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Copy, Gauge, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { AccountMenu } from '~/components/AccountMenu';
import { LanguagePicker } from '~/components/LanguagePicker';
import { Dialog, ErrorState, Notice, PageHeader, Segmented, Skeleton, Tab, TabList, TabPanel, Tabs } from '~/components/ui';
import { withFreshProof } from '~/lib/auth/client';
import { errorText } from '~/lib/errortext';
import { formatDate, relativeTime, useT } from '~/lib/i18n';
import {
  operatorCreateFamily, operatorDeleteFamily, operatorQuery, operatorRecount, operatorRenewLink, operatorSetCap, operatorSetStatus, type OperatorConsole as Data,
} from '~/lib/operator/operator.functions';
import { bytesToMb, formatBytes, mbToBytes, type FamilyStatus, type OperatorFamily } from '~/lib/operator/shared';
import { AuditTab, OperatorsTab, SettingsTab } from './OperatorInstance';
import { DataRequestsTab, FamilyRequestsTab } from './OperatorRequests';
import '~/components/families/families.css';
import './operator.css';

export const OPERATOR_TABS = ['families', 'requests', 'data', 'settings', 'operators', 'audit'] as const;
export type OperatorTab = (typeof OPERATOR_TABS)[number];

/** As the server suggests an id (suggestId in families.server.ts), so the field fills in while the name is typed. */
export const suggestId = (name: string) =>
  name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/^[0-9-]+/, '').slice(0, 40).replace(/-+$/, '');

export const inviteUrl = (token: string) => `${window.location.origin}/invite/${token}`;

export function OperatorConsole({ tab, onTab }: { tab: OperatorTab; onTab: (tab: OperatorTab) => void }) {
  const t = useT();
  const { data, isPending, isError, refetch } = useQuery(operatorQuery);
  const waiting = data?.familyRequests.open.length ?? 0;
  const open = data?.dataRequests.open.length ?? 0;
  return (
    <main className="families operator" aria-labelledby="operator-title">
      <div className="families-top">
        <Link to="/" search={{ families: 'all' }} className="btn ghost">{t('families.back')}</Link>
        <div className="home-account"><LanguagePicker /><AccountMenu /></div>
      </div>
      <PageHeader id="operator-title" title={t('operator.title')} subtitle={t('operator.subtitle')} />
      {isPending ? <div aria-busy="true" aria-label={t('operator.loading')}><Skeleton lines={6} /></div>
        : isError ? <ErrorState title={t('operator.err_load')} onRetry={() => { void refetch(); }} />
        : (
          <Tabs value={tab} onChange={(v) => onTab(v as OperatorTab)} label={t('operator.title')}>
            <TabList className="operator-tabs">
              <Tab value="families">{t('operator.tab_families')}</Tab>
              <Tab value="requests" badge={waiting || undefined}>{t('operator.tab_requests')}</Tab>
              <Tab value="data" badge={open || undefined}>{t('operator.tab_data')}</Tab>
              <Tab value="settings">{t('operator.tab_settings')}</Tab>
              <Tab value="operators">{t('operator.tab_operators')}</Tab>
              <Tab value="audit">{t('operator.tab_audit')}</Tab>
            </TabList>
            <TabPanel value="families"><FamiliesTab data={data} /></TabPanel>
            <TabPanel value="requests"><FamilyRequestsTab data={data} /></TabPanel>
            <TabPanel value="data"><DataRequestsTab data={data} /></TabPanel>
            <TabPanel value="settings"><SettingsTab settings={data.settings} turnstile={data.turnstile} pushKey={data.pushKey} /></TabPanel>
            <TabPanel value="operators"><OperatorsTab operators={data.operators} /></TabPanel>
            <TabPanel value="audit"><AuditTab families={data.families} /></TabPanel>
          </Tabs>
        )}
    </main>
  );
}

/** A one-time link to hand on, with a button that copies it. */
export function LinkBox({ url, label, children }: { url: string; label: string; children?: ReactNode }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const id = useId();
  return (
    <div className="operator-link">
      <label htmlFor={id}>{label}</label>
      <div className="families-row">
        <input id={id} className="input operator-link-input" readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
        <button type="button" className="btn" onClick={() => { void navigator.clipboard?.writeText(url).then(() => setCopied(true), () => {}); }}>
          <Copy size={15} aria-hidden /> {copied ? t('operator.copied') : t('operator.copy')}
        </button>
      </div>
      {children}
    </div>
  );
}

function FamiliesTab({ data }: { data: Data }) {
  const t = useT();
  return (
    <div className="operator-panel">
      <section aria-labelledby="operator-new">
        <h2 id="operator-new" className="rule">{t('operator.new_family')}</h2>
        {data.workers && <p className="families-hint">{t('operator.new_family_workers')}</p>}
        <div className="ui-card families-card"><NewFamilyFor /></div>
      </section>
      <section aria-labelledby="operator-families">
        <h2 id="operator-families" className="rule">{t('operator.families_count', { count: data.families.length })}</h2>
        <ul className="families-list">
          {data.families.map((f) => <FamilyRow key={f.id} family={f} now={data.now} total={data.families.length} />)}
        </ul>
      </section>
    </div>
  );
}

function NewFamilyFor() {
  const t = useT();
  const qc = useQueryClient();
  const ids = useId();
  const [name, setName] = useState('');
  const [id, setId] = useState('');
  const [idTouched, setIdTouched] = useState(false);
  const [theme, setTheme] = useState<'codex' | 'modern'>('codex');
  const [steward, setSteward] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<{ id: string; url: string; expires: number; steward: string } | null>(null);
  const chosenId = idTouched ? id : suggestId(name);
  const make = useMutation({
    mutationFn: () => operatorCreateFamily({ data: { id: chosenId, name, theme, stewardName: steward, stewardEmail: email } }),
    onSuccess: async (r) => {
      setError(null);
      setMade({ id: r.id, url: inviteUrl(r.token), expires: r.expires, steward });
      setName(''); setId(''); setIdTouched(false); setSteward(''); setEmail('');
      await qc.invalidateQueries({ queryKey: ['operator'] });
    },
    onError: (e) => setError(errorText(e, t.locale)),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim() && chosenId && steward.trim() && !make.isPending) make.mutate();
  };
  return (
    <form className="families-form" onSubmit={submit} aria-describedby={error ? `${ids}-error` : undefined}>
      <div className="operator-grid">
        <label className="field">
          <span>{t('families.name')}</span>
          <input className="input" value={name} maxLength={80} required autoComplete="off" onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span>{t('families.id')}</span>
          <input className="input families-id" value={chosenId} maxLength={40} required pattern="[a-z][a-z0-9]*(-[a-z0-9]+)*" autoComplete="off" spellCheck={false}
            onChange={(e) => { setIdTouched(true); setId(e.target.value.toLowerCase()); }} />
        </label>
        <label className="field">
          <span>{t('operator.steward_name')}</span>
          <input className="input" value={steward} maxLength={120} required autoComplete="off" onChange={(e) => setSteward(e.target.value)} />
        </label>
        <label className="field">
          <span>{t('operator.steward_email')}</span>
          <input className="input" type="email" value={email} maxLength={254} autoComplete="off" onChange={(e) => setEmail(e.target.value)} />
        </label>
      </div>
      <ThemePick value={theme} onChange={setTheme} />
      <p className="families-hint">{t('operator.new_family_hint')}</p>
      <div className="families-row">
        <button type="submit" className="btn primary" disabled={!name.trim() || !chosenId || !steward.trim() || make.isPending}>
          <Plus size={16} aria-hidden /> {make.isPending ? t('families.creating') : t('operator.create_and_invite')}
        </button>
      </div>
      {error && <p role="alert" id={`${ids}-error`} className="families-error">{error}</p>}
      {made && (
        <div role="status">
          <LinkBox url={made.url} label={t('operator.invite_link_for', { name: made.steward })}>
            <p className="families-hint">{t('operator.invite_link_hint', { date: formatDate(made.expires, t.locale) })}</p>
          </LinkBox>
        </div>
      )}
    </form>
  );
}

export function ThemePick({ value, onChange }: { value: 'codex' | 'modern'; onChange: (v: 'codex' | 'modern') => void }) {
  const t = useT();
  const label = useId();
  return (
    <div className="field">
      <span id={label}>{t('families.theme')}</span>
      <Segmented aria-labelledby={label} value={value} onChange={onChange} className="families-theme"
        options={[{ value: 'codex', label: t('shell.themeCodex') }, { value: 'modern', label: t('shell.themePaper') }]} />
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return <div className="operator-fact"><dt>{label}</dt><dd>{children}</dd></div>;
}

function FamilyRow({ family: f, now, total }: { family: OperatorFamily; now: number; total: number }) {
  const t = useT();
  const qc = useQueryClient();
  const ids = useId();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<{ url: string; expires: number } | null>(null);
  const [cap, setCap] = useState<string>(f.capBytes === null ? '' : String(bytesToMb(f.capBytes)));
  const refresh = () => qc.invalidateQueries({ queryKey: ['operator'] });
  const onError = (e: unknown) => setError(errorText(e, t.locale));
  const status = useMutation({ mutationFn: (next: FamilyStatus) => operatorSetStatus({ data: { tree: f.id, status: next } }), onSuccess: refresh, onError });
  const saveCap = useMutation({ mutationFn: () => operatorSetCap({ data: { tree: f.id, capBytes: mbToBytes(cap.trim() === '' ? null : Number(cap)) } }), onSuccess: refresh, onError });
  const recount = useMutation({ mutationFn: () => operatorRecount({ data: { tree: f.id } }), onSuccess: refresh, onError });
  const renew = useMutation({ mutationFn: () => operatorRenewLink({ data: { tree: f.id } }), onSuccess: (r) => setLink({ url: inviteUrl(r.token), expires: r.expires }), onError });
  const capChanged = (cap.trim() === '' ? null : Number(cap)) !== bytesToMb(f.capBytes) && (cap.trim() === '' || Number.isFinite(Number(cap)));
  const share = f.capBytes ? Math.min(1, f.usedBytes / f.capBytes) : 0;
  return (
    <li className="ui-card families-card operator-family" aria-labelledby={`${ids}-name`}>
      <h3 id={`${ids}-name`}>
        {f.name} <span className="families-id muted">/{f.id}</span>
        {f.status !== 'active' && <span className="chip operator-chip">{t(f.status === 'closed' ? 'operator.closed' : 'operator.suspended')}</span>}
      </h3>
      <dl className="operator-facts">
        <Fact label={t('operator.created')}>{f.created ? formatDate(f.created, t.locale) : '–'}</Fact>
        <Fact label={t('operator.members')}>{f.members}</Fact>
        <Fact label={t('operator.last_activity')}>{f.lastActivity ? relativeTime(f.lastActivity, t.locale, now) : '–'}</Fact>
        <Fact label={t('operator.storage')}>
          {f.capBytes === null ? formatBytes(f.usedBytes, t.locale) : t('operator.storage_of', { used: formatBytes(f.usedBytes, t.locale), cap: formatBytes(f.capBytes, t.locale) })}
          {f.capBytes !== null && <span className="operator-meter" role="presentation"><span style={{ width: `${Math.round(share * 100)}%` }} data-full={share >= 1 || undefined} /></span>}
        </Fact>
      </dl>
      <div className="operator-stewards">
        <b>{t('operator.stewards')}</b>
        {f.stewards.length ? (
          <ul>{f.stewards.map((s, i) => <li key={i}>{s.name}{s.email && <> · <a href={`mailto:${s.email}`}>{s.email}</a></>}</li>)}</ul>
        ) : f.pendingSteward ? (
          <p className="muted">{t(f.pendingSteward.email ? 'operator.pending_steward_email' : 'operator.pending_steward', { email: f.pendingSteward.email ?? '', date: formatDate(f.pendingSteward.expires, t.locale) })}</p>
        ) : <p className="muted">{t('operator.no_stewards')}</p>}
        {f.members === 0 && (
          <div className="families-row">
            <button type="button" className="btn" onClick={() => renew.mutate()} disabled={renew.isPending}>{t('operator.new_invite_link')}</button>
          </div>
        )}
        {link && <div role="status"><LinkBox url={link.url} label={t('operator.invite_link')}><p className="families-hint">{t('operator.invite_link_hint', { date: formatDate(link.expires, t.locale) })}</p></LinkBox></div>}
      </div>
      <form className="families-row operator-cap" onSubmit={(e) => { e.preventDefault(); if (capChanged && !saveCap.isPending) saveCap.mutate(); }}>
        <label className="operator-inline">
          <span>{t('operator.cap_mb')}</span>
          <input className="input" type="number" min={0} step={1} inputMode="numeric" value={cap} placeholder={t('operator.cap_none')} onChange={(e) => setCap(e.target.value)} />
        </label>
        <button type="submit" className="btn" disabled={!capChanged || saveCap.isPending}><Gauge size={15} aria-hidden /> {t('operator.cap_save')}</button>
        <button type="button" className="btn ghost" onClick={() => recount.mutate()} disabled={recount.isPending}><RefreshCw size={15} aria-hidden /> {recount.isPending ? t('operator.recounting') : t('operator.recount')}</button>
      </form>
      <div className="families-danger families-row">
        <span id={`${ids}-level`} className="muted">{t('operator.level')}</span>
        <Segmented aria-labelledby={`${ids}-level`} value={f.status} onChange={(next) => { if (next !== f.status && !status.isPending) status.mutate(next); }}
          options={[{ value: 'active', label: t('operator.level_active') }, { value: 'suspended', label: t('operator.level_suspended') }, { value: 'closed', label: t('operator.level_closed') }]} />
        {total < 2 ? <span className="muted">{t('families.delete_last')}</span>
          : <button type="button" className="btn danger" onClick={() => setDeleting(true)}><Trash2 size={15} aria-hidden /> {t('families.delete')}</button>}
      </div>
      {f.status !== 'active' && <p className="families-hint">{t(f.status === 'closed' ? 'operator.closed_hint' : 'operator.suspended_hint')}</p>}
      {error && <p role="alert" className="families-error">{error}</p>}
      {deleting && <DeleteAsOperator family={f} onClose={() => setDeleting(false)} />}
    </li>
  );
}

/** Deleting: the stewards' export first (the operator cannot export it), the family's id typed, a passkey confirmation. */
function DeleteAsOperator({ family: f, onClose }: { family: OperatorFamily; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const ids = useId();
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const remove = useMutation({
    mutationFn: () => withFreshProof(() => operatorDeleteFamily({ data: { tree: f.id, confirm: typed } })),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: ['operator'] }); onClose(); },
    onError: (e) => setError(errorText(e, t.locale)),
  });
  const ready = typed.trim() === f.id;
  return (
    <Dialog
      open onClose={onClose} title={t('families.delete_title', { name: f.name })} width="min(520px, 100vw - 24px)" dismissible={!remove.isPending}
      footer={<>
        <button type="button" className="btn" onClick={onClose} disabled={remove.isPending}>{t('families.cancel')}</button>
        <button type="submit" form={`${ids}-form`} className="btn danger" disabled={!ready || remove.isPending}><Trash2 size={16} aria-hidden /> {remove.isPending ? t('families.deleting') : t('families.delete_confirm')}</button>
      </>}
    >
      <div className="families-form">
        <Notice icon={<Trash2 size={15} aria-hidden />}>{t('operator.delete_warning')}</Notice>
        <p className="families-p">{t('operator.delete_export')}</p>
        <form id={`${ids}-form`} className="families-form" onSubmit={(e) => { e.preventDefault(); if (ready && !remove.isPending) remove.mutate(); }}>
          <label className="families-confirm">
            <span>{t('families.delete_type', { id: f.id })}</span>
            <input className="input families-id" value={typed} autoComplete="off" spellCheck={false} autoCapitalize="none" onChange={(e) => setTyped(e.target.value)} aria-describedby={error ? `${ids}-error` : undefined} />
          </label>
          {error && <p role="alert" id={`${ids}-error`} className="families-error">{error}</p>}
        </form>
      </div>
    </Dialog>
  );
}
