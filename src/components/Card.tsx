// A person on the canvas, at three levels of detail.
import { Minus, Plus } from 'lucide-react';
import { memo } from 'react';
import { displayName, lifespan, partnersOf, type Family } from '~/lib/graph';
import type { GPerson } from '~/lib/types';
import type { LNode } from '~/lib/layout';
import type { Detail } from './Canvas';
import { GameIcon } from './GameIcon';
import { Arms, houseColour } from './Heraldry';
import { Portrait } from './Portrait';
import './card.css';

export type AddRelation = 'parent' | 'child' | 'partner' | 'sibling';

interface Props {
  node: LNode;
  detail: Detail;
  family: Family;
  tree: string;
  kin?: string;
  selected: boolean;
  isMe: boolean;
  showSpouses: boolean;
  onSelect: (id: string) => void;
  /** Double-click: make this person the centre of the tree. */
  onOpen?: (id: string) => void;
  onToggle?: (id: string) => void;
  onAdd?: (id: string, r: AddRelation, sex?: 'm' | 'f') => void;
}

export const Card = memo(function Card({ node, detail, family: f, tree, kin, selected, isMe, showSpouses, onSelect, onOpen, onToggle, onAdd }: Props) {
  if (node.ghost) {
    // An unknown parent: an open slot that invites filling in.
    const { child, as } = node.ghost;
    const of = f.byId.get(child);
    return (
      <button
        className={`card ghost ${detail}`}
        onClick={() => onAdd?.(child, 'parent', as === 'father' ? 'm' : 'f')}
        title={`Add ${of?.given ?? 'their'}'s ${as}`}
      >
        {detail !== 'far' && (
          <>
            <span className="ghost-plus"><Plus size={detail === 'near' ? 26 : 34} /></span>
            {detail === 'near' && <span className="ghost-label">{as === 'father' ? 'Father' : 'Mother'}</span>}
            {detail === 'near' && <span className="ghost-sub">of {of?.given ?? '?'} · unknown</span>}
          </>
        )}
      </button>
    );
  }
  const p = f.byId.get(node.id);
  if (!p) return null;
  const house = p.house ? f.house.get(p.house) : undefined;
  const name = displayName(p, f);

  if (detail === 'far') {
    // Overview: a small shield in the house colour, a crown for rulers.
    const ruler = /^(King|Queen|Emperor|Empress)\b/.test(p.title ?? '');
    return (
      <button
        className={`card far${selected ? ' selected' : ''}${p.living ? ' living' : ''}${isMe ? ' me' : ''}${ruler ? ' crowned' : ''}`}
        style={{ ['--house' as string]: house ? houseColour(house.arms) : '#8a8270' }}
        onClick={() => onSelect(p.id)}
        onDoubleClick={() => onOpen?.(p.id)}
        title={`${name} · ${lifespan(p)}`}
      >
        {node.folded ? <span className="far-fold">+{node.folded}</span> : ruler ? <GameIcon name="crown" size={84} className="far-crown" /> : null}
      </button>
    );
  }

  const spouses = showSpouses ? partnersOf(f, p.id).map((id) => f.byId.get(id)!).filter(Boolean) : [];
  const roleClass = node.role === 'dup' ? ' dup' : node.role === 'partner' ? ' partner' : node.role === 'sibling' ? ' sibling' : node.role === 'kin' ? ' kin' : '';
  const ruler = /^(King|Queen|Emperor|Empress)\b/.test(p.title ?? '');
  const sub = p.title && !name.startsWith(p.title.split(' ')[0]) ? p.title : p.title ? '' : p.occupation ?? '';
  const soon = birthdaySoon(p);
  const disputed = (f.parentsOf.get(p.id) ?? []).some((q) => f.disputed.has(`${p.id}>${q}`));
  return (
    <div className={`card ${detail}${selected ? ' selected' : ''}${roleClass}${p.living ? ' living' : ' dead'}${ruler ? ' crowned' : ''}`}>
      <button className="card-hit" onClick={() => onSelect(p.id)} onDoubleClick={() => onOpen?.(p.id)} aria-label={name} title="Click to select · double-click to centre the tree here">
        <div className="card-portrait">
          <Portrait person={p} tree={tree} size={detail === 'near' ? 104 : 84} />
          {house && (
            <span className="card-arms" title={house.name}>
              <Arms arms={house.arms} size={detail === 'near' ? 28 : 24} />
            </span>
          )}
          {p.stories > 0 && detail === 'near' && (
            <span className="card-badge card-stories" title={`${p.stories} ${p.stories === 1 ? 'story' : 'stories'}`}>
              <GameIcon name="quill-ink" size={12} /> {p.stories}
            </span>
          )}
          {soon !== undefined && (
            <span className={`card-badge card-bday${soon === 0 ? ' today' : ''}`} title={soon === 0 ? 'Birthday today' : `Birthday in ${soon} day${soon === 1 ? '' : 's'}`}>
              <GameIcon name="cake-slice" size={13} />
            </span>
          )}
          {disputed && detail === 'near' && (
            <span className="card-badge card-disputed" title="Parentage disputed">
              <GameIcon name="uncertainty" size={12} />
            </span>
          )}
        </div>
        <div className="card-plate">
          <div className="card-name">{name}</div>
          {detail === 'near' && <div className="card-sub">{sub || '\u00a0'}</div>}
          <div className="card-years">
            {lifespan(p)}
            {node.outOfHouse && detail === 'near' ? <span className="card-out" title={`${node.outOfHouse} children belong to other houses`}>↗{node.outOfHouse}</span> : null}
          </div>
        </div>
      </button>
      {detail !== 'near' ? null : isMe ? <span className="card-kin me">you</span> : kin ? <span className="card-kin">{kin}</span> : null}
      {node.role === 'dup' && <span className="card-dup">appears again</span>}

      {spouses.length > 0 && detail === 'near' && (
        <div className="card-spouses">
          {spouses.slice(0, 2).map((s) => (
            <button key={s.id} className="card-spouse" title={`Partner: ${displayName(s, f)}`} onClick={() => onSelect(s.id)}>
              <Portrait person={s} tree={tree} size={28} frame={false} />
            </button>
          ))}
          {spouses.length > 2 && <span className="card-spouse more">+{spouses.length - 2}</span>}
        </div>
      )}

      {onToggle && (node.folded || (f.childrenOf.get(p.id)?.length && node.role === 'main')) ? (
        <button className={`card-fold${node.folded ? ' folded' : ''}`} onClick={() => onToggle(p.id)} title={node.folded ? `Unfold ${node.folded} descendants` : 'Fold descendants'}>
          {node.folded ? <>+{node.folded}</> : <Minus size={11} />}
        </button>
      ) : null}

      {selected && onAdd && node.role !== 'dup' && detail === 'near' && (
        <>
          {(f.parentsOf.get(p.id)?.length ?? 0) < 2 && <button className="add add-parent" onClick={() => onAdd(p.id, 'parent')} title="Add a parent"><Plus size={14} /></button>}
          <button className="add add-child" onClick={() => onAdd(p.id, 'child')} title="Add a child"><Plus size={14} /></button>
          <button className="add add-partner" onClick={() => onAdd(p.id, 'partner')} title="Add a partner"><Plus size={14} /></button>
          <button className="add add-sibling" onClick={() => onAdd(p.id, 'sibling')} title="Add a sibling"><Plus size={14} /></button>
        </>
      )}
    </div>
  );
});

/** Days until a living person's birthday, when it is within a week; undefined otherwise. */
function birthdaySoon(p: GPerson): number | undefined {
  if (!p.living || !p.born || !/^\d{4}-\d\d-\d\d$/.test(p.born)) return undefined;
  const [, m, d] = p.born.split('-').map(Number);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let next = new Date(today.getFullYear(), m - 1, d);
  if (next < today) next = new Date(today.getFullYear() + 1, m - 1, d);
  const days = Math.round((next.getTime() - today.getTime()) / 86_400_000);
  return days <= 7 ? days : undefined;
}
