// Japanese (です/ます): the words of src/lib/i18n/areas/profile.ts. English there is the source; keys are the same.
import type { Strings } from "../../types.ts";
import type { en } from "../../areas/profile.ts";

export default {
  "profile.showInTree": "家系図で表示",
  "profile.open": "プロフィール全体",
  "profile.openTitle": "{name}のプロフィールを開く",
  "profile.enlarge": "{name}の写真を大きく表示",
} satisfies Strings<typeof en, "ja">;
