// Spanish (tú): the words of src/lib/i18n/areas/ai-stream.ts. English there is the source; keys are the same.
import type { Strings } from "../../types.ts";
import type { en } from "../../areas/ai-stream.ts";

export default {
  "ai.stepFamily": "Revisando la familia…",
  "ai.stepMissing": "Comprobando qué falta…",
  "ai.stepHouses": "Mirando las casas…",
  "ai.stepPhotos": "Mirando las fotos…",
  "ai.stepWeb": "Consultando la web…",
  "ai.stepProposing": "Preparando una sugerencia…",
  "ai.stepWorking": "Trabajando en ello…",
  "ai.stop": "Detener",
  "ai.stopped": "Detenido.",
  "ai.stoppedNote": "Detuviste esta respuesta. No se guardó nada.",
  "ai.interrupted": "La página se recargó antes de que terminara la respuesta. No se guardó nada.",
  "ai.connectionLost": "La conexión se cortó antes de que terminara la respuesta. No se guardó nada.",
  "ai.errTurnBusy": "Todavía se está escribiendo una respuesta en este chat. Inténtalo de nuevo cuando termine.",
  "ai.errTurnTimeout": "Esto tardó demasiado, así que se detuvo. Inténtalo de nuevo.",
  "ai.err_bad_request": "No se pudo leer ese mensaje. Inténtalo de nuevo.",
} satisfies Strings<typeof en, "es">;
