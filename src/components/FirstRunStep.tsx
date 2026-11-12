// The first-run prompt after a family is made by its first steward (setup, sign-up): the steward is signed in and in their
// new family, which is empty. They add themselves to it, which makes them its starting point. Skipping goes to the family.
import { Crown, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { AuthCard, AuthError } from '~/components/AuthCard';
import { opKeys } from '~/lib/api';
import { splitName } from '~/lib/auth/name';
import { chooseMe } from '~/lib/family';
import { translateMessage, useT } from '~/lib/i18n';
import { addSelfToFamily } from '~/lib/person.functions';

/** A family just made: the steward is in it, and adds themselves before anything else. */
export interface MadeFamily { tree: string; family: string; steward: string }

/**
 * The first-run prompt after setup: the steward is signed in and in their new family, which is empty. They add
 * themselves to it, which makes them its starting point. Skipping goes to the family all the same.
 */
export function FirstRunStep({ tree, family, steward }: MadeFamily) {
  const t = useT();
  const [keys] = useState(opKeys);
  // The name typed in setup, taken apart at its last space: the steward checks both parts before saving.
  const [parts] = useState(() => splitName(steward));
  const [given, setGiven] = useState(parts.given);
  const [surname, setSurname] = useState(parts.surname);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addMe = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = { tree, given: given.trim(), surname: surname.trim() };
      const id = await addSelfToFamily({ data: { ...body, opKey: keys.for('self', body) } });
      keys.clear('self');
      await chooseMe(tree, id);
      window.location.assign(`/${tree}`);
    } catch (err) {
      setError(err instanceof Error ? translateMessage(err.message, t.locale) : t('setup.family_add_failed'));
      setBusy(false);
    }
  };

  return (
    <AuthCard crest={<Crown size={44} />} kicker={family} title={t('setup.family_ready_title', { name: family })} lede={t('setup.family_ready_lede')}>
      <form className="auth-form" onSubmit={addMe}>
        <label className="field">
          <span>{t('setup.given_name')}</span>
          <input className="input" value={given} onChange={(e) => setGiven(e.target.value)} autoComplete="given-name" required maxLength={120} autoFocus />
        </label>
        <label className="field">
          <span>{t('setup.surname')}</span>
          <input className="input" value={surname} onChange={(e) => setSurname(e.target.value)} autoComplete="family-name" maxLength={120} />
        </label>
        <AuthError>{error}</AuthError>
        <button className="btn primary auth-go" disabled={busy || !given.trim()}>
          <UserPlus size={19} /> {t('setup.add_me')}
        </button>
      </form>
      <p className="auth-device-hint"><a className="auth-link" href={`/${tree}`}>{t('setup.skip')}</a></p>
    </AuthCard>
  );
}
