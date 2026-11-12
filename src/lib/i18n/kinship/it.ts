// Italian kinship words: NOT WRITTEN YET. Until a translation lane writes this module, Italian uses the neutral stand-in
// (English words, no possessive), and the language cannot be complete. To write it: replace the export below with a
// KinshipRules of Italian's own (see de.ts or af.ts, and docs/translating.md, "Kinship"), then give every case in cases.ts
// its "it" answer; kinship.test.ts checks each one.
import neutral from "./neutral.ts";

export default neutral;
