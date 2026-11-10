// AI activity for stewards: what the background tasks did and when, what each cost, what waits for a steward (an arms
// suggestion that is not kept), each task's state with "Run now", the month's spending against the background share, and the
// recent runs, errors included. Stewards only (manage-access, the same check the AI settings page makes). Nothing here is
// written into the family's record, and viewers never see the page.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Activity as ActivityIcon, Play, Settings2 } from 'lucide-react';
import { useState } from 'react';
import { aiActivityQuery, aiRunTask } from '~/lib/ai/background.functions';
import { TASKS, type Activity, type Task } from '~/lib/ai/background';
import { errorText } from '~/lib/errortext';
import { houseTranslationsQuery } from '~/lib/house-meaning.functions';
import { translateReview } from '~/lib/house-translation';
import { dateText, locales, useT, type Key } from '~/lib/i18n';
import { toAiLocale } from '~/lib/ai/types';
import { useTreeId } from '~/lib/family';
import { useCan } from '~/lib/session';
import { EmptyState, ErrorState, Main, PageHeader, Skeleton } from '~/components/ui';
import { ago, usd } from './BackgroundSettings';
import './ai-tasks.css';

const TASK_NAME: Record<Task, Key> = { arms: 'aitasks.arms.name', occupations: 'aitasks.occupations.name', chronicle: 'aitasks.chronicle.name', names: 'aitasks.names.name' };
const VERDICT: Record<'partly' | 'reconsider', Key> = { partly: 'aitasks.verdict.partly', reconsider: 'aitasks.verdict.reconsider' };
const STATUS: Record<string, Key> = {
  done: 'aitasks.status.done', idle: 'aitasks.status.idle', stopped: 'aitasks.status.stopped', failed: 'aitasks.status.failed', skipped: 'aitasks.status.skipped',
};

export function AiActivityPage() {
  const tree = useTreeId();
  const t = useT();
  const steward = useCan('manage-access');
  const q = useQuery({ ...aiActivityQuery(tree), enabled: steward });
  if (!steward) {
    return (
      <Main className="page"><div className="page-inner ai-activity-page">
        <PageHeader title={t('aitasks.activityTitle')} subtitle={t('aitasks.activitySubtitle')} icon={<ActivityIcon size={22} />} />
        <EmptyState title={t('aitasks.stewardsOnly')} text="" />
      </div></Main>
    );
  }
  return (
    <Main className="page"><div className="page-inner ai-activity-page">
      <PageHeader
        title={t('aitasks.activityTitle')}
        subtitle={t('aitasks.activitySubtitle')}
        icon={<ActivityIcon size={22} />}
        actions={<Link to="/$tree/settings/ai" params={{ tree }} className="btn"><Settings2 size={15} /> {t('ai.settingsTitle')}</Link>}
      />
      <p className="ai-privacy">{t('aitasks.privacy')}</p>
      {q.isPending && <Skeleton lines={6} />}
      {q.isError && <ErrorState title={t('ai.settingsLoadFailed')} message={errorText(q.error, t.locale)} onRetry={() => q.refetch()} />}
      {q.data && <ActivityBody tree={tree} data={q.data} />}
    </div></Main>
  );
}

function ActivityBody({ tree, data }: { tree: string; data: Activity }) {
  const t = useT();
  const locale = toAiLocale(t.locale);
  const qc = useQueryClient();
  const [now] = useState(() => Date.now());
  const [ran, setRan] = useState<{ task: Task; text: string; ok: boolean } | null>(null);
  const translations = useQuery(houseTranslationsQuery(tree, t.locale)).data;
  const run = useMutation({
    mutationFn: (task: Task) => aiRunTask({ data: { tree, task } }),
    onSuccess: (out, task) => {
      const ok = out.status === 'done' || out.status === 'idle' || out.status === 'stopped';
      const counts = out.failed > 0 ? t('aitasks.ranPartial', { done: out.done, failed: out.failed, waiting: out.waiting }) : t('aitasks.ranOk', { done: out.done, waiting: out.waiting });
      const text = out.status === 'idle' ? t('aitasks.ranNothing') : ok ? counts : t((STATUS[out.status] ?? 'aitasks.status.failed') as Key);
      // A run that failed says why after its status; a run that partly worked keeps its counts and says which names did not.
      const said = !out.note ? text : !ok ? t('aitasks.withReason', { status: text, reason: out.note }) : out.failed > 0 ? `${text} ${out.note}` : text;
      setRan({ task, text: said, ok });
      void qc.invalidateQueries({ queryKey: ['ai-activity', tree] });
      void qc.invalidateQueries({ queryKey: ['collected-meanings', tree] });
      void qc.invalidateQueries({ queryKey: ['house-translations', tree] });
    },
    onError: (e, task) => setRan({ task, text: errorText(e, locale), ok: false }),
  });
  const cap = Math.max(1, data.capMicros);
  const used = Math.min(100, Math.round((data.backgroundSpentMicros / cap) * 100));
  const resets = new Date(`${data.resetsOn}T00:00:00Z`).toLocaleDateString(locales[locale], { day: 'numeric', month: 'long' });

  return (
    <>
      <section className="ui-card aitasks-section" aria-labelledby="aitasks-waiting-h">
        <h2 id="aitasks-waiting-h" className="rule">{t('aitasks.waitingTitle')}</h2>
        {data.waiting.length === 0 && <p className="muted">{t('aitasks.waitingNone')}</p>}
        {data.waiting.length > 0 && (
          <>
            <p className="muted">{t('aitasks.waitingText')}</p>
            <ul className="aitasks-waiting">
              {data.waiting.map((original) => {
                const w = translateReview(original, translations?.reviews[original.house]);
                return (
                <li key={w.house}>
                  <span className="aitasks-verdict">{t(VERDICT[w.verdict])}</span>
                  <b>{w.name}</b>
                  <span>{w.reason}</span>
                  {w.advice && <span className="muted">{w.advice}</span>}
                  <span>
                    <Link to="/$tree/house/$house" params={{ tree, house: w.house }} className="btn ghost">{t('aitasks.openHouse')}</Link>
                  </span>
                </li>
                );
              })}
            </ul>
          </>
        )}
      </section>

      <section className="ui-card aitasks-section" aria-labelledby="aitasks-tasks-h">
        <h2 id="aitasks-tasks-h" className="rule">{t('aitasks.tasksTitle')}</h2>
        <ul className="aitasks-tasks">
          {TASKS.map((task) => {
            const row = data.tasks.find((x) => x.task === task);
            const state = row?.state ?? 'off';
            const line = !row?.enabled
              ? t('aitasks.off')
              : [row.lastStarted ? t('aitasks.lastRun', { when: ago(row.lastStarted, now, locale) }) : t('aitasks.neverRun'), t('aitasks.waiting', { count: row.waiting })].join(' · ');
            return (
              <li key={task} data-task={task}>
                <span>
                  <b>{t(TASK_NAME[task])}</b>
                  <span className="muted"> · {line}</span>
                  {row?.enabled && state !== 'ready' && <span className="aitasks-status bad"> · {t(`aitasks.skip.${state}` as Key)}</span>}
                </span>
                <button
                  type="button"
                  className="btn"
                  disabled={state !== 'ready' || run.isPending}
                  onClick={() => run.mutate(task)}
                >
                  <Play size={14} /> {run.isPending && run.variables === task ? t('aitasks.running') : t('aitasks.runNow')}
                </button>
                {ran?.task === task && <span className={ran.ok ? 'aitasks-status' : 'aitasks-status bad'} role="status">{ran.text}</span>}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="ui-card aitasks-section" aria-labelledby="aitasks-spend-h">
        <h2 id="aitasks-spend-h" className="rule">{t('aitasks.spendTitle')}</h2>
        <p className="muted">
          {t('aitasks.spendLine', {
            spent: usd(data.backgroundSpentMicros, locale),
            cap: usd(data.capMicros, locale),
            total: usd(data.spentMicros, locale),
            budget: usd(data.monthlyMicros, locale),
            date: resets,
          })}
        </p>
        <div className="aitasks-spend" role="img" aria-label={`${used}%`}><span style={{ width: `${used}%` }} /></div>
      </section>

      <section className="ui-card aitasks-section" aria-labelledby="aitasks-runs-h">
        <h2 id="aitasks-runs-h" className="rule">{t('aitasks.runsTitle')}</h2>
        {data.runs.length === 0 ? (
          <p className="muted">{t('aitasks.runsNone')}</p>
        ) : (
          <ul className="aitasks-runs">
            {data.runs.map((r) => (
              <li key={r.id} data-status={r.status}>
                {/* Engines join a date and a time differently (", " or " at "), and the time is the reader's own: the browser keeps what the server wrote. */}
                <time dateTime={new Date(r.started).toISOString()} suppressHydrationWarning>{dateText(r.started, locale, { dateStyle: 'medium', timeStyle: 'short' })}</time>
                <span>
                  {t(TASK_NAME[r.task])}
                  <span className="muted"> · {r.source === 'manual' ? t('aitasks.by.manual') : t('aitasks.by.schedule')}</span>
                </span>
                <span className={r.status === 'failed' ? 'aitasks-failed' : undefined}>
                  <b>{t(STATUS[r.status] ?? 'aitasks.status.failed')}</b>
                  {r.status !== 'idle' && <span className="muted"> · {t('aitasks.countsLine', { done: r.done, failed: r.failed, waiting: r.waiting })}</span>}
                  {r.note && <span className="aitasks-note"> · {r.note}</span>}
                </span>
                <span className="aitasks-note">{r.micros > 0 ? usd(r.micros, locale) : '—'}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

/** The page's title, in the reader's language. */
