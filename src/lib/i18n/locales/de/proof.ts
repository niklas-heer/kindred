// German (du): the words of src/lib/i18n/areas/proof.ts. English there is the source; keys are the same.
import type { Strings } from "../../types.ts";
import type { en } from "../../areas/proof.ts";

export default {
  "proof.needed": "Bestätige zuerst mit deinem Passkey, dass du es bist.",
  "proof.hint": "Wenn du einen Passkey hinzufügst oder dich überall sonst abmeldest, fragt Kindred noch einmal nach deinem Passkey, außer du hast dich vor wenigen Minuten angemeldet.",
} satisfies Strings<typeof en, "de">;
