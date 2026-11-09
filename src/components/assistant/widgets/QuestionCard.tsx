// A question from the assistant, answered once. The answer is recorded on the server first, then sent as the reader's next
// message, so a reload shows it answered and nothing can answer it twice.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import { aiAnswerQuestion } from '~/lib/ai/widget.functions';
import type { QuestionBlock } from '~/lib/ai/blocks';
import { ANSWER_CHARS } from '~/lib/ai/blocks';
import { graphQuery } from '~/lib/api';
import { errorText } from '~/lib/errortext';
import { fullName } from '~/lib/graph';
import { matchesName } from '~/lib/search';
import { useT } from '~/lib/i18n';
import { DatePicker } from '~/components/ui/DatePicker';
import './widgets.css';

export function QuestionCard({ tree, itemId, block, conv, last, busy, onSend }: {
  tree: string; itemId: string; block: QuestionBlock; conv: string;
  /** The newest turn: an older question has been passed by and can no longer be answered. */
  last: boolean;
  busy: boolean;
  onSend: (text: string) => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const uid = useId();
  const [picked, setPicked] = useState<string[]>([]);
  const [other, setOther] = useState(false);
  const [text, setText] = useState('');
  const [date, setDate] = useState('');
  const [person, setPerson] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const graph = useQuery(graphQuery(tree)).data;

  const answered = block.answer;
  if (answered || !last) {
    return (
      <article className="aw-card aw-question aw-question-done" aria-label={t('chat.question.heading')}>
        <p className="aw-q">{block.question}</p>
        {answered ? <p className="aw-a"><Check size={13} aria-hidden /> {answered.text}</p> : <p className="aw-line aw-faint">{t('chat.question.passed')}</p>}
        {answered && last && !busy && !sent && (
          <button type="button" className="btn ghost ai-touch" onClick={() => { setSent(true); onSend(answered.text); }}>{t('chat.question.sendAgain')}</button>
        )}
      </article>
    );
  }

  const matches = query.trim() ? (graph?.people ?? []).filter((p) => matchesName(p, query)).slice(0, 8) : [];
  const offered = block.people ?? [];
  const chooseOther = () => { setOther(true); setPicked([]); setPerson(null); };
  const toggle = (o: string) => {
    setOther(false);
    setPicked((list) => (block.kind === 'single' ? [o] : list.includes(o) ? list.filter((x) => x !== o) : [...list, o]));
  };

  const ready = other ? !!text.trim()
    : block.kind === 'single' || block.kind === 'multiple' ? picked.length > 0
      : block.kind === 'person' ? !!person
        : block.kind === 'date' ? !!date
          : !!text.trim();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready || sending || busy) return;
    setSending(true);
    setError(null);
    const answer = other || block.kind === 'text' ? { text: text.trim() } : block.kind === 'person' ? { person: person! } : block.kind === 'date' ? { date } : { choices: picked };
    try {
      const r = await aiAnswerQuestion({ data: { tree, itemId, questionId: block.id, conv, answer } });
      setSent(true);
      await qc.invalidateQueries({ queryKey: ['ai-chat', tree] });
      onSend(r.text);
    } catch (err) {
      setError(errorText(err, t.locale));
      await qc.invalidateQueries({ queryKey: ['ai-chat', tree] });
    } finally {
      setSending(false);
    }
  }

  const name = `${uid}-pick`;
  const textId = `${uid}-text`;
  return (
    <form className="aw-card aw-question" aria-label={t('chat.question.heading')} onSubmit={submit}>
      <p className="aw-q" id={`${uid}-q`}>{block.question}</p>
      <div role="group" aria-labelledby={`${uid}-q`} className="aw-choices">
        {(block.kind === 'single' || block.kind === 'multiple') && block.options?.map((o) => (
          <label key={o} className="aw-choice">
            <input type={block.kind === 'single' ? 'radio' : 'checkbox'} name={name} checked={picked.includes(o)} onChange={() => toggle(o)} />
            <span>{o}</span>
          </label>
        ))}
        {block.kind === 'person' && !other && (
          <>
            {offered.map((p) => (
              <label key={p.id} className="aw-choice">
                <input type="radio" name={name} checked={person === p.id} onChange={() => setPerson(p.id)} />
                <span>{p.name}</span>
              </label>
            ))}
            <input className="input" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('common.find_person')} aria-label={t('common.find_person')} autoComplete="off" />
            {matches.map((p) => (
              <label key={p.id} className="aw-choice">
                <input type="radio" name={name} checked={person === p.id} onChange={() => setPerson(p.id)} />
                <span>{fullName(p)}{p.born ? <span className="aw-sub"> {p.born.match(/\d{4}/)?.[0]}</span> : null}</span>
              </label>
            ))}
          </>
        )}
        {block.kind === 'date' && !other && <DatePicker label={t('chat.question.date')} value={date} onChange={setDate} />}
        {(block.kind === 'text' || other) && (
          <>
            <label className="ai-sr" htmlFor={textId}>{t('chat.question.yourAnswer')}</label>
            <textarea id={textId} rows={2} className="input" maxLength={ANSWER_CHARS} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('chat.question.yourAnswer')} />
          </>
        )}
        {block.kind !== 'text' && (
          <label className="aw-choice aw-other">
            <input type={block.kind === 'multiple' ? 'checkbox' : 'radio'} name={block.kind === 'multiple' ? undefined : name} checked={other} onChange={() => (other ? setOther(false) : chooseOther())} />
            <span>{t('chat.question.other')}</span>
          </label>
        )}
      </div>
      <div className="ai-card-actions">
        <button type="submit" className="btn primary" disabled={!ready || sending || busy}>{t('chat.question.answer')}</button>
      </div>
      {error && <p className="ai-card-error" role="alert">{error}</p>}
    </form>
  );
}
