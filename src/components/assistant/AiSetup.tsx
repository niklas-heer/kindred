// "Set up AI", for stewards while a family has no AI key: the top bar's button and its panel, the ⌘K command,
// and the small hints beside AI controls (photos, the character editor, the arms designer). Everyone else
// sees none of it while AI is off. The status comes from the same query the AI controls use.
import { Link } from '@tanstack/react-router';
import { Sparkles } from 'lucide-react';
import { useT } from '~/lib/i18n';
import { useCan } from '~/lib/session';
import { Dialog } from '~/components/ui/Dialog';
import { closeAiSetup, openAiSetup, useAiSetupOpen, useAiStatus } from './store';
import './ai-setup.css';

/** True for a steward when the family has no AI key set up (`configured` is false). False while the status loads. */
export function useAiSetupNeeded(tree: string): boolean {
  const steward = useCan('manage-access');
  const status = useAiStatus(tree);
  return steward && !!status && !status.configured;
}

/** A quiet "Set up AI to use this" link beside an AI control that is hidden because AI is off. `feature` names it. */
export function AiSetupHint({ tree, feature, className = '' }: { tree: string; feature: string; className?: string }) {
  const t = useT();
  const needed = useAiSetupNeeded(tree);
  if (!needed) return null;
  return (
    <Link
      to="/$tree/settings/ai"
      params={{ tree }}
      className={`ai-setup-hint ${className}`}
      title={feature}
      aria-label={`${t('ai.setupHint')}: ${feature}`}
    >
      <Sparkles size={13} aria-hidden /> {t('ai.setupHint')}
    </Link>
  );
}

/** The top bar's stand-in for the assistant button while AI is not set up. Nothing for anyone else. */
export function AiSetupButton({ tree, className = '' }: { tree: string; className?: string }) {
  const t = useT();
  if (!useAiSetupNeeded(tree)) return null;
  return (
    // Below 1600px the words go (the icon and the title stay), as the account's name does, so the family's name keeps its room.
    <button type="button" className={`btn ai-launch ai-setup ${className}`} onClick={openAiSetup} aria-haspopup="dialog" aria-label={t('ai.setupButton')} title={t('ai.setupButton')}>
      <Sparkles size={16} aria-hidden /> <span className="ai-setup-label">{t('ai.setupButton')}</span>
    </button>
  );
}

/** The panel: what the assistant can do, the privacy point in a line, and the way to the settings. Mounted once per family. */
export function AiSetupDialog({ tree }: { tree: string }) {
  const t = useT();
  const open = useAiSetupOpen();
  const needed = useAiSetupNeeded(tree);
  return (
    <Dialog
      open={open && needed}
      onClose={closeAiSetup}
      title={t('ai.setupTitle')}
      width={480}
      footer={
        <Link to="/$tree/settings/ai" params={{ tree }} className="btn primary" onClick={closeAiSetup} data-autofocus>
          <Sparkles size={15} aria-hidden /> {t('ai.setupButton')}
        </Link>
      }
    >
      <div className="ai-setup-panel">
        <p className="ai-setup-lede">{t('ai.setupLede')}</p>
        <h3 className="ai-setup-what">{t('ai.setupWhat')}</h3>
        <ul className="ai-setup-list">
          <li><Sparkles size={15} aria-hidden /> <span>{t('ai.setupDoAsk')}</span></li>
          <li><Sparkles size={15} aria-hidden /> <span>{t('ai.setupDoDraft')}</span></li>
          <li><Sparkles size={15} aria-hidden /> <span>{t('ai.setupDoFaces')}</span></li>
          <li><Sparkles size={15} aria-hidden /> <span>{t('ai.setupDoAvatar')}</span></li>
          <li><Sparkles size={15} aria-hidden /> <span>{t('ai.setupDoArms')}</span></li>
        </ul>
        <p className="ai-setup-privacy">{t('ai.setupPrivacy')}</p>
      </div>
    </Dialog>
  );
}
