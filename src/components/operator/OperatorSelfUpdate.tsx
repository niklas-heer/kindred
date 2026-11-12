// "Updating this server", in the console's Updates tab (docs/hosting-many-families.md, "Updates"). A Deploy-button install
// (KINDRED_UPDATE_VIA=github-actions) stores a GitHub token and gets the Update button, which runs the copy's update workflow
// after a fresh passkey proof and then follows the run; every other install is shown its own steps.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, ShieldAlert, Wrench } from 'lucide-react';
import { useId, useState } from 'react';
import { Notice } from '~/components/ui';
import { withFreshProof } from '~/lib/auth/client';
import { errorText } from '~/lib/errortext';
import { formatDate, useT } from '~/lib/i18n';
import { operatorForgetUpdateToken, operatorSaveUpdateToken, operatorStartUpdate, selfUpdateQuery } from '~/lib/operator/self-update.functions';
import { releaseFlags, releasesUpTo, runActive, updateCommands, type SelfUpdate, type UpdateRun } from '~/lib/operator/self-update-shared';
import type { UpdateStatus } from '~/lib/operator/updates-shared';

/** How often the console asks about a running update (the server asks GitHub at most every 10 seconds). */
const POLL = 15_000;

export function SelfUpdateSection({ status }: { status: UpdateStatus }) {
  const t = useT();
  const { data } = useQuery({ ...selfUpdateQuery, refetchInterval: (q) => (runActive(q.state.data?.run ?? null) ? POLL : false) });
  if (!data) return null;
  const target = status.updateAvailable ? status.latest : null;
  const docs = (file: string, anchor: string) => `https://github.com/${status.repo}/blob/main/docs/${file}#${anchor}`;
  return (
    <section aria-labelledby="update-self" className="ops-section">
      <h2 id="update-self" className="rule">{t('update.section')}</h2>
      {data.install === 'github-actions' ? <ButtonInstall data={data} status={status} target={target} />
        : data.install === 'docker' ? (
          <>
            <p>{t('update.docker', { image: `${data.image}:${target ?? status.version ?? 'latest'}` })}</p>
            <pre className="ops-code"><code>{updateCommands('docker-image', target)}</code></pre>
            <p className="families-hint">{t('update.docker_built')}</p>
            <pre className="ops-code"><code>{updateCommands('docker-built', target)}</code></pre>
            <Doc href={docs('self-host.md', 'upgrades')} />
          </>
        ) : data.install === 'cloudflare' ? (
          <>
            <p>{t('update.cloudflare')}</p>
            <pre className="ops-code"><code>{updateCommands('cloudflare', target)}</code></pre>
            <Doc href={docs('deploy-cloudflare.md', 'upgrading')} />
          </>
        ) : (
          <>
            <p>{t('update.node')}</p>
            <pre className="ops-code"><code>{updateCommands('node', target)}</code></pre>
            <Doc href={docs('self-host.md', 'upgrades')} />
          </>
        )}
    </section>
  );
}

function Doc({ href }: { href: string }) {
  const t = useT();
  return <p><a href={href} target="_blank" rel="noopener noreferrer">{t('update.steps_doc')} <ExternalLink size={13} aria-hidden /></a></p>;
}

function ButtonInstall({ data, status, target }: { data: SelfUpdate; status: UpdateStatus; target: string | null }) {
  const t = useT();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['operator', 'self-update'] });
  const start = useMutation({
    mutationFn: (tag: string) => withFreshProof(() => operatorStartUpdate({ data: { tag } })),
    onSuccess: async () => { setError(null); await refresh(); },
    onError: (e) => setError(errorText(e, t.locale)),
  });
  const forget = useMutation({
    mutationFn: () => operatorForgetUpdateToken(),
    onSuccess: async () => { setError(null); await refresh(); },
    onError: (e) => setError(errorText(e, t.locale)),
  });
  const between = target ? releasesUpTo(status.newer, target).map((r) => ({ release: r, ...releaseFlags(r) })) : [];
  const manual = between.some((x) => x.manual);
  const busy = runActive(data.run);
  return (
    <>
      <p>{t('update.via_button')}</p>
      {data.repo ? (
        <div className="families-row">
          <p className="muted">{t('update.saved', { tail: data.tokenTail ?? '', repo: data.repo, branch: data.branch ?? '', date: data.setAt ? formatDate(data.setAt, t.locale, { dateStyle: 'long' }) : '' })}</p>
          <button type="button" className="btn ghost" disabled={forget.isPending || busy} onClick={() => forget.mutate()}>{t('update.forget')}</button>
        </div>
      ) : <TokenForm />}
      {data.run && <RunState run={data.run} />}
      {!status.enabled ? <p className="families-hint">{t('update.check_first')}</p>
        : !target ? <p className="families-hint">{t('update.up_to_date')}</p>
        : (
          <div className="ui-card families-card">
            <p>{t('update.between')}</p>
            <ul className="ops-list">
              {between.map(({ release: r, manual: m, security: s }) => (
                <li key={r.version}>
                  <a href={r.url} target="_blank" rel="noopener noreferrer nofollow">{r.version}</a>
                  {s && <> <span className="chip operator-chip"><ShieldAlert size={13} aria-hidden /> {t('ops.flag_security')}</span></>}
                  {m && <> <span className="chip"><Wrench size={13} aria-hidden /> {t('ops.flag_manual')}</span></>}
                </li>
              ))}
            </ul>
            {manual ? <Notice icon={<Wrench size={15} aria-hidden />}>{t('update.manual_refused')}</Notice>
              : <p className="families-hint">{t('update.confirm')}</p>}
            <div className="families-row">
              <button type="button" className="btn primary" disabled={!data.repo || manual || busy || start.isPending} onClick={() => start.mutate(`v${target}`)}>
                {t('update.to', { version: `v${target}` })}
              </button>
            </div>
          </div>
        )}
      {error && <p role="alert" className="families-error">{error}</p>}
    </>
  );
}

function TokenForm() {
  const t = useT();
  const qc = useQueryClient();
  const ids = useId();
  const [repo, setRepo] = useState('');
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => operatorSaveUpdateToken({ data: { repo, token } }),
    onSuccess: async () => { setToken(''); setError(null); await qc.invalidateQueries({ queryKey: ['operator', 'self-update'] }); },
    onError: (e) => setError(errorText(e, t.locale)),
  });
  return (
    <form className="ui-card families-card" onSubmit={(e) => { e.preventDefault(); if (repo.trim() && token.trim() && !save.isPending) save.mutate(); }}>
      <p>{t('update.token_intro')}</p>
      <p className="families-hint" id={`${ids}-how`}>{t('update.token_how')}</p>
      <div className="operator-grid">
        <label className="field">
          <span>{t('update.repo_label')}</span>
          <input className="input" value={repo} maxLength={200} spellCheck={false} autoComplete="off" onChange={(e) => setRepo(e.target.value)} />
        </label>
        <label className="field">
          <span>{t('update.token_label')}</span>
          <input className="input" type="password" value={token} maxLength={400} spellCheck={false} autoComplete="off" aria-describedby={`${ids}-how`} onChange={(e) => setToken(e.target.value)} />
        </label>
      </div>
      <div className="families-row">
        <button type="submit" className="btn" disabled={!repo.trim() || !token.trim() || save.isPending}>{t('update.save')}</button>
      </div>
      {error && <p role="alert" className="families-error">{error}</p>}
    </form>
  );
}

function RunState({ run }: { run: UpdateRun }) {
  const t = useT();
  const tag = run.tag;
  const text = run.status === 'completed'
    ? run.conclusion === 'success' ? t('update.run_success', { tag }) : t('update.run_failed', { tag, conclusion: run.conclusion ?? '?' })
    : !runActive(run) ? t('update.run_lost', { tag })
    : run.status === 'in_progress' ? t('update.run_in_progress', { tag })
    : run.status === 'queued' || run.status === 'waiting' || run.status === 'pending' ? t('update.run_queued', { tag })
    : t('update.run_requested', { tag });
  return (
    <p role="status">
      {text}{' '}
      {run.url && <a href={run.url} target="_blank" rel="noopener noreferrer">{t('update.run_link')} <ExternalLink size={13} aria-hidden /></a>}
    </p>
  );
}
