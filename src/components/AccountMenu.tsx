// The signed-in reader's menu in the topbar: who they are, their role in this family, and the way to
// their passkeys, the steward's Access page and signing out. Also `Initials`, a name's monogram.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { Check, Fingerprint, KeyRound, LogOut, Plus, ShieldCheck, Trash2, Users } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { addPasskey, forgetLocalIdentity, passkeysSupported, signOutRequest } from '~/lib/auth/client';
import { myPasskeysQuery, removeMyPasskey, renameMe, type Passkey } from '~/lib/auth/functions';
import { ROLES, can } from '~/lib/roles';
import { useMembership, useSession } from '~/lib/session';
import { Dialog } from './ui/Dialog';
import { isTopOverlay, useOverlayLayer } from './ui/overlay';
import './account.css';

/** A name's initials in a small medallion: "Anna Lindqvist" → "AL". */
export function Initials({ name, size = 32 }: { name: string; size?: number }) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = (words.length > 1 ? words[0][0] + words[words.length - 1][0] : (words[0] ?? '?').slice(0, 2)).toUpperCase();
  return (
    <span className="acct-initials" style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }} aria-hidden>
      {letters}
    </span>
  );
}

const roleOf = (id: string) => ROLES.find((r) => r.id === id);
const article = (word: string) => (/^[aeiou]/i.test(word) ? 'an' : 'a');

/** Signs out everywhere this browser knows about, then reloads at /signin with nothing cached. */
export async function signOut(accessLogout?: string) {
  try { await signOutRequest(); } catch {}
  forgetLocalIdentity();
  window.location.assign(accessLogout ?? '/signin');
}

export function AccountMenu({ familyName }: { familyName?: string }) {
  const session = useSession();
  const tree = useParams({ strict: false }).tree as string | undefined;
  const m = useMembership();
  const [open, setOpen] = useState(false);
  const [passkeys, setPasskeys] = useState(false);
  const layer = useOverlayLayer(open);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();

  // Close on Escape (only when this is the top layer) or a press outside; focus moves into the menu.
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isTopOverlay(layer)) { e.preventDefault(); setOpen(false); button.current?.focus(); }
    };
    const press = (e: PointerEvent) => {
      if (!menu.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', key);
    window.addEventListener('pointerdown', press);
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('pointerdown', press); };
  }, [open, layer]);
  // Hang the menu under its button, kept on screen.
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const r = button.current?.getBoundingClientRect();
    if (r) setPos({ top: Math.round(r.bottom + 6), right: Math.max(10, Math.round(window.innerWidth - r.right)) });
    menu.current?.querySelector<HTMLElement>('a, button')?.focus();
  }, [open]);

  const user = session?.user;
  if (!user) return null;
  const role = m ? roleOf(m.role) : undefined;

  // Arrow keys move between the menu's items.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
    e.preventDefault();
  };

  return (
    <>
      <button
        ref={button}
        className="btn ghost acct-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        title={`${user.name}: your account`}
      >
        <Initials name={user.name} size={30} />
        <span className="acct-trigger-name">{user.name}</span>
      </button>
      {open && (
        <div className="acct-menu panel" id={id} ref={menu} role="menu" aria-label="Your account" onKeyDown={onKeyDown} style={pos ?? undefined}>
          <div className="acct-head">
            <Initials name={user.name} size={44} />
            <div>
              <b className="acct-name">{user.name}</b>
              <span className="acct-sub">{user.via === 'access' ? `Signed in as ${user.email}` : user.email ?? 'Signed in with a passkey'}</span>
            </div>
          </div>
          {role && (
            <p className="acct-role">
              You are {article(role.label)} <b>{role.label.toLowerCase()}</b> in {familyName ?? 'this family'}. <span>{role.description}.</span>
            </p>
          )}
          <div className="acct-items">
            {tree && m && can(m.role, 'manage-access') && (
              <Link role="menuitem" className="acct-item" to="/$tree/access" params={{ tree }} onClick={() => setOpen(false)}>
                <Users size={17} /> Manage access
              </Link>
            )}
            <button role="menuitem" className="acct-item" onClick={() => { setOpen(false); setPasskeys(true); }}>
              <KeyRound size={17} /> Your name &amp; passkeys
            </button>
            <button role="menuitem" className="acct-item" onClick={() => void signOut(session?.accessLogout)}>
              <LogOut size={17} /> Sign out
            </button>
          </div>
        </div>
      )}
      <PasskeysDialog open={passkeys} onClose={() => setPasskeys(false)} />
    </>
  );
}

const dateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
export function ago(ms: number | null): string {
  if (!ms) return 'never';
  const d = Math.floor((Date.now() - ms) / 86_400_000);
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 30) return `${d} days ago`;
  return dateFmt.format(ms);
}

/** "Your name & passkeys": rename yourself, add a passkey on this device, remove an old one. */
export function PasskeysDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const session = useSession();
  const qc = useQueryClient();
  const keys = useQuery({ ...myPasskeysQuery, enabled: open });
  const [name, setName] = useState(session?.user?.name ?? '');
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Passkey | null>(null);
  useEffect(() => { if (open) { setName(session?.user?.name ?? ''); setError(null); } }, [open, session?.user?.name]);

  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['session'] })]);
  const add = useMutation({ mutationFn: addPasskey, onSuccess: refresh, onError: (e) => setError(e.message) });
  const remove = useMutation({
    mutationFn: (id: string) => removeMyPasskey({ data: { id } }),
    onSuccess: () => { setConfirm(null); return refresh(); },
    onError: (e) => { setConfirm(null); setError(e.message); },
  });
  const rename = useMutation({ mutationFn: () => renameMe({ data: { name } }), onSuccess: refresh, onError: (e) => setError(e.message) });
  const list = keys.data ?? [];
  const accessOnly = session?.user?.via === 'access';

  return (
    <>
      <Dialog open={open} onClose={onClose} title="Your name & passkeys" width={520} bodyClassName="acct-dialog">
        <form className="acct-rename" onSubmit={(e) => { e.preventDefault(); setError(null); rename.mutate(); }}>
          <label className="field">
            <span>Your name, as the family sees it</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoComplete="name" />
          </label>
          <button className="btn" disabled={rename.isPending || !name.trim() || name.trim() === session?.user?.name}>
            {rename.isSuccess && name.trim() === session?.user?.name ? <><Check size={15} /> Saved</> : 'Save'}
          </button>
        </form>

        <h3 className="acct-h">Passkeys</h3>
        <p className="acct-help">
          A passkey lets this device sign you in with your face, fingerprint or screen lock: nothing to remember. Add one on each phone or
          computer you use{accessOnly ? ', or keep signing in through your organisation’s login' : ''}.
        </p>
        {error && <p className="acct-error" role="alert">{error}</p>}
        {keys.isPending ? (
          <p className="subtle">Loading your passkeys…</p>
        ) : keys.isError ? (
          <p className="acct-error" role="alert">Your passkeys couldn’t be loaded. <button className="btn ghost" onClick={() => void keys.refetch()}>Retry</button></p>
        ) : list.length === 0 ? (
          <p className="subtle">No passkeys yet.</p>
        ) : (
          <ul className="acct-keys">
            {list.map((k) => (
              <li key={k.id}>
                <span className="acct-key-icon" aria-hidden><Fingerprint size={20} /></span>
                <div>
                  <b>{k.device ?? 'Passkey'}</b>
                  <span>
                    Added {dateFmt.format(k.created)} · used {ago(k.lastUsed)}
                    {k.synced && <> · <ShieldCheck size={13} aria-hidden /> synced</>}
                  </span>
                </div>
                <button
                  className="btn ghost icon acct-key-remove"
                  aria-label={`Remove the passkey on ${k.device ?? 'this device'}`}
                  title={list.length <= 1 && !accessOnly ? 'Your only passkey: add another first' : 'Remove'}
                  disabled={list.length <= 1 && !accessOnly}
                  onClick={() => setConfirm(k)}
                >
                  <Trash2 size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
        {passkeysSupported() && (
          <button className="btn acct-add" onClick={() => { setError(null); add.mutate(); }} disabled={add.isPending}>
            <Plus size={16} /> {add.isPending ? 'Waiting for your device…' : 'Add a passkey on this device'}
          </button>
        )}
        {add.isSuccess && <p className="acct-ok" role="status"><Check size={15} /> Passkey added.</p>}
      </Dialog>
      <Dialog
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title="Remove this passkey?"
        width={420}
        description={<>The passkey on <b>{confirm?.device ?? 'that device'}</b> will no longer sign you in. You can add it again later.</>}
        footer={
          <>
            <button className="btn" data-autofocus onClick={() => setConfirm(null)}>Keep it</button>
            <button className="btn primary acct-danger" onClick={() => confirm && remove.mutate(confirm.id)} disabled={remove.isPending}>Remove</button>
          </>
        }
      />
    </>
  );
}
