// One house: its arms and country, motto, founder, seats and size; who heads it and who comes next; the
// heads through history; a way into its dynasty tree; its notable and all its members; and the stories
// the family has written about them. Stewards set the succession and country, and redesign the arms.
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ChevronLeft, ListOrdered, Lock, Network, PenLine, ScrollText, Search, Sparkles } from 'lucide-react';
import { useId, useMemo, useState, type CSSProperties } from 'react';
import { ArmsEditor } from '~/components/ArmsEditor';
import { GameIcon } from '~/components/GameIcon';
import { Arms, TINCTURE_HEX } from '~/components/Heraldry';
import { asV2 } from '~/components/heraldry/convert';
import { countryName, Flag } from '~/components/heraldry/Flag';
import { ArmsMeanings } from '~/components/heraldry/ArmsMeanings';
import { Portrait } from '~/components/Portrait';
import { Dialog, ErrorState, NotFound, Select, Skeleton, type SelectOption } from '~/components/ui';
import { chronicleQuery, graphQuery, opKeys } from '~/lib/api';
import { useFamily, useTreeId } from '~/lib/family';
import { lifespan } from '~/lib/graph';
import { houseSettingsQuery, updateHouseSettings } from '~/lib/houses.functions';
import {
  COUNTRY_CODES, DEFAULT_HOUSE_SETTINGS, houseHistory, houseStats, houseSuccession, kinToHead, memberOrder, notables,
  SUCCESSION_LAWS, spanLabel, useHouseSettings, type HouseSettings, type HouseTenure, type Succession, type SuccessionLaw,
} from '~/lib/houses';
import { kinshipLabel, locales, translate, useT, type Key, type Locale } from '~/lib/i18n';
import { occupationText } from '~/lib/occupations';
import { useCan } from '~/lib/session';
import { toast } from '~/lib/toast';
import { treeTitle } from '~/lib/title';
import { errorText } from '~/lib/errortext';
import type { GPerson, House, Story } from '~/lib/types';
import '~/styles/house.css';

export const Route = createFileRoute('/$tree/house/$house')({
  // "House Valcourt · The Realm of Aurelmarch · Kindred", from the graph already in the cache.
  head: (ctx) => {
    const qc = (ctx.match.context as { queryClient?: QueryClient }).queryClient;
    const name = qc?.getQueryData(graphQuery(ctx.params.tree).queryKey)?.houses.find((h) => h.id === ctx.params.house)?.name;
    return { meta: [{ title: treeTitle(ctx, name ?? translate((ctx.match.context as { locale?: Locale }).locale ?? 'en', 'houses.house_title')) }] };
  },
  component: HousePage,
});

const nameOf = (p: GPerson) => [p.given, p.surname].filter(Boolean).join(' ');
/** A name in the body serif, with the epithet in italics. */
const Name = ({ p }: { p: GPerson }) => (
  <>
    {nameOf(p)}
    {p.epithet && <i> {p.epithet}</i>}
  </>
);

const LAW_KEY = {
  'absolute-primogeniture': 'houses.law.absolute-primogeniture',
  seniority: 'houses.law.seniority',
  elective: 'houses.law.elective',
} as const satisfies Record<SuccessionLaw, Key>;
const ROLE_KEY = { founder: 'houses.role.founder', eldest: 'houses.role.eldest', newest: 'houses.role.newest' } as const;
const KIND_KEY = { note: 'houses.kind.note', quote: 'houses.kind.quote', anecdote: 'houses.kind.anecdote', recipe: 'houses.kind.recipe', memory: 'houses.kind.memory' } as const;

function HousePage() {
  const { house: id } = Route.useParams();
  const tree = useTreeId();
  const t = useT();
  const f = useFamily();
  const house = f.house.get(id);
  const canEdit = useCan('edit-house');
  const settingsQ = useHouseSettings(tree);
  const [armsOpen, setArmsOpen] = useState(false);
  // Which tab the arms designer opens on: its own design, or the suggestions from the name.
  const [armsTab, setArmsTab] = useState<'design' | 'name'>('design');
  const [succession, setSuccession] = useState(false);
  const s = useMemo(() => (house ? houseStats(f, house) : undefined), [f, house]);
  const settings: HouseSettings = (house && settingsQ.data?.[house.id]) || DEFAULT_HOUSE_SETTINGS;
  const succ = useMemo<Succession | undefined>(() => (house ? houseSuccession(f, house, settings) : undefined), [f, house, settings]);
  const history = useMemo<HouseTenure[]>(() => (house ? houseHistory(f, house, settings) : []), [f, house, settings]);

  if (!house || !s || !succ) {
    return (
      <div className="page">
        <div className="page-inner">
          <NotFound title={t('houses.notFound')} text={t('houses.notFoundText')}>
            <Link className="btn primary" to="/$tree/houses" params={{ tree }}>{t('houses.allHouses')}</Link>
          </NotFound>
        </div>
      </div>
    );
  }

  const span = spanLabel(s, t('houses.present'));
  const total = s.members.length;
  const seats = s.seats.slice(0, 3);
  const country = settings.country;
  return (
    <div className="page">
      <div className="page-inner hp">
        <nav className="hp-crumbs" aria-label={t('houses.breadcrumb')}>
          <Link to="/$tree/houses" params={{ tree }}><ChevronLeft size={16} /> {t('houses.allHouses')}</Link>
        </nav>

        <header className="ui-card hp-head" style={{ '--house': TINCTURE_HEX[house.arms.field] } as CSSProperties}>
          <div className="hp-shield">
            <Arms arms={house.arms} size={176} full country={country ?? undefined} title={t('houses.armsOf', { name: house.name })} />
          </div>
          <div className="hp-text">
            <h1>{house.name}</h1>
            {house.motto && <p className="hp-motto">“{house.motto}”</p>}
            <p className="hp-summary">
              {total ? (
                s.living ? (
                  t('houses.summaryLiving', { members: t('houses.members', { count: total }), generations: t('houses.generations', { count: s.generations }), living: s.living })
                ) : (
                  t('houses.summary', { members: t('houses.members', { count: total }), generations: t('houses.generations', { count: s.generations }) })
                )
              ) : (
                t('houses.none')
              )}
            </p>
            <dl className="hp-facts">
              {s.founder && (
                <div>
                  <dt>{t('houses.founder')}</dt>
                  <dd>
                    <Link className="hp-link" to="/$tree" params={{ tree }} search={{ focus: s.founder.id }}><Name p={s.founder} /></Link>
                  </dd>
                </div>
              )}
              {span && (
                <div>
                  <dt>{t('houses.years')}</dt>
                  <dd className="hs-num">{span}</dd>
                </div>
              )}
              {country && (
                <div>
                  <dt>{t('houses.country')}</dt>
                  <dd className="hp-country"><Flag code={country} size={16} /> {countryName(country, t.locale)}</dd>
                </div>
              )}
              {seats.length > 0 && (
                <div>
                  <dt>{seats.length === 1 ? t('houses.seat') : t('houses.seats')}</dt>
                  <dd className="hp-seats">
                    {seats.map((x, i) => (
                      <span key={x.place} className="hp-seat">
                        <Link className="hp-link" to="/$tree/atlas" params={{ tree }} search={{ place: x.place }} title={t('houses.seatTitle', { count: x.n, place: x.place })}>{x.place}</Link>
                        <small aria-label={t('houses.bornThere', { count: x.n })}>×{x.n}</small>
                        {i < seats.length - 1 && <span aria-hidden className="subtle">·</span>}
                      </span>
                    ))}
                  </dd>
                </div>
              )}
            </dl>
            <div className="hp-actions">
              {s.founder && (
                <Link className="btn primary" to="/$tree" params={{ tree }} search={{ view: 'dynasty', line: 'house', root: s.founder.id }}>
                  <Network size={16} /> {t('houses.dynastyTree')}
                </Link>
              )}
              {canEdit ? (
                <>
                  <button type="button" className="btn" onClick={() => setSuccession(true)} aria-haspopup="dialog">
                    <ListOrdered size={16} /> {t('houses.editSuccession')}
                  </button>
                  <button type="button" className="btn" onClick={() => { setArmsTab('name'); setArmsOpen(true); }} aria-haspopup="dialog">
                    <Sparkles size={16} /> {t('houses.suggestArms')}
                  </button>
                  <button type="button" className="btn" onClick={() => { setArmsTab('design'); setArmsOpen(true); }} aria-haspopup="dialog">
                    <PenLine size={16} /> {t('houses.editArms')}
                  </button>
                </>
              ) : (
                <p className="hp-hint subtle"><Lock size={14} aria-hidden /> {t('houses.onlySteward')}</p>
              )}
            </div>
          </div>
        </header>
        <ArmsMeanings arms={asV2(house.arms)} label={t('heraldry.means.open')} className="hp-means" />

        <section className="hp-section hp-succession" aria-labelledby="hp-succession">
          <h2 className="rule" id="hp-succession">{t('houses.succession')}</h2>
          {settingsQ.isPending ? (
            <div className="hp-succession-grid" aria-busy="true">
              <Skeleton height={280} radius={12} />
              <Skeleton height={280} radius={12} />
            </div>
          ) : settingsQ.isError ? (
            <ErrorState title={t('houses.succession')} message={t('houses.succeedFailed')} onRetry={() => { void settingsQ.refetch(); }} error={settingsQ.error} />
          ) : (
            <>
              <div className="hp-succession-grid">
                <HeadCard house={house} settings={settings} head={succ.head} tree={tree} canEdit={canEdit} onChoose={() => setSuccession(true)} />
                <HeirCard f={f} house={house} tree={tree} succ={succ} />
              </div>
              <HeadsHistory house={house} tree={tree} history={history} succ={succ} />
            </>
          )}
        </section>

        <Notables s={s} tree={tree} />

        <div className="hp-cols">
          <Members members={s.members} tree={tree} />
          <HouseChronicle members={s.members} tree={tree} houseName={house.name} />
        </div>
      </div>
      {canEdit && succession && (
        <SuccessionDialog f={f} house={house} tree={tree} settings={settings} members={s.members} onClose={() => setSuccession(false)} />
      )}
      {canEdit && armsOpen && (
        // The designer reads the house's country (for its flag and its name suggestions) from the house object.
        <ArmsEditor open onClose={() => setArmsOpen(false)} house={{ ...house, country: country ?? undefined } as House} tree={tree} initialTab={armsTab} />
      )}
    </div>
  );
}

// ---------- succession ----------

function HeadCard({ house, settings, head, tree, canEdit, onChoose }: {
  house: House; settings: HouseSettings; head?: GPerson; tree: string; canEdit: boolean; onChoose: () => void;
}) {
  const t = useT();
  return (
    <section className="ui-card hp-card hp-head-card" aria-labelledby="hp-head" style={{ '--house': TINCTURE_HEX[house.arms.field] } as CSSProperties}>
      <h3 className="hp-eyebrow" id="hp-head"><GameIcon name="crown" size={15} /> {t('houses.headHeading')}</h3>
      {head ? (
        <>
          <Link to="/$tree" params={{ tree }} search={{ focus: head.id }} className="hp-seal" aria-label={nameOf(head)}>
            <Portrait person={head} tree={tree} size={132} house={house} />
            <span className="hp-seal-crown" aria-hidden><GameIcon name="crown" size={22} /></span>
          </Link>
          <p className="hp-head-name"><Link className="hp-link" to="/$tree" params={{ tree }} search={{ focus: head.id }}><Name p={head} /></Link></p>
          {(head.title ?? occupationText(head, t.locale)) && <p className="hp-title">{head.title ?? occupationText(head, t.locale)}</p>}
          {lifespan(head) && <p className="hp-years subtle hs-num">{lifespan(head)}</p>}
        </>
      ) : (
        <>
          <p className="hp-none">{t(settings.law === 'elective' ? 'houses.headElective' : 'houses.headNone')}</p>
          {canEdit && settings.law === 'elective' && <button type="button" className="btn" onClick={onChoose}>{t('houses.chooseHead')}</button>}
        </>
      )}
      <p className="hp-law subtle">{t(LAW_KEY[settings.law])}</p>
    </section>
  );
}

function HeirCard({ f, house, tree, succ }: { f: ReturnType<typeof useFamily>; house: House; tree: string; succ: Succession }) {
  const t = useT();
  const next = succ.line.slice(1, 6);
  const kin = (p: GPerson) => {
    const k = kinToHead(f, succ.head, p);
    return k ? t('houses.kinToHead', { kin: kinshipLabel(k, t.locale) }) : t('houses.kinNone');
  };
  const heir = succ.heir;
  return (
    <section className="ui-card hp-card hp-heir-card" aria-labelledby="hp-heir">
      <h3 className="hp-eyebrow" id="hp-heir">{t('houses.heirHeading')}</h3>
      {heir ? (
        <Link to="/$tree" params={{ tree }} search={{ focus: heir.id }} className="hp-heir-main">
          <Portrait person={heir} tree={tree} size={88} house={house} />
          <span className="hp-heir-text">
            <b><Name p={heir} /></b>
            <span className="hp-kin">{kin(heir)}</span>
          </span>
        </Link>
      ) : (
        <p className="hp-none">{t('houses.noHeir')}</p>
      )}
      {next.length > 0 && (
        <>
          <h4 className="hp-eyebrow">{t('houses.nextInLine')}</h4>
          <ol className="hp-line">
            {next.map((p, i) => (
              <li key={p.id}>
                <Link to="/$tree" params={{ tree }} search={{ focus: p.id }} className="hp-line-row">
                  <span className="hp-line-n" aria-hidden>{i + 2}</span>
                  <Portrait person={p} tree={tree} size={40} house={house} />
                  <span className="hp-row-name">
                    <b><Name p={p} /></b>
                    <small>{kin(p)}</small>
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

function HeadsHistory({ house, tree, history, succ }: { house: House; tree: string; history: HouseTenure[]; succ: Succession }) {
  const t = useT();
  return (
    <section className="hp-heads" aria-labelledby="hp-heads">
      <h3 className="hp-eyebrow" id="hp-heads">{t('houses.heads')}</h3>
      {history.length === 0 ? (
        <div className="ui-card hp-none"><p>{t('houses.historyNone')}</p></div>
      ) : (
        <ol className="ui-card hp-timeline">
          {history.map((tenure) => {
            const current = tenure.to === undefined && succ.head?.id === tenure.person.id;
            const end = tenure.to ?? (current ? t('houses.present') : undefined);
            return (
              <li key={`${tenure.person.id}-${tenure.from}`} className={current ? 'current' : undefined} aria-current={current || undefined}>
                <Link to="/$tree" params={{ tree }} search={{ focus: tenure.person.id }} className="hp-tl-link">
                  <Portrait person={tenure.person} tree={tree} size={44} house={house} />
                  <span className="hp-tl-text">
                    <b><Name p={tenure.person} /></b>
                    <small className="hs-num">{end ? `${tenure.from} – ${end}` : `${tenure.from}`}</small>
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

/** Steward: the law, an explicit head and heir, and the country. "Automatic" leaves it to the law. */
function SuccessionDialog({ f, house, tree, settings, members, onClose }: {
  f: ReturnType<typeof useFamily>; house: House; tree: string; settings: HouseSettings; members: GPerson[]; onClose: () => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const ids = useId();
  const [keys] = useState(() => opKeys());
  const [draft, setDraft] = useState<HouseSettings>(settings);
  const [error, setError] = useState<string | null>(null);
  const dirty = draft.law !== settings.law || draft.head !== settings.head || draft.heir !== settings.heir || draft.country !== settings.country;
  // What the law alone would choose, so "Automatic" names the right person.
  const auto = useMemo(() => houseSuccession(f, house, { ...draft, head: null, heir: null }), [f, house, draft.law]);
  const elective = draft.law === 'elective';

  const save = useMutation({
    mutationFn: (d: HouseSettings) =>
      updateHouseSettings({ data: { tree, id: house.id, opKey: keys.for('house-succession', { id: house.id, ...d }), ...d } }),
    onSuccess: (saved) => {
      qc.setQueryData<Record<string, HouseSettings>>(houseSettingsQuery(tree).queryKey, (old) => ({ ...old, [house.id]: saved }));
      keys.clear();
      toast({ title: t('houses.saved'), body: house.name, icon: 'crown' });
      onClose();
    },
    onError: (e) => setError(e instanceof Error ? errorText(e, t.locale) : t('houses.saveFailed')),
  });

  const people = useMemo<SelectOption<string>[]>(
    () => [...members].sort(memberOrder).map((p) => ({ value: p.id, label: nameOf(p), hint: lifespan(p) || undefined })),
    [members],
  );
  const laws = SUCCESSION_LAWS.map((law) => ({ value: law, label: t(LAW_KEY[law]) }));
  const headOptions: SelectOption<string>[] = [
    { value: '', label: elective ? t('houses.notSet') : auto.head ? t('houses.automatic', { name: nameOf(auto.head) }) : t('houses.automaticNone') },
    ...people,
  ];
  const heirOptions: SelectOption<string>[] = [
    { value: '', label: elective ? t('houses.notSet') : auto.heir ? t('houses.automatic', { name: nameOf(auto.heir) }) : t('houses.automaticNone') },
    ...people,
  ];
  const countries = useMemo<SelectOption<string>[]>(
    () => [
      { value: '', label: t('houses.countryNone') },
      ...COUNTRY_CODES.map((code) => ({ value: code, label: countryName(code, t.locale), icon: <Flag code={code} size={16} /> }))
        .sort((a, b) => a.label.localeCompare(b.label, locales[t.locale])),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t.locale],
  );

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('houses.editSuccession')}
      description={t('houses.succeedText')}
      dirty={dirty}
      width={520}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={save.isPending}>{t('houses.cancel')}</button>
          <button
            type="button"
            className="btn primary"
            disabled={!dirty || save.isPending}
            onClick={() => { setError(null); save.mutate({ law: draft.law, head: draft.head || null, heir: draft.heir || null, country: draft.country || null }); }}
          >
            {t('houses.save')}
          </button>
        </>
      }
    >
      <div className="hp-form">
        <div className="hp-field">
          <span id={`${ids}-law`}>{t('houses.lawLabel')}</span>
          <Select aria-labelledby={`${ids}-law`} value={draft.law} onChange={(law) => setDraft({ ...draft, law })} options={laws} />
        </div>
        <div className="hp-field">
          <span id={`${ids}-head`}>{t('houses.headField')}</span>
          <Select aria-labelledby={`${ids}-head`} value={draft.head ?? ''} onChange={(head) => setDraft({ ...draft, head: head || null })} options={headOptions} />
        </div>
        <div className="hp-field">
          <span id={`${ids}-heir`}>{t('houses.heirField')}</span>
          <Select aria-labelledby={`${ids}-heir`} value={draft.heir ?? ''} onChange={(heir) => setDraft({ ...draft, heir: heir || null })} options={heirOptions} />
        </div>
        <div className="hp-field">
          <span id={`${ids}-country`}>{t('houses.country')}</span>
          <Select aria-labelledby={`${ids}-country`} value={draft.country ?? ''} onChange={(country) => setDraft({ ...draft, country: country || null })} options={countries} />
        </div>
      </div>
      {error && <p role="alert" className="hp-error">{error}</p>}
    </Dialog>
  );
}

// ---------- notable members ----------

function Notables({ s, tree }: { s: ReturnType<typeof houseStats>; tree: string }) {
  const t = useT();
  const list = notables(s);
  if (!list.length) return null;
  const titled = list.some((n) => n.person.title);
  return (
    <section className="hp-section" aria-labelledby="hp-notables">
      <h2 className="rule" id="hp-notables">{titled ? t('houses.rulers') : t('houses.notable')}</h2>
      <ul className="hp-notables">
        {list.map(({ person: p, role }) => (
          <li key={p.id}>
            <Link to="/$tree" params={{ tree }} search={{ focus: p.id }} className="ui-card interactive hp-notable">
              <Portrait person={p} tree={tree} size={84} house={s.house} />
              <b><Name p={p} /></b>
              {(p.title || occupationText(p, t.locale)) && <span className="hp-title">{p.title ?? occupationText(p, t.locale)}</span>}
              {lifespan(p) && <span className="hp-years">{lifespan(p)}</span>}
              {role && <span className="hs-chip hp-role">{t(ROLE_KEY[role])}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------- members ----------

const PAGE = 40;

function Members({ members, tree }: { members: GPerson[]; tree: string }) {
  const t = useT();
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = useMemo(
    () =>
      [...members]
        .filter((p) => {
          if (!tokens.length) return true;
          const hay = `${p.given} ${p.surname ?? ''} ${p.nickname ?? ''} ${p.epithet ?? ''} ${p.title ?? ''}`.toLowerCase();
          return tokens.every((x) => hay.includes(x));
        })
        .sort(memberOrder),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [members, q],
  );
  const page = shown.slice(0, limit);
  const living = page.filter((p) => p.living);
  const dead = page.filter((p) => !p.living);
  const livingTotal = shown.filter((p) => p.living).length;

  return (
    <section className="hp-section" aria-labelledby="hp-members">
      <div className="hp-section-head">
        <h2 className="rule" id="hp-members">{t('houses.membersHeading')} <span className="subtle hs-num">{t('houses.count', { count: members.length })}</span></h2>
        {members.length > 12 && (
          <label className="hp-filter">
            <Search size={15} />
            <input className="input" type="search" placeholder={t('houses.findMember')} aria-label={t('houses.findMemberLabel')} value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }} />
          </label>
        )}
      </div>
      <div className="ui-card hp-members">
        {members.length === 0 && <p className="hp-none">{t('houses.none')}</p>}
        {members.length > 0 && shown.length === 0 && (
          <p className="hp-none">
            {t('houses.noMatch', { q })} <button type="button" className="btn ghost" onClick={() => setQ('')}>{t('houses.clear')}</button>
          </p>
        )}
        {living.length > 0 && <MemberGroup title={t('houses.livingGroup', { count: livingTotal })} people={living} tree={tree} />}
        {dead.length > 0 && <MemberGroup title={t('houses.rememberedGroup', { count: shown.length - livingTotal })} people={dead} tree={tree} />}
        {shown.length > limit && (
          <button type="button" className="btn hp-more" onClick={() => setLimit(limit + 80)}>
            {t('houses.showMore', { count: Math.min(80, shown.length - limit), total: shown.length - limit })}
          </button>
        )}
      </div>
    </section>
  );
}

function MemberGroup({ title, people, tree }: { title: string; people: GPerson[]; tree: string }) {
  const t = useT();
  return (
    <>
      <h3 className="hp-group">{title}</h3>
      <ul className="hp-list">
        {people.map((p) => (
          <li key={p.id}>
            <Link to="/$tree" params={{ tree }} search={{ focus: p.id }} className="hp-row">
              <Portrait person={p} tree={tree} size={40} />
              <span className="hp-row-name">
                <b><Name p={p} /></b>
                {(p.title || occupationText(p, t.locale) || p.nickname) && <small>{p.title ?? occupationText(p, t.locale) ?? `“${p.nickname}”`}</small>}
              </span>
              <span className="hp-row-years">{lifespan(p)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

// ---------- chronicle ----------

/** Markdown to a plain excerpt: enough for a three-line preview. */
const plain = (md: string) =>
  md.replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[#>*_`~]+/g, '').replace(/\s+/g, ' ').trim();

function HouseChronicle({ members, tree, houseName }: { members: GPerson[]; tree: string; houseName: string }) {
  const t = useT();
  const { data, isPending, isError, refetch } = useQuery(chronicleQuery(tree));
  const [limit, setLimit] = useState(6);
  const byId = useMemo(() => new Map(members.map((p) => [p.id, p])), [members]);
  const stories = useMemo(() => ((data ?? []) as Story[]).filter((st) => byId.has(st.person)), [data, byId]);

  return (
    <section className="hp-section" aria-labelledby="hp-chronicle" aria-busy={isPending || undefined}>
      <div className="hp-section-head">
        <h2 className="rule" id="hp-chronicle">{t('houses.chronicle')} {!isPending && !isError && stories.length > 0 && <span className="subtle hs-num">{t('houses.count', { count: stories.length })}</span>}</h2>
      </div>
      {isPending && (
        <div className="hp-feed" aria-label={t('houses.storiesLoading')}>
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="ui-card hp-story"><Skeleton width={40} height={40} radius="50%" /><Skeleton lines={3} /></div>
          ))}
        </div>
      )}
      {isError && <ErrorState title={t('houses.storiesError')} message={t('houses.storiesErrorText')} onRetry={() => { void refetch(); }} />}
      {!isPending && !isError && stories.length === 0 && (
        <div className="ui-card hp-none">
          <p style={{ margin: '0 0 10px' }}>{t('houses.storiesNone', { house: houseName })}</p>
          <Link className="btn" to="/$tree/chronicle" params={{ tree }}><ScrollText size={15} /> {t('houses.wholeChronicle')}</Link>
        </div>
      )}
      {!isPending && !isError && stories.length > 0 && (
        <>
          <ol className="hp-feed">
            {stories.slice(0, limit).map((st) => {
              const p = byId.get(st.person)!;
              const kind = KIND_KEY[st.kind as keyof typeof KIND_KEY] ?? KIND_KEY.note;
              return (
                <li key={st.id} className="ui-card hp-story">
                  <Link to="/$tree" params={{ tree }} search={{ focus: p.id }} className="hp-story-face" aria-label={nameOf(p)}>
                    <Portrait person={p} tree={tree} size={40} />
                  </Link>
                  <div className="hp-story-main">
                    <div className="hp-story-meta">
                      <span className="hp-story-kind">{t(kind)}</span>
                      <span>
                        {st.kind === 'quote' ? t('houses.of') : t('houses.about')}{' '}
                        <Link className="hp-link" to="/$tree" params={{ tree }} search={{ focus: p.id }}><Name p={p} /></Link>
                        {' '}· {st.author}
                      </span>
                      <time dateTime={st.at}>{when(st.at, t.locale)}</time>
                    </div>
                    {st.title && <h3>{st.title}</h3>}
                    <p className={st.kind === 'quote' ? 'hp-quote' : undefined}>{st.kind === 'quote' ? `“${plain(st.body)}”` : plain(st.body)}</p>
                  </div>
                </li>
              );
            })}
          </ol>
          <div className="hp-feed-foot">
            {stories.length > limit && <button type="button" className="btn" onClick={() => setLimit(limit + 10)}>{t('houses.showMoreStories', { count: Math.min(10, stories.length - limit) })}</button>}
            <Link className="btn ghost" to="/$tree/chronicle" params={{ tree }}><ScrollText size={15} /> {t('houses.wholeChronicle')}</Link>
          </div>
        </>
      )}
    </section>
  );
}

const when = (at: string, locale: keyof typeof locales) =>
  new Date(at).toLocaleDateString(locales[locale], { day: 'numeric', month: 'short', year: 'numeric' });
