// Spanish (tú): the words of src/lib/i18n/areas/arms-proposals.ts. English there is the source; keys are the same.
import type { Strings } from "../../types.ts";
import type { en } from "../../areas/arms-proposals.ts";

export default {
  "arms.vote.question": "¿Qué escudo de armas debe llevar la casa {house}?",
  "arms.vote.keep": "Mantener nuestro escudo actual",
} satisfies Strings<typeof en, "es">;
