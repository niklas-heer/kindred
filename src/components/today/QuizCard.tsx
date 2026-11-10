// The daily quiz, "Do you know your family?", as a card for the Today page: one question made from the family's own
// records, the same for every member that day. The reader picks, confirms once (an answer cannot be changed), and the
// card then shows the answer with a way to the person, how the family did, the reader's streak and this month's
// table of houses. It fetches its own data; while a steward has the quiz switched off it shows only them a note.
//
//   <QuizCard tree={tree} />
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowDown, ArrowUp, Check, Flame, X } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { GameIcon } from '~/components/GameIcon';
import { Arms } from '~/components/Heraldry';
import { Portrait } from '~/components/Portrait';
import { Skeleton } from '~/components/ui';
import { campaignStatusQuery } from '~/lib/campaign/campaign.functions';
import { errorText } from '~/lib/errortext';
import { useFamily } from '~/lib/family';
import { displayName, yearOf, type Family } from '~/lib/graph';
import { richText, useT, type Translator } from '~/lib/i18n';
import type { Key } from '~/lib/i18n/dictionary';
import { useSession, useCan } from '~/lib/session';
import { play } from '~/lib/sfx';
import type { QuizOption, QuizQuestion } from '~/lib/today/quiz';
import { answerQuizQuestion, quizQuery } from '~/lib/today/today.functions';
import type { QuizView } from '~/lib/today/types';
import './today.css';

const PROMPT: Record<QuizQuestion['kind'], Key> = {
  shield: 'today.quiz.ask_shield',
  portrait: 'today.quiz.ask_portrait',
  parents: 'today.quiz.ask_parents',
  birthplace: 'today.quiz.ask_birthplace',
  grandchild: 'today.quiz.ask_grandchild',
  order: 'today.quiz.ask_order',
};

/** An option's words: the people's names, the house's name, or the place as the family wrote it. */
function optionText(o: QuizOption, f: Family, t: Translator): string {
  if (o.house) return f.house.get(o.house)?.name ?? t('today.quiz.gone');
  if (o.place) return o.place;
  const names = (o.people ?? []).map((id) => { const p = f.byId.get(id); return p ? displayName(p, f) : t('today.quiz.gone'); });
  return names.length === 2 ? t('today.quiz.couple', { a: names[0]!, b: names[1]! }) : names[0] ?? t('today.quiz.gone');
}

/** The faces beside an option. Never for "who is this?": there the faces would be the answer. */
function Faces({ o, f, tree, show }: { o: QuizOption; f: Family; tree: string; show: boolean }) {
  if (!show || !o.people) return null;
  return (
    <span className="td-quiz-faces" aria-hidden>
      {o.people.map((id) => { const p = f.byId.get(id); return p ? <Portrait key={id} person={p} tree={tree} size={32} decorative /> : null; })}
    </span>
  );
}

export function QuizCard({ tree }: { tree: string }) {
  const t = useT();
  const f = useFamily();
  const qc = useQueryClient();
  const steward = useCan('manage-access');
  // A demo keeps nothing, and the day's question is kept when it is drawn: there the card is left out instead of failing.
  const demo = !!useSession()?.demo;
  const quiz = useQuery({ ...quizQuery(tree), enabled: !demo });
  const [picked, setPicked] = useState<number | null>(null);
  const [sequence, setSequence] = useState<number[] | null>(null);
  const group = useId();
  const answer = useMutation({
    mutationFn: (choice: string) => answerQuizQuestion({ data: { tree, day: quiz.data!.day, choice } }),
    onSuccess: (view) => {
      qc.setQueryData(quizQuery(tree).queryKey, view);
      play(view.mine?.correct ? 'chime' : 'tick');
      if (view.bonus) void qc.invalidateQueries({ queryKey: campaignStatusQuery(tree).queryKey });
    },
    // Midnight passed with the page open: today's question is another one now.
    onError: () => void quiz.refetch(),
  });

  const data = quiz.data;
  if (demo) return null;
  if (data && !data.enabled) {
    if (!steward) return null;
    return (
      <section className="ui-card td-card td-quiz" aria-labelledby={`${group}-h`}>
        <h2 className="td-h" id={`${group}-h`}><GameIcon name="laurel-crown" size={18} /> {t('today.quiz.title')}</h2>
        <p className="muted td-note">{t('today.quiz.off')}</p>
        <Link className="btn" to="/$tree/settings/games" params={{ tree }}>{t('today.quiz.off_settings')}</Link>
      </section>
    );
  }

  return (
    <section className="ui-card td-card td-quiz" aria-labelledby={`${group}-h`}>
      <header className="td-card-head">
        <h2 className="td-h" id={`${group}-h`}><GameIcon name="laurel-crown" size={18} /> {t('today.quiz.title')}</h2>
        {!!data?.streak && (
          <span className="td-streak" title={t('today.quiz.streak_title')}>
            <Flame size={15} aria-hidden /> {t('today.quiz.streak', { count: data.streak })}
          </span>
        )}
      </header>
      {quiz.isError ? <p role="alert" className="td-note">{t('today.quiz.load_failed')} <button type="button" className="btn ghost" onClick={() => void quiz.refetch()}>{t('today.retry')}</button></p>
        : !data ? <Skeleton height={180} />
        : !data.question ? (
          <>
            <p className="td-note">{t('today.quiz.too_little')}</p>
            <Link className="btn" to="/$tree/needed" params={{ tree }}>{t('today.quiz.too_little_action')}</Link>
          </>
        ) : data.mine ? <Result view={data} f={f} tree={tree} />
        : (
          <form
            className="td-quiz-form"
            onSubmit={(e) => {
              e.preventDefault();
              const q = data.question!;
              if (q.kind === 'order') answer.mutate((sequence ?? q.options.map((_, i) => i)).join(','));
              else if (picked !== null) answer.mutate(String(picked));
            }}
          >
            <Prompt q={data.question} day={data.day} f={f} tree={tree} id={`${group}-q`} />
            {data.question.kind === 'order' ? (
              <OrderPicker q={data.question} f={f} tree={tree} sequence={sequence ?? data.question.options.map((_, i) => i)} onChange={setSequence} labelledBy={`${group}-q`} />
            ) : (
              <div className="td-quiz-options" role="radiogroup" aria-labelledby={`${group}-q`}>
                {data.question.options.map((o, i) => (
                  <label key={i} className="td-quiz-option" data-picked={picked === i || undefined}>
                    <input type="radio" name={group} value={i} checked={picked === i} onChange={() => setPicked(i)} />
                    <Faces o={o} f={f} tree={tree} show={data.question!.kind !== 'portrait'} />
                    <span className="td-quiz-option-text">{optionText(o, f, t)}</span>
                  </label>
                ))}
              </div>
            )}
            {answer.isError && <p role="alert" className="td-note">{errorText(answer.error, t.locale)}</p>}
            <div className="td-quiz-foot">
              <button type="submit" className="btn primary" disabled={answer.isPending || (data.question.kind !== 'order' && picked === null)}>{t('today.quiz.answer')}</button>
              <span className="subtle">{t('today.quiz.once')}</span>
            </div>
          </form>
        )}
      {!!data?.houses.length && <HouseTable rows={data.houses} f={f} />}
    </section>
  );
}

/** The question itself: its picture, shield or person, and the words. */
function Prompt({ q, day, f, tree, id }: { q: QuizQuestion; day: string; f: Family; tree: string; id: string }) {
  const t = useT();
  const subject = q.subject ? f.byId.get(q.subject) : undefined;
  const name = subject ? displayName(subject, f) : t('today.quiz.gone');
  return (
    <div className="td-quiz-prompt" data-kind={q.kind}>
      {q.kind === 'shield' && q.arms && <span className="td-quiz-figure"><Arms arms={q.arms} size={92} title={t('today.quiz.shield_alt')} /></span>}
      {q.kind === 'portrait' && <img className="td-quiz-figure td-quiz-face" src={`/api/quiz-picture/${tree}/${day}`} alt={t('today.quiz.portrait_alt')} width={112} height={112} />}
      {subject && <span className="td-quiz-figure"><Portrait person={subject} tree={tree} size={64} decorative /></span>}
      <p className="td-quiz-q" id={id}>
        {q.subject
          ? richText(t, PROMPT[q.kind], { name: subject ? <Link to="/$tree/person/$id" params={{ tree, id: subject.id }}>{name}</Link> : name })
          : t(PROMPT[q.kind])}
      </p>
    </div>
  );
}

/** Three people to put in birth order: each row moves up or down with a button, so it works with keys and by touch. */
function OrderPicker({ q, f, tree, sequence, onChange, labelledBy }: { q: QuizQuestion; f: Family; tree: string; sequence: number[]; onChange: (s: number[]) => void; labelledBy: string }) {
  const t = useT();
  const move = (at: number, by: -1 | 1) => {
    const next = [...sequence];
    [next[at], next[at + by]] = [next[at + by]!, next[at]!];
    onChange(next);
    play('tick');
  };
  return (
    <ol className="td-quiz-order" aria-labelledby={labelledBy}>
      {sequence.map((option, at) => {
        const o = q.options[option]!;
        const name = optionText(o, f, t);
        return (
          <li key={option}>
            <span className="td-quiz-rank" aria-hidden>{at + 1}</span>
            <Faces o={o} f={f} tree={tree} show />
            <span className="td-quiz-option-text">{name}</span>
            <button type="button" className="btn icon ghost" disabled={at === 0} onClick={() => move(at, -1)} aria-label={t('today.quiz.move_up', { name })}><ArrowUp size={16} aria-hidden /></button>
            <button type="button" className="btn icon ghost" disabled={at === sequence.length - 1} onClick={() => move(at, 1)} aria-label={t('today.quiz.move_down', { name })}><ArrowDown size={16} aria-hidden /></button>
          </li>
        );
      })}
    </ol>
  );
}

/** After the answer: what was right, a way to the person or house, and how the family did. */
function Result({ view, f, tree }: { view: QuizView; f: Family; tree: string }) {
  const t = useT();
  const q = view.question!;
  const mine = view.mine!;
  const right = (view.answer ?? '').split(',').map(Number);
  const chosen = mine.choice.split(',').map(Number);
  const about = view.about;
  const person = about ? f.byId.get(about) : undefined;
  const house = q.kind === 'shield' && about ? f.house.get(about) : undefined;
  const family = view.family ?? { answered: 1, right: mine.correct ? 1 : 0 };
  let link: ReactNode = null;
  if (house) link = <Link className="btn" to="/$tree/house/$house" params={{ tree, house: house.id }}>{t('today.quiz.to_house', { name: house.name })}</Link>;
  else if (person) link = <Link className="btn" to="/$tree/person/$id" params={{ tree, id: person.id }}>{t('today.quiz.to_person', { name: person.given })}</Link>;

  return (
    <div className="td-quiz-result" data-correct={mine.correct}>
      <p className="td-quiz-verdict" role="status">
        <span className="td-quiz-mark" aria-hidden>{mine.correct ? <Check size={18} /> : <X size={18} />}</span>
        <b>{mine.correct ? t('today.quiz.right') : t('today.quiz.wrong')}</b>
      </p>
      <div className="td-quiz-reveal">
        {house && <Arms arms={house.arms} size={56} />}
        {person && <Portrait person={person} tree={tree} size={56} decorative />}
        <p className="td-quiz-q">
          {q.subject && f.byId.get(q.subject)
            ? richText(t, PROMPT[q.kind], { name: displayName(f.byId.get(q.subject)!, f) })
            : t(PROMPT[q.kind])}
        </p>
      </div>
      {q.kind === 'order' ? (
        <ol className="td-quiz-order td-quiz-order-done">
          {right.map((option, at) => {
            const o = q.options[option]!;
            const born = yearOf(f.byId.get(o.people?.[0] ?? '')?.born);
            return (
              <li key={option}>
                <span className="td-quiz-rank" aria-hidden>{at + 1}</span>
                <Faces o={o} f={f} tree={tree} show />
                <span className="td-quiz-option-text">{optionText(o, f, t)}</span>
                {Number.isFinite(born) && <span className="subtle">{t('today.quiz.born', { year: String(born) })}</span>}
              </li>
            );
          })}
        </ol>
      ) : (
        <ul className="td-quiz-options td-quiz-options-done">
          {q.options.map((o, i) => {
            const isRight = right[0] === i;
            const isMine = chosen[0] === i;
            return (
              <li key={i} className="td-quiz-option" data-right={isRight || undefined} data-missed={(isMine && !isRight) || undefined}>
                <span className="td-quiz-mark" aria-hidden>{isRight ? <Check size={15} /> : isMine ? <X size={15} /> : null}</span>
                <Faces o={o} f={f} tree={tree} show />
                <span className="td-quiz-option-text">{optionText(o, f, t)}</span>
                {isRight && <span className="td-quiz-tag">{t('today.quiz.tag_right')}</span>}
                {isMine && !isRight && <span className="td-quiz-tag">{t('today.quiz.tag_yours')}</span>}
              </li>
            );
          })}
        </ul>
      )}
      <p className="td-quiz-family">
        {family.answered <= 1 ? t('today.quiz.family_first') : t('today.quiz.family', { count: family.answered, right: family.right })}
        {' '}{t('today.quiz.tomorrow')}
      </p>
      {view.bonus && <p className="td-quiz-bonus"><GameIcon name="broadsword" size={15} /> {t('today.quiz.bonus')}</p>}
      {link && <div className="td-quiz-foot">{link}</div>}
    </div>
  );
}

/** This month's right answers by house: a small table, the leading house first. */
function HouseTable({ rows, f }: { rows: QuizView['houses']; f: Family }) {
  const t = useT();
  const known = rows.filter((r) => f.house.has(r.house));
  if (!known.length) return null;
  return (
    <div className="td-quiz-houses">
      <h3>{t('today.quiz.houses')}</h3>
      <ol>
        {known.map((r) => {
          const h = f.house.get(r.house)!;
          return (
            <li key={r.house}>
              <Arms arms={h.arms} size={22} />
              <span className="td-quiz-house-name">{h.name}</span>
              <span className="td-quiz-house-score">{t('today.quiz.house_score', { count: r.right })}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
