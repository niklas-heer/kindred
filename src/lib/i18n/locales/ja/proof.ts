// Japanese (です/ます): the words of src/lib/i18n/areas/proof.ts. English there is the source; keys are the same.
import type { Strings } from "../../types.ts";
import type { en } from "../../areas/proof.ts";

export default {
  "proof.needed": "先に、パスキーでご本人であることを確認してください。",
  "proof.hint": "パスキーの追加や、ほかの場所からのサインアウトでは、数分以内にサインインしていない限り、もう一度パスキーの確認があります。",
} satisfies Strings<typeof en, "ja">;
