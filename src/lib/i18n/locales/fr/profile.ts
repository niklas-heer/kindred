// French (tu): the words of src/lib/i18n/areas/profile.ts. English there is the source; keys are the same.
import type { Strings } from "../../types.ts";
import type { en } from "../../areas/profile.ts";

export default {
  "profile.showInTree": "Voir dans l’arbre",
  "profile.open": "Profil complet",
  "profile.openTitle": "Ouvrir le profil complet de {name}",
  "profile.enlarge": "Agrandir la photo de {name}",
} satisfies Strings<typeof en, "fr">;
