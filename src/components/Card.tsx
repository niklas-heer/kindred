// A person on the canvas, at four levels of detail: a full card, a name plate, a shield with a name, a shield.
import { Minus, Plus } from 'lucide-react';
import { memo, type KeyboardEvent } from 'react';
import { personDisplayName, cardAge, lifespan, type NameMode, type Family } from '~/lib/graph';
import { cardExtras } from '~/lib/card-label';
import type { GPerson } from '~/lib/types';
import { GAP_ACTION, GAP_LABEL, gapsOf, useRequired } from '~/lib/gaps';
import { can } from '~/lib/roles';
import { useRole } from '~/lib/session';
import { bareHouseName, useHouseRole } from '~/lib/houses';
import { useT } from '~/lib/i18n';
import { useToday } from '~/lib/clock';
import { occupationText } from '~/lib/occupations';
import type { LNode } from '~/lib/layout';
import type { Detail } from './Canvas';
import { GameIcon } from './GameIcon';
import { Arms, shieldColours } from './Heraldry';
import { Portrait } from './Portrait';
import { CardWatchers, watchedStyle } from './presence/Faces';
import type { Present } from '~/lib/presence/shared';
import './card.css';

export type AddRelation = 'parent' | 'child' | 'partner' | 'sibling';

interface Props {
  node: LNode;
  detail: Detail;
  family: Family;
  tree: string;
  /** How this person is related to the reader ("aunt"). Shown as a tab on a full card, and read out at every level. */
  kin?: string;
  /** The same relation as a screen reader hears it, with the possessive each language needs: "your aunt", "deine Tante". */
  kinSpoken?: string;
  selected: boolean;
  isMe: boolean;
  nameMode?: NameMode;
  ageMode?: 'living' | 'all' | 'off';
  onSelect: (id: string) => void;
  /** Double-click: make this person the centre of the tree. */
  onOpen?: (id: string) => void;
  onToggle?: (id: string) => void;
  onAdd?: (id: string, r: AddRelation, sex?: 'm' | 'f') => void;
  /** Other members who have this person selected right now (live presence): a soft halo in their colour. */
  watchers?: Present[];
}

export const Card = memo(function Card({ node, detail, family: f, tree, kin, kinSpoken, selected, isMe, nameMode = 'full', ageMode = 'living', onSelect, onOpen, onToggle, onAdd, watchers }: Props) {
  const [required] = useRequired(tree);
  const role = useRole();
  const t = useT();
  // The reader's day: the age and birthday badge are drawn only once the browser knows it (src/lib/clock.ts).
  const today = useToday();
  const houseRole = useHouseRole(tree, f, node.id);
  if (node.ghost) {
    // An unknown parent: an open slot that invites filling in. Under a named shield it is the same empty shield as farther out.
    const { child, as } = node.ghost;
    if (detail === 'seal') detail = 'far';
    const of = f.byId.get(child);
    const who = of?.given ?? t('card.theirs');
    const rel = t(as === 'father' ? 'card.father' : 'card.mother');
    const relLabel = t(as === 'father' ? 'card.fatherLabel' : 'card.motherLabel');
    // Readers who may not add people see the slot as a plain "unknown", not a button.
    if (!onAdd) {
      return (
        <div className={`card ghost readonly ${detail}`} title={t('card.unknownSlot', { who, rel })} aria-hidden>
          {detail === 'near' && (
            <>
              <span className="ghost-label">{relLabel}</span>
              <span className="ghost-sub">{t('card.of', { who: of?.given ?? '?' })}</span>
            </>
          )}
        </div>
      );
    }
    return (
      <button
        className={`card ghost ${detail}`}
        onClick={() => onAdd?.(child, 'parent', as === 'father' ? 'm' : 'f')}
        title={t('card.addSlot', { who, rel })}
        aria-label={t('card.addSlot', { who, rel })}
      >
        {detail !== 'far' && (
          <>
            <span className="ghost-plus"><Plus size={detail === 'near' ? 26 : 34} /></span>
            {detail === 'near' && <span className="ghost-label">{relLabel}</span>}
            {detail === 'near' && <span className="ghost-sub">{t('card.of', { who: of?.given ?? '?' })}</span>}
          </>
        )}
      </button>
    );
  }
  const p = f.byId.get(node.id);
  if (!p) return null;
  const house = p.house ? f.house.get(p.house) : undefined;
  const name = personDisplayName(p, nameMode, f);
  const years = lifespan(p, t.locale);
  const ageLabel = ageMode === 'all' || (ageMode === 'living' && p.living) ? cardAge(p, today, t.locale) : undefined;

  // What a screen reader hears after the name and years: who they are to the reader, and what the badges say.
  const soon = today ? birthdaySoon(p, today) : undefined;
  const disputed = (f.parentsOf.get(p.id) ?? []).some((q) => f.disputed.has(`${p.id}>${q}`));
  const extras = cardExtras({
    you: isMe ? t('common.you') : undefined,
    kin: !isMe ? kinSpoken : undefined,
    again: node.role === 'dup' ? t('card.appearsAgain') : undefined,
    stories: p.stories > 0 ? t('card.stories', { count: p.stories }) : undefined,
    birthday: soon === undefined ? undefined : soon === 0 ? t('card.birthdayToday') : t('card.birthdayIn', { count: soon }),
    disputed: disputed ? t('rel.disputed') : undefined,
  });
  // The arrow keys move the selection and the focus with it: the page finds the card to focus by this (index.tsx).
  const mark = {
    'data-person': node.role === 'dup' ? undefined : p.id,
    'aria-current': selected ? ('true' as const) : undefined,
    // Enter on a focused card centres the tree there, as a double-click does; Space selects, as a click does. Kept from
    // the page's own Enter key, which centres on the selected person and may be someone else when Tab moved the focus.
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || !onOpen) return;
      e.preventDefault();
      e.stopPropagation();
      onOpen(p.id);
    },
  };

  if (detail === 'far' || detail === 'seal') {
    // Overview: a shield in the house colour (rich for the living, faded for the dead), a crown for
    // rulers, and the house's arms on its founder.
    const ruler = /^(King|Queen|Emperor|Empress)\b/.test(p.title ?? '');
    const founder = house?.founder === p.id;
    const founderText = founder ? t('card.founderOf', { house: house!.name }) : '';
    const farColour = shieldColours(house?.arms);
    const shieldClass = `card far${selected ? ' selected' : ''}${p.living ? ' living' : ' dead'}${isMe ? ' me' : ''}${ruler ? ' crowned' : ''}${founder ? ' founder' : ''}${watchers?.length ? ' watched' : ''}`;
    const shieldStyle = { ['--house' as string]: farColour.house, ['--house-ink' as string]: farColour.ink, ...watchedStyle(watchers) };
    const face = (
      <>
        {ruler && <GameIcon name="crown" size={84} className="far-crown" />}
        {node.folded ? (
          <span className="far-fold">+{node.folded}</span>
        ) : founder ? (
          <span className="far-arms"><Arms arms={house!.arms} size={96} /></span>
        ) : (
          // A seal with the initial, so a wall of shields still has faces to tell apart.
          <span className="far-initial" aria-hidden>{p.given.slice(0, 1)}</span>
        )}
      </>
    );
    const spoken = [name, years, founderText, extras].filter(Boolean).join(', ');
    if (detail === 'seal') {
      // One step out from the name plates: the same shield, smaller, with the name they go by under it, so a row
      // still reads as people and not as a string of initials.
      const short = personDisplayName(p, nameMode === 'nickname' ? 'nickname' : 'first', f);
      return (
        <button
          className={`seal${selected ? ' selected' : ''}${node.role === 'dup' ? ' dup' : ''}${watchers?.length ? ' watched' : ''}`}
          style={watchedStyle(watchers)}
          onClick={() => onSelect(p.id)}
          onDoubleClick={() => onOpen?.(p.id)}
          title={[name, years, founderText].filter(Boolean).join(' · ')}
          {...mark}
        >
          <span className="seal-shield" aria-hidden><span className={shieldClass} style={shieldStyle}>{face}</span></span>
          <span className="seal-name">{short}</span>
          <span className="sr-only">, {spoken}</span>
        </button>
      );
    }
    return (
      <button
        className={shieldClass}
        style={shieldStyle}
        onClick={() => onSelect(p.id)}
        onDoubleClick={() => onOpen?.(p.id)}
        title={[name, years, founder ? founderText : ''].filter(Boolean).join(' · ')}
        aria-label={spoken}
        {...mark}
      >
        {face}
      </button>
    );
  }

  const roleClass = node.role === 'dup' ? ' dup' : node.role === 'partner' ? ' partner' : node.role === 'sibling' ? ' sibling' : node.role === 'kin' ? ' kin' : '';
  const ruler = /^(King|Queen|Emperor|Empress)\b/.test(p.title ?? '');
  const sub = p.title && !name.startsWith(p.title.split(' ')[0]) ? p.title : p.title ? '' : occupationText(p, t.locale) ?? '';
  // Only gaps this reader could fill: a viewer gets no to-do badges they can do nothing about.
  const gaps = detail === 'near' && node.role !== 'dup' ? gapsOf(f, p, required).filter((g) => can(role, GAP_ACTION[g])) : [];
  // The epithet ("the Pious") is set in italic; mid detail drops it so the name stays large.
  const epithet = p.epithet && name.endsWith(` ${p.epithet}`) ? p.epithet : undefined;
  const base = epithet ? name.slice(0, -epithet.length - 1) : name;
  const canFold = !!onToggle && !!(node.folded || (f.childrenOf.get(p.id)?.length && node.role === 'main'));
  return (
    <div className={`card ${detail}${selected ? ' selected' : ''}${roleClass}${p.living ? ' living' : ' dead'}${ruler ? ' crowned' : ''}${watchers?.length ? ' watched' : ''}`} style={watchedStyle(watchers)} data-tour={selected ? 'tree-selected' : undefined}>
      {watchers?.length ? <CardWatchers watchers={watchers} name={name} /> : null}
      <button className="card-hit" data-tour="tree-card" onClick={() => onSelect(p.id)} onDoubleClick={() => onOpen?.(p.id)} title={t('card.clickToSelect', { name })} {...mark}>
        <div className="card-portrait">
          <Portrait person={p} tree={tree} size={detail === 'near' ? 104 : 84} decorative />
          {house && (
            <span className="card-arms" title={house.name}>
              <Arms arms={house.arms} size={detail === 'near' ? 28 : 24} />
            </span>
          )}
          {houseRole?.role === 'head' && detail === 'near' && (
            <span className="card-badge card-crown" title={t('houses.headOf', { name: bareHouseName(houseRole.house) })}><GameIcon name="crown" size={13} /></span>
          )}
          {houseRole?.role === 'heir' && detail === 'near' && (
            <span className="card-heir" title={t('houses.heirOf', { name: bareHouseName(houseRole.house) })}>{t('houses.heirRibbon')}</span>
          )}
          {p.stories > 0 && detail === 'near' && (
            // The count is for the eye: the card's spoken name says "2 stories" after the name (extras), not "2" before it.
            <span className="card-badge card-stories" title={t('card.stories', { count: p.stories })} aria-hidden>
              <GameIcon name="quill-ink" size={12} /> {p.stories}
            </span>
          )}
          {soon !== undefined && (
            <span className={`card-badge card-bday${soon === 0 ? ' today' : ''}`} title={soon === 0 ? t('card.birthdayToday') : t('card.birthdayIn', { count: soon })}>
              <GameIcon name="cake-slice" size={13} />
            </span>
          )}
          {disputed && detail === 'near' && (
            <span className="card-badge card-disputed" title={t('rel.disputed')}>
              <GameIcon name="uncertainty" size={12} />
            </span>
          )}
        </div>
        <div className="card-plate">
          <div className="card-name">{base}{epithet && detail === 'near' ? <> <i className="card-epithet">{epithet}</i></> : null}</div>
          {detail === 'near' && <div className="card-sub">{sub || ' '}</div>}
          <div className="card-years">
            {years}
            {ageLabel && <span className="card-age" aria-label={`${p.living ? t('card.age') : t('card.ageAtDeath')}: ${ageLabel}`}>{ageLabel}</span>}
            {node.outOfHouse && detail === 'near' ? <span className="card-out" title={t('card.outOfHouse', { count: node.outOfHouse })}>↗{node.outOfHouse}</span> : null}
          </div>
        </div>
        {/* The name and years above are the start of the card's spoken name; this is the rest of it. */}
        {extras && <span className="sr-only">, {extras}</span>}
      </button>
      {/* Said in the button's own name already, so these two are for the eye only. */}
      {detail !== 'near' ? null : isMe ? <span className="card-kin me" aria-hidden>{t('common.you')}</span> : kin ? <span className="card-kin" aria-hidden>{kin}</span> : null}
      {node.role === 'dup' && <span className="card-dup" aria-hidden>{t('card.appearsAgain')}</span>}
      {gaps.length > 0 && (
        <span className="card-gaps" title={t('card.gapsTitle', { list: gaps.map((g) => t(GAP_LABEL[g])).join(', ') })}>
          {gaps.length}
        </span>
      )}

      {canFold ? (
        <button className={`card-fold${node.folded ? ' folded' : ''}`} onClick={() => onToggle?.(p.id)} title={node.folded ? t('card.unfold', { count: node.folded }) : t('card.fold')} aria-label={node.folded ? t('card.unfoldOf', { count: node.folded, name }) : t('card.foldOf', { name })} aria-expanded={!node.folded}>
          {node.folded ? <>+{node.folded}</> : <Minus size={11} />}
        </button>
      ) : null}

      {selected && onAdd && node.role !== 'dup' && detail === 'near' && (
        <>
          {(f.parentsOf.get(p.id)?.length ?? 0) < 2 && <button className="add add-parent" onClick={() => onAdd(p.id, 'parent')} title={t('card.addParent')} aria-label={t('card.addParentOf', { name })}><Plus size={14} /></button>}
          <button className="add add-child" onClick={() => onAdd(p.id, 'child')} title={t('card.addChild')} aria-label={t('card.addChildOf', { name })}><Plus size={14} /></button>
          <button className="add add-partner" onClick={() => onAdd(p.id, 'partner')} title={t('card.addPartner')} aria-label={t('card.addPartnerOf', { name })}><Plus size={14} /></button>
          <button className="add add-sibling" onClick={() => onAdd(p.id, 'sibling')} title={t('card.addSibling')} aria-label={t('card.addSiblingOf', { name })}><Plus size={14} /></button>
        </>
      )}
    </div>
  );
});

/** Days until a living person's birthday, when it is within a week; undefined otherwise. */
function birthdaySoon(p: GPerson, today: Date): number | undefined {
  if (!p.living || !p.born || !/^\d{4}-\d\d-\d\d$/.test(p.born)) return undefined;
  const [, m, d] = p.born.split('-').map(Number);
  let next = new Date(today.getFullYear(), m - 1, d);
  if (next < today) next = new Date(today.getFullYear() + 1, m - 1, d);
  const days = Math.round((next.getTime() - today.getTime()) / 86_400_000);
  return days <= 7 ? days : undefined;
}
