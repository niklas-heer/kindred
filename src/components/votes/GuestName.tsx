// The name a share-link guest votes under (docs/votes.md, "Guests"): required, at most MAX_GUEST_NAME characters, and the
// guest is told plainly who sees it. The ballot remembers it in this browser, so changing a vote does not ask again.
//
//   <GuestName value={name} onChange={setName} />
import { useId } from 'react';
import { useT } from '~/lib/i18n';
import { MAX_GUEST_NAME } from '~/lib/votes/types';

export function GuestName({ value, onChange }: { value: string; onChange: (name: string) => void }) {
  const t = useT();
  const id = useId();
  return (
    <div className="field vt-guest-name">
      <label htmlFor={id}>{t('votes.guest_name')}</label>
      <input
        id={id} className="input" type="text" autoComplete="name" required maxLength={MAX_GUEST_NAME}
        value={value} onChange={(e) => onChange(e.target.value)} aria-describedby={`${id}-hint`}
      />
      <p className="vt-note subtle" id={`${id}-hint`}>{t('votes.guest_name_hint')}</p>
    </div>
  );
}
