// A widget in the chat: a person, how two people are related, a small family tree, a life in order, the coming dates, or what is
// still missing. The server builds what it shows; this only draws it. Everything in it is a real link into the app.
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { Portrait } from '~/components/Portrait';
import { graphQuery } from '~/lib/api';
import { GAP_LABEL } from '~/lib/gaps';
import { formatDate, kinshipLabel, useT, type Key } from '~/lib/i18n';
import type { PersonRef, TimelineEvent, WidgetBlock, WidgetData } from '~/lib/ai/blocks';
import { aiWidgetQuery } from '~/lib/ai/widget.functions';
import { Skeleton } from '~/components/ui';
import { closeAssistant } from '../store';
import './widgets.css';

const year = (d?: string) => d?.match(/\d{4}/)?.[0];

function years(p: PersonRef): string {
  const b = year(p.born), d = year(p.died);
  return b || d ? `${b ?? '?'}${d ? `–${d}` : ''}` : '';
}

/** A person's name and face as a link to their profile. */
function Person({ tree, person, size = 36, note }: { tree: string; person: PersonRef; size?: number; note?: string }) {
  const graph = useQuery(graphQuery(tree)).data;
  const full = graph?.people.find((x) => x.id === person.id);
  const span = years(person);
  return (
    <Link to="/$tree/person/$id" params={{ tree, id: person.id }} className="aw-person" onClick={() => closeAssistant()}>
      {full ? <Portrait person={full} tree={tree} size={size} frame decorative /> : <span className="aw-face" style={{ width: size, height: size }} aria-hidden />}
      <span className="aw-person-text">
        <span className="aw-name">{person.name}</span>
        {(span || note) && <span className="aw-sub">{[note, span].filter(Boolean).join(' · ')}</span>}
      </span>
    </Link>
  );
}

function Group({ title, people, tree }: { title: string; people: PersonRef[]; tree: string }) {
  if (!people.length) return null;
  return (
    <section className="aw-group">
      <h4>{title}</h4>
      <ul className="aw-people">{people.map((p) => <li key={p.id}><Person tree={tree} person={p} /></li>)}</ul>
    </section>
  );
}

const EVENT: Record<TimelineEvent['kind'], Key> = {
  born: 'chat.event.born', married: 'chat.event.married', partnered: 'chat.event.partnered', ended: 'chat.event.ended', child: 'chat.event.child',
  job: 'chat.event.job', school: 'chat.event.school', service: 'chat.event.service', died: 'chat.event.died',
};

function Body({ tree, data }: { tree: string; data: WidgetData }): ReactNode {
  const t = useT();
  const day = (d: string) => (/^~/.test(d) ? `~${year(d)}` : d.length === 10 ? formatDate(d, t.locale, { day: 'numeric', month: 'short', year: 'numeric' }) : d);

  if (data.kind === 'person') {
    const line = [data.title, data.occupation].filter(Boolean).join(' · ');
    const places = [data.bornPlace, data.diedPlace].filter(Boolean).join(' – ');
    return (
      <>
        <Person tree={tree} person={data.person} size={56} note={data.kin ? kinshipLabel(data.kin, t.locale) : undefined} />
        {line && <p className="aw-line">{line}</p>}
        {places && <p className="aw-line aw-faint">{places}</p>}
        {data.house && <p className="aw-line aw-faint">{data.house}</p>}
      </>
    );
  }
  if (data.kind === 'path') {
    if (!data.steps.length) return <p className="aw-empty">{t('chat.widget.noPath', { a: data.from.name, b: data.to.name })}</p>;
    return (
      <>
        {data.kin && <p className="aw-line">{t('chat.widget.pathIs', { a: data.to.name, rel: kinshipLabel(data.kin, t.locale), b: data.from.name })}</p>}
        <ol className="aw-path">
          {data.steps.map((p, i) => (
            <li key={p.id}>
              {i > 0 && <ArrowRight size={13} aria-hidden className="aw-arrow" />}
              <Person tree={tree} person={p} size={32} />
            </li>
          ))}
        </ol>
      </>
    );
  }
  if (data.kind === 'tree') {
    return (
      <>
        <Group title={t('chat.widget.parents')} people={data.parents} tree={tree} />
        <section className="aw-group aw-focus"><Person tree={tree} person={data.person} size={44} /></section>
        <Group title={t('chat.widget.partners')} people={data.partners} tree={tree} />
        <Group title={t('chat.widget.siblings')} people={data.siblings} tree={tree} />
        <Group title={t('chat.widget.children')} people={data.children} tree={tree} />
        <Link to="/$tree" params={{ tree }} search={{ focus: data.person.id } as never} className="aw-more" onClick={() => closeAssistant()}>{t('chat.widget.openTree')}</Link>
      </>
    );
  }
  if (data.kind === 'timeline') {
    if (!data.events.length) return <p className="aw-empty">{t('chat.widget.noEvents')}</p>;
    return (
      <>
        <Person tree={tree} person={data.person} size={36} />
        <ol className="aw-timeline">
          {data.events.map((e, i) => (
            <li key={i}>
              <span className="aw-when">{day(e.date)}</span>
              <span className="aw-what">
                {t(EVENT[e.kind])}{e.text && ` · ${e.text}`}
                {e.other && <> · <Link to="/$tree/person/$id" params={{ tree, id: e.other.id }} onClick={() => closeAssistant()}>{e.other.name}</Link></>}
                {e.place && <> · <Link to="/$tree/atlas" params={{ tree }} search={{ place: e.place } as never} onClick={() => closeAssistant()}>{e.place}</Link></>}
              </span>
            </li>
          ))}
        </ol>
      </>
    );
  }
  if (data.kind === 'dates') {
    if (!data.rows.length) return <p className="aw-empty">{t('chat.widget.noDates', { days: data.days })}</p>;
    return (
      <>
        <ul className="aw-rows">
          {data.rows.map((r, i) => (
            <li key={i}>
              <Person tree={tree} person={r.who} size={32} note={r.other ? `& ${r.other.name}` : undefined} />
              <span className="aw-date">
                <strong>{r.inDays === 0 ? t('chat.widget.today') : formatDate(r.on, t.locale, { day: 'numeric', month: 'short' })}</strong>
                <span className="aw-sub">{t(r.kind === 'birthday' ? 'chat.widget.birthday' : 'chat.widget.anniversary', { n: r.years ?? 0 })}</span>
              </span>
            </li>
          ))}
        </ul>
        {data.more > 0 && <p className="aw-line aw-faint">{t('chat.widget.more', { count: data.more })}</p>}
      </>
    );
  }
  if (!data.rows.length) return <p className="aw-empty">{t('chat.widget.noGaps')}</p>;
  return (
    <>
      <ul className="aw-rows aw-gaps">
        {data.rows.map((r) => (
          <li key={r.who.id}>
            <Person tree={tree} person={r.who} size={32} />
            <ul className="aw-gap-list">{r.gaps.map((g) => <li key={g}>{t(GAP_LABEL[g])}</li>)}</ul>
          </li>
        ))}
      </ul>
      {data.more > 0 && <p className="aw-line aw-faint">{t('chat.widget.more', { count: data.more })}</p>}
    </>
  );
}

const TITLE: Record<WidgetData['kind'], Key> = {
  person: 'chat.widget.person', path: 'chat.widget.path', tree: 'chat.widget.tree', timeline: 'chat.widget.timeline', dates: 'chat.widget.dates', gaps: 'chat.widget.gaps',
};

export function Widget({ tree, itemId, block, conv }: { tree: string; itemId: string; block: WidgetBlock; conv: string }) {
  const t = useT();
  const q = useQuery(aiWidgetQuery(tree, itemId, block.id, conv));
  return (
    <section className="aw-card" aria-label={t(TITLE[block.spec.kind])}>
      <h3 className="aw-title">{t(TITLE[block.spec.kind])}</h3>
      {q.isPending ? <Skeleton lines={2} /> : q.data ? <Body tree={tree} data={q.data} /> : <p className="aw-empty">{t('chat.widget.gone')}</p>}
    </section>
  );
}
