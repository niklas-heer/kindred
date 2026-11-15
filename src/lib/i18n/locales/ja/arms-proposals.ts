// Japanese (です/ます): the words of src/lib/i18n/areas/arms-proposals.ts. English there is the source; keys are the same.
import type { Strings } from "../../types.ts";
import type { en } from "../../areas/arms-proposals.ts";

export default {
  "arms.vote.question": "{house}家はどの紋章を掲げますか？",
  "arms.vote.keep": "今の紋章のままにします",
} satisfies Strings<typeof en, "ja">;
