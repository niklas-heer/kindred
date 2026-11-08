// Accessibility problems already known and not yet fixed. A listed problem does not fail a journey, and is still printed
// after every run. Fix one and remove its entry; the point is to keep this list short and honest.
export const KNOWN_AXE: { rule: string; where: RegExp; note: string }[] = [];
