// The voices of an invented family. The seed of the test families and of the demo (scripts/seed.ts) writes posts, comments
// and reactions as `seed:<person id>`: no account has that id (accounts are UUIDs), and its voice is that person in the
// tree. So a demo's feed has faces and names without a single account. Plain code: the server's readers and the seed use it.

const PREFIX = 'seed:';

/** The account a seed writes as, for a person of the invented family. */
export const seedAccount = (person: string): string => `${PREFIX}${person}`;

/** The person a seed's account stands for, or null for a real account. */
export const seedVoice = (account: string): string | null => (account.startsWith(PREFIX) ? account.slice(PREFIX.length) : null);
