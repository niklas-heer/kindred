// Polish (ty): the words of src/lib/i18n/areas/ai-stream.ts. English there is the source; keys are the same.
import type { Strings } from "../../types.ts";
import type { en } from "../../areas/ai-stream.ts";

export default {
  "ai.stepFamily": "Przeglądanie rodziny…",
  "ai.stepMissing": "Sprawdzanie, czego brakuje…",
  "ai.stepHouses": "Przeglądanie rodów…",
  "ai.stepPhotos": "Przeglądanie zdjęć…",
  "ai.stepWeb": "Sprawdzanie w internecie…",
  "ai.stepProposing": "Przygotowywanie propozycji…",
  "ai.stepWorking": "Trwa praca…",
  "ai.stop": "Zatrzymaj",
  "ai.stopped": "Zatrzymano.",
  "ai.stoppedNote": "Ta odpowiedź została zatrzymana. Nic nie zostało zapisane.",
  "ai.interrupted": "Strona została odświeżona, zanim odpowiedź była gotowa. Nic nie zostało zapisane.",
  "ai.connectionLost": "Połączenie zostało przerwane, zanim odpowiedź była gotowa. Nic nie zostało zapisane.",
  "ai.errTurnBusy": "W tej rozmowie wciąż powstaje odpowiedź. Spróbuj ponownie, gdy będzie gotowa.",
  "ai.errTurnTimeout": "Trwało to zbyt długo, więc przerwano. Spróbuj ponownie.",
  "ai.err_bad_request": "Nie udało się odczytać tej wiadomości. Spróbuj ponownie.",
} satisfies Strings<typeof en, "pl">;
