// A way to say something, at the top of the feed: the reader's face, a line that opens the composer, and two short cuts
// (straight to choosing pictures, straight to a memory of someone). A reader who cannot write here is told why, in
// place of a button that would only fail: a viewer, a demo's visitor, a steward looking through a preview.
//
//   <ComposeRow tree={tree} open={writing} onOpen={setWriting} />
import { ImagePlus } from 'lucide-react';
import { useRef, useState } from 'react';
import { GameIcon } from '~/components/GameIcon';
import { Portrait } from '~/components/Portrait';
import { useFamily, useMeChosen } from '~/lib/family';
import { useT } from '~/lib/i18n';
import { useCan, useSession } from '~/lib/session';
import { Composer } from './Composer';
import './feed.css';

export function ComposeRow({ tree, open, onOpen }: { tree: string; open: boolean; onOpen: (open: boolean) => void }) {
  const t = useT();
  const f = useFamily();
  const session = useSession();
  const canPost = useCan('post');
  const canRemember = useCan('add-story');
  const meId = useMeChosen();
  const me = meId ? f.byId.get(meId) : undefined;
  const name = session?.user?.name?.trim().split(/\s+/)[0];
  const [start, setStart] = useState<'post' | 'memory'>('post');
  const [files, setFiles] = useState<File[] | undefined>(undefined);
  const input = useRef<HTMLInputElement>(null);
  const close = () => { onOpen(false); setStart('post'); setFiles(undefined); };

  // Why nothing can be written here, when it cannot: the demo's and the preview's own words, or the role's.
  const why = session?.demo ? t('demo.err_read_only') : session?.viewAs ? t('feed.compose.preview') : !canPost && !canRemember ? t('feed.compose.viewer') : null;

  return (
    <div className="ui-card fd-compose">
      {me ? <span className="fd-compose-face"><Portrait person={me} tree={tree} size={40} decorative /></span> : null}
      {why ? <p className="fd-compose-note">{why}</p> : (
        <>
          <button type="button" className="fd-compose-prompt" aria-haspopup="dialog" onClick={() => { setStart(canPost ? 'post' : 'memory'); onOpen(true); }}>
            {name ? t('feed.compose.prompt_named', { name }) : t('feed.compose.prompt')}
          </button>
          <div className="fd-compose-quick">
            {canPost ? (
              <>
                <input
                  ref={input} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden
                  onChange={(e) => {
                    const chosen = Array.from(e.target.files ?? []);
                    e.target.value = '';
                    if (!chosen.length) return;
                    setFiles(chosen);
                    setStart('post');
                    onOpen(true);
                  }}
                />
                <button type="button" className="btn" onClick={() => input.current?.click()}><ImagePlus size={16} aria-hidden /> {t('feed.compose.photos')}</button>
              </>
            ) : null}
            {canRemember ? (
              <button type="button" className="btn" aria-haspopup="dialog" onClick={() => { setStart('memory'); onOpen(true); }}><GameIcon name="quill-ink" size={16} /> {t('feed.compose.memory')}</button>
            ) : null}
          </div>
        </>
      )}
      {open && !why ? <Composer tree={tree} start={start} files={files} onClose={close} /> : null}
    </div>
  );
}
