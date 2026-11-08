// The feedback panel: mark a part of the page, look at the picture of the screen (leave it out or blur a part), say what
// is wrong, and see everything that is attached before it is sent. Loaded on demand from FeedbackHost.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Crosshair, EyeOff, ImageOff, Lightbulb, Bug, HelpCircle, RotateCcw, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Dialog } from '~/components/ui/Dialog';
import { Segmented } from '~/components/ui/Segmented';
import { Switch } from '~/components/ui/Switch';
import { isTopOverlay, useOverlayLayer } from '~/components/ui/overlay';
import { errorText } from '~/lib/errortext';
import { FEEDBACK_LIMITS, type FeedbackKind } from '~/lib/feedback';
import { cssPath, feedbackContext } from '~/lib/feedback-client';
import { feedbackQuery, submitFeedback } from '~/lib/feedback.functions';
import { LANGUAGE_NAME, useT, type Key } from '~/lib/i18n';
import { toast } from '~/lib/toast';
import { captureScreen, canvasJpeg, drawReport, SKIP_ATTR, type Box } from './capture';
import './feedback.css';

const KINDS: { value: FeedbackKind; label: Key; icon: typeof Bug }[] = [
  { value: 'bug', label: 'feedback.kind_bug', icon: Bug },
  { value: 'idea', label: 'feedback.kind_idea', icon: Lightbulb },
  { value: 'confusing', label: 'feedback.kind_confusing', icon: HelpCircle },
];

interface Marked { selector: string; box: Box }

export default function FeedbackPanel({ tree, onClose }: { tree: string; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [picking, setPicking] = useState(false);
  const [kind, setKind] = useState<FeedbackKind>('bug');
  const [text, setText] = useState('');
  const [marked, setMarked] = useState<Marked | null>(null);
  const [shot, setShot] = useState<HTMLCanvasElement | 'busy' | 'failed'>('busy');
  const [include, setInclude] = useState(true);
  const [blurs, setBlurs] = useState<Box[]>([]);
  const [blurring, setBlurring] = useState(false);
  const preview = useRef<HTMLCanvasElement>(null);
  const drag = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    let live = true;
    captureScreen().then((c) => { if (live) setShot(c); }, (e) => { console.error(e); if (live) setShot('failed'); });
    return () => { live = false; };
  }, []);

  const base = typeof shot === 'string' ? null : shot;
  const scale = base ? base.width / window.innerWidth : 1;
  // Drawn into the preview whenever something changes: what the steward sees is exactly what is sent.
  useLayoutEffect(() => {
    if (base && preview.current && include && !picking) drawReport(preview.current, base, blurs, marked ? scaleBox(marked.box, scale) : null);
  }, [base, blurs, marked, include, picking, scale]);

  // Fixed when the panel opens, apart from the element, so the list below is what is sent.
  const context = useMemo(() => feedbackContext(null, t.locale), [t.locale]);
  const attached = { ...context, selector: marked?.selector ?? null };

  const send = useMutation({
    mutationFn: async () => {
      const form = new FormData();
      form.set('tree', tree);
      form.set('kind', kind);
      form.set('text', text);
      form.set('context', JSON.stringify(attached));
      if (include && base && preview.current) form.set('picture', new File([await canvasJpeg(preview.current, FEEDBACK_LIMITS.picture)], 'screen.jpg', { type: 'image/jpeg' }));
      return submitFeedback({ data: form });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: feedbackQuery(tree).queryKey });
      toast({ title: t('feedback.sent') });
      onClose();
    },
  });

  const point = (e: React.PointerEvent) => {
    const r = preview.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, ratio: preview.current!.width / r.width };
  };
  const onDown = (e: React.PointerEvent) => {
    if (!blurring) return;
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const p = point(e);
    start.current = { x: p.x, y: p.y };
    if (drag.current) Object.assign(drag.current.style, { display: 'block', left: `${p.x}px`, top: `${p.y}px`, width: '0', height: '0' });
  };
  const onMove = (e: React.PointerEvent) => {
    if (!start.current || !drag.current) return;
    const p = point(e), s = start.current;
    Object.assign(drag.current.style, { left: `${Math.min(s.x, p.x)}px`, top: `${Math.min(s.y, p.y)}px`, width: `${Math.abs(p.x - s.x)}px`, height: `${Math.abs(p.y - s.y)}px` });
  };
  const onUp = (e: React.PointerEvent) => {
    const s = start.current;
    start.current = null;
    if (drag.current) drag.current.style.display = 'none';
    if (!s) return;
    const p = point(e);
    const w = Math.abs(p.x - s.x), h = Math.abs(p.y - s.y);
    if (w > 4 && h > 4) setBlurs((b) => [...b, { x: Math.min(s.x, p.x) * p.ratio, y: Math.min(s.y, p.y) * p.ratio, w: w * p.ratio, h: h * p.ratio }]);
  };

  if (picking) {
    return <Picker onCancel={() => setPicking(false)} onPick={(m) => { setMarked(m); setPicking(false); }} />;
  }

  const rows: [Key, string][] = [
    ['feedback.field_page', attached.page],
    ['feedback.field_element', attached.selector ?? t('feedback.none_marked')],
    ['feedback.field_language', LANGUAGE_NAME[attached.locale]],
    ['feedback.field_theme', attached.theme],
    ['feedback.field_screen', attached.screen],
    ['feedback.field_browser', attached.browser],
    ['feedback.field_version', attached.version],
  ];

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('feedback.title')}
      width={600}
      dirty={!!text.trim()}
      className="fb-panel"
      bodyClassName="fb-body"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>{t('common.cancel')}</button>
          <button type="button" className="btn primary" disabled={!text.trim() || send.isPending || shot === 'busy'} onClick={() => send.mutate()}>
            {send.isPending ? t('feedback.sending') : t('feedback.send')}
          </button>
        </>
      }
    >
      <p className="fb-intro">{t('feedback.intro')}</p>
      <Segmented
        aria-label={t('feedback.kind_label')}
        value={kind}
        onChange={setKind}
        block
        options={KINDS.map((k) => ({ value: k.value, label: t(k.label), icon: <k.icon size={15} /> }))}
      />
      <label className="field">
        <span>{t('feedback.text_label')}</span>
        <textarea className="input" rows={3} value={text} maxLength={FEEDBACK_LIMITS.text} placeholder={t('feedback.text_placeholder')} onChange={(e) => setText(e.target.value)} />
      </label>

      <div className="fb-mark-row">
        <button type="button" className="btn" onClick={() => { setBlurring(false); setPicking(true); }}>
          <Crosshair size={15} /> {marked ? t('feedback.point_again') : t('feedback.point')}
        </button>
        {marked && (
          <button type="button" className="btn ghost" onClick={() => setMarked(null)}>
            <X size={15} /> {t('feedback.clear_mark')}
          </button>
        )}
      </div>

      <section className="fb-shot-section" aria-label={t('feedback.picture_heading')}>
        <div className="fb-shot-head">
          <b>{t('feedback.picture_heading')}</b>
          <Switch checked={include} onChange={setInclude} labelFirst>{t('feedback.include_picture')}</Switch>
        </div>
        {include ? (
          <>
            <p className="fb-note">{t('feedback.picture_review')}</p>
            <div className="fb-shot" data-blurring={blurring || undefined}>
              {shot === 'busy' && <p className="fb-note" role="status">{t('feedback.capturing')}</p>}
              {shot === 'failed' && <p className="fb-note" role="alert"><ImageOff size={15} aria-hidden /> {t('feedback.capture_failed')}</p>}
              {base && (
                <div className="fb-shot-frame" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
                  <canvas ref={preview} className="fb-preview" role="img" aria-label={t('feedback.picture_heading')} />
                  <div ref={drag} className="fb-drag" hidden={false} />
                </div>
              )}
            </div>
            {base && (
              <div className="fb-mark-row">
                <button type="button" className="btn" aria-pressed={blurring} onClick={() => setBlurring((b) => !b)}>
                  <EyeOff size={15} /> {blurring ? t('feedback.blur_done') : t('feedback.blur')}
                </button>
                {blurs.length > 0 && (
                  <button type="button" className="btn ghost" onClick={() => setBlurs((b) => b.slice(0, -1))}>
                    <RotateCcw size={15} /> {t('feedback.blur_undo')}
                  </button>
                )}
                {blurring && <span className="fb-note">{t('feedback.blur_hint')}</span>}
              </div>
            )}
          </>
        ) : (
          <p className="fb-note">{t('feedback.picture_left_out')}</p>
        )}
      </section>

      <details className="fb-details" open>
        <summary>{t('feedback.attached_title')}</summary>
        <dl>
          {rows.map(([label, value]) => (
            <div key={label}><dt>{t(label)}</dt><dd>{value}</dd></div>
          ))}
          <div>
            <dt>{t('feedback.field_errors')}</dt>
            <dd>
              {attached.errors.length ? (
                <ul className="fb-errors">{attached.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
              ) : t('feedback.no_errors')}
            </dd>
          </div>
        </dl>
        <p className="fb-note">{t('feedback.attached_note')}</p>
      </details>

      {send.isError && <p className="fb-error" role="alert">{errorText(send.error, t.locale)}</p>}
    </Dialog>
  );
}

const scaleBox = (b: Box, s: number): Box => ({ x: b.x * s, y: b.y * s, w: b.w * s, h: b.h * s });

/** Which element is under a point, ignoring the picker itself and the page's outermost frames. */
function elementAt(x: number, y: number): Element | null {
  return document.elementsFromPoint(x, y).find((el) => !el.closest(`[${SKIP_ATTR}]`) && el !== document.documentElement && el !== document.body) ?? null;
}

/**
 * Hover and click (or touch and lift) to mark an element; Esc or Cancel leaves the panel as it was. It sits above the page and
 * takes every press, so the page underneath never reacts. If a dialog of the app is open, the picker goes inside it,
 * because a modal dialog makes everything outside it unreachable to a press.
 */
function Picker({ onPick, onCancel }: { onPick: (m: Marked) => void; onCancel: () => void }) {
  const t = useT();
  const layer = useOverlayLayer(true);
  const [host] = useState<HTMLElement>(() => [...document.querySelectorAll('dialog')].filter((d) => d.matches(':modal') && !d.querySelector(':scope > .fb-panel')).at(-1) ?? document.body);
  const [hover, setHover] = useState<DOMRect | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { cancelRef.current?.focus({ preventScroll: true }); }, []);
  const latest = useRef(onCancel);
  latest.current = onCancel;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !isTopOverlay(layer)) return;
      e.preventDefault();
      e.stopPropagation();
      latest.current();
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [layer]);
  const onMove = (e: React.PointerEvent) => {
    const el = elementAt(e.clientX, e.clientY);
    setHover(el ? el.getBoundingClientRect() : null);
  };
  const onUp = (e: React.PointerEvent) => {
    const el = elementAt(e.clientX, e.clientY);
    if (!el) return;
    const r = el.getBoundingClientRect();
    const box = {
      x: Math.max(0, r.left), y: Math.max(0, r.top),
      w: Math.min(window.innerWidth, r.right) - Math.max(0, r.left), h: Math.min(window.innerHeight, r.bottom) - Math.max(0, r.top),
    };
    onPick({ selector: cssPath(el), box });
  };
  return createPortal(
    <div {...{ [SKIP_ATTR]: '' }} className="fb-picker" onPointerMove={onMove} onPointerDown={onMove} onPointerUp={onUp} onContextMenu={(e) => e.preventDefault()}>
      {hover && <div className="fb-picker-box" style={{ left: hover.left, top: hover.top, width: hover.width, height: hover.height }} />}
      <div className="fb-picker-hint panel" role="status" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()} onPointerMove={(e) => e.stopPropagation()}>
        <span>{t('feedback.picker_hint')}</span>
        <button ref={cancelRef} type="button" className="btn" onClick={onCancel}>{t('common.cancel')}</button>
      </div>
    </div>,
    host,
  );
}
