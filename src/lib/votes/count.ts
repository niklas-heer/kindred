// Counting for family votes: plurality for single choice, instant runoff for ranked. Pure; computed from the ballots on read.
import type { VoteKind, VoteResult } from './types.ts';

type Round = { tallies: Record<string, number>; out: string[]; exhausted: number };

const known = (options: readonly string[], ballot: readonly string[]) => ballot.filter((id) => options.includes(id));

function countSingle(options: readonly string[], ballots: readonly (readonly string[])[]): VoteResult {
  const tallies = Object.fromEntries(options.map((id) => [id, 0]));
  let counted = 0;
  for (const ballot of ballots) {
    const choice = known(options, ballot)[0];
    if (choice === undefined) continue;
    tallies[choice]++;
    counted++;
  }
  const top = Math.max(0, ...Object.values(tallies));
  const winners = top === 0 ? [] : options.filter((id) => tallies[id] === top);
  return { kind: 'single', tallies, winners, ballots: counted };
}

function countRanked(options: readonly string[], ballots: readonly (readonly string[])[]): VoteResult {
  const counted = ballots.map((b) => known(options, b)).filter((b) => b.length > 0);
  const rounds: Round[] = [];
  if (counted.length === 0) return { kind: 'ranked', rounds, winners: [], ballots: 0 };
  let standing = [...options];
  for (;;) {
    const tallies: Record<string, number> = Object.fromEntries(standing.map((id) => [id, 0]));
    let exhausted = 0;
    for (const ballot of counted) {
      const choice = ballot.find((id) => standing.includes(id));
      if (choice === undefined) exhausted++;
      else tallies[choice]++;
    }
    const inPlay = counted.length - exhausted;
    const leader = standing.find((id) => tallies[id] * 2 > inPlay);
    if (leader !== undefined) {
      rounds.push({ tallies, out: [], exhausted });
      return { kind: 'ranked', rounds, winners: [leader], ballots: counted.length };
    }
    const low = Math.min(...standing.map((id) => tallies[id]));
    let tied = standing.filter((id) => tallies[id] === low);
    // Ties for last place: the fewer votes in the previous round, back to the first.
    for (let r = rounds.length - 1; r >= 0 && tied.length > 1; r--) {
      const before = Math.min(...tied.map((id) => rounds[r].tallies[id]));
      tied = tied.filter((id) => rounds[r].tallies[id] === before);
    }
    if (tied.length === standing.length) {
      rounds.push({ tallies, out: [], exhausted });
      return { kind: 'ranked', rounds, winners: standing, ballots: counted.length };
    }
    rounds.push({ tallies, out: tied, exhausted });
    standing = standing.filter((id) => !tied.includes(id));
  }
}

export function countVote(kind: VoteKind, options: readonly string[], ballots: readonly (readonly string[])[]): VoteResult {
  return kind === 'single' ? countSingle(options, ballots) : countRanked(options, ballots);
}
