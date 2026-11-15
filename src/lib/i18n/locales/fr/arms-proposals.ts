// French (tu): the words of src/lib/i18n/areas/arms-proposals.ts. English there is the source; keys are the same.
import type { Strings } from "../../types.ts";
import type { en } from "../../areas/arms-proposals.ts";

export default {
  "arms.vote.question": "Quelles armoiries la maison {house} doit-elle porter ?",
  "arms.vote.keep": "Garder nos armoiries actuelles",
} satisfies Strings<typeof en, "fr">;
