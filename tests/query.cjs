"use strict";
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const { execFile, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { isDeepStrictEqual } = require("node:util");
require("../src/web/query.js");
const { KindredQuery } = globalThis;

const ROOT = path.resolve(__dirname, "..");
const BINARY = path.join(ROOT, "target", "debug", "kindred");
const SKIP = fs.existsSync(BINARY) ? false : `${path.relative(ROOT, BINARY)} is missing; run cargo build --locked first`;
const ARCHIVES = ["examples/fictional", "examples/historical/european-dynasties"];
const CLAIM_STATUSES = ["accepted", "tentative", "disputed", "rejected"];
const CONCURRENCY = Math.max(4, os.availableParallelism());
const MODES = [
  { command: "ancestors", run: (data, id, input) => KindredQuery.ancestors(data, id, input) },
  { command: "descendants", run: (data, id, input) => KindredQuery.descendants(data, id, input) },
  { command: "neighbors", run: (data, id, input) => KindredQuery.neighborhood(data, id, input) },
];
const workspaces = [];
after(() => {
  for (const workspace of workspaces) fs.rmSync(workspace, { recursive: true, force: true });
});

// Each CLI call costs a process start, so the matrix is a deliberate list rather than a full product:
// the CLI defaults, every generation count, each relation filter, each status filter, and two mixed cases.
const COMBINATIONS = [
  {},
  { generations: 0 },
  { generations: 1 },
  { generations: 2 },
  { generations: 8 },
  { generations: 8, relations: ["partner"] },
  { generations: 8, relations: ["biological_parent"] },
  { generations: 8, statuses: CLAIM_STATUSES },
  { generations: 2, statuses: ["disputed"] },
];
const OVERVIEW_COMBINATIONS = [{}, { relations: ["partner"] }, { relations: ["biological_parent"] }, { statuses: CLAIM_STATUSES }, { statuses: ["disputed"] }];

function flags({ generations, relations = [], statuses = [] }) {
  return [
    ...(generations === undefined ? [] : ["--generations", String(generations)]),
    ...(relations.length ? ["--relations", relations.join(",")] : []),
    ...(statuses.length ? ["--statuses", statuses.join(",")] : []),
  ];
}

// Resolves to { value } for a successful CLI run, or { message } for the Rust error on stderr.
function kindred(args) {
  return new Promise((resolve, reject) => {
    execFile(BINARY, args, { maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (!error) return resolve({ value: JSON.parse(stdout) });
      if (error.code !== 1) return reject(new Error(`kindred ${args.join(" ")} failed unexpectedly: ${stderr}`));
      return resolve({ message: stderr.trim().replace(/^kindred: /, "") });
    });
  });
}

function outcome(run) {
  try {
    return { value: run() };
  } catch (error) {
    return { message: error.message };
  }
}

// Copies the archive so `reindex` can write its snapshot, then reads the full record list from that
// snapshot and every edge from `overview --json` with all claim statuses (Archive::edges() order).
function snapshot(relative) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "kindred-query-"));
  workspaces.push(workspace);
  const root = path.join(workspace, "archive");
  fs.cpSync(path.join(ROOT, relative), root, { recursive: true });
  execFileSync(BINARY, ["reindex", root], { stdio: "pipe" });
  const index = JSON.parse(fs.readFileSync(path.join(root, ".kindred", "index.json"), "utf8"));
  const overview = JSON.parse(execFileSync(BINARY, ["overview", root, "--json", "--statuses", CLAIM_STATUSES.join(",")], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
  return { root, data: { records: index.records, diagnostics: index.diagnostics, edges: overview.edges } };
}

// Every person gets the CLI defaults plus two filter sets rotated through the list, so each filter set
// is exercised across many people without one CLI call per (person, filter set) pair.
const FILTERED = COMBINATIONS.slice(1);
const rotation = (index) => [{}, FILTERED[index % FILTERED.length], FILTERED[(index + 3) % FILTERED.length]];

function comparisons(root, data) {
  const jobs = [];
  const people = data.records.filter((record) => record.type === "person").map((record) => record.id);
  const other = data.records.find((record) => record.type !== "person").id;
  people.forEach((id, index) => {
    for (const mode of MODES) {
      for (const combination of rotation(index)) jobs.push({ args: [mode.command, root, id, "--json", ...flags(combination)], run: () => mode.run(data, id, combination) });
    }
  });
  for (const combination of OVERVIEW_COMBINATIONS) jobs.push({ args: ["overview", root, "--json", ...flags(combination)], run: () => KindredQuery.overview(data, combination) });
  // One sampled pair per person (most fail under narrow filters), plus a self path.
  const pairs = people.map((from, index) => [from, people[(index * 7 + 3) % people.length], index]);
  pairs.push([people[0], people[0], 0]);
  for (const [from, to, index] of pairs) {
    for (const combination of rotation(index)) jobs.push({ args: ["path", root, from, to, "--json", ...flags(combination)], run: () => KindredQuery.path(data, from, to, combination) });
  }
  // Unknown and non-person IDs must fail with the Rust messages.
  jobs.push({ args: ["ancestors", root, "nobody", "--json"], run: () => KindredQuery.ancestors(data, "nobody", {}) });
  jobs.push({ args: ["descendants", root, other, "--json"], run: () => KindredQuery.descendants(data, other, {}) });
  jobs.push({ args: ["path", root, people[0], "nobody", "--json"], run: () => KindredQuery.path(data, people[0], "nobody", {}) });
  jobs.push({ args: ["path", root, other, people[0], "--json"], run: () => KindredQuery.path(data, other, people[0], {}) });
  return jobs;
}

async function compare(jobs) {
  const report = { mismatches: [], values: 0, errors: 0 };
  let next = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (next < jobs.length) {
      const job = jobs[next++];
      const expected = await kindred(job.args);
      const actual = outcome(job.run);
      if (expected.message === undefined) report.values += 1;
      else report.errors += 1;
      if (!isDeepStrictEqual(expected, actual)) report.mismatches.push({ command: job.args.join(" "), expected, actual });
    }
  }));
  return report;
}

for (const relative of ARCHIVES) {
  test(`${relative}: browser queries match the CLI for every person and option set`, { skip: SKIP }, async (t) => {
    const { root, data } = snapshot(relative);
    assert.ok(data.records.length > 0 && data.edges.length > 0, "snapshot should carry records and edges");
    const jobs = comparisons(root, data);
    const report = await compare(jobs);
    t.diagnostic(`${jobs.length} parity comparisons: ${report.values} results, ${report.errors} CLI errors`);
    const sample = report.mismatches.slice(0, 3).map((item) => JSON.stringify(item).slice(0, 1200)).join("\n");
    assert.equal(report.mismatches.length, 0, `${report.mismatches.length} comparisons differ from the CLI:\n${sample}`);
  });
}
