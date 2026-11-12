// Simplified Chinese (你): the words of src/lib/i18n/areas/ai-stream.ts. English there is the source; keys are the same.
import type { Strings } from "../../types.ts";
import type { en } from "../../areas/ai-stream.ts";

export default {
  "ai.stepMissing": "正在检查缺少的信息…",
  "ai.stepHouses": "正在查看各个支系…",
  "ai.stepPhotos": "正在查看照片…",
  "ai.stepWeb": "正在查询网络…",
  "ai.stepProposing": "正在准备建议…",
  "ai.stepWorking": "正在处理…",
  "ai.stop": "停止",
  "ai.stopped": "已停止。",
  "ai.stoppedNote": "你停止了这次回复，没有保存任何内容。",
  "ai.interrupted": "回复完成前页面被重新加载了，没有保存任何内容。",
  "ai.connectionLost": "回复完成前连接断开了，没有保存任何内容。",
  "ai.errTurnBusy": "这个对话还在回复中，请等它结束后再试。",
  "ai.errTurnTimeout": "耗时太长，已经停止。请再试一次。",
  "ai.err_bad_request": "无法读取这条消息，请再试一次。",
} satisfies Strings<typeof en, "zh-Hans">;
