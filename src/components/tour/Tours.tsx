// The Tours dialog: both tours in one place, with the grand tour's chapters ticked off as they are walked. Opened from
// the account menu, More and the ⌘K palette. `Tours` is what the family's layout mounts: this dialog and the player.
import { Check, Compass, Map as MapIcon } from 'lucide-react';
import { useMemo } from 'react';
import { useTreeId } from '~/lib/family';
import { useT } from '~/lib/i18n';
import { usePref } from '~/lib/prefs';
import { Dialog } from '../ui/Dialog';
import { Tour, useTourContext } from './Tour';
import { closeTours, grandPref, saveGrand, startTour, useToursOpen } from './store';
import { chaptersDone, chaptersFor, readProgress, resumeChapter, stepsFor } from './steps';
import './tour.css';

export function Tours() {
  return <><TourHub /><Tour /></>;
}

function TourHub() {
  const open = useToursOpen();
  return open ? <Hub /> : null;
}

function Hub() {
  const t = useT();
  const tree = useTreeId();
  const ctx = useTourContext();
  const kept = usePref(grandPref(tree));
  const progress = useMemo(() => readProgress(kept), [kept]);
  const chapters = chaptersFor(ctx);
  const ids = chapters.map((c) => c.id);
  const done = chaptersDone(progress, ids);
  const resume = resumeChapter(progress, ids);
  const begun = done > 0 || !!progress.at;
  const resumeAt = resume ? chapters.find((c) => c.id === resume) : undefined;

  return (
    <Dialog open onClose={closeTours} title={t('tour.hub.title')} description={t('tour.hub.intro')} width={560} className="tours-dialog">
      <div className="tours">
        <section className="tours-tour" aria-labelledby="tours-welcome">
          <span className="tours-icon" aria-hidden><Compass size={22} /></span>
          <div className="tours-text">
            <h3 id="tours-welcome">{t('tour.hub.welcome')}</h3>
            <p>{t('tour.hub.welcome_text', { count: stepsFor(ctx).length })}</p>
          </div>
          <button type="button" className={begun ? 'btn' : 'btn primary'} onClick={() => startTour('welcome')}>{t('tour.hub.start')}</button>
        </section>

        <section className="tours-tour tours-grand" aria-labelledby="tours-grand">
          <span className="tours-icon" aria-hidden><MapIcon size={22} /></span>
          <div className="tours-text">
            <h3 id="tours-grand">{t('tour.hub.grand')}</h3>
            <p>{t('tour.hub.grand_text')}</p>
          </div>
          <div className="tours-progress">
            <div className="tour-meter" aria-hidden><i style={{ width: `${(done / Math.max(1, ids.length)) * 100}%` }} /></div>
            <span>{t('tour.hub.progress', { done, count: ids.length })}</span>
          </div>
          {/* The way on comes before the list, so on a phone it is on the screen without scrolling. */}
          <div className="tours-actions">
            {begun && <button type="button" className="btn ghost" onClick={() => { saveGrand(tree, null); startTour('grand'); }}>{t('tour.hub.restart')}</button>}
            <button type="button" className="btn primary" onClick={() => startTour('grand', resume ?? undefined)}>
              {resumeAt ? t('tour.hub.continue', { n: ids.indexOf(resumeAt.id) + 1, chapter: t(resumeAt.title) }) : begun ? t('tour.hub.again') : t('tour.hub.start_grand')}
            </button>
          </div>
          <ol className="tours-chapters">
            {chapters.map((c, i) => {
              const ticked = progress.done.includes(c.id);
              return (
                <li key={c.id}>
                  <button type="button" onClick={() => startTour('grand', c.id)} data-done={ticked || undefined} aria-current={resume === c.id ? 'step' : undefined}>
                    <span className="tours-tick" aria-hidden>{ticked ? <Check size={14} /> : i + 1}</span>
                    <span className="tours-chapter">{t(c.title)}</span>
                    {ticked ? <span className="sr-only">{t('tour.hub.done')}</span> : null}
                    {resume === c.id ? <em>{t('tour.hub.next_up')}</em> : null}
                  </button>
                </li>
              );
            })}
          </ol>
        </section>
      </div>
    </Dialog>
  );
}
