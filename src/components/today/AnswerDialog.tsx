// Answering the question of the week: first whose memory it is (the reader themself when they have said who they are,
// or anyone in the tree), then a few sentences. The answer is saved as a memory of that person, so it is in the
// Chronicle and on their page like any other, and this week's card lists it with the others.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { PersonPicker } from '~/components/photos/PersonPicker';
import { Portrait } from '~/components/Portrait';
import { Dialog } from '~/components/ui';
import { opKeys } from '~/lib/api';
import { errorText } from '~/lib/errortext';
import { useFamily, useMeChosen } from '~/lib/family';
import { displayName } from '~/lib/graph';
import { useT } from '~/lib/i18n';
import { closestFamily } from '~/lib/person-overview';
import { toast } from '~/lib/toast';
import { answerWeekQuestion, weekQuery } from '~/lib/today/today.functions';
import type { WeekQuestion } from '~/lib/today/types';
import type { GPerson } from '~/lib/types';
import { questionText } from './WeekQuestionCard';

export function AnswerDialog({ tree, question, onClose }: { tree: string; question: WeekQuestion; onClose: () => void }) {
  const t = useT();
  const f = useFamily();
  const qc = useQueryClient();
  const me = useMeChosen();
  const [about, setAbout] = useState<GPerson | null>(me ? f.byId.get(me) ?? null : null);
  const [body, setBody] = useState('');
  // One key per attempt: a retry after a lost answer never saves the memory twice.
  const [keys] = useState(opKeys);
  const words = questionText(question, t);
  const save = useMutation({
    mutationFn: () => {
      const data = { tree, week: question.week, person: about!.id, body: body.trim(), locale: t.locale };
      return answerWeekQuestion({ data: { ...data, opKey: keys.for('answer', data) } });
    },
    onSuccess: async () => {
      keys.clear('answer');
      await qc.invalidateQueries({ queryKey: weekQuery(tree).queryKey });
      void qc.invalidateQueries({ queryKey: ['person', tree, about!.id] });
      void qc.invalidateQueries({ queryKey: ['graph', tree] });
      void qc.invalidateQueries({ queryKey: ['chronicle', tree] });
      void qc.invalidateQueries({ queryKey: ['feed', tree] });
      toast({ title: t('today.answer.saved'), body: t('today.answer.saved_body'), person: about!.id, icon: 'quill-ink' });
      onClose();
    },
  });
  const suggested = me ? [me, ...closestFamily(f, me, 7).shown.map((r) => r.id)] : undefined;

  return (
    <Dialog open onClose={onClose} title={t('today.answer.title')} variant="event" width="min(560px, 100vw - 24px)" dirty={body.trim().length > 0} bodyClassName="td-answer-dialog">
      <p className="td-answer-q">{words}</p>
      {about ? (
        <form onSubmit={(e) => { e.preventDefault(); if (body.trim()) save.mutate(); }}>
          <div className="td-answer-about">
            <Portrait person={about} tree={tree} size={44} decorative />
            <div>
              <span className="subtle">{t('today.answer.about')}</span>
              <b>{about.id === me ? t('today.answer.about_me', { name: displayName(about, f) }) : displayName(about, f)}</b>
            </div>
            <button type="button" className="btn ghost" onClick={() => setAbout(null)}>{t('today.answer.someone_else')}</button>
          </div>
          <label htmlFor="td-answer-body">{t('today.answer.label')}</label>
          <textarea id="td-answer-body" className="input" rows={6} maxLength={20000} value={body} onChange={(e) => setBody(e.target.value)} placeholder={t('today.answer.placeholder')} data-autofocus />
          <p className="subtle">{t('today.answer.hint')}</p>
          {save.isError && <p role="alert">{errorText(save.error, t.locale)}</p>}
          <div className="td-change-actions">
            <button type="submit" className="btn primary" disabled={!body.trim() || save.isPending}>{t('today.answer.save')}</button>
            <button type="button" className="btn ghost" onClick={onClose}>{t('common.cancel')}</button>
          </div>
        </form>
      ) : (
        <>
          <h3 className="td-answer-who">{t('today.answer.who')}</h3>
          <PersonPicker label={t('today.answer.who')} onPick={setAbout} suggested={suggested} portraits={tree} />
        </>
      )}
    </Dialog>
  );
}
