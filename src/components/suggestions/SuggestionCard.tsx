// One waiting suggestion as an editor or steward reviews it on the Suggestions page (docs/suggestions.md): who suggested it
// (a guest is marked), when, their note, their files (served only to reviewers while it waits), and the change as
// "what · now · suggested". The reviewer may adjust the suggested values first, say a missing relative is someone already
// in the tree, and name the source its files go to. The buttons are exactly what the server's `may` allows: Approve (after
// a confirmation), Decline (with an optional reason the suggester sees), and Close as partly applied for an approval that
// began and cannot finish (offered once an approval failed on the card, or ten minutes after it began). The server checks
// again; an approval refused because the record moved on reads the record anew.
//
//   {list.map((v) => <SuggestionCard key={v.id} tree={tree} v={v} />)}
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Check, FileText, PencilLine, RotateCcw, Undo2, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Portrait } from '~/components/Portrait';
import { When } from '~/components/votes/When';
import { ConfirmDialog, Dialog } from '~/components/ui';
import { opKeys } from '~/lib/api';
import { errorText } from '~/lib/errortext';
import { useFamily } from '~/lib/family';
import { displayName, lifespan } from '~/lib/graph';
import { useT } from '~/lib/i18n';
import {
  approvalKeys, approveSuggestionFn, closePartlyAppliedFn, declineSuggestionFn, matchCandidatesQuery, suggestionKeys,
} from '~/lib/suggestions/suggestions.functions';
import type { LifeEvent } from '~/lib/events';
import { MAX_REASON, offersClose, type EventPayload, type SuggestionView } from '~/lib/suggestions/types';
import { toast } from '~/lib/toast';
import { eventMode, headingOf, nowOf, rowsFor, sizeText, useEventsOf, valueAt, valueText, ValueInput, withValue, type Row } from './view';
import './suggestions.css';

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
/** Refusals that mean the reviewer must look at the suggestion again before approving it. */
const RELOOK = new Set(['suggest.err.changed', 'suggest.err.decided']);

export function SuggestionCard({ tree, v }: { tree: string; v: SuggestionView }) {
  const t = useT();
  const id = useId();
  const f = useFamily();
  const qc = useQueryClient();
  const events = useEventsOf(tree, v);
  const [adjusting, setAdjusting] = useState(false);
  const [values, setValues] = useState(v.payload);
  const [existing, setExisting] = useState('');
  const defaultTitle = t('sources.supplied_by_suggestion', { name: v.author.name });
  const [title, setTitle] = useState(defaultTitle);
  const [asking, setAsking] = useState<'approve' | 'decline' | 'close' | null>(null);
  const [reason, setReason] = useState('');
  const matches = useQuery({ ...matchCandidatesQuery(tree, v.id), enabled: v.kind === 'relative' && v.may.approve }).data ?? [];
  const rows = rowsFor(v.kind, adjusting ? values : v.payload, v.payload);
  const adjusted = adjusting && !same(values, v.payload);
  const filesSource = v.files.length > 0 && v.kind !== 'source';
  const refresh = (keys: unknown[][]) => Promise.all(keys.map((queryKey) => qc.invalidateQueries({ queryKey })));
  // A decline or a close sent again after a lost response is the same one, not refused as already decided.
  const ops = useRef(opKeys());
  // Closing as partly applied is offered once an approval failed here, or once it has stood begun a while (offersClose); the
  // clock is the browser's, read after the page is drawn, so the server's render and the browser's agree.
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!v.may.close) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [v.may.close]);

  const approve = useMutation({
    mutationFn: () => approveSuggestionFn({
      data: {
        tree, id: v.id,
        adjusted: adjusted ? (values as Record<string, unknown>) : undefined,
        // The record's values this page shows: approving over them is the reviewer's decision (review.server.ts).
        seen: v.current ?? undefined,
        existing: existing || undefined,
        sourceTitle: filesSource && title.trim() && title.trim() !== defaultTitle ? title.trim() : undefined,
      },
    }),
    onSuccess: async () => {
      setAsking(null);
      toast({ title: t('suggest.approved'), body: headingOf(v, f, t, events), icon: 'quill-ink' });
      await refresh(approvalKeys(tree));
    },
    // The record moved on, or another reviewer acted: the list is read again, with the record's values now, and the
    // confirmation closes, so approving again means pressing Approve once the reviewer has seen them.
    onError: (e) => {
      setFailed(true);
      if (e instanceof Error && RELOOK.has(e.message)) setAsking(null);
      void refresh(suggestionKeys(tree));
    },
  });
  const decline = useMutation({
    mutationFn: () => {
      const data = { tree, id: v.id, reason: reason.trim() || undefined };
      return declineSuggestionFn({ data: { ...data, opKey: ops.current.for('decline', data) } });
    },
    onSuccess: async () => { setAsking(null); await refresh(suggestionKeys(tree)); },
  });
  const close = useMutation({
    mutationFn: () => closePartlyAppliedFn({ data: { tree, id: v.id, opKey: ops.current.for('close', v.id) } }),
    onSuccess: async () => { setAsking(null); await refresh(approvalKeys(tree)); },
  });
  const busy = approve.isPending || decline.isPending || close.isPending;
  const closable = offersClose(v, failed, now);
  const chosen = matches.find((m) => m.person === existing);
  const chosenPerson = chosen ? f.byId.get(chosen.person) : undefined;
  const heading = headingOf(v, f, t, events);
  const correction = !!v.current;
  // A correction sets a value to none (an event's note to no words); a new person, event or source leaves it out.
  const corrects = v.kind === 'details' || (v.kind === 'event' && eventMode(v.payload as EventPayload) !== 'new');
  const edit = (r: Row, x: unknown) => setValues((p) => {
    let next = withValue(p, r.path, x === null || x === '' ? (corrects ? (r.path === 'note' ? '' : null) : undefined) : x);
    // A relative's kind of parent or of partnership goes with the link it belongs to.
    if (r.path === 'link.kind') {
      if (x !== 'parent' && x !== 'child') next = withValue(next, 'link.parentKind', undefined);
      if (x !== 'partner') next = withValue(next, 'link.partnerKind', undefined);
    }
    return next;
  });

  return (
    <article className="ui-card sg-card" aria-labelledby={`${id}-h`}>
      <header className="sg-card-head">
        <h2 className="sg-card-title" id={`${id}-h`}>
          {v.person && f.byId.has(v.person) ? <Link to="/$tree/person/$id" params={{ tree, id: v.person }}>{heading}</Link> : heading}
        </h2>
        <p className="sg-meta subtle">
          <Author tree={tree} v={v} />
          <When at={v.createdAt} />
        </p>
      </header>
      {v.note && <blockquote className="sg-note">{v.note}</blockquote>}

      <Change v={v} rows={rows} values={adjusting ? values : v.payload} correction={correction} events={events}
        edit={adjusting ? edit : undefined} />
      {adjusting && <p className="subtle sg-hint">{t('suggest.card.adjusting')}</p>}

      {v.files.length > 0 && <Files tree={tree} v={v} />}

      {v.kind === 'relative' && matches.length > 0 && (
        <div className="sg-matches" role="radiogroup" aria-labelledby={`${id}-m`}>
          <span className="sg-label" id={`${id}-m`}>{t('suggest.match.title')}</span>
          <label className="sg-match">
            <input type="radio" name={`${id}-match`} checked={!existing} onChange={() => setExisting('')} />
            <span>{t('suggest.match.new')}</span>
          </label>
          {matches.map((m) => {
            const p = f.byId.get(m.person);
            if (!p) return null;
            return (
              <label key={m.person} className="sg-match">
                <input type="radio" name={`${id}-match`} checked={existing === m.person} onChange={() => setExisting(m.person)} aria-describedby={`${id}-mh`} />
                <Portrait person={p} tree={tree} size={24} decorative />
                <span>{t('suggest.match.existing', { name: displayName(p, f) })} <small className="subtle">{lifespan(p, t.locale)}</small></span>
              </label>
            );
          })}
          <p className="subtle sg-hint" id={`${id}-mh`}>{t('suggest.match.existing_hint')}</p>
        </div>
      )}

      {filesSource && v.may.approve && (
        <label className="field sg-source-title">
          <span>{t('suggest.source_title')}</span>
          <input className="input" type="text" maxLength={300} value={title} onChange={(e) => setTitle(e.target.value)} aria-describedby={`${id}-st`} />
          <small className="subtle" id={`${id}-st`}>{t('suggest.source_title_hint')}</small>
        </label>
      )}

      {v.may.close && <p className="sg-begun" role="note">{t(closable ? 'suggest.card.begun' : 'suggest.card.begun_retry')}</p>}
      {approve.isError && asking !== 'approve' && <p className="err" role="alert">{errorText(approve.error, t.locale)}</p>}

      <div className="sg-actions">
        {v.may.approve && <button type="button" className="btn primary" disabled={busy} aria-haspopup="dialog" onClick={() => { approve.reset(); setAsking('approve'); }}><Check size={15} aria-hidden /> {t('suggest.approve')}</button>}
        {v.may.approve && !v.may.close && (adjusting
          ? <button type="button" className="btn ghost" disabled={busy} onClick={() => { setValues(v.payload); setAdjusting(false); }}><RotateCcw size={15} aria-hidden /> {t('suggest.card.reset')}</button>
          : <button type="button" className="btn" disabled={busy} onClick={() => setAdjusting(true)}><PencilLine size={15} aria-hidden /> {t('suggest.card.adjust')}</button>)}
        {v.may.decline && <button type="button" className="btn ghost" disabled={busy} aria-haspopup="dialog" onClick={() => { decline.reset(); setAsking('decline'); }}><X size={15} aria-hidden /> {t('suggest.decline')}</button>}
        {closable && <button type="button" className="btn ghost" disabled={busy} aria-haspopup="dialog" onClick={() => { close.reset(); setAsking('close'); }}><Undo2 size={15} aria-hidden /> {t('suggest.close_partial')}</button>}
      </div>

      <ConfirmDialog
        open={asking === 'approve'} onClose={() => setAsking(null)} onConfirm={() => approve.mutate()} busy={approve.isPending}
        title={t('suggest.approve_title')} confirmLabel={t('suggest.approve')}
        error={approve.isError ? errorText(approve.error, t.locale) : undefined}
      >
        <p>
          {chosenPerson ? t('suggest.approve_text_existing', { person: displayName(chosenPerson, f), name: v.author.name })
            : t(adjusted ? 'suggest.approve_text_adjusted' : 'suggest.approve_text', { name: v.author.name })}
        </p>
      </ConfirmDialog>
      <ConfirmDialog
        open={asking === 'close'} onClose={() => setAsking(null)} onConfirm={() => close.mutate()} busy={close.isPending}
        title={t('suggest.close_title')} confirmLabel={t('suggest.close_partial')}
        error={close.isError ? errorText(close.error, t.locale) : undefined}
      >
        <p>{t('suggest.close_text')}</p>
      </ConfirmDialog>
      <Dialog
        open={asking === 'decline'} onClose={() => { if (!decline.isPending) setAsking(null); }} title={t('suggest.decline_title')}
        width="min(480px, 100vw - 24px)" dismissible={!decline.isPending} dirty={!!reason.trim()}
        footer={
          <>
            <button type="button" className="btn ghost" onClick={() => setAsking(null)} disabled={decline.isPending}>{t('common.cancel')}</button>
            <button type="submit" form={`${id}-decline`} className="btn danger" disabled={decline.isPending}>{t('suggest.decline')}</button>
          </>
        }
      >
        <form id={`${id}-decline`} className="sg-decline" onSubmit={(e) => { e.preventDefault(); if (!decline.isPending) decline.mutate(); }}>
          <label className="sg-label" htmlFor={`${id}-r`}>{t('suggest.decline_reason')}</label>
          <textarea id={`${id}-r`} className="input" rows={3} maxLength={MAX_REASON} value={reason} onChange={(e) => setReason(e.target.value)} aria-describedby={`${id}-rh`} />
          <p className="subtle sg-hint" id={`${id}-rh`}>{t('suggest.decline_reason_hint', { name: v.author.name })}</p>
          {decline.isError && <p role="alert" className="err">{errorText(decline.error, t.locale)}</p>}
        </form>
      </Dialog>
    </article>
  );
}

/** Who suggested it: a member's face and name, or a guest's name with "Guest". */
export function Author({ tree, v }: { tree: string; v: SuggestionView }) {
  const t = useT();
  const f = useFamily();
  const person = v.author.person ? f.byId.get(v.author.person) : undefined;
  return (
    <span className="sg-by">
      {person ? <Portrait person={person} tree={tree} size={24} decorative /> : <span className="sg-initial" aria-hidden>{(v.author.name.trim()[0] ?? '·').toUpperCase()}</span>}
      {t('suggest.card.by', { name: v.author.name })}
      {v.author.guest && <span className="chip sg-guest">{t('suggest.card.guest')}</span>}
    </span>
  );
}

/** The change as a table: what, (for a correction a reviewer reads) what the record has now, and what is suggested. */
export function Change({ v, rows, values, correction, events, edit }: {
  v: SuggestionView; rows: Row[]; values: SuggestionView['payload']; correction: boolean; events?: LifeEvent[];
  edit?: (r: Row, value: unknown) => void;
}) {
  const t = useT();
  if (!rows.length) return null;
  return (
    <table className="sg-change">
      <thead>
        <tr>
          <th scope="col">{t('suggest.card.field')}</th>
          {correction && <th scope="col">{t('suggest.card.now')}</th>}
          <th scope="col">{t('suggest.card.suggested')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const now = nowOf(v, r);
          const was = v.basis?.[r.path];
          const moved = correction && v.basis && r.path in v.basis && !same(was, now);
          return (
            <tr key={r.path}>
              <th scope="row">{t(r.label)}</th>
              {correction && (
                <td className="sg-now">
                  {valueText(r, now, t, { events })}
                  {moved && <small className="sg-was">{t('suggest.card.was', { value: valueText(r, was, t, { events }) })}</small>}
                </td>
              )}
              <td className="sg-next">
                {edit && r.editable
                  ? <ValueInput row={r} value={valueAt(values, r.path)} onChange={(x) => edit(r, x)} t={t} />
                  : valueText(r, valueAt(values, r.path), t, { events })}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** The suggestion's files, each a link that opens it (reviewers and, while it waits, its suggester). */
export function Files({ tree, v }: { tree: string; v: SuggestionView }) {
  const t = useT();
  const id = useId();
  return (
    <div className="sg-files-shown">
      <span className="sg-label" id={id}>{t('suggest.card.files')}</span>
      <ul aria-labelledby={id}>
        {v.files.map((file) => (
          <li key={file.id}>
            <FileText size={14} aria-hidden />{' '}
            <a href={`/api/suggestion-file/${tree}/${file.id}`} target="_blank" rel="noopener noreferrer">{file.name}</a>{' '}
            <small className="subtle">{sizeText(file.size, t.locale)}</small>
          </li>
        ))}
      </ul>
    </div>
  );
}
