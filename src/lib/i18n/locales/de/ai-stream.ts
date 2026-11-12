// German (du): the words of src/lib/i18n/areas/ai-stream.ts. English there is the source; keys are the same.
import type { Strings } from "../../types.ts";
import type { en } from "../../areas/ai-stream.ts";

export default {
  'ai.stepFamily': 'Schaue die Familie durch…',
  'ai.stepMissing': 'Prüfe, was fehlt…',
  'ai.stepHouses': 'Schaue mir die Häuser an…',
  'ai.stepPhotos': 'Schaue mir die Fotos an…',
  'ai.stepWeb': 'Suche im Web…',
  'ai.stepProposing': 'Bereite einen Vorschlag vor…',
  'ai.stepWorking': 'Bin dran…',
  'ai.stop': 'Stopp',
  'ai.stopped': 'Gestoppt.',
  'ai.stoppedNote': 'Du hast diese Antwort gestoppt. Nichts wurde gespeichert.',
  'ai.interrupted': 'Die Seite wurde neu geladen, bevor die Antwort fertig war. Nichts wurde gespeichert.',
  'ai.connectionLost': 'Die Verbindung brach ab, bevor die Antwort fertig war. Nichts wurde gespeichert.',
  'ai.errTurnBusy': 'In diesem Chat wird noch eine Antwort geschrieben. Versuche es noch einmal, wenn sie fertig ist.',
  'ai.errTurnTimeout': 'Das hat zu lange gedauert und wurde gestoppt. Versuche es noch einmal.',
  'ai.err_bad_request': 'Diese Nachricht konnte nicht gelesen werden. Versuche es noch einmal.',
} satisfies Strings<typeof en, "de">;
