import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Check, Copy, Eye, Ghost, KeyRound, Mail, RefreshCw, Share2, Trash2, UserPlus, Users, X } from 'lucide-react';
import { useState } from 'react';
import { ago, Initials } from '~/components/AccountMenu';
import { Portrait } from '~/components/Portrait';
import { ShareLinkCard } from '~/components/ShareLinkCard';
import { openViewAs, startPreview } from '~/components/viewas/ViewAs';
import { JoinRequests } from '~/components/join/JoinRequests';
import { FamilyDataRequests } from '~/components/operator/FamilyDataRequests';
import { ROLE_ICON } from '~/components/RoleIcon';
import { Dialog, EmptyState, ErrorState, Notice, PageHeader, Select, Skeleton } from '~/components/ui';
import { accessQuery, answerPersonLink, createInvite, removeMember, renewInvite, revokeInvite, setMemberRole, type AccessInvite, type AccessMember } from '~/lib/auth/functions';
import { BROWSING, useFamily, useTreeId } from '~/lib/family';
import { displayName } from '~/lib/graph';
import { errorText } from '~/lib/errortext';
import { opKeys } from '~/lib/api';
import { updateFamilyDetails } from '~/lib/family-details.functions';
import { dateText, translateMessage, useT, type Key, type Locale, type Translator } from '~/lib/i18n';
import { toast } from '~/lib/toast';
import '~/styles/manage.css';
import { ROLES, type Role } from '~/lib/roles';
import { useCan, useSession } from '~/lib/session';
import { sectionHead } from '~/lib/title';
import '~/styles/access.css';

export const Route = createFileRoute('/$tree/access')({
  head: sectionHead('Access'),
  component: AccessPage,
});

/** The short date shown on invitations, in the reader's language. */
type ShortDate = { format: (at: number) => string };
const shortDate = (locale: Locale): ShortDate => ({ format: (at) => dateText(at, locale, { day: 'numeric', month: 'short' }) });
const roleLabel = (t: Translator, r: Role) => t(ROLES.find((x) => x.id === r)!.label);

// A link is shown once by the server; this browser remembers the ones its steward made, for "Copy link".
const linkKey = (id: string) => `kindred:invite-link:${id}`;
const rememberLink = (id: string, url: string) => { try { localStorage.setItem(linkKey(id), url); } catch {} };
const knownLink = (id: string) => { try { return localStorage.getItem(linkKey(id)); } catch { return null; } };
const forgetLink = (id: string) => { try { localStorage.removeItem(linkKey(id)); } catch {} };
const inviteUrl = (token: string) => `${window.location.origin}/invite/${token}`;

function daysLeft(t: Translator, ms: number, date: ShortDate): string {
  const d = Math.ceil((ms - Date.now()) / 86_400_000);
  return d <= 1 ? t('acc.expiresWithinDay') : t('acc.expiresIn', { count: d, date: date.format(ms) });
}

function AccessPage() {
  const t = useT();
  const tree = useTreeId();
  const f = useFamily();
  const steward = useCan('manage-access');
  const signInMethod = useSession()?.auth;
  const access = useQuery({ ...accessQuery(tree), enabled: steward });
  const qc = useQueryClient();
  const [inviting, setInviting] = useState(false);
  const [removing, setRemoving] = useState<AccessMember | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, rerender] = useState(0);
  const dateFmt = shortDate(t.locale);

  const refresh = () => qc.invalidateQueries({ queryKey: ['session'] });
  // Starting a preview loads the family afresh as that reader; a refusal is shown here.
  const viewAs = (choice: Parameters<typeof startPreview>[1]) => { setError(null); startPreview(tree, choice).catch((e: unknown) => setError(errorText(e, t.locale))); };
  const onError = (e: Error) => setError(translateMessage(e.message, t.locale));
  const role = useMutation({ mutationFn: (v: { user: string; role: Role }) => setMemberRole({ data: { tree, ...v } }), onSuccess: refresh, onError });
  const remove = useMutation({ mutationFn: (user: string) => removeMember({ data: { tree, user } }), onSuccess: () => { setRemoving(null); return refresh(); }, onError: (e) => { setRemoving(null); onError(e); } });
  // Whatever the answer, the list is read again: a member may have changed who they say they are.
  const answer = useMutation({
    mutationFn: (v: { user: string; person: string; confirm: boolean }) => answerPersonLink({ data: { tree, ...v } }),
    onError,
    onSettled: () => Promise.all([refresh(), qc.invalidateQueries({ queryKey: ['ai-attention', tree] }), qc.invalidateQueries({ queryKey: ['ai-activity', tree] })]),
  });
  const revoke = useMutation({ mutationFn: (id: string) => revokeInvite({ data: { tree, id } }), onSuccess: (_, id) => { forgetLink(id); return refresh(); }, onError });
  const renew = useMutation({
    mutationFn: (id: string) => renewInvite({ data: { tree, id } }),
    onSuccess: async (r, id) => { const url = inviteUrl(r.token); rememberLink(id, url); await copy(url); rerender((n) => n + 1); return refresh(); },
    onError,
  });

  if (!steward) {
    return (
      <div className="page"><div className="page-inner">
        <EmptyState icon={<KeyRound size={30} />} title={t('acc.onlyStewardsTitle')} text={t('acc.onlyStewardsText', { family: f.graph.tree.name })} />
      </div></div>
    );
  }

  const data = access.data;
  const members = data?.members ?? [];
  const waitingLinks = data?.waitingLinks ?? [];
  const stewards = members.filter((m) => m.role === 'steward').length;
  const pending = (data?.invites ?? []).filter((i) => i.status === 'open');
  const past = (data?.invites ?? []).filter((i) => i.status !== 'open').slice(0, 20);

  const personOf = (m: AccessMember) => {
    if (!m.person) return <span className="acc-person">{t('acc.hasntSaid')}</span>;
    if (m.person === BROWSING) return <span className="acc-person">{t('acc.justBrowsing')}</span>;
    const p = f.byId.get(m.person);
    if (!p) return null;
    return <span className="acc-person"><Portrait person={p} tree={tree} size={22} frame={false} /> {t('acc.linkedTo', { name: displayName(p, f) })}</span>;
  };

  return (
    <div className="page">
      <div className="page-inner acc">
        <PageHeader
          title={t('acc.title')}
          icon={<Users size={24} />}
          subtitle={t('acc.subtitle', { family: f.graph.tree.name })}
          actions={<button className="btn primary" data-tour="access-invite" onClick={() => setInviting(true)}><UserPlus size={16} /> {t('acc.inviteSomeone')}</button>}
        />
        {error && <Notice onDismiss={() => setError(null)} className="acc-notice">{error}</Notice>}
        {/* Requests to join come first: someone is waiting for an answer. */}
        <JoinRequests tree={tree} />
        {/* Data requests about this family (access, correction, deletion), sent through the server's operator. */}
        <FamilyDataRequests tree={tree} />

        {access.isPending ? (
          <div className="ui-card" aria-busy="true" aria-label={t('acc.loadingMembers')}><Skeleton lines={4} /></div>
        ) : access.isError ? (
          <ErrorState title={t('acc.loadFailed')} error={access.error} onRetry={() => void access.refetch()} />
        ) : (
          <>
            {waitingLinks.length > 0 && (
              <>
                <h2 className="rule">{t('acc.linksWaiting')} <small>{waitingLinks.length}</small></h2>
                <p className="acc-hint">{t('acc.linksWaitingText')}</p>
                <ul className="acc-list acc-inv ui-card" style={{ padding: 0 }}>
                  {waitingLinks.map((l) => {
                    const p = f.byId.get(l.person);
                    const claimed = p ? displayName(p, f) : l.person;
                    return (
                      <li key={l.user}>
                        <Initials name={l.name} size={40} />
                        <div className="acc-who">
                          <span className="acc-name"><span className="name">{l.name}</span></span>
                          <span className="acc-sub"><span className="acc-person">{p && <Portrait person={p} tree={tree} size={22} frame={false} />} {t('acc.linkClaims', { name: claimed })}</span></span>
                        </div>
                        <div className="acc-inv-actions">
                          <button className="btn primary" aria-label={t('acc.linkConfirmAria', { name: l.name, person: claimed })} disabled={answer.isPending} onClick={() => { setError(null); answer.mutate({ user: l.user, person: l.person, confirm: true }); }}><Check size={15} /> {t('acc.linkConfirm')}</button>
                          <button className="btn ghost" aria-label={t('acc.linkDeclineAria', { name: l.name, person: claimed })} disabled={answer.isPending} onClick={() => { setError(null); answer.mutate({ user: l.user, person: l.person, confirm: false }); }}><X size={15} /> {t('acc.linkDecline')}</button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}

            <h2 className="rule">{t('acc.members')} <small>{members.length}</small></h2>
            <ul className="acc-list ui-card" style={{ padding: 0 }}>
              {members.map((m) => {
                const lastSteward = m.role === 'steward' && stewards <= 1;
                return (
                  <li key={m.id}>
                    <Initials name={m.name} size={40} />
                    <div className="acc-who">
                      <span className="acc-name">
                        <span className="name">{m.name}</span>{m.you && <span className="chip acc-you">{t('common.you')}</span>}
                        {!m.you && (
                          <button type="button" className="btn ghost acc-viewas" aria-label={t('viewas.access_member_aria', { name: m.name })} onClick={() => viewAs({ kind: 'member', member: m.id })}>
                            <Eye size={14} aria-hidden /> {t('viewas.access_member')}
                          </button>
                        )}
                      </span>
                      <span className="acc-sub">{m.email && <span>{m.email}</span>}{personOf(m)}</span>
                    </div>
                    <span className="acc-seen">{t('acc.seen', { when: ago(m.lastSeen, t.locale) })}{signInMethod !== 'cloudflare-access' && <small>{t('acc.passkeys', { count: m.passkeys })}</small>}</span>
                    <div className="acc-role-select">
                      <Select<Role>
                        value={m.role}
                        aria-label={t('acc.roleAria', { name: m.name })}
                        options={roleOptions(t).map((o) => ({ ...o, disabled: lastSteward && o.value !== 'steward' }))}
                        onChange={(r) => { setError(null); role.mutate({ user: m.id, role: r }); }}
                        disabled={role.isPending}
                      />
                      {lastSteward && <span className="acc-only">{t('acc.onlySteward')}</span>}
                    </div>
                    <div className="acc-remove-cell">
                      <button
                        className="btn ghost icon acc-remove"
                        aria-label={t('acc.removeAria', { name: m.name })}
                        title={lastSteward ? t('acc.needsSteward') : t('acc.removeAria', { name: m.name })}
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

            <h2 className="rule">{t('acc.openInvites')} <small>{pending.length}</small></h2>
            {pending.length === 0 ? (
              <p className="acc-empty ui-card">{t('acc.noOpenInvites')} <button className="btn ghost" onClick={() => setInviting(true)}><UserPlus size={15} /> {t('acc.inviteSomeone')}</button></p>
            ) : (
              <ul className="acc-list acc-inv ui-card" style={{ padding: 0 }}>
                {pending.map((i) => <InviteRow key={i.id} i={i} onRevoke={() => revoke.mutate(i.id)} onRenew={() => renew.mutate(i.id)} busy={revoke.isPending || renew.isPending} dateFmt={dateFmt} />)}
              </ul>
            )}
            {past.length > 0 && (
              <details className="acc-history">
                <summary>{t('acc.earlier', { count: past.length })}</summary>
                <ul>
                  {past.map((i) => (
                    <li key={i.id}>
                      <span className="acc-status" data-s={i.status}>{t(i.status === 'used' ? 'acc.statusAccepted' : i.status === 'revoked' ? 'acc.statusWithdrawn' : 'acc.statusExpired')}</span>
                      <span>{roleLabel(t, i.role)}{i.email ? ` · ${i.email}` : ''}</span>
                      <span className="subtle">{i.status === 'used' && i.usedBy ? t('acc.byUsed', { name: i.usedBy, date: dateFmt.format(i.usedAt!) }) : t('acc.madeBy', { name: i.inviter ?? t('acc.aSteward'), date: dateFmt.format(i.created) })}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}

        <h2 className="rule">{t('acc.roleWhatCan')}</h2>
        <div className="acc-roles">
          {ROLES.map((r) => {
            const n = members.filter((m) => m.role === r.id).length;
            return (
              <div className="ui-card" key={r.id}>
                <h3><span className="acc-role-icon" aria-hidden>{ROLE_ICON[r.id]}</span>{t(r.label)}</h3>
                <p>{t(r.description)}.</p>
                {data && <small>{n === 0 ? t('acc.nobodyYet') : t('acc.memberCount', { count: n })}</small>}
              </div>
            );
          })}
        </div>

        {/* "View as": check what a role, a member or a guest gets, without borrowing their phone. */}
        <section className="ui-card acc-viewas-card" aria-labelledby="acc-viewas-heading" data-tour="view-as">
          <h2 className="rule" id="acc-viewas-heading">{t('viewas.access_heading')}</h2>
          <p>{t('viewas.access_text')}</p>
          <div className="share-actions">
            {(['viewer', 'contributor', 'editor'] as const).map((r) => (
              <button key={r} type="button" className="btn" onClick={() => viewAs({ kind: 'role', role: r })}><Eye size={15} aria-hidden /> {roleLabel(t, r)}</button>
            ))}
            <button type="button" className="btn" onClick={() => viewAs({ kind: 'guest' })}><Ghost size={15} aria-hidden /> {t('viewas.guest_heading')}</button>
            <button type="button" className="btn ghost" onClick={openViewAs}>{t('viewas.menu')}</button>
          </div>
        </section>

        {/* People first: who is here and who is invited. What is changed once, or rarely, comes after. */}
        <ShareLinkCard tree={tree} familyName={f.graph.tree.name} />

        {signInMethod && (
          <>
            <h2 className="rule">{t('auth.method_title')}</h2>
            <p className="acc-hint">{signInMethod === 'kindred' ? t('auth.method_kindred') : t('auth.method_cloudflare')}</p>
          </>
        )}

        <FamilyDetails tree={tree} name={f.graph.tree.name} tagline={f.graph.tree.tagline} />
      </div>

      <InviteDialog open={inviting} onClose={() => setInviting(false)} tree={tree} familyName={f.graph.tree.name} onCreated={refresh} />
      <Dialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        title={t('acc.removeTitle', { name: removing?.name ?? '' })}
        width={440}
        description={<>{t('acc.removeText', { family: f.graph.tree.name })} {t('acc.removePersonal')}</>}
        footer={
          <>
            <button className="btn" data-autofocus onClick={() => setRemoving(null)}>{t('acc.keepThem')}</button>
            <button className="btn primary acct-danger" onClick={() => removing && remove.mutate(removing.id)} disabled={remove.isPending}>{t('acc.remove')}</button>
          </>
        }
      />
    </div>
  );
}

/** The role choices with their names and hints, in the reader's language. */
function roleOptions(t: Translator) {
  return ROLES.map((r) => ({ value: r.id, label: t(r.label), icon: ROLE_ICON[r.id], hint: undefined as string | undefined }));
}

/**
 * The family's name and tagline: shown on every page and in every invitation. A steward changes them here; the server checks
 * the steward's permission first, and a retry of the same save writes nothing twice.
 */
function FamilyDetails({ tree, name, tagline }: { tree: string; name: string; tagline: string }) {
  const t = useT();
  const qc = useQueryClient();
  const [keys] = useState(() => opKeys());
  const [draft, setDraft] = useState({ name, tagline });
  const [error, setError] = useState<string | null>(null);
  // The fields follow the family when it changes elsewhere, unless the steward has typed something of their own.
  const [saved, setSaved] = useState({ name, tagline });
  const dirty = draft.name !== saved.name || draft.tagline !== saved.tagline;
  if (saved.name !== name || saved.tagline !== tagline) {
    setSaved({ name, tagline });
    if (!dirty) setDraft({ name, tagline });
  }

  const save = useMutation({
    mutationFn: () => updateFamilyDetails({ data: { tree, opKey: keys.for('family-details', draft), ...draft } }),
    onSuccess: async (done) => {
      keys.clear();
      setError(null);
      setSaved(done);
      setDraft(done);
      await Promise.all([qc.invalidateQueries({ queryKey: ['graph', tree] }), qc.invalidateQueries({ queryKey: ['session'] })]);
      toast({ title: t('acc.familySaved'), body: done.name, icon: 'crown' });
    },
    onError: (e) => setError(errorText(e, t.locale)),
  });

  return (
    <section className="ui-card fam-card" aria-labelledby="acc-family-heading">
      <h2 className="rule" id="acc-family-heading">{t('acc.familyHeading')}</h2>
      <p>{t('acc.familyText')}</p>
      <form className="fam-form" onSubmit={(e) => { e.preventDefault(); if (dirty && draft.name.trim() && !save.isPending) save.mutate(); }}>
        <label>
          <span>{t('acc.familyName')}</span>
          <input className="input" value={draft.name} maxLength={80} required onChange={(e) => setDraft({ ...draft, name: e.target.value })} autoComplete="organization" />
        </label>
        <label>
          <span>{t('acc.familyTagline')}</span>
          <input className="input" value={draft.tagline} maxLength={140} onChange={(e) => setDraft({ ...draft, tagline: e.target.value })} autoComplete="off" />
        </label>
        <p className="acc-hint">{t('acc.familySlug', { slug: tree })}</p>
        <div className="fam-actions">
          <button type="submit" className="btn primary" disabled={!dirty || !draft.name.trim() || save.isPending}>
            {save.isPending ? t('acc.familySaving') : t('acc.familySave')}
          </button>
        </div>
      </form>
      {error && <p role="alert" className="acc-error">{error}</p>}
    </section>
  );
}

async function copy(text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

function InviteRow({ i, onRevoke, onRenew, busy, dateFmt }: { i: AccessInvite; onRevoke: () => void; onRenew: () => void; busy: boolean; dateFmt: ShortDate }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const link = knownLink(i.id);
  return (
    <li>
      <span className="acc-role-icon" aria-hidden>{ROLE_ICON[i.role]}</span>
      <div className="acc-who">
        <span className="acc-name"><span>{roleLabel(t, i.role)}{i.email ? ` · ${i.email}` : ''}</span></span>
        <span className="acc-sub"><span>{daysLeft(t, i.expires, dateFmt)}</span><span>{t('acc.byInviter', { name: i.inviter ?? t('acc.aSteward') })}</span>{!i.email && <span>{t('acc.anyoneLink')}</span>}</span>
      </div>
      <div className="acc-inv-actions">
        {link ? (
          <button className="btn" onClick={async () => { if (await copy(link)) { setCopied(true); setTimeout(() => setCopied(false), 2000); } }}>
            {copied ? <><Check size={15} /> {t('acc.copied')}</> : <><Copy size={15} /> {t('acc.copyLink')}</>}
          </button>
        ) : (
          <button className="btn" onClick={onRenew} disabled={busy} title={t('acc.newLinkTitle')}>
            <RefreshCw size={15} /> {t('acc.newLink')}
          </button>
        )}
        <button className="btn ghost" onClick={onRevoke} disabled={busy}><X size={15} /> {t('acc.revoke')}</button>
      </div>
    </li>
  );
}

const DAYS: { value: string; label: Key }[] = [
  { value: '1', label: 'acc.day1' },
  { value: '7', label: 'acc.week1' },
  { value: '14', label: 'acc.weeks2' },
  { value: '30', label: 'acc.days30' },
];

function InviteDialog({ open, onClose, tree, familyName, onCreated }: { open: boolean; onClose: () => void; tree: string; familyName: string; onCreated: () => void }) {
  const t = useT();
  const [role, setRole] = useState<Role>('contributor');
  const [email, setEmail] = useState('');
  const [days, setDays] = useState('14');
  const [made, setMade] = useState<{ url: string; expires: number; role: Role; email: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const dateFmt = shortDate(t.locale);
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
  const message = made ? t('acc.shareText', { family: familyName, url: made.url }) : '';
  const share = typeof navigator !== 'undefined' && 'share' in navigator;

  return (
    <Dialog
      open={open}
      onClose={close}
      title={made ? t('acc.inviteReady') : t('acc.inviteSomeone')}
      variant="event"
      width={500}
      dirty={!made && !!email.trim()}
      footer={
        made ? (
          <button className="btn primary" onClick={close}>{t('acc.done')}</button>
        ) : (
          <>
            <button className="btn" onClick={close}>{t('common.cancel')}</button>
            <button className="btn primary" form="acc-invite" disabled={create.isPending}><UserPlus size={15} /> {create.isPending ? t('acc.making') : t('acc.makeLink')}</button>
          </>
        )
      }
    >
      {made ? (
        <>
          <p className="acc-ready">
            {t('acc.readyText', {
              who: made.email || t('acc.them'),
              article: t(/^[aeiou]/i.test(made.role) ? 'acc.article.an' : 'acc.article.a'),
              // English and Afrikaans put the role in lower case inside a sentence; German nouns keep their capital.
              role: t.locale === 'de' ? roleLabel(t, made.role) : roleLabel(t, made.role).toLowerCase(),
              date: dateFmt.format(made.expires),
            })} {t('acc.keepsCopy')}
          </p>
          <div className="acc-link">
            <input className="input" readOnly value={made.url} aria-label={t('acc.invitationLink')} onFocus={(e) => e.currentTarget.select()} />
            <button className="btn primary" data-autofocus onClick={async () => { if (await copy(made.url)) setCopied(true); }}>
              {copied ? <><Check size={15} /> {t('acc.copied')}</> : <><Copy size={15} /> {t('acc.copyLink')}</>}
            </button>
          </div>
          <div className="acc-share">
            {share && <button className="btn" onClick={() => void navigator.share({ title: t('acc.shareTitle', { family: familyName }), text: message }).catch(() => {})}><Share2 size={15} /> {t('acc.share')}</button>}
            {made.email && <a className="btn" href={`mailto:${encodeURIComponent(made.email)}?subject=${encodeURIComponent(t('acc.mailSubject', { family: familyName }))}&body=${encodeURIComponent(message)}`}><Mail size={15} /> {t('acc.emailIt')}</a>}
          </div>
        </>
      ) : (
        <form id="acc-invite" className="acc-form" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <label className="field">
            <span>{t('acc.theirRole')}</span>
            <Select<Role> value={role} onChange={setRole} aria-label={t('acc.theirRole')} options={roleOptions(t).map((o) => ({ ...o, hint: t(ROLES.find((r) => r.id === o.value)!.description) }))} menuWidth={420} />
          </label>
          <p className="acc-hint">{t(ROLES.find((r) => r.id === role)!.description)}. {t('acc.canChangeLater')}</p>
          <label className="field">
            <span>{t('acc.theirEmail')}</span>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" autoComplete="off" />
          </label>
          <p className="acc-hint">{t('acc.emailHint')}</p>
          <label className="field">
            <span>{t('acc.linkWorksFor')}</span>
            <Select value={days} onChange={setDays} aria-label={t('acc.linkWorksFor')} options={DAYS.map((d) => ({ value: d.value, label: t(d.label) }))} />
          </label>
          {create.isError && <p className="acc-error" role="alert">{translateMessage(create.error.message, t.locale)}</p>}
        </form>
      )}
    </Dialog>
  );
}
