// "View as", the browser's half (the rules are the server's: src/lib/auth/view-as.server.ts). The bar every page of a family
// shows while a steward previews it, the chooser that starts or switches a preview, and the helpers the account menu and the
// Access page use. Starting and stopping load the page afresh, so no read cached for one reader is ever shown to another.
import { useQuery } from '@tanstack/react-query';
import { Eye, Ghost, Repeat, UserRound, X } from 'lucide-react';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Dialog } from '~/components/ui/Dialog';
import { stopViewAs, startViewAs, viewAsChoicesQuery } from '~/lib/auth/view-as.functions';
import type { ViewAsInfo } from '~/lib/auth/functions';
import { errorText } from '~/lib/errortext';
import { useFamily } from '~/lib/family';
import { displayName } from '~/lib/graph';
import { useT, type Key, type Translator } from '~/lib/i18n';
import { ROLES, type Role } from '~/lib/roles';
import { useSession } from '~/lib/session';
import './viewas.css';

type Choice = { kind: 'role'; role: 'viewer' | 'contributor' | 'editor' } | { kind: 'member'; member: string } | { kind: 'guest' };

/** What the page says once it has loaded again after a start or a stop (kept for that one load). */
const ANNOUNCE = 'kindred:view-as-announce';
const remember = (what: 'start' | 'stop') => { try { sessionStorage.setItem(ANNOUNCE, what); } catch { /* storage is off: no announcement */ } };

/** Starts (or switches to) a preview of `tree`, then opens the family afresh as that reader. */
export async function startPreview(tree: string, choice: Choice): Promise<void> {
  await startViewAs({ data: { tree, choice } });
  remember('start');
  window.location.assign(`/${tree}`);
}

/** Ends this browser's preview and loads the page afresh as the steward. */
export async function stopPreview(): Promise<void> {
  await stopViewAs();
  remember('stop');
  window.location.assign(window.location.pathname + window.location.search);
}

// The chooser is one dialog for the family, opened from the bar, the account menu and the Access page.
let chooserOpen = false;
const subs = new Set<() => void>();
const setChooser = (v: boolean) => { chooserOpen = v; subs.forEach((s) => s()); };
/** Opens the "View as" chooser. */
export const openViewAs = () => setChooser(true);

/** The session's preview, if it has one. */
export function useViewAs(): ViewAsInfo | undefined {
  return useSession()?.viewAs;
}

const roleLabel = (t: Translator, role: Role) => t(ROLES.find((r) => r.id === role)!.label);

/** Who the preview shows, in a few words: "Viewing as Milo Member", "Viewing as a viewer". */
export function previewWho(t: Translator, v: ViewAsInfo): string {
  if (v.kind === 'member') return t('viewas.as_member', { name: v.name ?? '' });
  if (v.kind === 'guest') return t(v.link ? 'viewas.as_guest' : 'viewas.as_plain_guest');
  return t(`viewas.as_${v.role as 'viewer' | 'contributor' | 'editor'}` as Key);
}

/**
 * The bar while a preview is on: who, the role, that nothing is saved, Switch and Stop. Also the polite announcement after a
 * preview started or stopped (the page was loaded afresh, so it is said once the new page is there).
 */
export function ViewAsBar({ tree, familyName }: { tree: string; familyName?: string }) {
  const t = useT();
  const v = useViewAs();
  const [said, setSaid] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Read once, on the first load after a start or a stop.
  useEffect(() => {
    try {
      setPending(sessionStorage.getItem(ANNOUNCE));
      sessionStorage.removeItem(ANNOUNCE);
    } catch { /* storage is off: no announcement */ }
  }, []);
  useEffect(() => {
    if (!pending) return;
    // After the page has settled, so a screen reader is listening to the live region by then.
    const timer = setTimeout(() => {
      setSaid(pending === 'start' && v ? t('viewas.started', { who: previewWho(t, v) }) : pending === 'stop' ? t('viewas.stopped') : '');
      setPending(null);
    }, 600);
    return () => clearTimeout(timer);
  }, [pending, t, v]);

  const stop = async () => {
    setBusy(true);
    setError(null);
    try {
      await stopPreview();
    } catch {
      setBusy(false);
      setError(t('viewas.err_stop_failed'));
    }
  };

  return (
    <>
      <p className="sr-only" role="status" aria-live="polite">{said}</p>
      {v && (
        <aside className="viewas-bar" aria-label={t('viewas.bar_label')}>
          <span className="viewas-bar-icon" aria-hidden>{v.kind === 'guest' ? <Ghost size={18} /> : v.kind === 'member' ? <UserRound size={18} /> : <Eye size={18} />}</span>
          <p className="viewas-bar-text">
            <b>{previewWho(t, v)}</b>
            <span>{v.kind === 'guest' ? t('viewas.bar_guest_role') : t('viewas.bar_role', { role: roleLabel(t, v.role) })}</span>
            {v.kind === 'guest' && <span>{t(v.protectLiving ? 'viewas.bar_protected' : 'viewas.bar_unprotected')}</span>}
            {v.tree !== tree && familyName && <span>{t('viewas.bar_family', { family: familyName })}</span>}
            <span className="viewas-bar-saved">{t('viewas.bar_saved')}</span>
          </p>
          {error && <p className="viewas-bar-error" role="alert">{error}</p>}
          <span className="viewas-bar-actions">
            {v.tree === tree && (
              <button type="button" className="btn viewas-btn" onClick={openViewAs} aria-haspopup="dialog">
                <Repeat size={15} aria-hidden /> {t('viewas.switch')}
              </button>
            )}
            <button type="button" className="btn viewas-btn viewas-stop" onClick={() => void stop()} disabled={busy} aria-label={t('viewas.stop_aria')}>
              <X size={15} aria-hidden /> {t('viewas.stop')}
            </button>
          </span>
        </aside>
      )}
    </>
  );
}

/** The chooser for this family, for its stewards. Renders nothing until it is opened. */
export function ViewAsHost({ tree }: { tree: string }) {
  const open = useSyncExternalStore((l) => (subs.add(l), () => subs.delete(l)), () => chooserOpen, () => false);
  // Leaving the family closes it.
  useEffect(() => () => setChooser(false), []);
  if (!open) return null;
  return <Chooser tree={tree} onClose={() => setChooser(false)} />;
}

function Chooser({ tree, onClose }: { tree: string; onClose: () => void }) {
  const t = useT();
  const f = useFamily();
  const current = useViewAs();
  const here = current?.tree === tree ? current : undefined;
  const choices = useQuery(viewAsChoicesQuery(tree));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choose = async (choice: Choice) => {
    setBusy(true);
    setError(null);
    try {
      await startPreview(tree, choice);
    } catch (e) {
      setBusy(false);
      setError(errorText(e, t.locale) || t('viewas.err_failed'));
    }
  };
  const personName = (id: string | null) => {
    const p = id ? f.byId.get(id) : undefined;
    return p ? displayName(p, f) : null;
  };

  return (
    <Dialog open onClose={onClose} title={t('viewas.title')} width={560} description={t('viewas.intro', { family: f.graph.tree.name })}>
      <div className="viewas-chooser" aria-busy={busy || undefined}>
        {error && <p className="viewas-error" role="alert">{error}</p>}

        <section aria-labelledby="viewas-roles">
          <h3 id="viewas-roles">{t('viewas.role_heading')}</h3>
          <p className="viewas-hint">{t('viewas.role_hint')}</p>
          <ul className="viewas-options">
            {(['viewer', 'contributor', 'editor'] as const).map((role) => {
              const r = ROLES.find((x) => x.id === role)!;
              const now = here?.kind === 'role' && here.role === role;
              return (
                <li key={role}>
                  <button type="button" className="viewas-option" disabled={busy} aria-current={now || undefined} onClick={() => void choose({ kind: 'role', role })}>
                    <b>{t(r.label)}</b> <small>{t(r.description)}</small>
                    {now && <span className="chip">{t('viewas.current')}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <section aria-labelledby="viewas-members">
          <h3 id="viewas-members">{t('viewas.member_heading')}</h3>
          <p className="viewas-hint">{t('viewas.member_hint')}</p>
          {choices.isPending ? (
            <p className="viewas-hint" aria-busy="true">{t('viewas.loading')}</p>
          ) : choices.isError ? (
            <p className="viewas-error" role="alert">{t('viewas.load_failed')}</p>
          ) : !choices.data.members.length ? (
            <p className="viewas-hint">{t('viewas.no_members')}</p>
          ) : (
            <ul className="viewas-options">
              {choices.data.members.map((m) => {
                const linked = personName(m.person);
                const now = here?.kind === 'member' && here.member === m.id;
                return (
                  <li key={m.id}>
                    <button type="button" className="viewas-option" disabled={busy} aria-current={now || undefined} onClick={() => void choose({ kind: 'member', member: m.id })}>
                      <b>{m.name}</b> <small>{roleLabel(t, m.role)} · {linked ? t('viewas.member_linked', { name: linked }) : t('viewas.member_unlinked')}</small>
                      {now && <span className="chip">{t('viewas.current')}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section aria-labelledby="viewas-guest">
          <h3 id="viewas-guest">{t('viewas.guest_heading')}</h3>
          {choices.data && (
            <button type="button" className="viewas-option" disabled={busy} aria-current={here?.kind === 'guest' || undefined} onClick={() => void choose({ kind: 'guest' })}>
              <b>{t(choices.data.link ? 'viewas.guest_link' : 'viewas.guest_plain')}</b>
              <small>{choices.data.link ? t(choices.data.link.protectLiving ? 'viewas.guest_link_protected' : 'viewas.guest_link_open') : t('viewas.guest_plain_hint')}</small>
              {here?.kind === 'guest' && <span className="chip">{t('viewas.current')}</span>}
            </button>
          )}
        </section>
      </div>
    </Dialog>
  );
}
