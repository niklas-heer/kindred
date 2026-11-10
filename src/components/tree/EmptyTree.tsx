import { useQueryClient } from '@tanstack/react-query';
import { UserPlus, Users } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { EmptyState } from '~/components/ui';
import { opKeys } from '~/lib/api';
import { chooseMe } from '~/lib/family';
import { translateMessage, useT } from '~/lib/i18n';
import { addSelfToFamily } from '~/lib/person.functions';

/**
 * An empty family: a card to start the tree. Someone who may add people adds themselves (the first-run step's form, the
 * same server call) or somebody else; everyone else is told that nobody has been added yet.
 */
export function EmptyTree({ tree, canAdd }: { tree: string; canAdd: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const [keys] = useState(opKeys);
  const [mode, setMode] = useState<'me' | 'other'>('me');
  const [given, setGiven] = useState('');
  const [surname, setSurname] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canAdd) {
    return (
      <div className="page">
        <div className="page-inner">
          <EmptyState icon={<Users size={28} />} title={t('tree.nobodyYet')} text={t('tree.nobodyYetText')} />
        </div>
      </div>
    );
  }

  const self = mode === 'me';
  const add = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = { tree, given: given.trim(), surname: surname.trim() };
      const id = await addSelfToFamily({ data: { ...body, opKey: keys.for(mode, body) } });
      keys.clear(mode);
      // The steward's own card is their "me"; a person added for someone else leaves the reader's answer as it was.
      if (self) await chooseMe(tree, id);
      await qc.invalidateQueries({ queryKey: ['graph', tree] });
      await qc.invalidateQueries({ queryKey: ['session'] });
    } catch (err) {
      setError(err instanceof Error ? translateMessage(err.message, t.locale) : t(self ? 'setup.family_add_failed' : 'tree.start.failed'));
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <div className="page-inner">
        <section className="panel tree-start" aria-labelledby="tree-start-title" style={{ maxWidth: 480, margin: '48px auto', padding: 24 }}>
          <h2 id="tree-start-title" className="display">{self ? t('tree.start.title') : t('tree.start.otherTitle')}</h2>
          <p className="muted">{self ? t('tree.start.lede') : t('tree.start.otherLede')}</p>
          <form onSubmit={add} style={{ display: 'grid', gap: 12 }}>
            <label className="field">
              <span>{t('setup.given_name')}</span>
              <input className="input" value={given} onChange={(e) => setGiven(e.target.value)} autoComplete="given-name" required maxLength={120} autoFocus />
            </label>
            <label className="field">
              <span>{t('setup.surname')}</span>
              <input className="input" value={surname} onChange={(e) => setSurname(e.target.value)} autoComplete="family-name" maxLength={120} />
            </label>
            {error && <p role="alert" className="muted">{error}</p>}
            <button className="btn primary" disabled={busy || !given.trim()}>
              <UserPlus size={17} /> {self ? t('setup.add_me') : t('tree.start.addOther')}
            </button>
          </form>
          <p style={{ marginTop: 16 }}>
            {self ? (
              <button type="button" className="btn ghost" onClick={() => { setMode('other'); setError(null); }}>{t('tree.start.other')}</button>
            ) : (
              <button type="button" className="btn ghost" onClick={() => { setMode('me'); setError(null); }}>{t('tree.start.back')}</button>
            )}
          </p>
        </section>
      </div>
    </div>
  );
}
