// The feedback inbox: every report sent from this family's Kindred, newest first, with its picture, what was attached, a
// status, and "Copy as report" for a developer. Stewards only; the server checks the role on every call.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Bug, ClipboardCopy, Download, HelpCircle, ImageOff, Inbox as InboxIcon, Lightbulb, MessageSquarePlus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { EmptyState, ErrorState, PageHeader, Segmented, Skeleton } from '~/components/ui';
import { Dialog } from '~/components/ui/Dialog';
import { errorText } from '~/lib/errortext';
import { FEEDBACK_STATUSES, reportMarkdown, type FeedbackKind, type FeedbackReport, type FeedbackStatus } from '~/lib/feedback';
import { feedbackQuery, removeFeedback, updateFeedbackStatus } from '~/lib/feedback.functions';
import { useTreeId } from '~/lib/family';
import { formatDate, LANGUAGE_NAME, relativeTime, useT, type Key } from '~/lib/i18n';
import { useCan } from '~/lib/session';
import { toast } from '~/lib/toast';
import { openFeedback } from './FeedbackHost';
import './feedback.css';

const KIND: Record<FeedbackKind, { label: Key; icon: typeof Bug }> = {
  bug: { label: 'feedback.kind_bug', icon: Bug },
  idea: { label: 'feedback.kind_idea', icon: Lightbulb },
  confusing: { label: 'feedback.kind_confusing', icon: HelpCircle },
};
const STATUS: Record<FeedbackStatus, Key> = { new: 'feedback.status_new', 'in-progress': 'feedback.status_in_progress', resolved: 'feedback.status_resolved' };

export function FeedbackInbox() {
  const tree = useTreeId();
  const t = useT();
  const steward = useCan('manage-access');
  const q = useQuery({ ...feedbackQuery(tree), enabled: steward });
  const [filter, setFilter] = useState<FeedbackStatus | 'all'>('all');
  const [selected, setSelected] = useState<string | null>(null);
  const header = (
    <PageHeader
      title={t('feedback.inbox_title')}
      subtitle={t('feedback.inbox_subtitle')}
      icon={<InboxIcon size={22} />}
      actions={steward ? <button className="btn" onClick={openFeedback}><MessageSquarePlus size={15} /> {t('feedback.title')}</button> : undefined}
    />
  );
  if (!steward) return <main className="page fb-page">{header}<EmptyState title={t('feedback.stewards_only')} text="" /></main>;
  const reports = q.data ?? [];
  const shown = filter === 'all' ? reports : reports.filter((r) => r.status === filter);
  const current = reports.find((r) => r.id === selected) ?? null;
  return (
    <main className="page fb-page">
      <div className="page-inner">
        {header}
        {q.isPending && <Skeleton lines={6} />}
        {q.isError && <ErrorState message={errorText(q.error, t.locale)} onRetry={() => q.refetch()} />}
        {q.data && reports.length === 0 && <EmptyState icon={<InboxIcon size={28} />} title={t('feedback.empty_title')} text={<>{t('feedback.empty_text')} <kbd>{t('feedback.key_mod')}</kbd> <kbd>{t('feedback.key_shift')}</kbd> <kbd>F</kbd></>} />}
        {reports.length > 0 && (
          <div className="fb-inbox" data-open={current ? '' : undefined}>
            <div className="fb-list-col">
              <Segmented
                aria-label={t('feedback.filter_label')}
                size="sm"
                block
                value={filter}
                onChange={setFilter}
                options={[{ value: 'all', label: t('feedback.filter_all') }, ...FEEDBACK_STATUSES.map((s) => ({ value: s, label: `${t(STATUS[s])} (${reports.filter((r) => r.status === s).length})` }))]}
              />
              {shown.length === 0 ? <p className="fb-note">{t('feedback.filter_none')}</p> : (
                <ul className="fb-list">
                  {shown.map((r) => {
                    const Icon = KIND[r.kind].icon;
                    return (
                      <li key={r.id}>
                        <button className="fb-row" aria-current={r.id === selected || undefined} onClick={() => setSelected(r.id)}>
                          <Icon size={16} aria-hidden />
                          <span className="fb-row-main">
                            <span className="fb-row-text">{r.text}</span>
                            <small>{r.by} · {relativeTime(r.created, t.locale)}</small>
                          </span>
                          <span className="fb-pill" data-status={r.status}>{t(STATUS[r.status])}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <div className="fb-detail-col">
              {current ? <Detail key={current.id} tree={tree} report={current} onClose={() => setSelected(null)} /> : <p className="fb-note fb-pick-one">{t('feedback.pick_one')}</p>}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

function Detail({ tree, report: r, onClose }: { tree: string; report: FeedbackReport; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: feedbackQuery(tree).queryKey });
  const status = useMutation({ mutationFn: (s: FeedbackStatus) => updateFeedbackStatus({ data: { tree, id: r.id, status: s } }), onSuccess: refresh });
  const remove = useMutation({ mutationFn: () => removeFeedback({ data: { tree, id: r.id } }), onSuccess: async () => { await refresh(); onClose(); } });
  const picture = `/api/feedback/${tree}/${r.id}.jpg`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(reportMarkdown(r));
      toast({ title: t('feedback.copied') });
    } catch {
      toast({ title: t('feedback.copy_failed') });
    }
  };
  const c = r.context;
  const rows: [Key, string][] = [
    ['feedback.field_page', c.page],
    ['feedback.field_element', c.selector ?? t('feedback.none_marked')],
    ['feedback.field_language', LANGUAGE_NAME[c.locale]],
    ['feedback.field_theme', c.theme],
    ['feedback.field_screen', c.screen],
    ['feedback.field_browser', c.browser],
    ['feedback.field_version', c.version],
  ];
  return (
    <article className="fb-detail panel">
      <button className="btn ghost fb-back" onClick={onClose}><ArrowLeft size={15} /> {t('feedback.back')}</button>
      <header>
        <b>{t(KIND[r.kind].label)}</b>
        <small>{r.by} · {formatDate(r.created, t.locale)}</small>
      </header>
      <p className="fb-text">{r.text}</p>
      {r.hasPicture ? (
        <a href={picture} target="_blank" rel="noreferrer" className="fb-picture"><img src={picture} alt={t('feedback.picture_alt')} /></a>
      ) : (
        <p className="fb-note"><ImageOff size={15} aria-hidden /> {t('feedback.no_picture')}</p>
      )}
      <Segmented aria-label={t('feedback.status_label')} size="sm" block value={r.status} onChange={(s) => status.mutate(s)} options={FEEDBACK_STATUSES.map((s) => ({ value: s, label: t(STATUS[s]) }))} />
      {status.isError && <p className="fb-error" role="alert">{errorText(status.error, t.locale)}</p>}
      <div className="fb-actions">
        <button className="btn" onClick={() => void copy()}><ClipboardCopy size={15} /> {t('feedback.copy')}</button>
        {r.hasPicture && <a className="btn" href={`${picture}?download=1`}><Download size={15} /> {t('feedback.save_picture')}</a>}
        <button className="btn ghost" onClick={() => setConfirm(true)}><Trash2 size={15} /> {t('common.delete')}</button>
      </div>
      <dl className="fb-details">
        {rows.map(([label, value]) => <div key={label}><dt>{t(label)}</dt><dd>{value}</dd></div>)}
        <div><dt>{t('feedback.field_errors')}</dt><dd>{c.errors.length ? <ul className="fb-errors">{c.errors.map((e, i) => <li key={i}>{e}</li>)}</ul> : t('feedback.no_errors')}</dd></div>
      </dl>
      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title={t('feedback.delete_title')}
        width={420}
        description={t('feedback.delete_text')}
        footer={<>
          <button className="btn" data-autofocus onClick={() => setConfirm(false)}>{t('common.cancel')}</button>
          <button className="btn primary" disabled={remove.isPending} onClick={() => remove.mutate()}>{t('common.delete')}</button>
        </>}
      />
    </article>
  );
}
