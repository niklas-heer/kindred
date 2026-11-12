// Single sign-on in the browser (src/lib/auth/oidc.server.ts): a button per provider on the sign-in and invitation pages, and
// the account menu's list of providers the reader's account uses (adding one needs a fresh proof and a round trip to the
// provider; removing one needs a fresh proof and another way in).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link2, LogIn, Unlink } from 'lucide-react';
import { useState } from 'react';
import { forgetLocalIdentity, hereForReturn, startSingleSignOn, withFreshProof } from '~/lib/auth/client';
import type { PublicProvider } from '~/lib/auth/oidc';
import { myProvidersQuery, signInMethodsQuery, unlinkMyProvider } from '~/lib/auth/signin.functions';
import { errorText } from '~/lib/errortext';
import { useT, type Key } from '~/lib/i18n';
import './signin.css';

/** What a provider's callback may say went wrong (`?oidc_error=<code>`), as the sentence to show. */
export const OIDC_ERRORS: Record<string, Key> = {
  off: 'oidc.err.off', provider_off: 'oidc.err.provider_off', expired: 'oidc.err.expired', denied: 'oidc.err.denied', provider: 'oidc.err.provider',
  token: 'oidc.err.token', no_account: 'oidc.err.no_account', account_exists: 'oidc.err.account_exists', linked_elsewhere: 'oidc.err.linked_elsewhere',
  already_linked: 'oidc.err.already_linked', not_linked: 'oidc.err.not_linked', invite_gone: 'oidc.err.invite_gone', pending: 'oidc.err.pending',
  session: 'oidc.err.session', proof: 'oidc.err.proof', failed: 'oidc.err.failed', throttled: 'oidc.err.throttled',
  signup_unverified: 'oidc.err.signup_unverified', signup_failed: 'oidc.err.signup_failed',
};

/** The providers the sign-in pages offer (none while single sign-on is off). */
export function useSignInProviders(): PublicProvider[] {
  const { data } = useQuery(signInMethodsQuery);
  return data?.providers ?? [];
}

/**
 * A button per provider. `purpose` `signin`, `invite` (with the invitation's token, the name and the terms) or `signup` (with
 * the sign-up form in `form`).
 */
export function SsoButtons({ providers, purpose, next, token, name, acceptTerms, form, disabled, onError }: {
  providers: PublicProvider[]; purpose: 'signin' | 'invite' | 'signup'; next?: string; token?: string; name?: string; acceptTerms?: boolean;
  form?: Record<string, unknown>; disabled?: boolean; onError: (message: string) => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState<string | null>(null);
  if (!providers.length) return null;
  const go = async (provider: string) => {
    setBusy(provider);
    try {
      if (purpose !== 'invite') forgetLocalIdentity();
      // Only what is set: an unset name must not hide the sign-up form's own.
      const set = Object.fromEntries(Object.entries({ next, token, name, acceptTerms }).filter(([, v]) => v !== undefined));
      await startSingleSignOn({ ...form, ...set, provider, purpose });
    } catch (e) {
      onError(errorText(e, t.locale));
      setBusy(null);
    }
  };
  return (
    <div className="sso-buttons">
      {providers.map((p) => (
        <button key={p.id} type="button" className="btn auth-go" disabled={disabled || !!busy} onClick={() => void go(p.id)}>
          <LogIn size={18} aria-hidden /> {busy === p.id ? t('oidc.leaving') : t(purpose === 'invite' ? 'oidc.join_with' : 'oidc.continue_with', { name: p.label })}
        </button>
      ))}
    </div>
  );
}

/** The account menu's single sign-on section: each provider the server offers, linked to this account or not. */
export function MySingleSignOn({ open }: { open: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const mine = useQuery({ ...myProvidersQuery, enabled: open });
  const [error, setError] = useState<string | null>(null);
  const link = useMutation({
    mutationFn: (provider: string) => withFreshProof(() => startSingleSignOn({ provider, purpose: 'link', next: hereForReturn() })),
    onError: (e: Error) => setError(errorText(e, t.locale)),
  });
  const unlink = useMutation({
    mutationFn: (provider: string) => withFreshProof(() => unlinkMyProvider({ data: { provider } })),
    onSuccess: ({ signedOut }) => {
      if (signedOut) { forgetLocalIdentity(); window.location.assign('/signin'); return; }
      return qc.invalidateQueries({ queryKey: ['session'] });
    },
    onError: (e: Error) => setError(errorText(e, t.locale)),
  });
  const list = mine.data ?? [];
  if (!list.length) return null;
  const busy = link.isPending || unlink.isPending;
  return (
    <>
      <h3 className="acct-h">{t('oidc.section')}</h3>
      <p className="acct-help">{t('oidc.section_lede')}</p>
      {error && <p className="acct-error" role="alert">{error}</p>}
      <ul className="sso-list">
        {list.map((p) => (
          <li key={p.id}>
            <span><b>{p.label}</b>{p.linked ? <small> {p.email ? t('oidc.linked_as', { email: p.email }) : t('oidc.linked')}</small> : null}</span>
            {p.linked
              ? <button className="btn ghost acct-add" disabled={busy} onClick={() => { setError(null); unlink.mutate(p.id); }}><Unlink size={16} /> {t('oidc.unlink')}</button>
              : <button className="btn acct-add" disabled={busy} onClick={() => { setError(null); link.mutate(p.id); }}><Link2 size={16} /> {t('oidc.link')}</button>}
          </li>
        ))}
      </ul>
    </>
  );
}
