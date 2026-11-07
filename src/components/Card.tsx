// A person on the canvas, at three levels of detail.
import { BookOpenText, Minus, Plus } from 'lucide-react';
import { memo } from 'react';
import { age, displayName, lifespan, partnersOf, type Family } from '~/lib/graph';
import type { LNode } from '~/lib/layout';
import type { Detail } from './Canvas';
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
  onAdd?: (id: string, r: AddRelation) => void;
}

export const Card = memo(function Card({ node, detail, family: f, tree, kin, selected, isMe, showSpouses, onSelect, onOpen, onToggle, onAdd }: Props) {
  const p = f.byId.get(node.id);
  if (!p) return null;
  const house = p.house ? f.house.get(p.house) : undefined;
  const name = displayName(p, f);

  if (detail === 'far') {
    // Overview tiles: house colour, a crown for rulers, faded for those who died as children.
    const ruler = /^(King|Queen|Emperor|Empress)\b/.test(p.title ?? '');
    const lived = age(p);
    return (
      <button
        className={`card far${selected ? ' selected' : ''}${p.living ? ' living' : ''}${isMe ? ' me' : ''}${lived !== undefined && lived < 15 ? ' young' : ''}`}
        style={{ background: house ? houseColour(house.arms) : 'var(--faint)' }}
        onClick={() => onSelect(p.id)}
        onDoubleClick={() => onOpen?.(p.id)}
        title={`${name} · ${lifespan(p)}`}
      >
        {node.folded ? <span className="far-fold">+{node.folded}</span> : ruler ? <span className="far-crown">♛</span> : null}
      </button>
    );
  }

  const spouses = showSpouses ? partnersOf(f, p.id).map((id) => f.byId.get(id)!).filter(Boolean) : [];
  const roleClass = node.role === 'dup' ? ' dup' : node.role === 'partner' ? ' partner' : node.role === 'sibling' ? ' sibling' : '';
  return (
    <div className={`card ${detail}${selected ? ' selected' : ''}${roleClass}${p.living ? ' living' : ' dead'}`}>
      <button className="card-hit" onClick={() => onSelect(p.id)} onDoubleClick={() => onOpen?.(p.id)} aria-label={name} title="Click to select · double-click to centre the tree here">
        <div className="card-portrait">
          <Portrait person={p} tree={tree} size={detail === 'near' ? 108 : 84} />
          {house && (
            <span className="card-arms" title={house.name}>
              <Arms arms={house.arms} size={detail === 'near' ? 30 : 24} />
            </span>
          )}
          {p.stories > 0 && detail === 'near' && (
            <span className="card-stories" title={`${p.stories} stories`}>
              <BookOpenText size={11} /> {p.stories}
            </span>
          )}
        </div>
        <div className="card-name">{name}</div>
        {detail === 'near' && (
          <>
            <div className="card-sub">{p.title && !name.startsWith(p.title.split(' ')[0]) ? p.title : p.title ?? p.occupation ?? ' '}</div>
            <div className="card-years">{lifespan(p)}</div>
          </>
        )}
        {detail === 'mid' && <div className="card-years">{lifespan(p)}</div>}
      </button>
      {isMe ? <span className="card-kin me">you</span> : kin && detail === 'near' ? <span className="card-kin">{kin}</span> : null}
      {node.role === 'dup' && <span className="card-dup">appears again</span>}

      {spouses.length > 0 && detail === 'near' && (
        <div className="card-spouses">
          {spouses.slice(0, 3).map((s) => (
            <button key={s.id} className="card-spouse" title={`Partner: ${displayName(s, f)}`} onClick={() => onSelect(s.id)}>
              <Portrait person={s} tree={tree} size={30} frame={false} />
            </button>
          ))}
          {spouses.length > 3 && <span className="card-spouse more">+{spouses.length - 3}</span>}
        </div>
      )}

      {onToggle && (node.folded || (f.childrenOf.get(p.id)?.length && node.role === 'main')) ? (
        <button className={`card-fold${node.folded ? ' folded' : ''}`} onClick={() => onToggle(p.id)} title={node.folded ? 'Unfold descendants' : 'Fold descendants'}>
          {node.folded ? <><Plus size={12} /> {node.folded}</> : <Minus size={12} />}
        </button>
      ) : null}
      {node.outOfHouse && detail === 'near' ? <span className="card-out" title="Children outside this house">+{node.outOfHouse} elsewhere</span> : null}

      {selected && onAdd && node.role !== 'dup' && (
        <>
          <button className="add add-parent" onClick={() => onAdd(p.id, 'parent')} title="Add a parent"><Plus size={14} /></button>
          <button className="add add-child" onClick={() => onAdd(p.id, 'child')} title="Add a child"><Plus size={14} /></button>
          <button className="add add-partner" onClick={() => onAdd(p.id, 'partner')} title="Add a partner"><Plus size={14} /></button>
          <button className="add add-sibling" onClick={() => onAdd(p.id, 'sibling')} title="Add a sibling"><Plus size={14} /></button>
        </>
      )}
    </div>
  );
});
