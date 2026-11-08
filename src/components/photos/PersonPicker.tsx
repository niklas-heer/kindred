// Find a person by name, for putting someone in a photo. Shows the best matches as buttons.
import { useMemo, useState } from 'react';
import { useFamily } from '~/lib/family';
import { displayName } from '~/lib/graph';
import { matchesName } from '~/lib/search';
import type { GPerson } from '~/lib/types';
import { useT } from '~/lib/i18n';
import '~/styles/gallery.css';

/** The birth year, to tell two people with the same name apart. */
const yearOf = (p: GPerson) => p.born?.match(/\d{4}/)?.[0] ?? null;

export function PersonPicker({ onPick, label }: { onPick: (person: GPerson) => void; label: string }) {
  const f = useFamily();
  const g = useT();
  const [q, setQ] = useState('');
  const matches = useMemo(() => {
    // Birth and current names both count, so a married name finds the person as well as the birth name.
    return f.graph.people.filter((p) => matchesName(p, q)).slice(0, 8);
  }, [f, q]);

  return (
    <div className="gal-picker">
      <input
        className="input"
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={g('common.find_person')}
        aria-label={label}
        autoComplete="off"
        data-autofocus
      />
      <ul className="gal-picker-list" aria-label={label}>
        {matches.map((p) => (
          <li key={p.id}>
            <button type="button" className="gal-picker-item" onClick={() => onPick(p)}>
              <span className="name">{displayName(p, f)}</span>
              {yearOf(p) ? <span className="subtle">{yearOf(p)}</span> : null}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
