// Spanish (tú): the words of src/lib/i18n/areas/proof.ts. English there is the source; keys are the same.
import type { Strings } from "../../types.ts";
import type { en } from "../../areas/proof.ts";

export default {
  "proof.needed": "Confirma antes que eres tú con tu llave de acceso.",
  "proof.hint": "Añadir una llave de acceso o cerrar sesión en todos los demás sitios te pide de nuevo tu llave de acceso, salvo que hayas iniciado sesión hace unos minutos.",
} satisfies Strings<typeof en, "es">;
