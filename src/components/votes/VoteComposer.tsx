// Starting a vote (docs/votes.md): the question and an optional description, two to twenty options, single choice or
// ranked, open or secret, whether others may add options and whether guests may vote, and when it closes (in a week
// unless the creator picks another time, from an hour to ninety days away). A retried request never starts it twice.
//
//   <VoteComposer tree={tree} onClose={close} onStarted={(id) => go(id)} />
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { useId, useState } from 'react';
import { Dialog, Segmented, Switch } from '~/components/ui';
import { opKeys } from '~/lib/api';
import { errorText } from '~/lib/errortext';
import { useT } from '~/lib/i18n';
import { startVote } from '~/lib/votes/votes.functions';
import {
  DEFAULT_CLOSE_DAYS, MAX_CLOSE_DAYS, MAX_DESCRIPTION, MAX_OPTION, MAX_OPTIONS, MAX_QUESTION, MIN_CLOSE_MS, MIN_OPTIONS, type VoteKind,
} from '~/lib/votes/types';

const DAY = 86_400_000;

/** A datetime-local value, in the reader's own time zone, and back. */
export const toLocalInput = (ms: number) => new Date(ms - new Date(ms).getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
export const fromLocalInput = (value: string) => (value ? new Date(value).getTime() : NaN);

export function VoteComposer({ tree, onClose, onStarted }: { tree: string; onClose: () => void; onStarted: (id: string) => void }) {
  const t = useT();
  const id = useId();
  const qc = useQueryClient();
  const [keys] = useState(opKeys);
  // The time the window opened: the closing time's default and its range are counted from it.
  const [opened] = useState(() => Date.now());
  const [question, setQuestion] = useState('');
  const [description, setDescription] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [kind, setKind] = useState<VoteKind>('single');
  const [secret, setSecret] = useState(false);
  const [addOptions, setAddOptions] = useState(false);
  const [guests, setGuests] = useState(false);
  const [closes, setCloses] = useState(() => toLocalInput(opened + DEFAULT_CLOSE_DAYS * DAY));

  const labels = options.map((o) => o.trim()).filter(Boolean);
  const closesAt = fromLocalInput(closes);
  const ready = !!question.trim() && labels.length >= MIN_OPTIONS && Number.isFinite(closesAt);
  const dirty = !!question.trim() || !!description.trim() || labels.length > 0;

  const start = useMutation({
    mutationFn: () => {
      const data = {
        tree,
        vote: { question: question.trim(), description: description.trim(), kind, secret, addOptions, guests, closesAt: new Date(closesAt).toISOString(), options: labels },
      };
      return startVote({ data: { ...data, opKey: keys.for('start', data) } });
    },
    onSuccess: async ({ id: vote }) => {
      keys.clear();
      await qc.invalidateQueries({ queryKey: ['votes', tree] });
      onClose();
      onStarted(vote);
    },
  });

  const setOption = (i: number, value: string) => setOptions((cur) => cur.map((o, j) => (j === i ? value : o)));

  return (
    <Dialog
      open onClose={onClose} title={t('votes.new')} variant="event" width="min(580px, 100vw - 24px)" dirty={dirty && !start.isSuccess}
      footer={<button type="submit" form={`${id}-form`} className="btn primary" disabled={!ready || start.isPending}>{t('votes.compose.start')}</button>}
    >
      <form id={`${id}-form`} className="vt-composer" onSubmit={(e) => { e.preventDefault(); if (ready && !start.isPending) start.mutate(); }}>
        <div className="vt-field">
          <label className="vt-label" htmlFor={`${id}-q`}>{t('votes.compose.question')}</label>
          <input
            id={`${id}-q`} className="input" type="text" required maxLength={MAX_QUESTION} value={question}
            onChange={(e) => setQuestion(e.target.value)} placeholder={t('votes.compose.question_placeholder')} data-autofocus
          />
        </div>
        <div className="vt-field">
          <label className="vt-label" htmlFor={`${id}-d`}>{t('votes.compose.description')}</label>
          <textarea id={`${id}-d`} className="input" rows={2} maxLength={MAX_DESCRIPTION} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <fieldset className="vt-field vt-options">
          <legend className="vt-label">{t('votes.compose.options')}</legend>
          {options.map((o, i) => (
            <div key={i} className="vt-option-row">
              <input
                className="input" type="text" maxLength={MAX_OPTION} value={o} onChange={(e) => setOption(i, e.target.value)}
                aria-label={t('votes.compose.option_n', { n: i + 1 })} placeholder={t('votes.compose.option_n', { n: i + 1 })}
              />
              {options.length > MIN_OPTIONS && (
                <button
                  type="button" className="btn icon ghost" onClick={() => setOptions((cur) => cur.filter((_, j) => j !== i))}
                  aria-label={t('votes.compose.remove_option', { n: i + 1 })} title={t('votes.compose.remove_option', { n: i + 1 })}
                ><X size={15} aria-hidden /></button>
              )}
            </div>
          ))}
          {options.length < MAX_OPTIONS && (
            <button type="button" className="btn ghost vt-add" onClick={() => setOptions((cur) => [...cur, ''])}><Plus size={15} aria-hidden /> {t('votes.compose.add_option')}</button>
          )}
        </fieldset>
        <div className="vt-field">
          <span className="vt-label" id={`${id}-k`}>{t('votes.compose.kind')}</span>
          <Segmented
            aria-labelledby={`${id}-k`} block value={kind} onChange={setKind}
            options={[{ value: 'single', label: t('votes.kind_single') }, { value: 'ranked', label: t('votes.kind_ranked') }]}
          />
          <p className="vt-note subtle">{kind === 'single' ? t('votes.compose.kind_single_hint') : t('votes.compose.kind_ranked_hint')}</p>
        </div>
        <div className="vt-field">
          <Switch checked={secret} onChange={setSecret} aria-describedby={`${id}-s`}>{t('votes.compose.secret')}</Switch>
          <p className="vt-note subtle" id={`${id}-s`}>{secret ? t('votes.secret_meaning') : t('votes.compose.open_hint')}</p>
        </div>
        <div className="vt-field">
          <Switch checked={addOptions} onChange={setAddOptions}>{t('votes.compose.add_options')}</Switch>
        </div>
        <div className="vt-field">
          <Switch checked={guests} onChange={setGuests} aria-describedby={`${id}-g`}>{t('votes.compose.guests')}</Switch>
          <p className="vt-note subtle" id={`${id}-g`}>{t('votes.compose.guests_hint')}</p>
        </div>
        <div className="vt-field">
          <label className="vt-label" htmlFor={`${id}-c`}>{t('votes.compose.closes')}</label>
          <input
            id={`${id}-c`} className="input vt-when" type="datetime-local" required value={closes} onChange={(e) => setCloses(e.target.value)}
            min={toLocalInput(opened + MIN_CLOSE_MS)} max={toLocalInput(opened + MAX_CLOSE_DAYS * DAY)} aria-describedby={`${id}-ch`}
          />
          <p className="vt-note subtle" id={`${id}-ch`}>{t('votes.compose.closes_hint', { count: MAX_CLOSE_DAYS })}</p>
        </div>
        {start.isError && <p role="alert" className="vt-note vt-error">{errorText(start.error, t.locale)}</p>}
      </form>
    </Dialog>
  );
}
