// English: graph.kinship() already speaks it, so the label is the word ("great-aunt", "second cousin once removed").
import type { Kinship } from "../../graph";
import { possessive, type KinshipRules } from "./shared.ts";

const label = (k: Kinship) => k.label;
const en: KinshipRules = { label, ...possessive("your", label) };
export default en;
