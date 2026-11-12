// Dutch (je/jij): the words of src/lib/i18n/areas/ai-stream.ts. English there is the source; keys are the same.
import type { Strings } from "../../types.ts";
import type { en } from "../../areas/ai-stream.ts";

export default {
  "ai.stepFamily": "De familie doorzoeken…",
  "ai.stepMissing": "Nagaan wat er ontbreekt…",
  "ai.stepHouses": "De huizen bekijken…",
  "ai.stepPhotos": "De foto’s bekijken…",
  "ai.stepWeb": "Het web raadplegen…",
  "ai.stepProposing": "Een voorstel voorbereiden…",
  "ai.stepWorking": "Bezig…",
  "ai.stop": "Stop",
  "ai.stopped": "Gestopt.",
  "ai.stoppedNote": "Je hebt dit antwoord gestopt. Er is niets opgeslagen.",
  "ai.interrupted": "De pagina is opnieuw geladen voordat het antwoord klaar was. Er is niets opgeslagen.",
  "ai.connectionLost": "De verbinding viel weg voordat het antwoord klaar was. Er is niets opgeslagen.",
  "ai.errTurnBusy": "In dit gesprek wordt nog een antwoord geschreven. Probeer het opnieuw als het klaar is.",
  "ai.errTurnTimeout": "Dit duurde te lang en is daarom gestopt. Probeer het opnieuw.",
  "ai.err_bad_request": "Dat bericht kon niet worden gelezen. Probeer het opnieuw.",
} satisfies Strings<typeof en, "nl">;
