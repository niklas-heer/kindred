import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Check, Copy, KeyRound, Mail, RefreshCw, Share2, Trash2, UserPlus, Users, X } from 'lucide-react';
import { useState } from 'react';
import { ago, Initials } from '~/components/AccountMenu';
import { Portrait } from '~/components/Portrait';
import { ROLE_ICON } from '~/components/RoleIcon';
import { Dialog, EmptyState, ErrorState, Notice, PageHeader, Select, Skeleton } from '~/components/ui';
import { accessQuery, createInvite, removeMember, renewInvite, revokeInvite, setMemberRole, type AccessInvite, type AccessMember } from '~/lib/auth/functions';
import { BROWSING, useFamily, useTreeId } from '~/lib/family';
import { displayName } from '~/lib/graph';
import { ROLES, type Role } from '~/lib/roles';
import { useCan } from '~/lib/session';
import { sectionHead } from '~/lib/title';
import '~/styles/access.css';

export const Route = createFileRoute('/$tree/access')({
  head: sectionHead('Access'),
  component: AccessPage,
});

const dateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
const roleLabel = (r: Role) => ROLES.find((x) => x.id === r)!.label;
const roleOptions = ROLES.map((r) => ({ value: r.id, label: r.label, icon: ROLE_ICON[r.id], hint: undefined }));

// A link is shown once by the server; this browser remembers the ones its steward made, for "Copy link".
const linkKey = (id: string) => `kindred:invite-link:${id}`;
const rememberLink = (id: string, url: string) => { try { localStorage.setItem(linkKey(id), url); } catch {} };
const knownLink = (id: string) => { try { return localStorage.getItem(linkKey(id)); } catch { return null; } };
const forgetLink = (id: string) => { try { localStorage.removeItem(linkKey(id)); } catch {} };
const inviteUrl = (token: string) => `${window.location.origin}/invite/${token}`;

function daysLeft(ms: number): string {
  const d = Math.ceil((ms - Date.now()) / 86_400_000);
  return d <= 1 ? 'Expires within a day' : `Expires in ${d} days (${dateFmt.format(ms)})`;
}

function AccessPage() {
  const tree = useTreeId();
  const f = useFamily();
  const steward = useCan('manage-access');
  const access = useQuery({ ...accessQuery(tree), enabled: steward });
  const qc = useQueryClient();
  const [inviting, setInviting] = useState(false);
  const [removing, setRemoving] = useState<AccessMember | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, rerender] = useState(0);

  const refresh = () => qc.invalidateQueries({ queryKey: ['session'] });
  const onError = (e: Error) => setError(e.message);
  const role = useMutation({ mutationFn: (v: { user: string; role: Role }) => setMemberRole({ data: { tree, ...v } }), onSuccess: refresh, onError });
  const remove = useMutation({ mutationFn: (user: string) => removeMember({ data: { tree, user } }), onSuccess: () => { setRemoving(null); return refresh(); }, onError: (e) => { setRemoving(null); onError(e); } });
  const revoke = useMutation({ mutationFn: (id: string) => revokeInvite({ data: { tree, id } }), onSuccess: (_, id) => { forgetLink(id); return refresh(); }, onError });
  const renew = useMutation({
    mutationFn: (id: string) => renewInvite({ data: { tree, id } }),
    onSuccess: async (r, id) => { const url = inviteUrl(r.token); rememberLink(id, url); await copy(url); rerender((n) => n + 1); return refresh(); },
    onError,
  });

  if (!steward) {
    return (
      <div className="page"><div className="page-inner">
        <EmptyState icon={<KeyRound size={30} />} title="Only stewards manage access" text={`Ask a steward of ${f.graph.tree.name} if someone should be invited, or if your role should change.`} />
      </div></div>
    );
  }

  const data = access.data;
  const members = data?.members ?? [];
  const stewards = members.filter((m) => m.role === 'steward').length;
  const pending = (data?.invites ?? []).filter((i) => i.status === 'open');
  const past = (data?.invites ?? []).filter((i) => i.status !== 'open').slice(0, 20);

  const personOf = (m: AccessMember) => {
    if (!m.person) return <span className="acc-person">hasn’t said who they are</span>;
    if (m.person === BROWSING) return <span className="acc-person">just browsing</span>;
    const p = f.byId.get(m.person);
    if (!p) return null;
    return <span className="acc-person"><Portrait person={p} tree={tree} size={22} frame={false} /> linked to <b className="name">{displayName(p, f)}</b></span>;
  };

  return (
    <div className="page">
      <div className="page-inner acc">
        <PageHeader
          title="Access"
          icon={<Users size={24} />}
          subtitle={`Who can see and change ${f.graph.tree.name}`}
          actions={<button className="btn primary" onClick={() => setInviting(true)}><UserPlus size={16} /> Invite someone</button>}
        />
        {error && <Notice onDismiss={() => setError(null)} className="acc-notice">{error}</Notice>}

        {access.isPending ? (
          <div className="ui-card" aria-busy="true" aria-label="Loading members"><Skeleton lines={4} /></div>
        ) : access.isError ? (
          <ErrorState title="Couldn’t load who has access" error={access.error} onRetry={() => void access.refetch()} />
        ) : (
          <>
            <h2 className="rule">Members <small>{members.length}</small></h2>
            <ul className="acc-list ui-card" style={{ padding: 0 }}>
              {members.map((m) => {
                const lastSteward = m.role === 'steward' && stewards <= 1;
                return (
                  <li key={m.id}>
                    <Initials name={m.name} size={40} />
                    <div className="acc-who">
                      <span className="acc-name"><span className="name">{m.name}</span>{m.you && <span className="chip acc-you">you</span>}</span>
                      <span className="acc-sub">{m.email && <span>{m.email}</span>}{personOf(m)}</span>
                    </div>
                    <span className="acc-seen">Seen {ago(m.lastSeen)}<small>{m.passkeys} {m.passkeys === 1 ? 'passkey' : 'passkeys'}</small></span>
                    <div className="acc-role-select">
                      <Select<Role>
                        value={m.role}
                        aria-label={`${m.name}’s role`}
                        options={roleOptions.map((o) => ({ ...o, disabled: lastSteward && o.value !== 'steward' }))}
                        onChange={(r) => { setError(null); role.mutate({ user: m.id, role: r }); }}
                        disabled={role.isPending}
                      />
                      {lastSteward && <span className="acc-only">The only steward</span>}
                    </div>
                    <div className="acc-remove-cell">
                      <button
                        className="btn ghost icon acc-remove"
                        aria-label={`Remove ${m.name}`}
                        title={lastSteward ? 'A family needs at least one steward' : `Remove ${m.name}`}
                        disabled={lastSteward}
                        onClick={() => setRemoving(m)}
                      >
                        <Trash2 size={17} />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>

            <h2 className="rule">Open invitations <small>{pending.length}</small></h2>
            {pending.length === 0 ? (
              <p className="acc-empty ui-card">No open invitations. <button className="btn ghost" onClick={() => setInviting(true)}><UserPlus size={15} /> Invite someone</button></p>
            ) : (
              <ul className="acc-list acc-inv ui-card" style={{ padding: 0 }}>
                {pending.map((i) => <InviteRow key={i.id} i={i} onRevoke={() => revoke.mutate(i.id)} onRenew={() => renew.mutate(i.id)} busy={revoke.isPending || renew.isPending} />)}
              </ul>
            )}
            {past.length > 0 && (
              <details className="acc-history">
                <summary>Earlier invitations ({past.length})</summary>
                <ul>
                  {past.map((i) => (
                    <li key={i.id}>
                      <span className="acc-status" data-s={i.status}>{i.status === 'used' ? 'accepted' : i.status === 'revoked' ? 'withdrawn' : 'expired'}</span>
                      <span>{roleLabel(i.role)}{i.email ? ` · ${i.email}` : ''}</span>
                      <span className="subtle">{i.status === 'used' && i.usedBy ? `by ${i.usedBy}, ${dateFmt.format(i.usedAt!)}` : `made by ${i.inviter ?? 'a steward'}, ${dateFmt.format(i.created)}`}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}

        <h2 className="rule">What each role can do</h2>
        <div className="acc-roles">
          {ROLES.map((r) => {
            const n = members.filter((m) => m.role === r.id).length;
            return (
              <div className="ui-card" key={r.id}>
                <h3><span className="acc-role-icon" aria-hidden>{ROLE_ICON[r.id]}</span>{r.label}</h3>
                <p>{r.description}.</p>
                {data && <small>{n === 0 ? 'Nobody yet' : `${n} ${n === 1 ? 'member' : 'members'}`}</small>}
              </div>
            );
          })}
        </div>
      </div>

      <InviteDialog open={inviting} onClose={() => setInviting(false)} tree={tree} familyName={f.graph.tree.name} onCreated={refresh} />
      <Dialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        title={`Remove ${removing?.name ?? ''}?`}
        width={440}
        description={<>They will no longer see {f.graph.tree.name}. Their stories and photos stay. You can invite them again later.</>}
        footer={
          <>
            <button className="btn" data-autofocus onClick={() => setRemoving(null)}>Keep them</button>
            <button className="btn primary acct-danger" onClick={() => removing && remove.mutate(removing.id)} disabled={remove.isPending}>Remove</button>
          </>
        }
      />
    </div>
  );
}

async function copy(text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

function InviteRow({ i, onRevoke, onRenew, busy }: { i: AccessInvite; onRevoke: () => void; onRenew: () => void; busy: boolean }) {
  const [copied, setCopied] = useState(false);
  const link = knownLink(i.id);
  return (
    <li>
      <span className="acc-role-icon" aria-hidden>{ROLE_ICON[i.role]}</span>
      <div className="acc-who">
        <span className="acc-name"><span>{roleLabel(i.role)}{i.email ? ` · ${i.email}` : ''}</span></span>
        <span className="acc-sub"><span>{daysLeft(i.expires)}</span><span>by {i.inviter ?? 'a steward'}</span>{!i.email && <span>anyone with the link</span>}</span>
      </div>
      <div className="acc-inv-actions">
        {link ? (
          <button className="btn" onClick={async () => { if (await copy(link)) { setCopied(true); setTimeout(() => setCopied(false), 2000); } }}>
            {copied ? <><Check size={15} /> Copied</> : <><Copy size={15} /> Copy link</>}
          </button>
        ) : (
          <button className="btn" onClick={onRenew} disabled={busy} title="Only the browser that made a link keeps a copy. A new link replaces the old one and is copied for you.">
            <RefreshCw size={15} /> New link
          </button>
        )}
        <button className="btn ghost" onClick={onRevoke} disabled={busy}><X size={15} /> Revoke</button>
      </div>
    </li>
  );
}

const DAYS = [
  { value: '1', label: '1 day' },
  { value: '7', label: '1 week' },
  { value: '14', label: '2 weeks' },
  { value: '30', label: '30 days' },
];

function InviteDialog({ open, onClose, tree, familyName, onCreated }: { open: boolean; onClose: () => void; tree: string; familyName: string; onCreated: () => void }) {
  const [role, setRole] = useState<Role>('contributor');
  const [email, setEmail] = useState('');
  const [days, setDays] = useState('14');
  const [made, setMade] = useState<{ url: string; expires: number; role: Role; email: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const create = useMutation({
    mutationFn: () => createInvite({ data: { tree, role, email: email.trim(), days: Number(days) } }),
    onSuccess: (r) => {
      const url = inviteUrl(r.token);
      rememberLink(r.id, url);
      setMade({ url, expires: r.expires, role, email: email.trim() });
      onCreated();
    },
  });
  const close = () => {
    onClose();
    setTimeout(() => { setMade(null); setEmail(''); setRole('contributor'); setDays('14'); setCopied(false); create.reset(); }, 200);
  };
  const message = made ? `You’re invited to the ${familyName} family tree on Kindred. Open this link to join: ${made.url}` : '';
  const share = typeof navigator !== 'undefined' && 'share' in navigator;

  return (
    <Dialog
      open={open}
      onClose={close}
      title={made ? 'Invitation ready' : 'Invite someone'}
      variant="event"
      width={500}
      dirty={!made && !!email.trim()}
      footer={
        made ? (
          <button className="btn primary" onClick={close}>Done</button>
        ) : (
          <>
            <button className="btn" onClick={close}>Cancel</button>
            <button className="btn primary" form="acc-invite" disabled={create.isPending}><UserPlus size={15} /> {create.isPending ? 'Making the link…' : 'Make an invitation link'}</button>
          </>
        )
      }
    >
      {made ? (
        <>
          <p className="acc-ready">
            Send this link to {made.email ? <b>{made.email}</b> : 'them'}. It lets one person join as {/^[aeiou]/i.test(made.role) ? 'an' : 'a'} <b>{roleLabel(made.role).toLowerCase()}</b> until {dateFmt.format(made.expires)}. This browser keeps a copy under Open invitations; on another device, make a new link instead.
          </p>
          <div className="acc-link">
            <input className="input" readOnly value={made.url} aria-label="Invitation link" onFocus={(e) => e.currentTarget.select()} />
            <button className="btn primary" data-autofocus onClick={async () => { if (await copy(made.url)) setCopied(true); }}>
              {copied ? <><Check size={15} /> Copied</> : <><Copy size={15} /> Copy link</>}
            </button>
          </div>
          <div className="acc-share">
            {share && <button className="btn" onClick={() => void navigator.share({ title: `Join ${familyName}`, text: message }).catch(() => {})}><Share2 size={15} /> Share…</button>}
            {made.email && <a className="btn" href={`mailto:${encodeURIComponent(made.email)}?subject=${encodeURIComponent(`Join ${familyName} on Kindred`)}&body=${encodeURIComponent(message)}`}><Mail size={15} /> Email it</a>}
          </div>
        </>
      ) : (
        <form id="acc-invite" className="acc-form" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <label className="field">
            <span>Their role</span>
            <Select<Role> value={role} onChange={setRole} aria-label="Their role" options={ROLES.map((r) => ({ value: r.id, label: r.label, icon: ROLE_ICON[r.id], hint: r.description }))} menuWidth={420} />
          </label>
          <p className="acc-hint">{ROLES.find((r) => r.id === role)!.description}. You can change it later.</p>
          <label className="field">
            <span>Their email (optional)</span>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" autoComplete="off" />
          </label>
          <p className="acc-hint">To remember who it’s for. If Kindred runs behind Cloudflare Access, they’re let in with that address without the link.</p>
          <label className="field">
            <span>Link works for</span>
            <Select value={days} onChange={setDays} aria-label="Link works for" options={DAYS} />
          </label>
          {create.isError && <p className="acc-error" role="alert">{create.error.message}</p>}
        </form>
      )}
    </Dialog>
  );
}
