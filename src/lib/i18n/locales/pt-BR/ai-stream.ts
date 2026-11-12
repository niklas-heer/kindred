// Brazilian Portuguese (você): the words of src/lib/i18n/areas/ai-stream.ts. English there is the source; keys are the same.
import type { Strings } from "../../types.ts";
import type { en } from "../../areas/ai-stream.ts";

export default {
  "ai.stepFamily": "Olhando a família…",
  "ai.stepMissing": "Verificando o que falta…",
  "ai.stepHouses": "Olhando as casas…",
  "ai.stepPhotos": "Olhando as fotos…",
  "ai.stepWeb": "Consultando a web…",
  "ai.stepProposing": "Preparando uma sugestão…",
  "ai.stepWorking": "Trabalhando nisso…",
  "ai.stop": "Parar",
  "ai.stopped": "Parado.",
  "ai.stoppedNote": "Você parou esta resposta. Nada foi salvo.",
  "ai.interrupted": "A página foi recarregada antes de a resposta terminar. Nada foi salvo.",
  "ai.connectionLost": "A conexão caiu antes de a resposta terminar. Nada foi salvo.",
  "ai.errTurnBusy": "Uma resposta ainda está sendo escrita neste chat. Tente de novo quando ela terminar.",
  "ai.errTurnTimeout": "Isto demorou demais, então foi interrompido. Tente de novo.",
  "ai.err_bad_request": "Não foi possível ler essa mensagem. Tente de novo.",
} satisfies Strings<typeof en, "pt-BR">;
