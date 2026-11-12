// Italian (tu): the words of src/lib/i18n/areas/proof.ts. English there is the source; keys are the same.
import type { Strings } from "../../types.ts";
import type { en } from "../../areas/proof.ts";

export default {
  "proof.needed": "Conferma prima di essere tu con la tua passkey.",
  "proof.hint": "Aggiungere una passkey o uscire da tutti gli altri dispositivi richiede di nuovo la tua passkey, a meno che tu non abbia effettuato l’accesso da pochi minuti.",
} satisfies Strings<typeof en, "it">;
