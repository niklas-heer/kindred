// A Markdown editor for a biography: a toolbar, Write and Preview, and ⌘B / ⌘I. Preview is `renderMarkdown`,
// the one renderer for anything people type, so it never shows raw HTML or unsafe links. "Mention" inserts a
// link to a relative in this family: [Name](/<tree>?focus=<id>).
import { Bold, Heading2, Italic, Link2, List, Quote, UserRound } from 'lucide-react';
import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useFamily } from '~/lib/family';
import { displayName, type Family } from '~/lib/graph';
import { compareText, useT, type Locale } from '~/lib/i18n';
import { renderMarkdown } from '~/lib/markdown';
import './fields/markdown.css';

interface Props {
  id?: string;
  tree: string;
  value: string;
  onChange: (next: string) => void;
  /** Read by screen readers. */
  label: string;
  rows?: number;
  placeholder?: string;
}

export function MarkdownEditor({ id, tree, value, onChange, label, rows = 8, placeholder }: Props) {
  const c = useT();
  const fam = useFamily();
  const ta = useRef<HTMLTextAreaElement>(null);
  const [mode, setMode] = useState<'write' | 'preview'>('write');
  const [mentioning, setMentioning] = useState(false);
  const [query, setQuery] = useState('');

  /** Puts `next` in place and selects [start, end) once React has written it. */
  const apply = (next: string, start: number, end: number) => {
    onChange(next);
    requestAnimationFrame(() => {
      const el = ta.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(start, end);
    });
  };

  /** Wraps the selection (or `hint`) in `open` and `close`. */
  const wrap = (open: string, close: string, hint: string) => {
    const el = ta.current;
    if (!el) return;
    const s = el.selectionStart, e = el.selectionEnd;
    const body = value.slice(s, e) || hint;
    apply(value.slice(0, s) + open + body + close + value.slice(e), s + open.length, s + open.length + body.length);
  };

  /** Starts each line of the selection (or the current line) with `prefix`, for headings, lists and quotes. */
  const lines = (prefix: string) => {
    const el = ta.current;
    if (!el) return;
    const s = value.lastIndexOf('\n', el.selectionStart - 1) + 1;
    const endAt = value.indexOf('\n', el.selectionEnd);
    const e = endAt === -1 ? value.length : endAt;
    const block = value.slice(s, e).split('\n').map((l) => (l.startsWith(prefix) ? l : prefix + l)).join('\n');
    apply(value.slice(0, s) + block + value.slice(e), s, s + block.length);
  };

  const link = () => {
    const el = ta.current;
    if (!el) return;
    const s = el.selectionStart, e = el.selectionEnd;
    const text = value.slice(s, e) || c('md.linkText');
    const insert = `[${text}](https://)`;
    const at = s + text.length + 3;
    apply(value.slice(0, s) + insert + value.slice(e), at, at + 'https://'.length);
  };

  const insertAtCursor = (snippet: string) => {
    const el = ta.current;
    const s = el?.selectionStart ?? value.length, e = el?.selectionEnd ?? value.length;
    apply(value.slice(0, s) + snippet + value.slice(e), s + snippet.length, s + snippet.length);
    setMentioning(false);
    setQuery('');
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'b') { e.preventDefault(); wrap('**', '**', c('md.bold')); }
    else if (k === 'i') { e.preventDefault(); wrap('*', '*', c('md.italic')); }
  };

  const matches = mentioning ? matchPeople(fam, query, c.locale).slice(0, 8) : [];

  return (
    <div className="md-editor">
      <div className="md-bar" role="toolbar" aria-label={c('md.toolbar')}>
        <div className="md-tools">
          <Tool label={c('md.bold')} shortcut="⌘B" onClick={() => wrap('**', '**', c('md.bold'))} icon={<Bold size={15} />} disabled={mode === 'preview'} />
          <Tool label={c('md.italic')} shortcut="⌘I" onClick={() => wrap('*', '*', c('md.italic'))} icon={<Italic size={15} />} disabled={mode === 'preview'} />
          <Tool label={c('md.heading')} onClick={() => lines('## ')} icon={<Heading2 size={15} />} disabled={mode === 'preview'} />
          <Tool label={c('md.list')} onClick={() => lines('- ')} icon={<List size={15} />} disabled={mode === 'preview'} />
          <Tool label={c('md.quote')} onClick={() => lines('> ')} icon={<Quote size={15} />} disabled={mode === 'preview'} />
          <Tool label={c('md.link')} onClick={link} icon={<Link2 size={15} />} disabled={mode === 'preview'} />
          <Tool label={c('md.mention')} onClick={() => setMentioning((x) => !x)} icon={<UserRound size={15} />} disabled={mode === 'preview'} pressed={mentioning} />
        </div>
        <div className="seg md-mode" role="group" aria-label={c('md.mode')}>
          <button type="button" className="btn" aria-pressed={mode === 'write'} onClick={() => setMode('write')}>{c('md.write')}</button>
          <button type="button" className="btn" aria-pressed={mode === 'preview'} onClick={() => setMode('preview')}>{c('md.preview')}</button>
        </div>
      </div>

      {mentioning && mode === 'write' && (
        <div className="md-mention" role="group" aria-label={c('md.mention')}>
          <input
            className="input" autoFocus value={query} placeholder={c('md.mentionPlaceholder')} aria-label={c('md.mentionPlaceholder')}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setMentioning(false); } }}
          />
          <div className="md-mention-list">
            {matches.length === 0 && <span className="subtle">{c('md.noMatch')}</span>}
            {matches.map((p) => (
              <button type="button" className="btn ghost md-mention-item" key={p.id} onClick={() => insertAtCursor(`[${displayName(p, fam)}](/${tree}?focus=${p.id})`)}>
                {displayName(p, fam)}
              </button>
            ))}
          </div>
        </div>
      )}

      {mode === 'write' ? (
        <textarea
          id={id} ref={ta} className="input md-text" rows={rows} value={value} placeholder={placeholder}
          aria-label={label} onKeyDown={onKey} onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <div className="md-preview story-body" aria-label={label}>
          {value.trim() ? <div dangerouslySetInnerHTML={{ __html: renderMarkdown(value) }} /> : <p className="subtle">{c('md.nothing')}</p>}
        </div>
      )}
      <span className="subtle md-hint">{c('md.hint')}</span>
    </div>
  );
}

function Tool({ label, shortcut, icon, onClick, disabled, pressed }: { label: string; shortcut?: string; icon: ReactNode; onClick: () => void; disabled?: boolean; pressed?: boolean }) {
  return (
    <button type="button" className="btn icon ghost md-tool" aria-label={label} title={shortcut ? `${label} (${shortcut})` : label} onClick={onClick} disabled={disabled} aria-pressed={pressed}>
      {icon}
    </button>
  );
}

/** People whose name starts with (or contains) what was typed, the closest first. */
function matchPeople(fam: Family, q: string, locale: Locale) {
  const cmp = compareText(locale);
  const needle = q.trim().toLowerCase();
  const all = fam.graph.people.map((p) => ({ p, name: displayName(p, fam) }));
  const hit = needle ? all.filter((x) => x.name.toLowerCase().includes(needle)) : all;
  return hit.sort((a, b) => Number(!a.name.toLowerCase().startsWith(needle)) - Number(!b.name.toLowerCase().startsWith(needle)) || cmp(a.name, b.name)).map((x) => x.p);
}
