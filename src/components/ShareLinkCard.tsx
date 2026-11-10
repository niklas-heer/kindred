// The steward's family share link on the Access page: make it, copy the link, the password or a ready message, replace it, or turn
// it off. The server keeps only hashes, so the link and the password can be shown only to the browser that made them. Whether the
// link protects living people is chosen when it is made (on by default) and can be switched at any time without replacing it.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Link2, Link2Off, MessageCircle, RefreshCw, TriangleAlert } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { Dialog, Notice, Select, Skeleton } from '~/components/ui';
import { Switch } from '~/components/ui/Switch';
import { makeShareLink, revokeShareLink, setShareProtectLiving, shareStateQuery } from '~/lib/auth/share.functions';
import { errorText } from '~/lib/errortext';
import { formatDate, useT, type Key, type Translator } from '~/lib/i18n';
import '~/styles/access.css';

interface Known { id: string; generation: number; url: string; password: string | null }
type Days = 1 | 7 | 30 | 90 | null;

// As with invitations, the browser that made the link remembers it, so "Copy" keeps working here and only here.
const storeKey = (tree: string) => `kindred:share-link:${tree}`;
const readKnown = (tree: string): Known | null => { try { return JSON.parse(localStorage.getItem(storeKey(tree)) ?? 'null') as Known | null; } catch { return null; } };
const writeKnown = (tree: string, known: Known) => { try { localStorage.setItem(storeKey(tree), JSON.stringify(known)); } catch {} };
const forgetKnown = (tree: string) => { try { localStorage.removeItem(storeKey(tree)); } catch {} };

const CHOICES: { value: string; days: Days; label: Key }[] = [
  { value: '1', days: 1, label: 'share.day1' },
  { value: '7', days: 7, label: 'share.week1' },
  { value: '30', days: 30, label: 'share.days30' },
  { value: '90', days: 90, label: 'share.days90' },
  { value: 'never', days: null, label: 'share.never' },
];

function CopyButton({ text, label, icon, primary }: { text: string; label: string; icon: React.ReactNode; primary?: boolean }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };
  return <button className={primary ? 'btn primary' : 'btn'} onClick={() => void copy()}>{copied ? <><Check size={15} /> {t('share.copied')}</> : <>{icon} {label}</>}</button>;
}

export function ShareLinkCard({ tree, familyName }: { tree: string; familyName: string }) {
  const t = useT();
  const qc = useQueryClient();
  const state = useQuery(shareStateQuery(tree));
  const [known, setKnown] = useState<Known | null>(null);
  const [making, setMaking] = useState(false);
  const [turningOff, setTurningOff] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setKnown(readKnown(tree)); }, [tree]);

  const refresh = () => qc.invalidateQueries({ queryKey: ['session', 'share', tree] });
  const revoke = useMutation({
    mutationFn: () => revokeShareLink({ data: { tree } }),
    onSuccess: () => { setTurningOff(false); forgetKnown(tree); setKnown(null); return refresh(); },
    onError: (e) => { setTurningOff(false); setError(errorText(e, t.locale)); },
  });
  const protect = useMutation({
    mutationFn: (on: boolean) => setShareProtectLiving({ data: { tree, protectLiving: on } }),
    onSuccess: () => refresh(),
    onError: () => setError(t('share.protectLivingFailed')),
  });

  const link = state.data?.link ?? null;
  // Only a copy of the link as it is now: an older copy names a link that no longer works.
  const shown = link && known && known.id === link.id && known.generation === link.generation ? known : null;

  return (
    <section className="ui-card share-card" aria-labelledby="acc-share-heading">
      <h2 className="rule" id="acc-share-heading">{t('share.heading')}</h2>
      <p>{t('share.intro')}</p>
      {error && <Notice onDismiss={() => setError(null)} className="acc-notice">{error}</Notice>}
      {state.isPending ? <Skeleton lines={2} /> : state.isError ? <p className="acc-error" role="alert">{t('share.loadFailed')}</p> : (
        <>
          {state.data?.behindAccess && <Notice icon={<TriangleAlert size={15} />}>{t('share.behindAccess')}</Notice>}
          {link ? (
            <>
              <p className="share-status">
                <span className="chip" data-ended={link.ended || undefined}>{link.ended ? t('share.statusEnded', { date: formatDate(link.expires!, t.locale) }) : link.expires ? t('share.statusUntil', { date: formatDate(link.expires, t.locale) }) : t('share.statusForever')}</span>
                <span className="chip">{link.hasPassword ? t('share.hasPassword') : t('share.noPassword')}</span>
              </p>
              <ProtectLiving checked={protect.isPending ? protect.variables : link.protectLiving} disabled={protect.isPending} onChange={(on) => protect.mutate(on)} />
              {shown ? <Shared known={shown} familyName={familyName} /> : <p className="acc-hint share-note">{t('share.forgotten')}</p>}
              <div className="share-actions">
                <button className="btn" onClick={() => setMaking(true)}><RefreshCw size={15} /> {t('share.makeNew')}</button>
                <button className="btn ghost" onClick={() => setTurningOff(true)} disabled={revoke.isPending}><Link2Off size={15} /> {t('share.turnOff')}</button>
              </div>
            </>
          ) : (
            <div className="share-actions">
              <button className="btn primary" disabled={state.data?.behindAccess} onClick={() => setMaking(true)}><Link2 size={15} /> {t('share.make')}</button>
            </div>
          )}
        </>
      )}

      <ShareDialog
        open={making}
        tree={tree}
        replacing={!!link}
        onClose={() => setMaking(false)}
        onMade={(made) => {
          writeKnown(tree, made);
          setKnown(made);
          setMaking(false);
          return refresh();
        }}
      />
      <Dialog
        open={turningOff}
        onClose={() => setTurningOff(false)}
        title={t('share.offTitle')}
        width={440}
        description={<>{t('share.offText')}</>}
        footer={
          <>
            <button className="btn" data-autofocus onClick={() => setTurningOff(false)}>{t('common.cancel')}</button>
            <button className="btn primary acct-danger" onClick={() => revoke.mutate()} disabled={revoke.isPending}>{t('share.turnOff')}</button>
          </>
        }
      />
    </section>
  );
}

/** The switch for protecting living people, with one sentence on what it means either way. */
function ProtectLiving({ checked, disabled, onChange }: { checked: boolean; disabled?: boolean; onChange: (on: boolean) => void }) {
  const t = useT();
  const hint = useId();
  return (
    <>
      <Switch checked={checked} disabled={disabled} onChange={onChange} aria-describedby={hint}>{t('share.protectLiving')}</Switch>
      <p className="acc-hint share-note" id={hint}>{t(checked ? 'share.protectLivingHint' : 'share.protectLivingOff')}</p>
    </>
  );
}

/** The link, the password and the ready message, each with its own copy button. */
function Shared({ known, familyName }: { known: Known; familyName: string }) {
  const t = useT();
  const message = shareMessage(t, familyName, known);
  return (
    <div className="share-shown">
      <label>
        <span>{t('share.linkLabel')}</span>
        <span className="acc-link">
          <input className="input" readOnly value={known.url} onFocus={(e) => e.currentTarget.select()} />
          <CopyButton text={known.url} label={t('share.copyLink')} icon={<Copy size={15} />} />
        </span>
      </label>
      {known.password && (
        <label>
          <span>{t('share.passwordLabel')}</span>
          <span className="acc-link">
            <input className="input" readOnly value={known.password} onFocus={(e) => e.currentTarget.select()} />
            <CopyButton text={known.password} label={t('share.copyPassword')} icon={<Copy size={15} />} />
          </span>
        </label>
      )}
      <label>
        <span>{t('share.messageLabel')}</span>
        <textarea className="input share-message" readOnly value={message} rows={4} onFocus={(e) => e.currentTarget.select()} />
      </label>
      <div className="share-actions">
        <CopyButton text={message} label={t('share.copyMessage')} icon={<MessageCircle size={15} />} primary />
      </div>
      <p className="acc-hint share-note">{t('share.keptHere')}</p>
    </div>
  );
}

/** The short message to paste into a chat or an email, in the steward's language. */
export function shareMessage(t: Translator, family: string, known: Pick<Known, 'url' | 'password'>): string {
  return known.password
    ? t('share.message', { family, url: known.url, password: known.password })
    : t('share.messageOpen', { family, url: known.url });
}

function ShareDialog({ open, tree, replacing, onClose, onMade }: { open: boolean; tree: string; replacing: boolean; onClose: () => void; onMade: (made: Known) => unknown }) {
  const t = useT();
  const [password, setPassword] = useState(true);
  const [days, setDays] = useState('30');
  // On for every new link: a link can be forwarded, and the living, children above all, are better protected by default.
  const [protectLiving, setProtectLiving] = useState(true);
  const make = useMutation({
    mutationFn: () => makeShareLink({ data: { tree, password, days: CHOICES.find((c) => c.value === days)!.days, protectLiving } }),
    onSuccess: (r) => onMade({ id: r.id, generation: r.generation, url: r.url, password: r.password }),
  });
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t(replacing ? 'share.dialogTitleNew' : 'share.dialogTitle')}
      width={480}
      footer={
        <>
          <button className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn primary" disabled={make.isPending} onClick={() => make.mutate()}>{make.isPending ? t('share.making') : t(replacing ? 'share.confirmNew' : 'share.make')}</button>
        </>
      }
    >
      <div className="acc-form">
        {replacing && <p className="acc-ready">{t('share.replaceText')}</p>}
        <Switch checked={password} onChange={setPassword}>{t('share.usePassword')}</Switch>
        <p className="acc-hint share-note">{t(password ? 'share.usePasswordHint' : 'share.noPasswordWarn')}</p>
        <ProtectLiving checked={protectLiving} onChange={setProtectLiving} />
        <label className="field">
          <span>{t('share.endsAfter')}</span>
          <Select<string> value={days} options={CHOICES.map((c) => ({ value: c.value, label: t(c.label) }))} onChange={setDays} aria-label={t('share.endsAfter')} />
        </label>
        {make.isError && <p className="acc-error" role="alert">{errorText(make.error, t.locale)}</p>}
      </div>
    </Dialog>
  );
}
