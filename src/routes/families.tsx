// The Families page: the families of this server that the reader is a member of, with their own details for a steward to
// change, a way to make another family, and (for a steward) deleting one. The rules are checked on the server
// (src/lib/families.server.ts); this page only offers what the overview says the reader may do.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, redirect, useNavigate } from '@tanstack/react-router';
import { Download, Plus, Shield, Trash2 } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import { AccountMenu } from '~/components/AccountMenu';
import { LanguagePicker } from '~/components/LanguagePicker';
import { Dialog, ErrorState, Notice, PageHeader, Segmented, Skeleton } from '~/components/ui';
import { opKeys } from '~/lib/api';
import { sessionQuery } from '~/lib/auth/functions';
import { withFreshProof } from '~/lib/auth/client';
import { errorText } from '~/lib/errortext';
import { createFamily, deleteFamily, editFamily, familiesQuery } from '~/lib/families.functions';
import type { FamiliesOverview, FamilyAdminRow } from '~/lib/families.server';
import { formatBytes } from '~/lib/operator/shared';
import { translate, useT } from '~/lib/i18n';
import '~/styles/home.css';
import '~/components/families/families.css';

export const Route = createFileRoute('/families')({
  beforeLoad: async ({ context, location }) => {
    const session = await context.queryClient.ensureQueryData(sessionQuery);
    if (session.needsSetup) throw redirect({ to: '/setup' });
    // A demo has nothing to manage; a guest has no account to manage it with.
    if (session.demo || session.guest) throw redirect({ to: '/' });
    if (!session.user) throw redirect({ to: '/signin', search: { next: location.href } });
  },
  head: ({ match }) => ({ meta: [{ title: `${translate(match.context.locale ?? 'en', 'families.title')} · Kindred` }] }),
  component: Families,
});

type Theme = FamilyAdminRow['theme'];
const THEMES: Theme[] = ['codex', 'modern'];
/** As the server suggests one (suggestId in families.server.ts), so the field fills in while the name is typed. */
const suggest = (name: string) =>
  name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/^[0-9-]+/, '').slice(0, 40).replace(/-+$/, '');

function Families() {
  const t = useT();
  const { data, isPending, isError, refetch } = useQuery(familiesQuery);
  return (
    <main className="families" aria-labelledby="families-title">
      <div className="families-top">
        <Link to="/" search={{ families: 'all' }} className="btn ghost">{t('families.back')}</Link>
        <div className="home-account"><LanguagePicker /><AccountMenu /></div>
      </div>
      <PageHeader id="families-title" title={t('families.title')} subtitle={t('families.subtitle')} />
      {isPending ? <div aria-busy="true" aria-label={t('families.loading')}><Skeleton lines={4} /></div>
        : isError ? <ErrorState title={t('families.err_load')} onRetry={() => { void refetch(); }} />
        : <Overview data={data} />}
    </main>
  );
}

function Overview({ data }: { data: FamiliesOverview }) {
  const t = useT();
  return (
    <>
      <section aria-labelledby="families-yours">
        <h2 id="families-yours" className="rule">{t('families.yours')}</h2>
        {data.families.length === 0 ? <p className="muted">{t('families.none')}</p> : (
          <ul className="families-list">
            {data.families.map((f) => <FamilyCard key={f.id} family={f} total={data.total} isDefault={data.defaultTree === f.id} />)}
          </ul>
        )}
      </section>
      {!data.mayCreate && data.familyCreation === 'requests' && (
        <section aria-labelledby="families-new">
          <h2 id="families-new" className="rule">{t('families.new')}</h2>
          <p><Link to="/request">{t('request.ask_link')}</Link></p>
        </section>
      )}
      {data.mayCreate && (
        <section aria-labelledby="families-new">
          <h2 id="families-new" className="rule">{t('families.new')}</h2>
          {data.empty.length > 0 && (
            <div className="families-list">
              {data.empty.map((e) => (
                <div key={e.id} className="ui-card families-card">
                  <h3><Shield size={18} aria-hidden /> {t('families.empty_heading', { id: e.id })}</h3>
                  <p className="muted">{t(data.workers ? 'families.empty_text_workers' : 'families.empty_text', { binding: e.binding })}</p>
                  <NewFamilyForm fixedId={e.id} />
                </div>
              ))}
            </div>
          )}
          {data.workers ? <BindingSteps /> : <div className="ui-card families-card"><NewFamilyForm /></div>}
        </section>
      )}
    </>
  );
}

/** Commands and configuration, the same in every language. */
const COMMANDS = {
  create: 'npx wrangler d1 create kindred-<id>',
  bind: '{ "binding": "TREE_<ID>", "database_name": "kindred-<id>", "database_id": "…", "migrations_dir": "migrations/tree" }',
  deploy: 'mise run deploy',
};

/** On Workers a family needs a D1 database bound when the Worker is deployed: what to do, as docs/deploy-cloudflare.md says. */
function BindingSteps() {
  const t = useT();
  return (
    <div className="ui-card families-card">
      <h3>{t('families.binding_heading')}</h3>
      <ol className="families-steps">
        <li>{t('families.binding_1')} <code>{COMMANDS.create}</code></li>
        <li>{t('families.binding_2')} <code>{COMMANDS.bind}</code></li>
        <li>{t('families.binding_3')} <code>{COMMANDS.deploy}</code></li>
        <li>{t('families.binding_4')}</li>
      </ol>
    </div>
  );
}

function NewFamilyForm({ fixedId }: { fixedId?: string }) {
  const t = useT();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const ids = useId();
  const [name, setName] = useState('');
  const [tagline, setTagline] = useState('');
  const [theme, setTheme] = useState<Theme>('codex');
  const [id, setId] = useState(fixedId ?? '');
  const [idTouched, setIdTouched] = useState(!!fixedId);
  const [error, setError] = useState<string | null>(null);
  const chosenId = fixedId ?? (idTouched ? id : suggest(name));
  const make = useMutation({
    mutationFn: () => createFamily({ data: { id: chosenId, name, tagline, theme } }),
    onSuccess: async ({ id: made }) => {
      setError(null);
      await qc.invalidateQueries({ queryKey: ['session'] });
      await qc.invalidateQueries({ queryKey: ['families'] });
      // The new family is empty: its own page asks the steward to add themselves first.
      await navigate({ to: '/$tree', params: { tree: made } });
    },
    onError: (e) => setError(errorText(e, t.locale)),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim() && chosenId && !make.isPending) make.mutate();
  };
  return (
    <form className="families-form" onSubmit={submit} aria-describedby={error ? `${ids}-error` : undefined}>
      <label className="field">
        <span>{t('families.name')}</span>
        <input className="input" value={name} maxLength={80} required autoComplete="off" onChange={(e) => setName(e.target.value)} />
      </label>
      {!fixedId && (
        <label className="field">
          <span>{t('families.id')}</span>
          <input className="input families-id" value={chosenId} maxLength={40} required pattern="[a-z][a-z0-9]*(-[a-z0-9]+)*" autoComplete="off" spellCheck={false} aria-describedby={`${ids}-id-hint`}
            onChange={(e) => { setIdTouched(true); setId(e.target.value.toLowerCase()); }} />
          <small className="families-hint" id={`${ids}-id-hint`}>{t('families.id_hint', { url: `/${chosenId || '…'}` })}</small>
        </label>
      )}
      <label className="field">
        <span>{t('families.tagline')}</span>
        <input className="input" value={tagline} maxLength={140} autoComplete="off" onChange={(e) => setTagline(e.target.value)} />
      </label>
      <ThemeChoice value={theme} onChange={setTheme} />
      <div className="families-row">
        <button type="submit" className="btn primary" disabled={!name.trim() || !chosenId || make.isPending}>
          <Plus size={16} aria-hidden /> {make.isPending ? t('families.creating') : fixedId ? t('families.set_up') : t('families.create')}
        </button>
      </div>
      {error && <p role="alert" id={`${ids}-error`} className="families-error">{error}</p>}
    </form>
  );
}

function ThemeChoice({ value, onChange }: { value: Theme; onChange: (theme: Theme) => void }) {
  const t = useT();
  const label = useId();
  return (
    <div className="field">
      <span id={label}>{t('families.theme')}</span>
      <Segmented aria-labelledby={label} value={value} onChange={onChange} className="families-theme"
        options={THEMES.map((th) => ({ value: th, label: t(th === 'codex' ? 'shell.themeCodex' : 'shell.themePaper') }))} />
    </div>
  );
}

function FamilyCard({ family: f, total, isDefault }: { family: FamilyAdminRow; total: number; isDefault: boolean }) {
  const t = useT();
  const [deleting, setDeleting] = useState(false);
  return (
    <li className="ui-card families-card">
      <h3>
        <Link to="/$tree" params={{ tree: f.id }}>{f.name}</Link>
        <span className="families-id muted">/{f.id}</span>
      </h3>
      <p className="muted">{t('families.people', { count: f.people })}</p>
      {f.suspended && <p className="families-error">{t('operator.suspended_banner')}</p>}
      {f.storage && (
        <p className="muted">
          {f.storage.capBytes === null ? t('families.storage_used', { used: formatBytes(f.storage.usedBytes, t.locale) })
            : t('families.storage_used_of', { used: formatBytes(f.storage.usedBytes, t.locale), cap: formatBytes(f.storage.capBytes, t.locale) })}
        </p>
      )}
      {f.steward ? (
        <>
          <EditFamily family={f} />
          <div className="families-danger">
            {total < 2 ? <p className="muted">{t('families.delete_last')}</p>
              : isDefault ? <p className="muted">{t('families.delete_default')}</p>
              : <div className="families-row"><button type="button" className="btn danger" onClick={() => setDeleting(true)}><Trash2 size={16} aria-hidden /> {t('families.delete')}</button></div>}
          </div>
          {deleting && <DeleteFamily family={f} onClose={() => setDeleting(false)} />}
        </>
      ) : <p className="muted">{t('families.not_steward')}</p>}
    </li>
  );
}

function EditFamily({ family: f }: { family: FamilyAdminRow }) {
  const t = useT();
  const qc = useQueryClient();
  const ids = useId();
  const [keys] = useState(() => opKeys());
  const [draft, setDraft] = useState({ name: f.name, tagline: f.tagline, theme: f.theme });
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = draft.name !== f.name || draft.tagline !== f.tagline || draft.theme !== f.theme;
  const save = useMutation({
    mutationFn: () => editFamily({ data: { tree: f.id, opKey: keys.for('edit-family', draft), ...draft } }),
    onSuccess: async () => {
      keys.clear();
      setStatus({ ok: true, text: t('families.saved') });
      await Promise.all([qc.invalidateQueries({ queryKey: ['families'] }), qc.invalidateQueries({ queryKey: ['graph', f.id] }), qc.invalidateQueries({ queryKey: ['session'] })]);
    },
    onError: (e) => setStatus({ ok: false, text: errorText(e, t.locale) }),
  });
  return (
    <form className="families-form" onSubmit={(e) => { e.preventDefault(); if (dirty && draft.name.trim() && !save.isPending) save.mutate(); }}>
      <label className="field">
        <span>{t('families.name')}</span>
        <input className="input" value={draft.name} maxLength={80} required autoComplete="off" onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
      </label>
      <label className="field">
        <span>{t('families.tagline')}</span>
        <input className="input" value={draft.tagline} maxLength={140} autoComplete="off" onChange={(e) => setDraft({ ...draft, tagline: e.target.value })} />
      </label>
      <ThemeChoice value={draft.theme} onChange={(theme) => setDraft({ ...draft, theme })} />
      <div className="families-row">
        <button type="submit" className="btn" disabled={!dirty || !draft.name.trim() || save.isPending} aria-describedby={status ? `${ids}-status` : undefined}>
          {save.isPending ? t('families.saving') : t('families.save')}
        </button>
        {status && <span id={`${ids}-status`} role={status.ok ? 'status' : 'alert'} className={status.ok ? 'muted' : 'families-error'}>{status.text}</span>}
      </div>
    </form>
  );
}

/** Deleting: the export first, then the family's id typed, then a passkey confirmation (the server asks for it). */
function DeleteFamily({ family: f, onClose }: { family: FamilyAdminRow; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const ids = useId();
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const remove = useMutation({
    mutationFn: () => withFreshProof(() => deleteFamily({ data: { tree: f.id, confirm: typed } })),
    onSuccess: async () => {
      try { if (JSON.parse(localStorage.getItem('kindred:last-visit') ?? 'null')?.tree === f.id) localStorage.removeItem('kindred:last-visit'); } catch {}
      await qc.invalidateQueries({ queryKey: ['session'] });
      await qc.invalidateQueries({ queryKey: ['families'] });
      qc.removeQueries({ queryKey: ['graph', f.id] });
      onClose();
      await navigate({ to: '/families' });
    },
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
        <Notice icon={<Trash2 size={15} aria-hidden />}>{t('families.delete_warning', { count: f.people })}</Notice>
        <p className="families-p">{t('families.delete_export')}</p>
        <div className="families-row">
          <a className="btn" href={`/api/export/${f.id}?format=markdown`} download><Download size={16} aria-hidden /> {t('families.export_markdown')}</a>
          <a className="btn" href={`/api/export/${f.id}?format=gedcom`} download><Download size={16} aria-hidden /> {t('families.export_gedcom')}</a>
        </div>
        <form id={`${ids}-form`} className="families-form" onSubmit={(e) => { e.preventDefault(); if (ready && !remove.isPending) remove.mutate(); }}>
          {/* Not a .field: its label is set in capitals in two themes, and the address to type is lower-case. */}
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
