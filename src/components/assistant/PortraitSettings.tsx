// Painted portraits, in the AI settings page (stewards only). Its switch, its provider and its image model are in the "What
// uses what" table above, saved with the rest of the page. What is left here is what is specific to portraits: what a
// painting sends, where it goes, and whether it can run now.
import { useQuery } from '@tanstack/react-query';
import { useT } from '~/lib/i18n';
import { PROVIDER_LABEL, type Provider } from '~/lib/ai/types';
import { portraitSettingsQuery } from '~/lib/portrait.functions';

export function PortraitSettings({ tree }: { tree: string }) {
  const t = useT();
  const q = useQuery(portraitSettingsQuery(tree));
  const s = q.data?.settings;
  const provider: Provider | null = s?.provider ?? null;
  return (
    <section className="ui-card ai-step" aria-labelledby="paint-settings-h">
      <h2 id="paint-settings-h" className="ai-step-title">{t('paint.setTitle')}</h2>
      <p className="subtle">{t('paint.setWhat')}</p>
      {s && s.enabled && s.connected && provider && <p className="ai-card-state ok" role="status">{t('paint.setOnWith', { provider: PROVIDER_LABEL[provider] })}</p>}
      {s && !s.enabled && <p className="subtle">{t('paint.setOff')}</p>}
      {s && s.enabled && !s.connected && <p className="ai-key-status bad" role="alert">{t('paint.setNeedsProvider')}</p>}
      <p className="ai-privacy">{t('paint.setSends', { provider: PROVIDER_LABEL[provider ?? 'openrouter'] })}</p>
    </section>
  );
}
