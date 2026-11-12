// French (tu): the words of src/lib/i18n/areas/ai-stream.ts. English there is the source; keys are the same.
import type { Strings } from "../../types.ts";
import type { en } from "../../areas/ai-stream.ts";

export default {
  "ai.stepFamily": "Je parcours la famille…",
  "ai.stepMissing": "Je vérifie ce qui manque…",
  "ai.stepHouses": "Je regarde les maisons…",
  "ai.stepPhotos": "Je regarde les photos…",
  "ai.stepWeb": "Je cherche sur le web…",
  "ai.stepProposing": "Je prépare une suggestion…",
  "ai.stepWorking": "J’y travaille…",
  "ai.stop": "Arrêter",
  "ai.stopped": "Arrêté.",
  "ai.stoppedNote": "Tu as arrêté cette réponse. Rien n’a été enregistré.",
  "ai.interrupted": "La page a été rechargée avant la fin de la réponse. Rien n’a été enregistré.",
  "ai.connectionLost": "La connexion a été coupée avant la fin de la réponse. Rien n’a été enregistré.",
  "ai.errTurnBusy": "Une réponse est encore en cours dans cette conversation. Réessaie quand elle sera terminée.",
  "ai.errTurnTimeout": "Cela a pris trop de temps, donc c’est arrêté. Réessaie.",
  "ai.err_bad_request": "Ce message n’a pas pu être lu. Réessaie.",
} satisfies Strings<typeof en, "fr">;
