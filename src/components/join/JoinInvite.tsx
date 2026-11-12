// "Ask to join", the guest's side: a quiet invitation on a share-link guest's pages, the form that makes a passkey and sends a
// request (showing first exactly what the stewards will receive), the "waiting for a steward" note, and, once a steward has said
// yes, the button that signs the new member in with that passkey. Server rules: src/lib/auth/join.server.ts.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, KeyRound, UserPlus, X } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { WhoPicker } from '~/components/FirstRun';
import { Portrait } from '~/components/Portrait';
import { Dialog } from '~/components/ui/Dialog';
import { forgetLocalIdentity, passkeysSupported, signInWithPasskey } from '~/lib/auth/client';
import { askToJoin, browserContext, onOpenJoin, openJoin } from '~/lib/auth/join-client';
import { fetchJoinPreview, joinStateQuery, sendJoinWithPassword } from '~/lib/auth/join.functions';
import { Link } from '@tanstack/react-router';
import { firstWay, NewPasswordFields, newPasswordReady, useSignInMethods, WayPicker, type NewWay } from '~/components/signin/PasswordFields';
import type { Usage } from '~/lib/auth/join-rules';
import { errorText } from '~/lib/errortext';
import { BROWSING, useFamily } from '~/lib/family';
import { displayName, lifespan } from '~/lib/graph';
import { formatDate, useT, type Key, type Translator } from '~/lib/i18n';
import { useSession } from '~/lib/session';
import './join.css';

const dismissKey = (tree: string) => `kindred:join-dismissed:${tree}`;
const dismissed = (tree: string) => { try { return localStorage.getItem(dismissKey(tree)) === '1'; } catch { return false; } };
const dismiss = (tree: string) => { try { localStorage.setItem(dismissKey(tree), '1'); } catch {} };

/** The request state for a guest of `tree`; nothing is fetched for anyone else. */
export function useJoinState(tree: string) {
  const session = useSession();
  // A steward viewing the family as a guest of its link sees the same invitation ("View as"); pressing it explains instead.
  const guest = !!session?.guest && session.guest.tree === tree && (!session.user || session.viewAs?.kind === 'guest');
  return useQuery({ ...joinStateQuery(tree), enabled: guest, refetchInterval: (q) => (q.state.data?.request?.status === 'open' ? 60_000 : false) }).data;
}

/** On a guest's pages: the invitation, the waiting note or the way in. Renders nothing for members. */
export function JoinInvite({ tree }: { tree: string }) {
  const t = useT();
  const state = useJoinState(tree);
  const preview = useSession()?.viewAs?.kind === 'guest';
  const [hidden, setHidden] = useState(true);
  const [open, setOpen] = useState(false);
  const [explained, setExplained] = useState(false);
  useEffect(() => { setHidden(dismissed(tree)); }, [tree]);
  useEffect(() => onOpenJoin(() => setOpen(true)), []);
  if (!state) return null;

  if (state.request?.status === 'approved') return <Approved tree={tree} />;
  return (
    <>
      {state.request?.status === 'open' && !hidden && (
        <aside className="ui-card join-card" aria-labelledby="join-wait-title">
          <Clock size={20} aria-hidden className="join-card-icon" />
          <div>
            <h2 id="join-wait-title">{t('join.waiting_title')}</h2>
            <p>{t('join.waiting_text', { name: state.request.name, date: formatDate(state.request.expires, t.locale) })}</p>
          </div>
          <button className="btn ghost icon" aria-label={t('ui.dismiss')} onClick={() => { dismiss(tree); setHidden(true); }}><X size={16} /></button>
        </aside>
      )}
      {state.available && !state.request && !hidden && (
        <aside className="ui-card join-card join-card-invite" aria-labelledby="join-invite-title">
          <UserPlus size={20} aria-hidden className="join-card-icon" />
          <div>
            <h2 id="join-invite-title">{t('join.invite_title')}</h2>
            <p>{t('join.invite_text')}</p>
            <div className="join-card-actions">
              <button className="btn primary" onClick={() => (preview ? setExplained(true) : setOpen(true))} aria-describedby={explained ? 'join-preview-note' : undefined}>{t('join.ask')}</button>
              <button className="btn ghost" onClick={() => { dismiss(tree); setHidden(true); }}>{t('join.not_now')}</button>
            </div>
            {explained && <p className="join-preview-note" id="join-preview-note" role="status">{t('viewas.join_preview')}</p>}
          </div>
        </aside>
      )}
      {state.available && !state.request && !preview && <JoinDialog open={open} tree={tree} onClose={() => setOpen(false)} />}
    </>
  );
}

/** A steward said yes: the passkey made with the request signs the new member in. */
function Approved({ tree }: { tree: string }) {
  const t = useT();
  const methods = useSignInMethods();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      await signInWithPasskey();
      forgetLocalIdentity();
      // A full load, so the family is read as a member and nothing of the guest's visit stays in memory.
      window.location.assign(`/${tree}`);
    } catch (e) {
      setError(errorText(e, t.locale));
      setBusy(false);
    }
  };
  return (
    <aside className="ui-card join-card join-card-yes" aria-labelledby="join-yes-title">
      <KeyRound size={20} aria-hidden className="join-card-icon" />
      <div>
        <h2 id="join-yes-title">{t('join.approved_title')}</h2>
        <p>{t('join.approved_text')}</p>
        {error && <p className="acc-error" role="alert">{error}</p>}
        <div className="join-card-actions">
          {methods.includes('passkey') && <button className="btn primary" onClick={() => void go()} disabled={busy}><KeyRound size={16} /> {busy ? t('join.signing_in') : t('join.sign_in')}</button>}
          {/* An account that asked with a username and password signs in on the sign-in page. */}
          {methods.includes('password') && <Link className="btn" to="/signin" search={{ next: `/${tree}` }}>{t('pw.sign_in_with_password')}</Link>}
        </div>
      </div>
    </aside>
  );
}

/** The request form: name, who you are, a message, then the passkey. Shows what the stewards will receive before it is sent. */
function JoinDialog({ open, tree, onClose }: { open: boolean; tree: string; onClose: () => void }) {
  const t = useT();
  const f = useFamily();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [person, setPerson] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(true);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState(true);
  const methods = useSignInMethods();
  const [chosenWay, setWay] = useState<NewWay | null>(null);
  const byPassword = (chosenWay ?? firstWay(methods)) === 'password' && methods.includes('password');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const preview = useQuery({ queryKey: ['join-preview', tree], queryFn: () => fetchJoinPreview({ data: { tree } }), enabled: open, staleTime: 0 });
  const ctx = open ? browserContext() : { timeZone: '', language: '' };
  const nameId = useId();
  const messageId = useId();
  useEffect(() => { if (open) setSupported(passkeysSupported()); }, [open]);

  const chosen = person && person !== BROWSING ? f.byId.get(person) : undefined;
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (choosing) return;
    setBusy(true);
    setError(null);
    try {
      const form = { tree, name: name.trim(), person: person === BROWSING ? null : person, message };
      if (byPassword) await sendJoinWithPassword({ data: { ...form, ...browserContext(), username, password } });
      else await askToJoin(form);
      await qc.invalidateQueries({ queryKey: ['join', tree] });
      onClose();
    } catch (err) {
      setError(errorText(err, t.locale));
    }
    setBusy(false);
  };

  return (
    <Dialog open={open} onClose={onClose} title={t('join.form_title')} description={t('join.form_lede')} width={560} dirty={!!name.trim() || !!message.trim()}
      footer={
        <>
          <button className="btn" type="button" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn primary" form="join-form" disabled={busy || (!supported && !byPassword) || choosing || !name.trim() || (byPassword && !newPasswordReady(username, password))}><KeyRound size={16} /> {busy ? t('join.sending') : t('join.send')}</button>
        </>
      }
    >
      {/* Only the name is inside the form: the person list's buttons must not send it. */}
      <div className="acc-form join-form">
        <form id="join-form" onSubmit={(e) => void send(e)}>
          <label className="field" htmlFor={nameId}>
            <span>{t('join.your_name')}</span>
            <input id={nameId} className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required autoComplete="name" />
          </label>
        </form>
        <fieldset className="join-who">
          <legend>{t('join.who_label')}</legend>
          {choosing ? (
            <>
              <WhoPicker f={f} tree={tree} initialQuery={name} onChoose={(id) => { setPerson(id); setChoosing(false); }} />
              <button type="button" className="btn" onClick={() => { setPerson(BROWSING); setChoosing(false); }}>{t('join.not_in_tree')}</button>
            </>
          ) : (
            <div className="join-chosen">
              {chosen ? <><Portrait person={chosen} tree={tree} size={36} frame={false} /> <b>{displayName(chosen, f)}</b> <span className="subtle">{lifespan(chosen, t.locale)}</span></> : <span>{t('join.not_in_tree')}</span>}
              <button type="button" className="btn ghost" onClick={() => setChoosing(true)}>{t('join.change')}</button>
            </div>
          )}
        </fieldset>
        <label className="field" htmlFor={messageId}>
          <span>{t('join.message_label')}</span>
          <textarea id={messageId} className="input" rows={3} maxLength={500} value={message} onChange={(e) => setMessage(e.target.value)} />
        </label>

        <section className="join-preview" aria-labelledby="join-preview-title">
          <h3 id="join-preview-title">{t('join.preview_title')}</h3>
          {preview.isError ? <p className="acc-error" role="alert">{errorText(preview.error, t.locale)}</p> : (
            <dl className="join-facts">
              <dt>{t('join.fact_name')}</dt><dd>{name.trim() || '—'}</dd>
              <dt>{t('join.fact_who')}</dt><dd>{choosing ? '—' : chosen ? displayName(chosen, f) : t('join.not_in_tree')}</dd>
              <dt>{t('join.fact_message')}</dt><dd className="join-message">{message.trim() || '—'}</dd>
              <Facts t={t} place={preview.data?.place ?? null} loading={preview.isPending} timeZone={ctx.timeZone} language={ctx.language} device={preview.data?.device ?? null} />
              <dt>{t('join.fact_usage')}</dt><dd>{preview.isPending ? '…' : <UsageText t={t} usage={preview.data?.usage ?? null} names={(id) => { const p = f.byId.get(id); return p ? displayName(p, f) : null; }} />}</dd>
            </dl>
          )}
          <p className="acc-hint">{t('join.measured_note')}</p>
        </section>
        <WayPicker methods={methods} value={chosenWay ?? firstWay(methods)} onChange={setWay} />
        {byPassword && <NewPasswordFields username={username} onUsername={setUsername} password={password} onPassword={setPassword} />}
        {!supported && !byPassword && <p className="acc-error" role="alert">{t('join.err_no_passkeys')}</p>}
        {error && <p className="acc-error" role="alert">{error}</p>}
        <p className="acc-hint">{byPassword ? t('pw.join_note') : t('join.passkey_note')}</p>
      </div>
    </Dialog>
  );
}

/** A language tag or a country code in the reader's language ("German (Germany)", "Namibia"), or the code itself. */
export function displayCode(kind: 'language' | 'region', code: string, locale: string): string {
  try { return new Intl.DisplayNames([locale], { type: kind }).of(code) ?? code; } catch { return code; }
}

/** The place, time zone, language and device, as the stewards' card shows them. */
export function Facts({ t, place, timeZone, language, device, loading }: { t: Translator; place: { city: string | null; region: string | null; country: string | null } | null; timeZone: string | null; language: string | null; device: string | null; loading?: boolean }) {
  const where = place ? [place.city, place.region, place.country && displayCode('region', place.country, t.locale)].filter(Boolean).join(', ') : '';
  return (
    <>
      {/* Engines name some countries and languages differently ("UK" or "United Kingdom"): the browser keeps what the server wrote. */}
      <dt>{t('join.fact_place')}</dt><dd suppressHydrationWarning>{loading ? '…' : where || t('join.unknown')}</dd>
      <dt>{t('join.fact_time_zone')}</dt><dd>{timeZone || t('join.unknown')}</dd>
      <dt>{t('join.fact_language')}</dt><dd suppressHydrationWarning>{language ? displayCode('language', language, t.locale) : t('join.unknown')}</dd>
      <dt>{t('join.fact_device')}</dt><dd>{loading ? '…' : !device || device === 'unknown' ? t('join.unknown') : device}</dd>
    </>
  );
}

/** How a guest browser used the link, in one or two plain sentences and a short list. */
export function UsageText({ t, usage, names }: { t: Translator; usage: Usage | null; names: (id: string) => string | null }) {
  if (!usage) return <>{t('join.usage_none')}</>;
  const sections = Object.entries(usage.sections).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0)).map(([k]) => t(`stats.route.${k}` as Key));
  const people = usage.people.map((p) => names(p.id)).filter((n): n is string => !!n);
  const list = (items: string[]) => { try { return new Intl.ListFormat(t.locale, { type: 'conjunction' }).format(items); } catch { return items.join(', '); } };
  return (
    <span className="join-usage">
      <span>{t('join.usage_summary', { first: formatDate(usage.firstSeen, t.locale), count: usage.visits, time: usage.activeMinutes < 1 ? t('join.usage_time_brief') : t('join.usage_time', { count: Math.round(usage.activeMinutes) }) })}</span>
      {sections.length > 0 && <span>{t('join.usage_sections', { list: list(sections) })}</span>}
      {people.length > 0 && <span>{t('join.usage_people', { list: list(people) })}</span>}
    </span>
  );
}

/** The guest chip's part: "Ask to join", or that a steward has the request. */
export function JoinChip({ tree }: { tree: string }) {
  const t = useT();
  const state = useJoinState(tree);
  if (state?.request?.status === 'open') return <span className="join-chip-wait" title={t('join.waiting_title')}><Clock size={14} aria-hidden /> <span className="join-chip-label">{t('join.chip_waiting')}</span></span>;
  if (state?.available && !state.request) return <button className="btn join-chip-ask" title={t('join.ask')} onClick={() => openJoin()}><UserPlus size={15} aria-hidden /> <span>{t('join.ask')}</span></button>;
  return null;
}
