// Background AI tasks, in the AI settings page (stewards only; the page is). Three tasks, each with its switch (off until a
// steward turns it on) and its schedule, a plain line on what it sends, when it last ran and what waits. "Run now" runs one
// batch of a task. Below them: the share of the monthly budget that background work may use, and the languages the
// translations go into. Every change is saved at once; nothing runs at save. The results are on the AI activity page.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Play } from 'lucide-react';
import { useState } from 'react';
import { aiActivityQuery, aiRunTask, aiSaveBackground } from '~/lib/ai/background.functions';
import { TASK_FEATURE, TASKS, type Activity, type BackgroundSettings as Settings, type SaveInput, type Schedule, type Task } from '~/lib/ai/background';
import { errorText } from '~/lib/errortext';
import { locales, useT, type Key, type Locale } from '~/lib/i18n';
import { toAiLocale } from '~/lib/ai/types';
import { ErrorState, Range, Select, Skeleton, Switch } from '~/components/ui';
import './ai-tasks.css';

const TASK_NAME: Record<Task, Key> = { arms: 'aitasks.arms.name', occupations: 'aitasks.occupations.name', chronicle: 'aitasks.chronicle.name' };
const TASK_WHAT: Record<Task, Key> = { arms: 'aitasks.arms.what', occupations: 'aitasks.occupations.what', chronicle: 'aitasks.chronicle.what' };
const FEATURE_KEY: Record<'arms' | 'assistant', Key> = { arms: 'ai.featureArms', assistant: 'ai.featureAssistant' };
const LANGUAGE_NAME: Record<Locale, string> = { en: 'English', de: 'Deutsch', af: 'Afrikaans' };
const CAP_TICKS = [5, 20, 50, 100];

/** How long ago a time was, in the reader's language ("2 hours ago"). */
export function ago(ms: number, now: number, locale: Locale): string {
  const rtf = new Intl.RelativeTimeFormat(locales[locale], { numeric: 'auto' });
  const s = (ms - now) / 1000;
  const a = Math.abs(s);
  if (a < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if (a < 86_400) return rtf.format(Math.round(s / 3600), 'hour');
  if (a < 86_400 * 60) return rtf.format(Math.round(s / 86_400), 'day');
  return rtf.format(Math.round(s / (86_400 * 30)), 'month');
}

/** A money amount in micro-dollars, in the reader's language. Under a cent it shows four decimals, so a small cost is not "US$0". */
export const usd = (micros: number, locale: Locale, digits?: number) => {
  const max = digits ?? (Math.abs(micros) < 10_000 && micros !== 0 ? 4 : 2);
  return new Intl.NumberFormat(locales[locale], { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: max }).format(micros / 1_000_000);
};

/** The settings the form edits: the save input's shape, which the server returns in full after each save. */
type Draft = SaveInput;

const draftOf = (s: Settings): Draft => ({
  tasks: {
    arms: { enabled: s.tasks.arms.enabled, schedule: s.tasks.arms.schedule },
    occupations: { enabled: s.tasks.occupations.enabled, schedule: s.tasks.occupations.schedule },
    chronicle: { enabled: s.tasks.chronicle.enabled, schedule: s.tasks.chronicle.schedule },
  },
  capShare: s.capShare,
  languages: s.languages,
  locale: s.locale,
});

export function BackgroundSettings({ tree }: { tree: string }) {
  const t = useT();
  const q = useQuery(aiActivityQuery(tree));
  return (
    <section className="ui-card ai-step aitasks" aria-labelledby="aitasks-h">
      <h2 id="aitasks-h" className="ai-step-title">{t('aitasks.title')}</h2>
      {q.isPending && <Skeleton lines={5} />}
      {q.isError && <ErrorState title={t('ai.settingsLoadFailed')} message={errorText(q.error, t.locale)} onRetry={() => q.refetch()} />}
      {q.data && <BackgroundForm tree={tree} data={q.data} />}
    </section>
  );
}

function BackgroundForm({ tree, data }: { tree: string; data: Activity }) {
  const t = useT();
  const locale = toAiLocale(t.locale);
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft>(() => draftOf(data.settings));
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [ran, setRan] = useState<{ task: Task; text: string } | null>(null);
  const now = Date.now();
  const refresh = () => qc.invalidateQueries({ queryKey: ['ai-activity', tree] });

  const save = useMutation({
    mutationFn: (next: Draft) => aiSaveBackground({ data: { tree, input: next } }),
    onSuccess: (saved) => {
      setDraft(draftOf(saved));
      setNotice({ ok: true, text: t('aitasks.saved') });
      void refresh();
    },
    onError: (e) => setNotice({ ok: false, text: errorText(e, locale) || t('aitasks.saveFailed') }),
  });

  const change = (next: Draft) => {
    setDraft(next);
    setNotice(null);
    save.mutate({ ...next, locale });
  };

  const run = useMutation({
    mutationFn: (task: Task) => aiRunTask({ data: { tree, task } }),
    onSuccess: (out, task) => {
      setRan({ task, text: out.status === 'done' || out.status === 'stopped' ? t('aitasks.ranOk', { done: out.done, waiting: out.waiting }) : t(`aitasks.status.${out.status}` as Key) });
      void refresh();
    },
    onError: (e, task) => setRan({ task, text: errorText(e, locale) }),
  });

  const share = Math.round(draft.capShare * 100);
  const monthly = data.monthlyMicros;
  const capText = t('aitasks.capValue', { percent: share, amount: usd(Math.floor(monthly * draft.capShare), locale) });

  return (
    <>
      <p className="ai-privacy">{t('aitasks.intro')}</p>

      <div className="aitasks-cap">
        <label className="ai-label" htmlFor="aitasks-cap-range">{t('aitasks.cap')}</label>
        <Range
          id="aitasks-cap-range"
          value={share}
          min={5}
          max={100}
          step={5}
          ticks={CAP_TICKS}
          format={(v) => `${v}%`}
          aria-label={t('aitasks.cap')}
          disabled={save.isPending}
          onChange={(v) => setDraft({ ...draft, capShare: v / 100 })}
          onCommit={(v) => change({ ...draft, capShare: v / 100 })}
        />
        <p className="aitasks-cap-line">{capText}</p>
      </div>

      <div className="aitasks-langs" role="group" aria-label={t('aitasks.langs')}>
        <span className="aitasks-label">{t('aitasks.langs')}</span>
        {(['en', 'de', 'af'] as Locale[]).map((l) => (
          <Switch
            key={l}
            checked={draft.languages.includes(l)}
            disabled={save.isPending}
            onChange={(on) => change({ ...draft, languages: on ? [...draft.languages, l].filter((x, i, a) => a.indexOf(x) === i) : draft.languages.filter((x) => x !== l) })}
          >
            {LANGUAGE_NAME[l]}
          </Switch>
        ))}
      </div>

      {TASKS.map((task) => {
        const row = data.tasks.find((x) => x.task === task);
        const setting = draft.tasks[task];
        const ready = row?.state === 'ready';
        const hint = !setting.enabled ? null : row?.state === 'ready' ? null : row?.state === 'feature-off' ? t('aitasks.need.feature', { feature: t(FEATURE_KEY[TASK_FEATURE[task]]) }) : t(`aitasks.skip.${row?.state ?? 'off'}` as Key);
        const statusLine = row?.lastStarted ? t('aitasks.lastRun', { when: ago(row.lastStarted, now, locale) }) : t('aitasks.neverRun');
        return (
          <div className="aitasks-task" key={task} data-task={task}>
            <div className="aitasks-task-head">
              <h3 className="aitasks-task-name">{t(TASK_NAME[task])}</h3>
              <Switch
                checked={setting.enabled}
                disabled={save.isPending}
                onChange={(on) => change({ ...draft, tasks: { ...draft.tasks, [task]: { ...setting, enabled: on } } })}
              >
                {setting.enabled ? t('aitasks.on') : t('aitasks.off')}
              </Switch>
            </div>
            <p className="aitasks-task-what">{t(TASK_WHAT[task])}</p>
            <div className="aitasks-task-controls">
              <Select
                aria-label={t('aitasks.schedule')}
                size="sm"
                value={setting.schedule}
                disabled={save.isPending}
                options={[{ value: 'daily', label: t('aitasks.daily') }, { value: 'weekly', label: t('aitasks.weekly') }]}
                onChange={(v) => change({ ...draft, tasks: { ...draft.tasks, [task]: { ...setting, schedule: v as Schedule } } })}
              />
              <button
                type="button"
                className="btn"
                disabled={!ready || run.isPending}
                onClick={() => run.mutate(task)}
                title={t('aitasks.runNowHint')}
              >
                <Play size={14} /> {run.isPending && run.variables === task ? t('aitasks.running') : t('aitasks.runNow')}
              </button>
            </div>
            <p className="aitasks-status">
              {statusLine} · {row ? t('aitasks.waiting', { count: row.waiting }) : ''}
            </p>
            {hint && <p className="aitasks-status bad" role="status">{hint}</p>}
            {ran?.task === task && <p className="aitasks-status" role="status">{ran.text}</p>}
          </div>
        );
      })}

      <div className="aitasks-foot">
        {notice && <p className={notice.ok ? 'ai-card-state ok' : 'ai-card-error'} role={notice.ok ? 'status' : 'alert'}>{notice.text}</p>}
        <Link to="/$tree/settings/activity" params={{ tree }} className="btn">{t('aitasks.openActivity')}</Link>
      </div>
    </>
  );
}
