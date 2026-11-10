// The question of the week, as the Today page's first card: the question, a way to answer it (an answer is a memory
// of someone, saved to the Chronicle), this week's answers together, the earlier questions, and for a steward the
// means to ask their own or to skip the week. A viewer reads; answering takes the role that adds memories.
//
//   <WeekQuestionCard tree={tree} />
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ChevronDown, PenLine, Settings2 } from 'lucide-react';
import { useId, useState } from 'react';
import { GameIcon } from '~/components/GameIcon';
import { Portrait } from '~/components/Portrait';
import { Dialog, Skeleton } from '~/components/ui';
import { errorText } from '~/lib/errortext';
import { useFamily } from '~/lib/family';
import { displayName } from '~/lib/graph';
import { formatDate, richText, useT, type Translator } from '~/lib/i18n';
import type { Key } from '~/lib/i18n/dictionary';
import { renderMarkdown } from '~/lib/markdown';
import { useCan, useSession } from '~/lib/session';
import { setWeekQuestion, weekAnswersQuery, weekQuery } from '~/lib/today/today.functions';
import type { WeekAnswer, WeekQuestion } from '~/lib/today/types';
import { weekStart } from '~/lib/today/week';
import { AnswerDialog } from './AnswerDialog';
import './today.css';

const EARLIER_SHOWN = 3;

/** A question's words: the steward's own, or the curated one in the reader's language. */
export const questionText = (q: Pick<WeekQuestion, 'id' | 'text'>, t: Translator) => q.text ?? t(`today.q.${q.id}` as Key);

/** "Week of 9 November": the Monday a week starts on, the same on the server and in every time zone. */
const weekLabel = (week: string, t: Translator) => t('today.week.of', { date: formatDate(weekStart(week), t.locale, { year: undefined, timeZone: 'UTC' }) });

export function WeekQuestionCard({ tree }: { tree: string }) {
  const t = useT();
  const id = useId();
  const canWrite = useCan('add-story');
  const steward = useCan('manage-access');
  const demo = !!useSession()?.demo;
  const week = useQuery(weekQuery(tree));
  const [answering, setAnswering] = useState<WeekQuestion | null>(null);
  const [changing, setChanging] = useState(false);
  const [allEarlier, setAllEarlier] = useState(false);
  const data = week.data;
  // A few earlier questions by default: the page is about this week, and the rest are one press away.
  const earlier = data ? (allEarlier ? data.earlier : data.earlier.slice(0, EARLIER_SHOWN)) : [];

  return (
    <>
      <section className="ui-card td-card td-week" aria-labelledby={`${id}-h`}>
        <header className="td-card-head">
          <h2 className="td-eyebrow" id={`${id}-h`}><GameIcon name="quill-ink" size={16} /> {t('today.week.title')}</h2>
          {data && <span className="subtle td-week-date">{weekLabel(data.current.week, t)}</span>}
          {steward && data && (
            <button type="button" className="btn ghost td-week-change" onClick={() => setChanging(true)}>
              <Settings2 size={15} aria-hidden /> {t('today.week.change')}
            </button>
          )}
        </header>
        {week.isError ? <p role="alert" className="td-note">{t('today.week.load_failed')} <button type="button" className="btn ghost" onClick={() => void week.refetch()}>{t('today.retry')}</button></p>
          : !data ? <Skeleton height={160} />
          : data.current.skipped ? (
            <p className="td-note td-week-skipped">{t('today.week.skipped')}</p>
          ) : (
            <>
              <p className="td-week-q">{questionText(data.current, t)}</p>
              {canWrite ? (
                <div className="td-week-cta">
                  <button type="button" className="btn primary" onClick={() => setAnswering(data.current)}>
                    <PenLine size={16} aria-hidden /> {t('today.week.answer')}
                  </button>
                  <span className="subtle">{t('today.week.answer_hint')}</span>
                </div>
              ) : (
                <p className="td-note td-week-viewer">{t(demo ? 'demo.err_read_only' : 'today.week.viewer')}</p>
              )}
              <div className="td-answers">
                <h3>{data.answers.length ? t('today.week.answers', { count: data.answers.length }) : t('today.week.no_answers')}</h3>
                {data.answers.length === 0 && <p className="muted td-note">{canWrite ? t('today.week.no_answers_text') : t('today.week.no_answers_viewer')}</p>}
                <AnswerList answers={data.answers} tree={tree} />
                {data.answers.length > 0 && <Link className="td-more-link" to="/$tree/chronicle" params={{ tree }}>{t('today.week.in_chronicle')}</Link>}
              </div>
            </>
          )}
      </section>

      {!!data?.earlier.length && (
        <section className="td-earlier" aria-labelledby={`${id}-e`}>
          <h2 className="td-h td-h-quiet" id={`${id}-e`}>{t('today.week.earlier')}</h2>
          <ul>
            {earlier.map((q) => <Earlier key={q.week} q={q} tree={tree} canWrite={canWrite} onAnswer={() => setAnswering(q)} />)}
          </ul>
          {!allEarlier && data.earlier.length > EARLIER_SHOWN && (
            <button type="button" className="btn ghost td-earlier-more" onClick={() => setAllEarlier(true)}>{t('today.week.earlier_more', { count: data.earlier.length - EARLIER_SHOWN })}</button>
          )}
        </section>
      )}

      {answering && <AnswerDialog tree={tree} question={answering} onClose={() => setAnswering(null)} />}
      {changing && data && <ChangeQuestion tree={tree} current={data.current} curated={data.curated} onClose={() => setChanging(false)} />}
    </>
  );
}

/** The answers to one question: who wrote, about whom, and what they remember. */
function AnswerList({ answers, tree }: { answers: WeekAnswer[]; tree: string }) {
  const t = useT();
  const f = useFamily();
  if (!answers.length) return null;
  return (
    <ul className="td-answer-list">
      {answers.map((a) => {
        const p = f.byId.get(a.person);
        return (
          <li key={a.id} className="td-answer">
            {p ? <Portrait person={p} tree={tree} size={40} decorative /> : <span />}
            <div>
              <p className="td-answer-by">
                {richText(t, 'today.week.by', {
                  author: <b>{a.author}</b>,
                  subject: p ? <Link to="/$tree/person/$id" params={{ tree, id: p.id }}>{displayName(p, f)}</Link> : t('today.quiz.gone'),
                })}
                <time dateTime={a.at}>{formatDate(a.at.slice(0, 10), t.locale, { year: undefined })}</time>
              </p>
              <div className="td-answer-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(a.body, { images: 'text' }) }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** An earlier week: its question, how many answered, and the answers once opened. Still answerable. */
function Earlier({ q, tree, canWrite, onAnswer }: { q: WeekQuestion & { answers: number }; tree: string; canWrite: boolean; onAnswer: () => void }) {
  const t = useT();
  const id = useId();
  const [open, setOpen] = useState(false);
  const answers = useQuery({ ...weekAnswersQuery(tree, q.week), enabled: open && q.answers > 0 });
  return (
    <li className="td-earlier-item">
      <div className="td-earlier-row">
        <div className="td-earlier-text">
          <span className="subtle">{weekLabel(q.week, t)}</span>
          <p>{questionText(q, t)}</p>
        </div>
        {q.answers > 0 && (
          <button type="button" className="btn ghost" aria-expanded={open} aria-controls={`${id}-a`} onClick={() => setOpen(!open)}>
            {t('today.week.count', { count: q.answers })} <ChevronDown size={15} aria-hidden className="td-chevron" />
          </button>
        )}
        {canWrite && <button type="button" className="btn" onClick={onAnswer} aria-label={t('today.week.answer_this', { question: questionText(q, t) })}>{t('today.week.answer_short')}</button>}
      </div>
      <div id={`${id}-a`} hidden={!open}>
        {open && (answers.data ? <AnswerList answers={answers.data} tree={tree} /> : answers.isError ? <p role="alert" className="td-note">{t('today.week.load_failed')}</p> : <Skeleton height={60} />)}
      </div>
    </li>
  );
}

/** A steward's choices for this week: their own question, no question, or the curated one back. */
function ChangeQuestion({ tree, current, curated, onClose }: { tree: string; current: WeekQuestion; curated: string; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [text, setText] = useState(current.text ?? '');
  const change = useMutation({
    mutationFn: (c: Parameters<typeof setWeekQuestion>[0]['data']['change']) => setWeekQuestion({ data: { tree, change: c } }),
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: weekQuery(tree).queryKey }); onClose(); },
  });
  const own = text.replace(/\s+/g, ' ').trim();
  const changed = current.skipped || current.id === 'custom';
  return (
    <Dialog open onClose={onClose} title={t('today.week.change_title')} description={t('today.week.change_intro')} width="min(520px, 100vw - 24px)" dirty={own !== (current.text ?? '')}>
      <form className="td-change" onSubmit={(e) => { e.preventDefault(); if (own.length >= 5) change.mutate({ mode: 'custom', text: own }); }}>
        <label htmlFor="td-own-q">{t('today.week.own_label')}</label>
        <textarea id="td-own-q" className="input" rows={3} maxLength={200} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('today.week.own_placeholder')} />
        <p className="subtle">{t('today.week.own_hint')}</p>
        {change.isError && <p role="alert">{errorText(change.error, t.locale)}</p>}
        <div className="td-change-actions">
          <button type="submit" className="btn primary" disabled={own.length < 5 || change.isPending}>{t('today.week.own_save')}</button>
          {!current.skipped && <button type="button" className="btn" disabled={change.isPending} onClick={() => change.mutate({ mode: 'skip' })}>{t('today.week.skip')}</button>}
          {changed && <button type="button" className="btn" disabled={change.isPending} onClick={() => change.mutate({ mode: 'curated' })}>{t('today.week.restore')}</button>}
        </div>
        {changed && <p className="subtle">{t('today.week.restore_hint', { question: t(`today.q.${curated}` as Key) })}</p>}
      </form>
    </Dialog>
  );
}
