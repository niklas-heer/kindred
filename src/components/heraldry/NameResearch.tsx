// The AI half of "Suggest from the name": step one researches what the surname may mean (the reader selects
// the meanings to use, and may add their own), step two designs arms from the chosen meanings. Stewards only, and
// only when the family's AI arms feature is on; the offline ideas above it are unaffected. Results belong to the
// name they were asked for: change the name and they go, the family's own words stay.
import { useMutation } from '@tanstack/react-query';
import { Check, Plus, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { MAX_DESIGN_MEANINGS, aiArmsDesigns, aiNameMeaning } from '~/lib/ai/arms.functions';
import { toAiLocale, type Attestation, type DesignMeaning, type IdeaKind, type NameDesign, type NameMeaning, type NameResearch } from '~/lib/ai/types';
import { errorText } from '~/lib/errortext';
import { useT, type Key } from '~/lib/i18n';
import { play } from '~/lib/sfx';
import type { ArmsV2 } from '~/lib/seed-format';
import { EmptyState, ErrorState, Skeleton } from '../ui';
import { blazonV2 } from './blazon';
import { ArmsV2View } from './render';

const ATTEST_KEY: Record<Attestation, Key> = {
  'well-attested': 'heraldry.meaning_attested',
  speculative: 'heraldry.meaning_speculative',
  family: 'heraldry.meaning_family',
};
const IDEA_KEY: Record<IdeaKind, Key> = {
  quality: 'heraldry.idea_quality',
  object: 'heraldry.idea_object',
  trade: 'heraldry.idea_trade',
  sound: 'heraldry.idea_sound',
};

interface Result { surname: string; data: NameResearch }
interface Designs { surname: string; list: NameDesign[] }

export function NameResearchPanel({ tree, surname, country, onPick }: {
  tree: string;
  surname: string;
  /** ISO 3166 code, upper case, when the house has one. */
  country?: string;
  onPick: (arms: ArmsV2) => void;
}) {
  const t = useT();
  const locale = toAiLocale(t.locale);
  const name = surname.trim();
  const iso = country && /^[A-Z]{2}$/.test(country) ? country : undefined;
  const [hint, setHint] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  /** The reader's own meanings, added to the research's; they are never removed, only deselected. */
  const [own, setOwn] = useState<NameMeaning[]>([]);
  const [draft, setDraft] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [designs, setDesigns] = useState<Designs | null>(null);
  /** Set when the reader tries to choose more meanings than the design call takes. */
  const [limitHit, setLimitHit] = useState(false);

  /** A failed call's line: the server's own message when it is a readable one, never raw validation JSON. */
  const failure = (e: unknown, fallback: string) => {
    const m = e instanceof Error ? e.message : '';
    return m && !/^[[{]/.test(m) ? errorText(e, t.locale) : fallback;
  };

  const research = useMutation({
    mutationFn: (q: { surname: string; familyHint: string }) => aiNameMeaning({
      data: { tree, surname: q.surname, country: iso, familyHint: q.familyHint || undefined, locale },
    }),
    onSuccess: (data, q) => {
      setResult({ surname: q.surname, data });
      setOwn([]);
      setPicked(new Set(data.meanings.map((m) => m.id)));
      setDesigns(null);
    },
  });

  const design = useMutation({
    mutationFn: (q: { surname: string; meanings: DesignMeaning[]; familyHint: string }) => aiArmsDesigns({
      data: { tree, surname: q.surname, country: iso, familyHint: q.familyHint || undefined, meanings: q.meanings, locale },
    }),
    onSuccess: (list, q) => setDesigns({ surname: q.surname, list }),
  });

  // Results for another name are not shown; a fresh search replaces them.
  const current = result && result.surname === name ? result.data : undefined;
  const shown: NameMeaning[] = current ? [...current.meanings, ...own] : [];
  const chosen = shown.filter((m) => picked.has(m.id));
  const liveDesigns = designs && designs.surname === name ? designs.list : null;
  const familyHint = hint.trim();

  // The design call takes at most MAX_DESIGN_MEANINGS: a meaning past that is not selected, and the reader is told why.
  const full = chosen.length >= MAX_DESIGN_MEANINGS;

  const toggle = (id: string) => {
    if (!picked.has(id) && full) { setLimitHit(true); return; }
    setLimitHit(false);
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    // Designs drawn on the old choice no longer match it.
    setDesigns(null);
  };

  const addOwn = () => {
    const meaning = draft.trim();
    if (!meaning) return;
    const id = `own${own.length + 1}`;
    setOwn((o) => [...o, { id, language: '', root: '', meaning: meaning.slice(0, 200), attestation: 'family', ideas: [] }]);
    if (!full) setPicked((p) => new Set(p).add(id));
    setLimitHit(full);
    setDraft('');
    setDesigns(null);
    play('tick');
  };

  const meaningsFor = (list: NameMeaning[]): DesignMeaning[] => list.map(({ id, language, root, meaning, attestation, ideas }) => ({ id, language, root, meaning, attestation, ideas }));

  return (
    <section className="ae-research" aria-label={t('heraldry.research_title')} aria-busy={research.isPending || design.isPending || undefined}>
      <h3 className="ae-research-title">{t('heraldry.research_title')}</h3>
      <p className="subtle ae-lead">{t('heraldry.research_lead')}</p>

      <label className="field ae-research-hint">
        <span>{t('heraldry.family_hint_label')}</span>
        <input
          className="input"
          value={hint}
          maxLength={200}
          placeholder={t('heraldry.family_hint_placeholder')}
          onChange={(e) => setHint(e.target.value)}
        />
      </label>
      <button
        type="button"
        className="btn ae-research-go"
        disabled={!name || research.isPending}
        onClick={() => research.mutate({ surname: name, familyHint })}
      >
        <Sparkles size={15} aria-hidden /> {t('heraldry.research_name')}
      </button>

      {research.isPending && (
        <div className="ae-research-busy" role="status">
          <p className="subtle">{t('heraldry.researching')}</p>
          <Skeleton lines={3} />
        </div>
      )}

      {research.isError && !research.isPending && (
        <ErrorState
          title={t('heraldry.research_failed')}
          message={failure(research.error, t('heraldry.research_failed_text'))}
          onRetry={() => research.mutate({ surname: name, familyHint })}
        />
      )}

      {current && !research.isPending && (
        <div className="ae-meanings">
          <p className="subtle ae-basis">{t(current.webSearched ? 'heraldry.basis_web' : 'heraldry.basis_knowledge')}</p>
          {current.note && <p className="subtle ae-basis">{current.note}</p>}

          {shown.length === 0 ? (
            <EmptyState
              title={t('heraldry.no_meanings')}
              text={t('heraldry.no_meanings_text')}
            />
          ) : (
            <ul className="ae-meaning-list" aria-label={t('heraldry.meanings_title')}>
              {shown.map((m) => {
                const on = picked.has(m.id);
                const byReader = m.id.startsWith('own');
                return (
                  <li key={m.id} className={`ae-meaning${on ? ' on' : ''}`}>
                    <button type="button" className="ae-meaning-pick" aria-pressed={on} onClick={() => toggle(m.id)}>
                      <span className="ae-meaning-check" aria-hidden>{on && <Check size={14} />}</span>
                      <span className="ae-meaning-body">
                        <span className="ae-meaning-head">
                          {m.root && <span className="ae-meaning-root">{m.root}</span>}
                          {m.language && <small>{m.language}</small>}
                          <span className={`ae-badge ${byReader ? 'own' : m.attestation}`}>
                            {t(byReader ? 'heraldry.meaning_added' : ATTEST_KEY[m.attestation])}
                          </span>
                        </span>
                        <span className="ae-card-title">{m.meaning}</span>
                        {m.ideas.length > 0 && (
                          <span className="ae-meaning-ideas">
                            {m.ideas.map((i, k) => (
                              <span key={k}><small>{t(IDEA_KEY[i.kind])}</small> {i.idea}</span>
                            ))}
                          </span>
                        )}
                      </span>
                    </button>
                    {m.sources && m.sources.length > 0 && (
                      <p className="ae-meaning-sources">
                        <small>{t('heraldry.meaning_sources')}:</small>{' '}
                        {m.sources.map((s, k) => (
                          <span key={s.url}>
                            {k > 0 && ', '}
                            <a href={s.url} target="_blank" rel="noopener noreferrer">{s.title || s.url}</a>
                          </span>
                        ))}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          <div className="ae-meaning-add">
            <label className="field">
              <span>{t('heraldry.meaning_add_label')}</span>
              <input
                className="input"
                value={draft}
                maxLength={200}
                placeholder={t('heraldry.meaning_add_placeholder')}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addOwn(); } }}
              />
            </label>
            <button type="button" className="btn" onClick={addOwn} disabled={!draft.trim()}>
              <Plus size={15} aria-hidden /> {t('heraldry.meaning_add')}
            </button>
          </div>

          {(limitHit || full) && <p className="subtle ae-limit" role="status">{t('heraldry.meanings_limit', { max: MAX_DESIGN_MEANINGS })}</p>}
          <div className="ae-design-go">
            <span className="subtle">{chosen.length === 0 ? t('heraldry.no_meaning_chosen') : t('heraldry.meanings_selected', { count: chosen.length })}</span>
            <button
              type="button"
              className="btn primary"
              disabled={chosen.length === 0 || design.isPending}
              onClick={() => design.mutate({ surname: name, meanings: meaningsFor(chosen), familyHint })}
            >
              <Sparkles size={15} aria-hidden /> {t('heraldry.design_from_these')}
            </button>
          </div>
        </div>
      )}

      {design.isPending && (
        <div className="ae-research-busy" role="status">
          <p className="subtle">{t('heraldry.designing')}</p>
          <Skeleton lines={3} />
        </div>
      )}

      {design.isError && !design.isPending && (
        <ErrorState
          title={t('heraldry.design_failed')}
          message={failure(design.error, t('heraldry.design_failed_text'))}
          onRetry={() => design.mutate({ surname: name, meanings: meaningsFor(chosen), familyHint })}
        />
      )}

      {liveDesigns && !design.isPending && (
        <div className="ae-designs">
          <h4 className="ae-designs-title">{t('heraldry.designs_title')}</h4>
          <p className="subtle ae-lead">{t('heraldry.designs_lead')}</p>
          <div className="ae-gallery ae-gallery-wide">
            {liveDesigns.map((d, i) => (
              <button key={i} type="button" className="ae-card ae-card-wide" onClick={() => { onPick(structuredClone(d.arms)); play('tick'); }}>
                <ArmsV2View arms={d.arms} size={72} />
                <span className="ae-card-text">
                  <small className="ae-design-draws">{t('heraldry.design_draws', { meaning: d.meaning })}</small>
                  <span className="ae-card-title">{d.explanation}</span>
                  {d.symbolism && d.symbolism.length > 0 && (
                    <span className="ae-symbolism">
                      <small className="subtle">{t('heraldry.means.ai_title')}</small>
                      {d.symbolism.slice(0, 3).map((s, k) => (
                        <span key={k}><b>{s.element}</b> {s.why}</span>
                      ))}
                    </span>
                  )}
                  <small>{blazonV2(d.arms)}</small>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
