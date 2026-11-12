// Dutch (je/jij): the words of src/lib/i18n/areas/proof.ts. English there is the source; keys are the same.
import type { Strings } from "../../types.ts";
import type { en } from "../../areas/proof.ts";

export default {
  "proof.needed": "Bevestig eerst met je passkey dat jij het bent.",
  "proof.hint": "Als je een passkey toevoegt of overal elders uitlogt, vragen we opnieuw om je passkey, tenzij je een paar minuten geleden bent ingelogd.",
} satisfies Strings<typeof en, "nl">;
