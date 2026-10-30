"use strict";
// Browser port of src/query.rs. `data` is { records, edges, diagnostics? }: records as the archive
// serializes them (index.json, including derived records) and edges as Archive::edges() lists them
// (every status and relation, in archive order). Results mirror the Rust QueryResult and its order.
(() => {
  const DEFAULT_GENERATIONS = 4;
  const DEFAULT_STATUSES = ["accepted"];

  function options(input) {
    const source = input ?? {};
    return {
      generations: source.generations ?? DEFAULT_GENERATIONS,
      relations: source.relations ?? [],
      statuses: source.statuses ?? DEFAULT_STATUSES,
    };
  }

  function filtered(data, { relations, statuses }) {
    return data.edges.filter((edge) => (!relations.length || relations.includes(edge.relation)) && (statuses.length ? statuses.includes(edge.status) : edge.status === "accepted"));
  }

  function check(data, id) {
    if (data.diagnostics?.length) throw new Error("archive contains validation errors; run kindred check");
    const matches = data.records.filter((record) => record.id === id);
    if (matches.length !== 1) throw new Error(`unknown or ambiguous person ID: ${id}`);
    if (matches[0].type !== "person") throw new Error(`expected person ID: ${id}`);
    return matches[0];
  }

  function selection(data, ids, edges) {
    return { nodes: data.records.filter((record) => ids.has(record.id)), edges };
  }

  // Ancestors follow parent edges backwards, descendants forwards; neighborhoods follow any edge, partners included.
  function step(edge, current, direction) {
    if (direction === "both") return edge.from === current ? edge.to : edge.to === current ? edge.from : undefined;
    if (edge.relation === "partner") return undefined;
    if (direction === "ancestors") return edge.to === current ? edge.from : undefined;
    return edge.from === current ? edge.to : undefined;
  }

  function traverse(data, id, input, direction) {
    check(data, id);
    const query = options(input);
    const edges = filtered(data, query);
    const ids = new Set([id]);
    const selected = new Set();
    const queue = [[id, 0]];
    for (let head = 0; head < queue.length; head++) {
      const [current, depth] = queue[head];
      if (depth >= query.generations) continue;
      for (const edge of edges) {
        const next = step(edge, current, direction);
        if (next === undefined) continue;
        selected.add(edge.id);
        if (!ids.has(next)) {
          ids.add(next);
          queue.push([next, depth + 1]);
        }
      }
    }
    return selection(data, ids, edges.filter((edge) => selected.has(edge.id)));
  }

  // Breadth-first search with first-discovery parents, so ties resolve in edge order as in query.rs.
  function path(data, from, to, input) {
    check(data, from);
    check(data, to);
    const query = options(input);
    const edges = filtered(data, query);
    const visited = new Set([from]);
    const previous = new Map();
    const queue = [[from, 0]];
    for (let head = 0; head < queue.length; head++) {
      const [current, depth] = queue[head];
      if (current === to) break;
      if (depth >= query.generations) continue;
      for (const edge of edges) {
        const next = edge.from === current ? edge.to : edge.to === current ? edge.from : undefined;
        if (next === undefined || visited.has(next)) continue;
        visited.add(next);
        previous.set(next, [current, edge]);
        queue.push([next, depth + 1]);
      }
    }
    if (!visited.has(to)) throw new Error(`no connection within ${query.generations} steps under the selected claim policy`);
    const ids = new Set([to]);
    const selected = [];
    let current = to;
    while (previous.has(current)) {
      const [parent, edge] = previous.get(current);
      ids.add(parent);
      selected.push(edge);
      current = parent;
    }
    return selection(data, ids, selected.reverse());
  }

  function overview(data, input) {
    return { nodes: data.records.filter((record) => record.type === "person"), edges: filtered(data, options(input)) };
  }

  const ancestors = (data, id, input) => traverse(data, id, input, "ancestors");
  const descendants = (data, id, input) => traverse(data, id, input, "descendants");
  const neighborhood = (data, id, input) => traverse(data, id, input, "both");

  globalThis.KindredQuery = Object.freeze({ overview, neighborhood, ancestors, descendants, path });
})();
