// Japanese (です/ます): the words of src/lib/i18n/areas/ai-stream.ts. English there is the source; keys are the same.
import type { Strings } from "../../types.ts";
import type { en } from "../../areas/ai-stream.ts";

export default {
  "ai.stepFamily": "家族を調べています…",
  "ai.stepMissing": "足りない情報を確認しています…",
  "ai.stepHouses": "家系を見ています…",
  "ai.stepPhotos": "写真を見ています…",
  "ai.stepWeb": "ウェブを調べています…",
  "ai.stepProposing": "提案を準備しています…",
  "ai.stepWorking": "作業しています…",
  "ai.stop": "停止",
  "ai.stopped": "停止しました。",
  "ai.stoppedNote": "返信を止めました。何も保存されていません。",
  "ai.interrupted": "返信が終わる前にページが再読み込みされました。何も保存されていません。",
  "ai.connectionLost": "返信が終わる前に接続が切れました。何も保存されていません。",
  "ai.errTurnBusy": "このチャットではまだ返信を書いています。終わってからもう一度お試しください。",
  "ai.errTurnTimeout": "時間がかかりすぎたため、止めました。もう一度お試しください。",
  "ai.err_bad_request": "メッセージを読み取れませんでした。もう一度お試しください。",
} satisfies Strings<typeof en, "ja">;
