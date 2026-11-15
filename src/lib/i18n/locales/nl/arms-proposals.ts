// Dutch (je/jij): the words of src/lib/i18n/areas/arms-proposals.ts. English there is the source; keys are the same.
import type { Strings } from "../../types.ts";
import type { en } from "../../areas/arms-proposals.ts";

export default {
  "arms.vote.question": "Welk wapen moet het Huis {house} voeren?",
  "arms.vote.keep": "Ons huidige wapen houden",
} satisfies Strings<typeof en, "nl">;
