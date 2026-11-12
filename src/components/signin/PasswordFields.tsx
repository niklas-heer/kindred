// The pieces every form that makes or uses a password shares: which way in this server offers (and the choice between a
// passkey and a password where both are on), and the username and password fields with their rules. The rules are checked
// again on the server (src/lib/auth/password.server.ts); the browser only says them early.
import { useQuery } from '@tanstack/react-query';
import { Fingerprint, KeyRound } from 'lucide-react';
import { useId } from 'react';
import { Segmented } from '~/components/ui';
import { isCommonPassword } from '~/lib/auth/common-passwords';
import { normalizeUsername, PASSWORD_MIN, passwordLength, USERNAME, type SignInMethod } from '~/lib/auth/methods';
import { signInMethodsQuery } from '~/lib/auth/signin.functions';
import { useT } from '~/lib/i18n';
import './signin.css';

/** The ways in this server offers, as the sign-in pages read them (passkeys while it is loading, as before). */
export function useSignInMethods(): SignInMethod[] {
  const { data } = useQuery(signInMethodsQuery);
  return data?.methods ?? ['passkey'];
}

export type NewWay = 'passkey' | 'password';

/** The way a new account starts: the one the server offers, or a choice when it offers both. */
export function WayPicker({ methods, value, onChange }: { methods: SignInMethod[]; value: NewWay; onChange: (v: NewWay) => void }) {
  const t = useT();
  if (!(methods.includes('passkey') && methods.includes('password'))) return null;
  return (
    <Segmented<NewWay>
      aria-label={t('pw.way_label')} value={value} onChange={onChange} block
      options={[{ value: 'passkey', label: t('pw.way_passkey'), icon: <Fingerprint size={15} /> }, { value: 'password', label: t('pw.way_password'), icon: <KeyRound size={15} /> }]}
    />
  );
}

/** The first way a new account gets: a passkey where the server offers them, else a password. */
export const firstWay = (methods: SignInMethod[]): NewWay => (methods.includes('passkey') ? 'passkey' : 'password');

/** What is wrong with a new password, as a key to show before sending, or null. */
export function passwordProblem(password: string, username?: string): 'pw.err.short' | 'pw.err.common' | 'pw.err.like_username' | null {
  if (passwordLength(password) < PASSWORD_MIN) return 'pw.err.short';
  if (isCommonPassword(password)) return 'pw.err.common';
  if (username && password.trim().toLowerCase() === normalizeUsername(username)) return 'pw.err.like_username';
  return null;
}
export const usernameOk = (u: string) => USERNAME.test(normalizeUsername(u));

/** A username (unless it is fixed already) and a new password, with the rules said plainly. */
export function NewPasswordFields({ username, onUsername, password, onPassword, fixedUsername, quiet }: {
  username: string; onUsername: (v: string) => void; password: string; onPassword: (v: string) => void; fixedUsername?: string | null;
  /** With `fixedUsername`: the form shows the username elsewhere, so it is not repeated here. */
  quiet?: boolean;
}) {
  const t = useT();
  const userId = useId();
  const pwId = useId();
  const hintId = useId();
  const problem = password ? passwordProblem(password, fixedUsername ?? username) : null;
  return (
    <>
      {fixedUsername ? (quiet ? null :
        <p className="pw-fixed">{t('pw.your_username')} <b>{fixedUsername}</b></p>
      ) : (
        <label className="field" htmlFor={userId}>
          <span>{t('pw.username')}</span>
          <input id={userId} className="input" value={username} onChange={(e) => onUsername(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} required maxLength={64} />
          <p className="auth-hint">{t('pw.username_hint')}</p>
        </label>
      )}
      <label className="field" htmlFor={pwId}>
        <span>{t('pw.new_password')}</span>
        <input id={pwId} className="input" type="password" value={password} onChange={(e) => onPassword(e.target.value)} autoComplete="new-password" required minLength={PASSWORD_MIN} maxLength={256} aria-describedby={hintId} />
        <p className="auth-hint" id={hintId}>{problem && problem !== 'pw.err.short' ? <span className="pw-problem">{t(problem)}</span> : t('pw.password_hint', { count: PASSWORD_MIN })}</p>
      </label>
    </>
  );
}

/** Whether the fields are ready to send. */
export const newPasswordReady = (username: string, password: string, fixedUsername?: string | null) =>
  (!!fixedUsername || usernameOk(username)) && passwordProblem(password, fixedUsername ?? username) === null;
