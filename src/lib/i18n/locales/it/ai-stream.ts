// Italian (tu): the words of src/lib/i18n/areas/ai-stream.ts. English there is the source; keys are the same.
import type { Strings } from "../../types.ts";
import type { en } from "../../areas/ai-stream.ts";

export default {
  "ai.stepFamily": "Sto guardando la famiglia…",
  "ai.stepMissing": "Sto controllando cosa manca…",
  "ai.stepHouses": "Sto guardando le casate…",
  "ai.stepPhotos": "Sto guardando le foto…",
  "ai.stepWeb": "Sto cercando sul web…",
  "ai.stepProposing": "Sto preparando un suggerimento…",
  "ai.stepWorking": "Ci sto lavorando…",
  "ai.stop": "Ferma",
  "ai.stopped": "Fermato.",
  "ai.stoppedNote": "Hai fermato questa risposta. Non è stato salvato nulla.",
  "ai.interrupted": "La pagina è stata ricaricata prima che la risposta finisse. Non è stato salvato nulla.",
  "ai.connectionLost": "La connessione è caduta prima che la risposta finisse. Non è stato salvato nulla.",
  "ai.errTurnBusy": "In questa chat si sta ancora scrivendo una risposta. Riprova quando ha finito.",
  "ai.errTurnTimeout": "Ci ha messo troppo, quindi è stato fermato. Riprova.",
  "ai.err_bad_request": "Non è stato possibile leggere quel messaggio. Riprova.",
} satisfies Strings<typeof en, "it">;
