// Pictures on a chat message: picked, dropped or pasted. Each is checked by its own first bytes, then scaled down in the
// browser, so a phone photo costs little and carries no GPS or camera details (a canvas keeps no metadata). They stay on
// this page until they are sent, and the server checks them again. Used by the assistant's composer and the family session.
import { pastedImages } from './paste-images';
import { ImagePlus, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { scaledPicture } from '~/components/photos/image';
import { CHAT_IMAGE_BYTES, CHAT_IMAGE_COUNT, CHAT_IMAGE_EDGE, CHAT_IMAGE_FILE_BYTES, PROVIDER_LABEL, type Provider } from '~/lib/ai/types';
import { useT } from '~/lib/i18n';

export interface Attached { id: string; base64: string; url: string }

let seq = 0;

/** Whether a file's first bytes are a picture format a browser may open, whatever its name or stated type says. */
export function looksLikeImage(b: Uint8Array): boolean {
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return true;
  if (b[0] === 0x89 && ascii(1, 4) === 'PNG') return true;
  if (ascii(0, 4) === 'GIF8') return true;
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return true;
  // HEIC and AVIF, as an iPhone may hand them over: the browser decides below whether it can open one.
  return ascii(4, 8) === 'ftyp' && /^(hei|hev|mif|msf|avi)/.test(ascii(8, 12));
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** One file as it will be sent, or an error key. Steps down until it fits; a screenshot usually fits the first time. */
async function prepare(file: File): Promise<Attached> {
  if (file.size > CHAT_IMAGE_FILE_BYTES) throw new Error('ai.err_image_big');
  if (!looksLikeImage(new Uint8Array(await file.slice(0, 16).arrayBuffer()))) throw new Error('ai.err_image_bad');
  for (const [edge, quality] of [[CHAT_IMAGE_EDGE, 0.85], [CHAT_IMAGE_EDGE, 0.7], [1600, 0.7], [1200, 0.6]] as const) {
    let blob: Blob;
    try {
      ({ blob } = await scaledPicture(file, edge, quality));
    } catch {
      throw new Error('ai.err_image_bad');
    }
    if (blob.size > CHAT_IMAGE_BYTES) continue;
    const base64 = toBase64(new Uint8Array(await blob.arrayBuffer()));
    return { id: `img${Date.now().toString(36)}${(seq++).toString(36)}`, base64, url: `data:image/jpeg;base64,${base64}` };
  }
  throw new Error('ai.err_image_big');
}

/** The pictures waiting to be sent, and the handlers that add to them. `active` is false while this composer is hidden. */
export function useImageAttach({ active, initial = [], onError }: { active: boolean; initial?: Attached[]; onError: (key: string | null) => void }) {
  const [images, setImages] = useState<Attached[]>(initial);
  const [reading, setReading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const current = useRef(images);
  current.current = images;
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback(async (files: File[]) => {
    if (!files.length) return;
    onError(null);
    setReading(true);
    try {
      for (const file of files) {
        if (current.current.length >= CHAT_IMAGE_COUNT) {
          onError('ai.err_image_many');
          break;
        }
        try {
          const img = await prepare(file);
          if (current.current.some((x) => x.base64 === img.base64)) continue;
          current.current = [...current.current, img];
          setImages(current.current);
        } catch (e) {
          onError(e instanceof Error ? e.message : 'ai.err_image_bad');
        }
      }
    } finally {
      setReading(false);
    }
  }, [onError]);

  // A screenshot on the clipboard. Anywhere in the page while this composer is showing, and text is left to paste as text.
  useEffect(() => {
    if (!active) return;
    const onPaste = (e: ClipboardEvent) => {
      const files = pastedImages(e.clipboardData);
      if (!files.length) return;
      e.preventDefault();
      void addFiles(files);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [active, addFiles]);

  const hasFiles = (e: DragEvent) => [...e.dataTransfer.types].includes('Files');
  const dropProps = {
    onDragEnter: (e: DragEvent) => { if (hasFiles(e)) { e.preventDefault(); setDragging(true); } },
    onDragOver: (e: DragEvent) => { if (hasFiles(e)) e.preventDefault(); },
    onDragLeave: (e: DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); },
    onDrop: (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setDragging(false);
      void addFiles([...e.dataTransfer.files]);
    },
  };

  const remove = (id: string) => setImages((list) => (current.current = list.filter((x) => x.id !== id)));
  const replace = (next: Attached[]) => { current.current = next; setImages(next); };
  const pick = () => inputRef.current?.click();
  const onPicked = (e: ChangeEvent<HTMLInputElement>) => {
    void addFiles([...(e.target.files ?? [])]);
    e.target.value = '';
  };
  return { images, reading, dragging, remove, replace, pick, onPicked, inputRef, dropProps };
}

type Attach = ReturnType<typeof useImageAttach>;

/** The button that opens the file or photo picker, and its hidden input. */
export function AttachButton({ attach, disabled }: { attach: Attach; disabled?: boolean }) {
  const t = useT();
  return (
    <>
      <input ref={attach.inputRef} type="file" accept="image/*" multiple hidden onChange={attach.onPicked} />
      <button type="button" className="btn ai-touch ai-attach" onClick={attach.pick} disabled={disabled || attach.images.length >= CHAT_IMAGE_COUNT} aria-label={t('ai.attach')} title={t('ai.attach')}>
        <ImagePlus size={16} aria-hidden />
      </button>
    </>
  );
}

/** The pictures waiting to go, each with a remove button, where they go, and the choice to keep them. */
export function ImageTray({ attach, provider, keep, onKeep, disabled }: {
  attach: Attach;
  provider: Provider | 'fake' | null | undefined;
  keep: boolean;
  onKeep: (next: boolean) => void;
  disabled?: boolean;
}) {
  const t = useT();
  if (!attach.images.length && !attach.reading) return null;
  const name = provider && provider !== 'fake' ? PROVIDER_LABEL[provider] : provider === 'fake' ? 'Fake' : t('ai.attachProviderUnknown');
  return (
    <div className="ai-tray">
      <ul className="ai-thumbs">
        {attach.images.map((img, i) => (
          <li key={img.id} className="ai-thumb">
            <img src={img.url} alt={t('ai.attachAlt', { n: i + 1 })} />
            <button type="button" className="ai-thumb-x" onClick={() => attach.remove(img.id)} disabled={disabled} aria-label={t('ai.attachRemove')} title={t('ai.attachRemove')}>
              <X size={13} aria-hidden />
            </button>
          </li>
        ))}
        {attach.reading && <li className="ai-thumb ai-thumb-busy subtle" role="status">{t('ai.attachReading')}</li>}
      </ul>
      {attach.images.length > 0 && (
        <>
          <p className="ai-tray-note subtle">{t('ai.attachNote', { provider: name })}</p>
          <label className="ai-tray-keep">
            <input type="checkbox" checked={keep} onChange={(e) => onKeep(e.target.checked)} disabled={disabled} />
            <span>{t('ai.attachKeep')}</span>
          </label>
        </>
      )}
    </div>
  );
}

/** The veil over a composer while a file is dragged over it. */
export function DropVeil({ show }: { show: boolean }) {
  const t = useT();
  return show ? <div className="ai-drop" aria-hidden><ImagePlus size={22} /> {t('ai.attachDrop')}</div> : null;
}
