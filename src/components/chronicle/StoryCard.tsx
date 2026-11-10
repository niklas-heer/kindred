// A memory, saying, recipe, note or anecdote as an entry: the face of the person it is about, who wrote what about
// whom, the words, and the family's reactions and comments. The Chronicle lists every one this way, and the family's
// feed on the Today page shows the newest between the posts, so a memory looks the same wherever it is read.
//
//   <StoryCard s={story} f={family} tree={tree} now={now} />
import { Link } from '@tanstack/react-router';
import { ChefHat, Quote, Sparkles, StickyNote } from 'lucide-react';
import { useState, type ComponentType, type ReactNode } from 'react';
import { GameIcon } from '~/components/GameIcon';
import { Portrait } from '~/components/Portrait';
import { PortraitZoom } from '~/components/photos/PortraitZoom';
import { Responses } from '~/components/responses/Responses';
import { displayName, type Family } from '~/lib/graph';
import { richText, useT, type Key } from '~/lib/i18n';
import { renderMarkdown } from '~/lib/markdown';
import type { GPerson, Story } from '~/lib/types';
import { ago, exact } from '~/lib/when';
import '~/styles/chronicle.css';
import '~/components/assistant/ai-tasks.css';

// ---------- kinds ----------

export type Kind = Story['kind'];
/** Stories are written with a quill; the rest keep their line icons. */
const Quill = ({ size = 14 }: { size?: number }) => <GameIcon name="quill-ink" size={size} />;
export const KINDS: { id: Kind; label: Key; plural: Key; line: Key; icon: ComponentType<{ size?: number }> }[] = [
  { id: 'note', label: 'chronicle.kind.note', plural: 'chronicle.kind.note_plural', line: 'chronicle.line.note', icon: StickyNote },
  { id: 'quote', label: 'chronicle.kind.quote', plural: 'chronicle.kind.quote_plural', line: 'chronicle.line.quote', icon: Quote },
  { id: 'anecdote', label: 'chronicle.kind.anecdote', plural: 'chronicle.kind.anecdote_plural', line: 'chronicle.line.anecdote', icon: Quill },
  { id: 'recipe', label: 'chronicle.kind.recipe', plural: 'chronicle.kind.recipe_plural', line: 'chronicle.line.recipe', icon: ChefHat },
  { id: 'memory', label: 'chronicle.kind.memory', plural: 'chronicle.kind.memory_plural', line: 'chronicle.line.memory', icon: Sparkles },
];
export const KIND = Object.fromEntries(KINDS.map((k) => [k.id, k])) as Record<Kind, (typeof KINDS)[number]>;

// ---------- pieces ----------

export function PersonLink({ p, f, tree }: { p?: GPerson; f: Family; tree: string }) {
  const t = useT();
  if (!p) return <>{t('chronicle.someone')}</>;
  return (
    <Link to="/$tree/person/$id" params={{ tree, id: p.id }} className="chr-person">
      {displayName(p, f)}
    </Link>
  );
}

/** An AI translation of a story into the reader's language (its source text was current when it was made). */
export type StoryTranslation = { title: string | null; body: string };

/**
 * The text a story card shows: its translation while there is one and the reader has not asked for the original. The
 * original is always one click away (TranslatedNote), and it is what a story without a translation shows.
 */
export function useShownStory(s: Story, tr: StoryTranslation | undefined) {
  const [original, setOriginal] = useState(false);
  const translated = !!tr && !original;
  return {
    title: translated ? (tr?.title ?? s.title) : s.title,
    body: translated && tr ? tr.body : s.body,
    hasTranslation: !!tr,
    original,
    toggle: () => setOriginal((v) => !v),
  };
}

/** "Translated by AI", with the other text one click away. Nothing when the story has no translation. */
export function TranslatedNote({ shown }: { shown: ReturnType<typeof useShownStory> }) {
  const t = useT();
  if (!shown.hasTranslation) return null;
  return (
    <p className="chr-ai">
      <Sparkles size={14} /> {t('aitasks.chronicle.translated')}
      <button type="button" className="btn ghost" onClick={shown.toggle}>
        {shown.original ? t('aitasks.chronicle.showTranslation') : t('aitasks.chronicle.showOriginal')}
      </button>
    </p>
  );
}

/**
 * How many entries draw their faces in the server's HTML. A drawn face is about 8 kB of inline SVG and each entry has two
 * (beside the card, and in its first line on a phone), so the rest follow at once after hydration (Portrait's `defer`), in the
 * same frame and house colour: the first screen looks the same, and the page is several hundred kB lighter.
 */
export const EAGER_FACES = 6;

/**
 * One story as an entry of a list. `now` is the reader's clock, undefined until the page runs in the browser. `line`
 * replaces the sentence that says who wrote what about whom (the feed says "answered the question of the week");
 * `kindLink` makes the kind a way into the Chronicle.
 */
export function StoryCard({ s, f, tree, now, tr, defer, line, kindLink }: {
  s: Story; f: Family; tree: string; now?: number; tr?: StoryTranslation; defer?: boolean; line?: Key; kindLink?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const t = useT();
  const p = f.byId.get(s.person);
  const k = KIND[s.kind];
  const shown = useShownStory(s, tr);
  const long = shown.body.length > 360 || shown.body.split('\n').length > 6;
  const kind: ReactNode = <><k.icon size={14} /> {t(k.label)}</>;
  return (
    <li className="chr-item" data-kind={s.kind}>
      {p && (
        <PortraitZoom person={p} tree={tree} size={50} className="chr-face" defer={defer} />
      )}
      <article className="chr-card ui-card">
        <header>
          {/* On a phone the face sits in the card's first line; the column beside the card is for wider screens. */}
          {p && <span className="chr-face-in"><Portrait person={p} tree={tree} size={28} decorative defer={defer} /></span>}
          {kindLink
            ? <Link className="chr-kind" to="/$tree/chronicle" params={{ tree }} title={t('feed.to_chronicle_hint')}>{kind}</Link>
            : <span className="chr-kind">{kind}</span>}
          <span className="chr-line">
            {richText(t, line ?? k.line, { author: <b>{s.author}</b>, subject: <PersonLink p={p} f={f} tree={tree} /> })}
          </span>
          <time dateTime={s.at} title={now === undefined ? undefined : exact(s.at, t.locale)}>
            {now === undefined ? '' : ago(s.at, now, t)}
          </time>
        </header>
        {shown.title && <h3>{shown.title}</h3>}
        {s.kind === 'quote' ? (
          <blockquote className="chr-inline-quote" dangerouslySetInnerHTML={{ __html: renderMarkdown(shown.body) }} />
        ) : (
          <div className="chr-md" data-clamped={(long && !open) || undefined} dangerouslySetInnerHTML={{ __html: renderMarkdown(shown.body) }} />
        )}
        <TranslatedNote shown={shown} />
        {s.context && <p className="chr-ctx">{s.context}</p>}
        {long && s.kind !== 'quote' && (
          <button className="btn ghost chr-toggle" onClick={() => setOpen(!open)}>
            {open ? t('chronicle.show_less') : t('chronicle.read_more')}
          </button>
        )}
        {/* Members only: for a guest it draws nothing and asks nothing. */}
        <Responses tree={tree} kind="story" target={s.id} />
      </article>
    </li>
  );
}
