// Polish (ty): the words of src/lib/i18n/areas/proof.ts. English there is the source; keys are the same.
import type { Strings } from "../../types.ts";
import type { en } from "../../areas/proof.ts";

export default {
  "proof.needed": "Najpierw potwierdź kluczem dostępu, że to Ty.",
  "proof.hint": "Dodanie klucza dostępu albo wylogowanie ze wszystkich innych urządzeń wymaga ponownego użycia klucza dostępu, chyba że logowanie nastąpiło kilka minut temu.",
} satisfies Strings<typeof en, "pl">;
