// Import and export for one family. Editors and stewards can export (the file carries private fields, so no one
// else may). Only stewards can import: the page reads a GEDCOM file, shows what it would do, and writes only when
// the steward presses the button. A family that already has people needs the explicit "add to this family" switch.
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { EmptyState, ErrorState, Notice, PageHeader, Skeleton, Switch } from '~/components/ui';
import { opKeys } from '~/lib/api';
import { applyImportFile, exchangeContext, exportReport, previewImportFile } from '~/lib/exchange/exchange.functions';
import { translate, useT, type Locale } from '~/lib/i18n';
import { treeTitle } from '~/lib/title';
import '~/styles/exchange.css';

const MAX_BYTES = 5_000_000; // the server refuses more (exchange.functions.ts)

export const Route = createFileRoute('/$tree/settings/import')({
  head: (ctx) => ({ meta: [{ title: treeTitle(ctx, translate((ctx.match.context as { locale?: Locale }).locale ?? 'en', 'exchange.page.title')) }] }),
  component: ExchangePage,
});

type Preview = Awaited<ReturnType<typeof previewImportFile>>;
type Applied = Awaited<ReturnType<typeof applyImportFile>>;
const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

function ExchangePage() {
  const { tree } = Route.useParams();
  const t = useT();
  const context = useQuery({ queryKey: ['exchange-context', tree], queryFn: () => exchangeContext({ data: { tree } }) });

  return (
    <main className="exchange">
      <PageHeader title={t('exchange.page.title')} subtitle={t('exchange.page.subtitle')} />
      {context.isPending ? (
        <Skeleton lines={3} />
      ) : context.isError ? (
        <ErrorState title={t('exchange.state.failed')} error={context.error} onRetry={() => context.refetch()} />
      ) : (
        <>
          {context.data.canExport ? <ExportSection tree={tree} /> : <EmptyState title={t('exchange.export.heading')} text={t('exchange.export.text')} />}
          {context.data.canImport ? (
            <ImportSection tree={tree} people={context.data.people} />
          ) : (
            <Notice>{t('exchange.import.notSteward')}</Notice>
          )}
        </>
      )}
    </main>
  );
}

// ---------- export ----------

function ExportSection({ tree }: { tree: string }) {
  const t = useT();
  return (
    <section className="exchange-section" aria-labelledby="export-heading">
      <h2 id="export-heading">{t('exchange.export.heading')}</h2>
      <p className="exchange-text">{t('exchange.export.text')}</p>
      <div className="exchange-actions">
        <a className="exchange-link" href={`/api/export/${tree}?format=gedcom`} download>
          {t('exchange.export.gedcom')}
        </a>
        <a className="exchange-link" href={`/api/export/${tree}?format=markdown`} download>
          {t('exchange.export.markdown')}
        </a>
      </div>
      <details className="exchange-details">
        <summary>{t('exchange.export.losses')}</summary>
        <LossList tree={tree} format="gedcom" label="GEDCOM" />
        <LossList tree={tree} format="markdown" label="Markdown" />
      </details>
    </section>
  );
}

/** What one format leaves out. Its own loading, failure and empty states. */
function LossList({ tree, format, label }: { tree: string; format: 'gedcom' | 'markdown'; label: string }) {
  const t = useT();
  const q = useQuery({ queryKey: ['exchange-losses', tree, format], queryFn: () => exportReport({ data: { tree, format } }) });
  if (q.isPending) return <Skeleton lines={2} />;
  if (q.isError) return <ErrorState title={t('exchange.state.failed')} error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data.length) return <p className="exchange-text">{label}: {t('exchange.export.noLosses')}</p>;
  return (
    <>
      <p className="exchange-text">{label}</p>
      <ul className="exchange-list">
        {q.data.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
    </>
  );
}

// ---------- import ----------

function ImportSection({ tree, people }: { tree: string; people: number }) {
  const t = useT();
  const qc = useQueryClient();
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [applied, setApplied] = useState<Applied | null>(null);
  const [allow, setAllow] = useState(false);
  const [busy, setBusy] = useState<'preview' | 'apply' | null>(null);
  const [error, setError] = useState<string | null>(null);
  // One retry key per attempt: a retry of the same change after a lost response writes nothing twice.
  const keys = useRef(opKeys());

  async function pick(f: File | undefined) {
    setPreview(null);
    setApplied(null);
    setAllow(false);
    setError(null);
    if (!f) return setFile(null);
    if (f.size > MAX_BYTES) {
      setFile(null);
      return setError(t('exchange.import.tooBig'));
    }
    setFile({ name: f.name, text: await f.text() });
  }

  async function runPreview() {
    if (!file) return;
    setBusy('preview');
    setError(null);
    setApplied(null);
    try {
      setPreview(await previewImportFile({ data: { tree, text: file.text } }));
    } catch (e) {
      setPreview(null);
      setError(/GEDCOM/i.test(messageOf(e)) ? t('exchange.import.notGedcom') : `${t('exchange.state.failed')} ${messageOf(e)}`);
    } finally {
      setBusy(null);
    }
  }

  async function apply() {
    if (!file || !preview) return;
    setBusy('apply');
    setError(null);
    try {
      const opKey = keys.current.for('apply', { text: file.text, allow });
      const result = await applyImportFile({ data: { tree, text: file.text, allowExisting: allow, opKey } });
      keys.current.clear('apply');
      setApplied(result);
      setPreview(null);
      setFile(null);
      qc.invalidateQueries({ queryKey: ['graph', tree] });
      qc.invalidateQueries({ queryKey: ['exchange-context', tree] });
    } catch (e) {
      // Nothing was written: the same key is kept, so pressing again is a safe retry.
      setError(`${t('exchange.import.failed')} ${messageOf(e)}`);
    } finally {
      setBusy(null);
    }
  }

  const needsAllow = people > 0 && !allow;
  const nothingToAdd = !!preview && preview.addCount === 0 && preview.conflictCount === 0 && preview.parents === 0 && preview.unions === 0;

  return (
    <section className="exchange-section" aria-labelledby="import-heading">
      <h2 id="import-heading">{t('exchange.import.heading')}</h2>
      <p className="exchange-text">{t('exchange.import.text')}</p>
      <div className="exchange-actions">
        <input
          type="file"
          accept=".ged,.gedcom,text/plain"
          className="exchange-file"
          aria-label={t('exchange.import.pick')}
          onChange={(e) => pick(e.target.files?.[0])}
        />
        <button type="button" className="exchange-primary" disabled={!file || busy !== null} onClick={runPreview}>
          {busy === 'preview' ? t('exchange.import.previewing') : t('exchange.import.preview')}
        </button>
      </div>

      {error && (
        <p role="alert" className="exchange-text">
          {error}
        </p>
      )}

      {applied && (
        <p className="exchange-done" role="status">
          {t('exchange.import.done', { people: applied.people, parents: applied.parents, unions: applied.unions })}
        </p>
      )}

      {preview && (
        <>
          <p className="exchange-text">
            {t('exchange.import.family', { name: preview.fileName ?? file?.name ?? '' })}
          </p>
          {nothingToAdd ? (
            <Notice>{t('exchange.import.noChange')}</Notice>
          ) : (
            <ul className="exchange-counts">
              <li>{t('exchange.import.summary.new', { count: preview.addCount })}</li>
              <li>{t('exchange.import.summary.matched', { count: preview.matchCount })}</li>
              <li>{t('exchange.import.summary.conflicts', { count: preview.conflictCount })}</li>
              <li>{t('exchange.import.summary.parents', { count: preview.parents })}</li>
              <li>{t('exchange.import.summary.unions', { count: preview.unions })}</li>
              <li>{t('exchange.import.summary.dupes', { count: preview.duplicateParents + preview.duplicateUnions })}</li>
              {preview.ambiguous.length > 0 && <li>{t('exchange.import.summary.ambiguous', { count: preview.ambiguous.length })}</li>}
              {preview.pictures > 0 && <li>{t('exchange.import.summary.pictures', { count: preview.pictures })}</li>}
              {preview.unlinked > 0 && <li>{t('exchange.import.summary.unlinked', { count: preview.unlinked })}</li>}
            </ul>
          )}

          <PreviewList title={t('exchange.import.list.add')} rows={preview.add.map((a) => a.name)} total={preview.addCount} />
          <PreviewList title={t('exchange.import.list.matched')} rows={preview.matched.map((m) => m.name)} total={preview.matchCount} />
          {preview.conflicts.length > 0 && (
            <PreviewList
              title={t('exchange.import.list.conflicts')}
              rows={preview.conflicts.map((c) => `${c.name}: ${c.field} ${c.existing} → ${c.incoming}`)}
              total={preview.conflictCount}
            />
          )}
          {preview.issues.length > 0 && (
            <PreviewList title={t('exchange.import.list.issues')} rows={preview.issues.map((i) => i.message)} total={preview.issueCount} />
          )}

          {people > 0 && (
            <div className="exchange-allow">
              <Switch checked={allow} onChange={setAllow}>
                {t('exchange.import.allow')}
              </Switch>
              <p>{t('exchange.import.allowHint')}</p>
            </div>
          )}
          {needsAllow && <Notice>{t('exchange.import.needAllow', { count: people })}</Notice>}

          <div className="exchange-actions">
            <button type="button" className="exchange-primary" disabled={needsAllow || nothingToAdd || busy !== null} onClick={apply}>
              {busy === 'apply' ? t('exchange.import.applying') : t('exchange.import.apply')}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

/** A list of names or lines, cut at LIST with the true count. Empty lists are not drawn. */
function PreviewList({ title, rows, total }: { title: string; rows: string[]; total: number }) {
  const t = useT();
  if (!total) return null;
  return (
    <>
      <h3 className="exchange-text">
        {title} ({total})
      </h3>
      <ul className="exchange-list">
        {rows.map((r, i) => (
          <li key={`${i}-${r}`}>{r}</li>
        ))}
        {total > rows.length && <li>{t('exchange.import.more', { count: total - rows.length })}</li>}
      </ul>
    </>
  );
}
