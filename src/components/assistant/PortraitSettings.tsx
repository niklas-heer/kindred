// Painted portraits, in the AI settings page (stewards only). Its switch, its provider and its image model are in the "What
// uses what" table above, saved with the rest of the page. What is left here is what is specific to portraits: the family's
// style, what a painting sends, where it goes, and whether it can run now.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { errorText } from '~/lib/errortext';
import { useT } from '~/lib/i18n';
import { DEFAULT_FAMILY_STYLE, MAX_STYLE_CHARS } from '~/lib/ai/portrait-rules';
import { PROVIDER_LABEL, type Provider } from '~/lib/ai/types';
import { portraitSettingsQuery, savePortraitStyle } from '~/lib/portrait.functions';

export function PortraitSettings({ tree }: { tree: string }) {
  const t = useT();
  const qc = useQueryClient();
  const q = useQuery(portraitSettingsQuery(tree));
  const s = q.data?.settings;
  const provider: Provider | null = s?.provider ?? null;
  const saved = s ? s.style || DEFAULT_FAMILY_STYLE : null;
  const [text, setText] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (saved !== null) setText((now) => now ?? saved);
  }, [saved]);
  const save = useMutation({
    mutationFn: (style: string) => savePortraitStyle({ data: { tree, style } }),
    onSuccess: async () => {
      setNotice(t('paint.setSaved'));
      await qc.invalidateQueries({ queryKey: portraitSettingsQuery(tree).queryKey });
    },
    onError: (e) => setNotice(errorText(e, t.locale)),
  });
  const value = text ?? saved ?? '';
  const tooLong = value.trim().length > MAX_STYLE_CHARS;
  return (
    <section className="ui-card ai-step" aria-labelledby="paint-settings-h">
      <h2 id="paint-settings-h" className="rule ai-step-title">{t('paint.setTitle')}</h2>
      <p className="subtle">{t('paint.setWhat')}</p>
      {s && s.enabled && s.connected && provider && <p className="ai-card-state ok" role="status">{t('paint.setOnWith', { provider: PROVIDER_LABEL[provider] })}</p>}
      {s && !s.enabled && <p className="subtle">{t('paint.setOff')}</p>}
      {s && s.enabled && !s.connected && <p className="ai-key-status bad" role="alert">{t('paint.setNeedsProvider')}</p>}
      {s ? (
        <div className="paint-style">
          <label className="ai-field">
            <span>{t('paint.styleLabel')}</span>
            <textarea rows={6} value={value} aria-invalid={tooLong} onChange={(e) => { setText(e.target.value); setNotice(null); }} />
          </label>
          <p className="subtle">{t('paint.styleHint')}</p>
          <p className={tooLong ? 'ai-key-status bad' : 'subtle'}>{t('paint.styleCount', { n: String(value.trim().length), max: String(MAX_STYLE_CHARS) })}</p>
          <div className="paint-style-actions">
            <button type="button" className="btn ghost" onClick={() => { setText(DEFAULT_FAMILY_STYLE); setNotice(null); }} disabled={save.isPending || value === DEFAULT_FAMILY_STYLE}>{t('paint.styleReset')}</button>
            <button type="button" className="btn primary" onClick={() => save.mutate(value)} disabled={save.isPending || tooLong || !value.trim() || value === saved}>{t('paint.styleSave')}</button>
          </div>
          {notice ? <p className="subtle" role="status">{notice}</p> : null}
        </div>
      ) : null}
      <p className="ai-privacy">{t('paint.setSends', { provider: PROVIDER_LABEL[provider ?? 'openrouter'] })}</p>
    </section>
  );
}
