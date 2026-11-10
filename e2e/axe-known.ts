// Accessibility problems already known and not yet fixed. A listed problem does not fail a journey, and is still printed
// after every run. Fix one and remove its entry; the point is to keep this list short and honest.
export const KNOWN_AXE: { rule: string; where: RegExp; note: string }[] = [
  {
    rule: 'aria-required-children',
    where: /^assistant: /,
    note: 'The chat window\'s tab strip (ChatList.tsx) keeps each tab\'s close button inside role="tablist". Found by journey 19, the first to run axe with the assistant open; not caused by it.',
  },
];
