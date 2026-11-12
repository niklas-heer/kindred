// On a family's Access page, for its stewards: answering a request about someone in the family's records who is not a member
// (docs/gdpr.md, "A person in the tree"). Find the person by name; see where they appear, by place and count, never what the
// family keeps about the relatives around them; download a copy of what is kept about them (to send them); restrict them
// (kept, but not changed) or erase them everywhere Kindred keeps them. Erasing needs their name typed and, under Kindred's own
// sign-in, the steward's passkey once more. A request the operator forwarded can be named, so it is marked answered with it.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Eraser, Lock, Search, Unlock } from 'lucide-react';
import { useId, useState } from 'react';
import { Dialog, Notice } from '~/components/ui';
import { withFreshProof } from '~/lib/auth/client';
import { errorText } from '~/lib/errortext';
import { formatDate, useT, type Key } from '~/lib/i18n';
import { eraseSubject, fetchSubjectCopy, findSubject, restrictSubject, subjectReportQuery } from '~/lib/gdpr/gdpr.functions';
import { familyDataRequestsQuery } from '~/lib/operator/operator.functions';
import { useSession } from '~/lib/session';
import type { PersonHit, SubjectReport } from '~/lib/gdpr/subject.server';
import { downloadText, fileSafe } from './download';
import './gdpr.css';

const PLACE: Record<string, Key> = { link: 'gdpr.how_link', text: 'gdpr.how_text', history: 'gdpr.how_history', conversation: 'gdpr.how_conversation' };

export function SubjectRequests({ tree }: { tree: string }) {
  const t = useT();
  const ids = useId();
  const previewing = !!useSession()?.viewAs;
  const [text, setText] = useState('');
  const [hits, setHits] = useState<PersonHit[] | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const search = useMutation({
    mutationFn: () => findSubject({ data: { tree, text } }),
    onSuccess: (r) => { setHits(r); setChosen(null); },
    onError: (e) => setError(errorText(e, t.locale)),
  });
  if (previewing) return null;
  return (
    <section aria-labelledby={`${ids}-h`} className="gdpr-subject">
      <h2 id={`${ids}-h`} className="rule">{t('gdpr.subject_title')}</h2>
      <p className="families-hint">{t('gdpr.subject_hint')}</p>
      <form className="families-row" role="search" onSubmit={(e) => { e.preventDefault(); if (text.trim()) { setError(null); search.mutate(); } }}>
        <label className="operator-inline">
          <span>{t('gdpr.subject_search')}</span>
          <input className="input gdpr-search" value={text} onChange={(e) => setText(e.target.value)} maxLength={200} />
        </label>
        <button type="submit" className="btn" disabled={!text.trim() || search.isPending}><Search size={15} aria-hidden /> {t('gdpr.find')}</button>
      </form>
      {error && <Notice onDismiss={() => setError(null)}>{error}</Notice>}
      {hits && (hits.length === 0 ? <p className="muted">{t('gdpr.nobody_found')}</p> : (
        <ul className="gdpr-hits">
          {hits.map((h) => (
            <li key={h.id}>
              <button type="button" className={`btn ghost${chosen === h.id ? ' gdpr-chosen' : ''}`} aria-pressed={chosen === h.id} onClick={() => setChosen(h.id)}>
                {h.name}{h.born && <span className="muted"> · {h.born}</span>}
                {h.living && <span className="muted"> · {t('gdpr.living')}</span>}
                {h.member && <span className="muted"> · {t('gdpr.member')}</span>}
                {h.restricted && <span className="muted"> · {t('gdpr.restricted')}</span>}
              </button>
            </li>
          ))}
        </ul>
      ))}
      {chosen && <SubjectPanel tree={tree} person={chosen} onGone={() => { setChosen(null); setHits((h) => h?.filter((x) => x.id !== chosen) ?? null); }} />}
    </section>
  );
}

function SubjectPanel({ tree, person, onGone }: { tree: string; person: string; onGone: () => void }) {
  const t = useT();
  const ids = useId();
  const qc = useQueryClient();
  const report = useQuery(subjectReportQuery(tree, person));
  const requests = useQuery(familyDataRequestsQuery(tree));
  const [request, setRequest] = useState('');
  const [erasing, setErasing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ['subject', tree, person] }), qc.invalidateQueries({ queryKey: ['data-requests', tree] })]);
  const copy = useMutation({
    mutationFn: () => fetchSubjectCopy({ data: { tree, person } }),
    onSuccess: (c) => downloadText(`kindred-${tree}-${fileSafe(report.data?.person.name ?? person)}.json`, c.text),
    onError: (e) => setError(errorText(e, t.locale)),
  });
  const restrict = useMutation({
    mutationFn: (on: boolean) => restrictSubject({ data: { tree, person, on, request: request || null } }),
    onSuccess: refresh,
    onError: (e) => setError(errorText(e, t.locale)),
  });
  if (report.isPending) return <p className="muted" aria-busy="true">{t('gdpr.looking')}</p>;
  if (report.isError || !report.data) return <p className="families-error" role="alert">{errorText(report.error, t.locale)}</p>;
  const r = report.data;
  const total = r.traces.reduce((n, x) => n + x.rows, 0);
  const open = (requests.data ?? []).filter((x) => x.status !== 'done');
  return (
    <div className="ui-card families-card gdpr-panel" aria-labelledby={`${ids}-name`}>
      <h3 id={`${ids}-name`}>{r.person.name}{r.person.born && <span className="muted"> · {r.person.born}</span>}</h3>
      {r.restrictedSince && <p className="operator-soon">{t('gdpr.restricted_since', { date: formatDate(r.restrictedSince, t.locale) })}</p>}
      {r.person.member && <p className="families-hint">{t('gdpr.is_member_hint')}</p>}
      <p>{t('gdpr.appears', { count: total })}</p>
      {r.traces.length > 0 && (
        <div className="operator-table-wrap">
          <table className="operator-table">
            <thead><tr><th>{t('gdpr.place')}</th><th>{t('gdpr.how')}</th><th>{t('gdpr.rows')}</th></tr></thead>
            <tbody>{r.traces.map((x) => <tr key={`${x.db}.${x.table}.${x.how}`}><td><code>{x.table}</code></td><td>{t(PLACE[x.how]!)}</td><td>{x.rows}</td></tr>)}</tbody>
          </table>
        </div>
      )}
      {r.pictures.length > 0 && (
        <p className="families-hint">{t('gdpr.pictures', { count: r.pictures.length, deleted: r.pictures.filter((p) => p.deleted).length })}</p>
      )}
      {r.names.length > 0 && <p className="families-hint">{t('gdpr.names_replaced', { names: r.names.join(', ') })}</p>}
      {open.length > 0 && (
        <label className="operator-inline">
          <span>{t('gdpr.answers_request')}</span>
          <select className="input" value={request} onChange={(e) => setRequest(e.target.value)}>
            <option value="">{t('gdpr.no_request')}</option>
            {open.map((x) => <option key={x.id} value={x.id}>{x.name} · {formatDate(x.created, t.locale)}</option>)}
          </select>
        </label>
      )}
      <div className="families-row">
        <button type="button" className="btn" onClick={() => copy.mutate()} disabled={copy.isPending}><Download size={15} aria-hidden /> {t('gdpr.copy')}</button>
        {!r.person.member && (r.restrictedSince
          ? <button type="button" className="btn" onClick={() => restrict.mutate(false)} disabled={restrict.isPending}><Unlock size={15} aria-hidden /> {t('gdpr.lift')}</button>
          : <button type="button" className="btn" onClick={() => restrict.mutate(true)} disabled={restrict.isPending}><Lock size={15} aria-hidden /> {t('gdpr.restrict')}</button>)}
        {!r.person.member && <button type="button" className="btn danger" onClick={() => setErasing(true)}><Eraser size={15} aria-hidden /> {t('gdpr.erase')}</button>}
      </div>
      {done && <p role="status" className="muted">{done}</p>}
      {error && <p role="alert" className="families-error">{error}</p>}
      {erasing && <EraseDialog tree={tree} report={r} request={request || null} onClose={() => setErasing(false)}
        onDone={(n) => { setErasing(false); setDone(t('gdpr.erased', { count: n })); void qc.invalidateQueries({ queryKey: ['data-requests', tree] }); void qc.invalidateQueries({ queryKey: ['graph', tree] }); onGone(); }} />}
    </div>
  );
}

function EraseDialog({ tree, report: r, request, onClose, onDone }: { tree: string; report: SubjectReport; request: string | null; onClose: () => void; onDone: (rows: number) => void }) {
  const t = useT();
  const ids = useId();
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const erase = useMutation({
    mutationFn: () => withFreshProof(() => eraseSubject({ data: { tree, person: r.person.id, confirm: typed, request } })),
    onSuccess: (res) => onDone(Object.values(res.counts).reduce((n, x) => n + x, 0)),
    onError: (e) => setError(errorText(e, t.locale)),
  });
  return (
    <Dialog open onClose={onClose} title={t('gdpr.erase_title', { name: r.person.name })} width={480} dismissible={!erase.isPending}>
      <form className="gdpr-confirm" onSubmit={(e) => { e.preventDefault(); if (typed.trim() && !erase.isPending) erase.mutate(); }}>
        <p>{t('gdpr.erase_text')}</p>
        <label htmlFor={`${ids}-typed`}>{t('gdpr.erase_confirm', { name: r.person.name })}</label>
        <input id={`${ids}-typed`} className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" maxLength={400} />
        <p className="families-hint">{t('proof.hint')}</p>
        {error && <p role="alert" className="families-error">{error}</p>}
        <div className="families-row">
          <button type="button" className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <button type="submit" className="btn primary acct-danger" disabled={!typed.trim() || erase.isPending}>{erase.isPending ? t('gdpr.erasing') : t('gdpr.erase_for_good')}</button>
        </div>
      </form>
    </Dialog>
  );
}
