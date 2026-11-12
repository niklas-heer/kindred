// French (tu): the words of src/lib/i18n/areas/proof.ts. English there is the source; keys are the same.
import type { Strings } from "../../types.ts";
import type { en } from "../../areas/proof.ts";

export default {
  "proof.needed": "Confirme d’abord que c’est bien toi avec ta clé d’accès.",
  "proof.hint": "Ajouter une clé d’accès ou te déconnecter partout ailleurs te redemande ta clé d’accès, sauf si tu t’es connecté il y a quelques minutes.",
} satisfies Strings<typeof en, "fr">;
