// Arms proposals (src/lib/arms-proposals/): a house's arms vote as each reader sees it. Its question and its "keep" option
// are stored in English and translated on the server: for the reader in the votes reads and the feed, and for each device
// in the pushes about votes (src/lib/votes/vote-push.server.ts).
export const en = {
  "arms.vote.question": "Which arms should House {house} bear?",
  "arms.vote.keep": "Keep our current arms",
} as const;
