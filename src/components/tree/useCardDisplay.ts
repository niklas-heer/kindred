import { useEffect, useState } from 'react';
import { nameModeKey, type NameMode } from '~/lib/graph';
import type { AgeMode } from './DisplayChoices';

/** How the tree's cards show names and ages: this reader's choice for this family, kept in the browser and shared between tabs. */
export function useCardDisplay(tree: string) {
  const [nameMode, setNameMode] = useState<NameMode>('full');
  const [ageMode, setAgeMode] = useState<AgeMode>('living');
  useEffect(() => {
    const read = () => {
      try {
        const names = localStorage.getItem(nameModeKey(tree));
        setNameMode(names === 'nickname' || names === 'first' ? names : 'full');
        const ages = localStorage.getItem(`kindred:${tree}:ages`);
        setAgeMode(ages === 'all' || ages === 'off' ? ages : 'living');
      } catch { /* Storage can be unavailable in private browsing. */ }
    };
    read();
    addEventListener('storage', read);
    addEventListener('kindred:names', read);
    return () => { removeEventListener('storage', read); removeEventListener('kindred:names', read); };
  }, [tree]);
  const changeNameMode = (mode: NameMode) => {
    setNameMode(mode);
    try { localStorage.setItem(nameModeKey(tree), mode); } catch {}
    dispatchEvent(new Event('kindred:names'));
  };
  const changeAgeMode = (mode: AgeMode) => {
    setAgeMode(mode);
    try { localStorage.setItem(`kindred:${tree}:ages`, mode); } catch {}
  };
  return { nameMode, ageMode, changeNameMode, changeAgeMode };
}
