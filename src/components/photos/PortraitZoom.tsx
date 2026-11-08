// A person's face that opens large. The picture shown large is the one on screen: a photo, a painted portrait or the drawing.
import { useState, type SyntheticEvent } from 'react';
import { faceOf, faceSrc, Portrait, useHouse } from '~/components/Portrait';
import { useT, type Key } from '~/lib/i18n';
import type { Face } from '~/lib/portrait-face';
import type { GPerson } from '~/lib/types';
import { PictureLightbox } from './Lightbox';
import '../profile.css';

const FACE_LABEL: Record<Face, Key> = { photo: 'pp.photo', portrait: 'paint.showPainted', drawing: 'pp.drawn' };
// A row or card around the picture must not also react to what happens in the dialog: React events pass through portals.
const contain = (e: SyntheticEvent) => e.stopPropagation();

export function PortraitZoom({ person, tree, size, frame, prefer, className = '' }: {
  person: GPerson;
  tree: string;
  size: number;
  frame?: boolean;
  prefer?: 'photo' | 'avatar' | 'portrait';
  className?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const house = useHouse(person, tree, undefined);
  const name = [person.given, person.surname].filter(Boolean).join(' ');
  const face = faceOf(person, prefer);
  return (
    <>
      <button
        type="button"
        className={`portrait-zoom ${className}`.trim()}
        aria-label={t('profile.enlarge', { name })}
        aria-haspopup="dialog"
        title={t('profile.enlarge', { name })}
        onClick={(e) => { contain(e); e.preventDefault(); setOpen(true); }}
      >
        <Portrait person={person} tree={tree} size={size} frame={frame} prefer={prefer} decorative />
      </button>
      {open ? (
        <span className="portrait-zoom-host" onClick={contain} onKeyDown={contain} onPointerDown={contain}>
          <PictureLightbox src={faceSrc(person, tree, house, face, 'lg')} alt={name} caption={`${name} · ${t(FACE_LABEL[face])}`} onClose={() => setOpen(false)} />
        </span>
      ) : null}
    </>
  );
}
