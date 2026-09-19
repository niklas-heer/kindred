(() => {
  "use strict";

  const state = {
    mode: "overview",
    person: "",
    to: "",
    data: null,
    selected: "",
    positions: new Map(),
    orderedIds: [],
    scale: 1,
    tx: 0,
    ty: 0,
    drag: null,
    request: 0,
    editorOriginal: "",
    overviewExpanded: new Set(),
    overviewCollapsed: new Set(),
    overviewShowAll: false
  };

  const el = Object.fromEntries([
    "direction-label", "zoom-in", "zoom-out", "zoom-level", "search", "search-results", "generations", "relation-filter", "status-filter", "show-evidence", "overview-toggle", "fit-button",
    "diagnostics", "path-picker", "path-from", "path-to", "graph", "viewport",
    "edges", "nodes", "empty-state", "graph-status", "details", "editor",
    "editor-title", "editor-text", "editor-message", "save-button", "help-button", "shortcuts"
  ].map((id) => [id.replaceAll("-", "_"), document.getElementById(id)]));

  const svgNs = "http://www.w3.org/2000/svg";

  function html(tag, options = {}) {
    const node = document.createElement(tag);
    if (options.className) node.className = options.className;
    if (options.text !== undefined) node.textContent = String(options.text);
    if (options.attrs) {
      for (const [name, value] of Object.entries(options.attrs)) node.setAttribute(name, String(value));
    }
    return node;
  }

  function svg(tag, options = {}) {
    const node = document.createElementNS(svgNs, tag);
    if (options.className) node.setAttribute("class", options.className);
    if (options.text !== undefined) node.textContent = String(options.text);
    if (options.attrs) {
      for (const [name, value] of Object.entries(options.attrs)) node.setAttribute(name, String(value));
    }
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.firstChild.remove();
  }

  function people() {
    if (!state.data) return [];
    return state.data.records.filter((record) => record.kind === "person");
  }

  function record(id) {
    return state.data?.records.find((candidate) => candidate.id === id);
  }

  function linkedIds(item, field) {
    const raw = item?.metadata?.[field];
    const values = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
    const ids = [];
    for (const value of values) {
      if (typeof value !== "string") continue;
      const match = /^\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]$/u.exec(value.trim());
      if (!match) continue;
      const target = match[1];
      const candidates = state.data.records.filter((candidate) => {
        const stem = candidate.path.replace(/\.md$/iu, "");
        return stem === target || (!target.includes("/") && stem.split("/").at(-1) === target);
      });
      if (candidates.length === 1) ids.push(candidates[0].id);
    }
    return ids;
  }

  function eventsForPerson(id) {
    return state.data.records.filter((item) => item.kind === "event" && linkedIds(item, "people").includes(id));
  }

  function label(item) {
    return item?.name || item?.metadata?.title || item?.id || "Unnamed record";
  }

  function initials(name) {
    return name.split(/\s+/u).filter(Boolean).slice(0, 2).map((part) => [...part][0] || "").join("").toLocaleUpperCase() || "?";
  }

  function shortRelation(value) {
    return String(value || "related").replaceAll("_", " ").replace(/\b\w/gu, (letter) => letter.toLocaleUpperCase());
  }

  async function loadGraph({ keepSelection = true } = {}) {
    const request = ++state.request;
    el.graph_status.textContent = "Reading archive…";
    const parameters = new URLSearchParams({
      mode: state.mode,
      generations: el.generations.value,
      relations: el.relation_filter.value,
      statuses: el.status_filter.value
    });
    if (state.mode !== "overview") parameters.set("person", state.person);
    if (state.mode === "path") parameters.set("to", state.to);

    try {
      const response = await fetch(`/api/graph?${parameters}`, { headers: { Accept: "application/json" } });
      const payload = await response.json();
      if (request !== state.request) return;
      if (!response.ok) throw new Error(payload.details ? `${payload.error}: ${payload.details}` : payload.error || `Request failed (${response.status})`);
      for (const item of [...payload.records, ...payload.query.nodes]) item.kind = item.kind || item.type;
      const previous = keepSelection ? state.selected : "";
      state.data = payload;
      state.selected = previous && record(previous) ? previous : state.person;
      if (!state.person) state.person = payload.query.nodes.find((item) => item.kind === "person")?.id || "";
      populatePeople();
      renderDiagnostics();
      renderGraph();
      renderDetails();
    } catch (error) {
      if (request !== state.request) return;
      el.graph_status.textContent = "Could not load archive";
      el.empty_state.hidden = false;
      clear(el.nodes);
      clear(el.edges);
      showError(error instanceof Error ? error.message : String(error));
    }
  }

  function showError(message) {
    clear(el.diagnostics);
    el.diagnostics.append(html("strong", { text: "Archive needs attention. " }));
    el.diagnostics.append(document.createTextNode(message));
    el.diagnostics.hidden = false;
  }

  function renderDiagnostics() {
    const diagnostics = state.data?.diagnostics || [];
    clear(el.diagnostics);
    if (!diagnostics.length) {
      el.diagnostics.hidden = true;
      return;
    }
    const summary = diagnostics.length === 1 ? "1 archive diagnostic" : `${diagnostics.length} archive diagnostics`;
    el.diagnostics.append(html("strong", { text: `${summary}. ` }));
    el.diagnostics.append(document.createTextNode(diagnostics.slice(0, 3).map((item) => item.message).join(" · ")));
    el.diagnostics.hidden = false;
  }

  function populatePeople() {
    const sorted = [...people()].sort((a, b) => label(a).localeCompare(label(b)));
    const current = el.path_to.value;
    clear(el.path_to);
    el.path_to.append(html("option", { text: "Choose a person…", attrs: { value: "" } }));
    for (const person of sorted) {
      if (person.id === state.person) continue;
      el.path_to.append(html("option", { text: label(person), attrs: { value: person.id } }));
    }
    el.path_to.value = state.to || current;
    el.path_from.textContent = label(record(state.person)) || "choose a person";
  }

  function graphNodes() {
    let persons = (state.data?.query.nodes || []).filter((item) => item.kind === "person");
    if (state.mode === "overview" && !state.overviewShowAll) persons = collapsedOverview(persons);
    if (!el.show_evidence.checked) return persons;
    const personIds = new Set(persons.map((person) => person.id));
    const sourceIds = new Set((state.data?.query.edges || []).filter((edge) => personIds.has(edge.from) && personIds.has(edge.to)).flatMap((edge) => edge.sources || []));
    for (const person of persons) for (const source of linkedIds(person, "sources")) sourceIds.add(source);
    const evidence = state.data.records.filter((item) => sourceIds.has(item.id) || (item.kind === "event" && linkedIds(item, "people").some((id) => personIds.has(id))));
    return [...persons, ...evidence.filter((item, index, all) => all.findIndex((other) => other.id === item.id) === index)];
  }

  function collapsedOverview(persons) {
    const ids = new Set(persons.map((person) => person.id));
    const claims = state.data.query.edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to));
    const neighbors = new Map(persons.map((person) => [person.id, []]));
    for (const edge of claims) {
      neighbors.get(edge.from).push(edge.to);
      neighbors.get(edge.to).push(edge.from);
    }
    const visible = new Set();
    const visited = new Set();
    for (const person of persons) {
      if (visited.has(person.id)) continue;
      const component = [], queue = [person.id];
      visited.add(person.id);
      while (queue.length) {
        const id = queue.shift();
        component.push(id);
        for (const next of neighbors.get(id)) if (!visited.has(next)) { visited.add(next); queue.push(next); }
      }
      const children = new Set(claims.filter((edge) => edge.relation !== "partner").map((edge) => edge.to));
      const roots = component.filter((id) => !children.has(id));
      // Start at a root with the largest descendant branch, not every spouse
      // whose parents happen to be absent from this selective archive.
      const reach = (root) => {
        const found = new Set([root]), pending = [root];
        while (pending.length) {
          const id = pending.shift();
          for (const edge of claims) if (edge.from === id && edge.relation !== "partner" && !found.has(edge.to)) {
            found.add(edge.to); pending.push(edge.to);
          }
        }
        return found.size;
      };
      const root = (roots.length ? roots : component).sort((a, b) => reach(b) - reach(a) || a.localeCompare(b))[0];
      const pending = [[root, 0]], seen = new Set();
      while (pending.length) {
        const [id, depth] = pending.shift();
        if (seen.has(id)) continue;
        seen.add(id); visible.add(id);
        for (const edge of claims) {
          if (edge.relation === "partner" && (edge.from === id || edge.to === id)) {
            pending.push([edge.from === id ? edge.to : edge.from, depth]);
          } else if (edge.from === id && (!state.overviewCollapsed.has(id) && (depth < 2 || state.overviewExpanded.has(id)))) {
            pending.push([edge.to, depth + 1]);
          }
        }
      }
    }
    // Show both sides of the visible parentage without inventing a partnership.
    // Use a snapshot so including a parent does not recursively unfold ancestors.
    const descendants = new Set(visible);
    for (const edge of claims) if (edge.relation !== "partner" && descendants.has(edge.to)) visible.add(edge.from);
    return persons.filter((person) => visible.has(person.id));
  }

  function graphEdges(nodes) {
    const ids = new Set(nodes.map((node) => node.id));
    const claims = (state.data?.query.edges || []).filter((edge) => ids.has(edge.from) && ids.has(edge.to));
    if (!el.show_evidence.checked) return claims;
    const evidence = [];
    for (const edge of claims) {
      for (const source of edge.sources || []) {
        if (ids.has(source)) evidence.push({ id: `${edge.id}:${source}`, from: edge.to, to: source, relation: "evidence", status: "accepted", sources: [] });
      }
    }
    for (const person of nodes.filter((node) => node.kind === "person")) {
      for (const source of linkedIds(person, "sources")) {
        if (ids.has(source) && !evidence.some((edge) => edge.from === person.id && edge.to === source)) {
          evidence.push({ id: `source:${person.id}:${source}`, from: person.id, to: source, relation: "evidence", status: "accepted", sources: [] });
        }
      }
    }
    for (const event of nodes.filter((node) => node.kind === "event")) {
      const participants = new Set(linkedIds(event, "people"));
      const participant = nodes.find((node) => node.kind === "person" && participants.has(node.id));
      if (participant) evidence.push({ id: `event:${event.id}`, from: participant.id, to: event.id, relation: "event", status: "accepted", sources: [] });
    }
    return [...claims, ...evidence];
  }

  function renderGraph() {
    el.direction_label.textContent = state.mode === "path" ? "Connection path" : "Parents above children";
    const nodes = graphNodes();
    if (state.selected && record(state.selected)?.kind === "person" && !nodes.some((node) => node.id === state.selected)) state.selected = nodes[0]?.id || "";
    const edges = graphEdges(nodes);
    state.positions = layout(nodes, edges);
    state.orderedIds = nodes.map((node) => node.id);
    clear(el.nodes);
    clear(el.edges);

    for (const edge of edges) renderEdge(edge);
    for (const node of nodes) renderNode(node);
    renderGraphSelection();

    el.empty_state.hidden = nodes.length !== 0;
    const peopleCount = nodes.filter((node) => node.kind === "person").length;
    const evidenceCount = nodes.length - peopleCount;
    const claimCount = edges.filter((edge) => edge.relation !== "evidence" && edge.relation !== "event").length;
    const allPeopleCount = state.data.query.nodes.filter((node) => node.kind === "person").length;
    const peopleText = state.mode === "overview" && !state.overviewShowAll
      ? `${peopleCount} shown of ${allPeopleCount} people`
      : `${peopleCount} ${peopleCount === 1 ? "person" : "people"}`;
    const evidenceText = evidenceCount ? ` · ${evidenceCount} evidence` : "";
    const claimsText = `${claimCount} ${claimCount === 1 ? "claim" : "claims"}`;
    el.graph_status.textContent = `${peopleText}${evidenceText} · ${claimsText}`;
    requestAnimationFrame(fitGraph);
  }

  function layout(nodes, edges) {
    const CARD_WIDTH = 224;
    const COLUMN_GAP = 36;
    const ROW_GAP = 80;
    const COMPONENT_GAP = 180;
    const X_STEP = CARD_WIDTH + COLUMN_GAP;
    const Y_STEP = 96 + ROW_GAP;
    const positions = new Map();
    if (!nodes.length) return positions;
    const people = nodes
      .filter((node) => node.kind === "person")
      .sort((left, right) => left.id.localeCompare(right.id));
    const evidence = nodes
      .filter((node) => node.kind !== "person")
      .sort((left, right) => left.id.localeCompare(right.id));
    const personIds = new Set(people.map((person) => person.id));
    const personEdges = edges.filter((edge) => personIds.has(edge.from) && personIds.has(edge.to));

    if (state.mode === "path") {
      const adjacency = new Map(people.map((person) => [person.id, []]));
      for (const edge of personEdges) {
        adjacency.get(edge.from)?.push(edge.to);
        adjacency.get(edge.to)?.push(edge.from);
      }
      for (const neighbors of adjacency.values()) neighbors.sort((left, right) => left.localeCompare(right));
      const endpoint = people.find((person) => adjacency.get(person.id)?.length === 1)?.id;
      let current = personIds.has(state.person) ? state.person : endpoint || people[0]?.id;
      const ordered = [];
      const visited = new Set();
      while (current && !visited.has(current)) {
        ordered.push(current);
        visited.add(current);
        current = adjacency.get(current)?.find((candidate) => !visited.has(candidate)) || "";
      }
      for (const person of people) if (!visited.has(person.id)) ordered.push(person.id);
      ordered.forEach((id, index) => positions.set(id, { x: index * X_STEP, y: 0 }));
      const evidenceStart = Math.max(0, (ordered.length - evidence.length) * X_STEP / 2);
      evidence.forEach((node, index) => positions.set(node.id, { x: evidenceStart + index * X_STEP, y: Y_STEP }));
    } else {
      const representative = new Map(people.map((person) => [person.id, person.id]));
      const find = (id) => {
        let root = id;
        while (representative.get(root) !== root) root = representative.get(root);
        let cursor = id;
        while (representative.get(cursor) !== root) {
          const next = representative.get(cursor);
          representative.set(cursor, root);
          cursor = next;
        }
        return root;
      };
      const union = (left, right) => {
        const leftRoot = find(left);
        const rightRoot = find(right);
        if (leftRoot === rightRoot) return;
        const [first, second] = [leftRoot, rightRoot].sort((a, b) => a.localeCompare(b));
        representative.set(second, first);
      };
      for (const edge of personEdges) if (edge.relation === "partner") union(edge.from, edge.to);

      const groupsByRoot = new Map();
      for (const person of people) {
        const root = find(person.id);
        if (!groupsByRoot.has(root)) groupsByRoot.set(root, []);
        groupsByRoot.get(root).push(person);
      }
      const groups = [...groupsByRoot.entries()]
        .map(([id, members]) => ({ id, members: members.sort((left, right) => left.id.localeCompare(right.id)) }))
        .sort((left, right) => left.id.localeCompare(right.id));
      const groupForPerson = new Map();
      for (const group of groups) for (const member of group.members) groupForPerson.set(member.id, group.id);

      const directedCandidates = [];
      const candidateKeys = new Set();
      for (const edge of personEdges) {
        if (edge.relation === "partner") continue;
        const from = groupForPerson.get(edge.from);
        const to = groupForPerson.get(edge.to);
        const key = `${from}\u0000${to}`;
        if (from && to && from !== to && !candidateKeys.has(key)) {
          candidateKeys.add(key);
          directedCandidates.push({ from, to });
        }
      }
      directedCandidates.sort((left, right) => left.from.localeCompare(right.from) || left.to.localeCompare(right.to));

      const outgoing = new Map(groups.map((group) => [group.id, []]));
      const incoming = new Map(groups.map((group) => [group.id, []]));
      const reaches = (start, target) => {
        const pending = [start];
        const seen = new Set();
        while (pending.length) {
          const id = pending.pop();
          if (id === target) return true;
          if (seen.has(id)) continue;
          seen.add(id);
          pending.push(...(outgoing.get(id) || []));
        }
        return false;
      };
      for (const edge of directedCandidates) {
        if (reaches(edge.to, edge.from)) continue;
        outgoing.get(edge.from).push(edge.to);
        incoming.get(edge.to).push(edge.from);
      }
      for (const neighbors of [...outgoing.values(), ...incoming.values()]) neighbors.sort((left, right) => left.localeCompare(right));

      const ranks = new Map(groups.map((group) => [group.id, 0]));
      const indegree = new Map(groups.map((group) => [group.id, incoming.get(group.id).length]));
      const ready = groups.filter((group) => indegree.get(group.id) === 0).map((group) => group.id).sort((left, right) => left.localeCompare(right));
      const topological = [];
      while (ready.length) {
        const id = ready.shift();
        topological.push(id);
        for (const child of outgoing.get(id)) {
          ranks.set(child, Math.max(ranks.get(child), ranks.get(id) + 1));
          indegree.set(child, indegree.get(child) - 1);
          if (indegree.get(child) === 0) {
            ready.push(child);
            ready.sort((left, right) => left.localeCompare(right));
          }
        }
      }
      for (const id of [...topological].reverse()) {
        const children = outgoing.get(id);
        if (children.length) {
          const latestParentRank = Math.min(...children.map((child) => ranks.get(child) - 1));
          ranks.set(id, Math.max(ranks.get(id), latestParentRank));
        }
      }

      const weak = new Map(groups.map((group) => [group.id, new Set()]));
      for (const edge of directedCandidates) {
        weak.get(edge.from).add(edge.to);
        weak.get(edge.to).add(edge.from);
      }
      const groupById = new Map(groups.map((group) => [group.id, group]));
      const components = [];
      const assigned = new Set();
      for (const group of groups) {
        if (assigned.has(group.id)) continue;
        const ids = [];
        const pending = [group.id];
        assigned.add(group.id);
        while (pending.length) {
          const id = pending.shift();
          ids.push(id);
          for (const neighbor of [...weak.get(id)].sort((left, right) => left.localeCompare(right))) {
            if (!assigned.has(neighbor)) {
              assigned.add(neighbor);
              pending.push(neighbor);
            }
          }
        }
        components.push(ids.sort((left, right) => left.localeCompare(right)));
      }

      const componentForGroup = new Map();
      components.forEach((component, index) => component.forEach((id) => componentForGroup.set(id, index)));
      const evidenceByComponent = components.map(() => []);
      const unassignedEvidence = [];
      for (const node of evidence) {
        const link = edges.find((edge) => edge.from === node.id || edge.to === node.id);
        const personId = link && personIds.has(link.from) ? link.from : link && personIds.has(link.to) ? link.to : "";
        const component = componentForGroup.get(groupForPerson.get(personId));
        if (component === undefined) unassignedEvidence.push(node);
        else evidenceByComponent[component].push(node);
      }

      let componentOffset = 0;
      components.forEach((component, componentIndex) => {
        const minimumRank = Math.min(...component.map((id) => ranks.get(id)));
        const buckets = new Map();
        for (const id of component) {
          const rank = ranks.get(id) - minimumRank;
          if (!buckets.has(rank)) buckets.set(rank, []);
          buckets.get(rank).push(groupById.get(id));
        }
        const rankNumbers = [...buckets.keys()].sort((left, right) => left - right);
        const order = new Map();
        const updateOrder = () => {
          for (const rank of rankNumbers) buckets.get(rank).forEach((group, index) => order.set(group.id, index));
        };
        const reorder = (rank, neighbors) => {
          buckets.get(rank).sort((left, right) => {
            const score = (group) => {
              const values = neighbors.get(group.id).filter((id) => order.has(id)).map((id) => order.get(id));
              return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : order.get(group.id);
            };
            return score(left) - score(right) || left.id.localeCompare(right.id);
          });
          updateOrder();
        };
        updateOrder();
        for (let pass = 0; pass < 4; pass += 1) {
          for (const rank of rankNumbers.slice(1)) reorder(rank, incoming);
          for (const rank of [...rankNumbers].reverse().slice(1)) reorder(rank, outgoing);
        }

        const widthOfGroup = (group) => CARD_WIDTH + (group.members.length - 1) * X_STEP;
        const widthOfRank = (rank) => {
          const row = buckets.get(rank);
          return row.reduce((width, group) => width + widthOfGroup(group), 0) + Math.max(0, row.length - 1) * COLUMN_GAP;
        };
        const rail = evidenceByComponent[componentIndex];
        rail.sort((left, right) => {
          const anchor = (node) => {
            const link = edges.find((edge) => edge.from === node.id || edge.to === node.id);
            const personId = link && personIds.has(link.from) ? link.from : link?.to;
            return groupForPerson.get(personId) || "";
          };
          return anchor(left).localeCompare(anchor(right)) || left.id.localeCompare(right.id);
        });
        const personWidth = Math.max(...rankNumbers.map(widthOfRank));
        const evidenceWidth = rail.length ? CARD_WIDTH + (rail.length - 1) * X_STEP : 0;
        const componentWidth = Math.max(CARD_WIDTH, personWidth, evidenceWidth);
        const groupCenters = new Map();
        for (const rank of [...rankNumbers].reverse()) {
          const row = buckets.get(rank);
          const childCenters = row.flatMap((group) => outgoing.get(group.id).map((child) => groupCenters.get(child)).filter((center) => center !== undefined));
          const desiredCenter = childCenters.length
            ? childCenters.reduce((sum, center) => sum + center, 0) / childCenters.length
            : componentOffset + componentWidth / 2;
          const rowWidth = widthOfRank(rank);
          const minimumStart = componentOffset;
          const maximumStart = componentOffset + componentWidth - rowWidth;
          let cursor = Math.max(minimumStart, Math.min(maximumStart, desiredCenter - rowWidth / 2));
          for (const group of row) {
            const groupWidth = widthOfGroup(group);
            group.members.forEach((member, index) => {
              positions.set(member.id, { x: cursor + CARD_WIDTH / 2 + index * X_STEP, y: rank * Y_STEP });
            });
            groupCenters.set(group.id, cursor + groupWidth / 2);
            cursor += groupWidth + COLUMN_GAP;
          }
        }
        const evidenceY = (Math.max(...rankNumbers) + 1) * Y_STEP;
        let evidenceX = componentOffset + (componentWidth - evidenceWidth) / 2 + CARD_WIDTH / 2;
        for (const node of rail) {
          positions.set(node.id, { x: evidenceX, y: evidenceY });
          evidenceX += X_STEP;
        }
        componentOffset += componentWidth + COMPONENT_GAP;
      });

      for (const node of unassignedEvidence) {
        positions.set(node.id, { x: componentOffset + CARD_WIDTH / 2, y: 0 });
        componentOffset += X_STEP;
      }
    }

    if (positions.size) {
      const values = [...positions.values()];
      const centerX = (Math.min(...values.map((point) => point.x)) + Math.max(...values.map((point) => point.x))) / 2;
      for (const point of values) point.x -= centerX;
    }
    return positions;
  }

  function renderEdge(edge) {
    const from = state.positions.get(edge.from), to = state.positions.get(edge.to);
    if (!from || !to) return;
    const sideLink = state.mode === "path" || edge.relation === "partner" || edge.relation === "evidence" || edge.relation === "event";
    let d;
    if (sideLink) {
      const direction = to.x >= from.x ? 1 : -1;
      const x1 = from.x + direction * 112, x2 = to.x - direction * 112;
      const bend = Math.max(24, Math.abs(x2 - x1) / 2);
      d = `M ${x1} ${from.y} C ${x1 + direction * bend} ${from.y}, ${x2 - direction * bend} ${to.y}, ${x2} ${to.y}`;
    } else {
      const direction = to.y > from.y ? 1 : -1;
      const y1 = from.y + direction * 48, y2 = to.y - direction * 48;
      const middle = (y1 + y2) / 2;
      d = `M ${from.x} ${y1} C ${from.x} ${middle}, ${to.x} ${middle}, ${to.x} ${y2}`;
    }
    const status = String(edge.status || "accepted").toLocaleLowerCase();
    const group = svg("g", { className: `connection ${edge.relation} ${status}`, attrs: { "data-from": edge.from, "data-to": edge.to } });
    const path = svg("path", { className: "edge", attrs: { d } });
    group.append(path, svg("title", { text: `${label(record(edge.from))} → ${label(record(edge.to))} · ${shortRelation(edge.relation)} · ${status}` }));
    const hit = svg("path", { className: "edge-hit", attrs: { d } });
    hit.addEventListener("click", () => { if (record(edge.id)) select(edge.id); });
    group.append(hit);
    el.edges.append(group);
  }

  function renderNode(node) {
    const position = state.positions.get(node.id);
    if (!position) return;
    const group = svg("g", {
      className: `node${node.kind === "person" ? "" : " evidence"}${state.selected === node.id ? " selected" : ""}`,
      attrs: { transform: `translate(${position.x} ${position.y})`, tabindex: "0", role: "button", "aria-label": `${label(node)}. Open details.`, "data-id": node.id }
    });
    group.append(svg("rect", { className: "node-card", attrs: { x: -112, y: -48, width: 224, height: 96, rx: 14 } }));
    const content = svg("foreignObject", { attrs: { x: -112, y: -48, width: 224, height: 96 } });
    const card = html("div", { className: "person-card" });
    card.append(html("span", { className: "person-avatar", text: node.kind === "person" ? initials(label(node)) : "↗", attrs: { "aria-hidden": "true" } }));
    const copy = html("div", { className: "person-copy" });
    copy.append(html("span", { className: "person-name", text: label(node) }));
    copy.append(html("span", { className: "person-dates", text: node.kind === "person" ? lifeSpan(node) : shortRelation(node.kind) }));
    card.append(copy); content.append(card); group.append(content);
    group.append(svg("title", { text: `${label(node)} · ${lifeSpan(node)}` }));
    group.addEventListener("click", () => select(node.id));
    group.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); select(node.id, true); }
    });
    el.nodes.append(group);
  }

  function truncate(value, length) {
    const characters = [...String(value)];
    return characters.length > length ? `${characters.slice(0, length - 1).join("")}…` : value;
  }

  function lifeSpan(item) {
    const born = item.metadata?.born || item.metadata?.birth || item.metadata?.birth_date || "";
    const died = item.metadata?.died || item.metadata?.death || item.metadata?.death_date || "";
    if (born || died) return `${plainValue(born) || "?"} – ${plainValue(died) || ""}`;
    return "Dates not recorded";
  }

  function plainValue(value) {
    if (value === undefined || value === null) return "";
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
    if (Array.isArray(value)) return value.map(plainValue).join(", ");
    return JSON.stringify(value);
  }

  function select(id, openFamily = false) {
    state.selected = id;
    if (!state.person) state.person = id;
    renderGraphSelection();
    renderDetails();
    if (record(id)?.kind === "person" && openFamily) {
      state.person = id;
      setMode("focus");
    }
  }

  function renderGraphSelection() {
    for (const node of el.nodes.querySelectorAll(".node")) node.classList.remove("selected");
    const index = state.orderedIds.indexOf(state.selected);
    if (index >= 0) el.nodes.children[index]?.classList.add("selected");
    for (const edge of el.edges.children) edge.classList.toggle("highlight", edge.dataset.from === state.selected || edge.dataset.to === state.selected);
  }

  function renderDetails() {
    const item = record(state.selected);
    if (!item) return;
    clear(el.details);
    const header = html("header", { className: "detail-header" });
    header.append(html("span", { className: "eyebrow", text: item.kind || "Record" }));
    header.append(html("h1", { text: label(item) }));
    if (item.kind === "person") header.append(html("p", { className: "detail-lifespan", text: lifeSpan(item) }));
    const aliases = item.metadata?.aliases;
    if (aliases) header.append(html("p", { className: "aliases", text: plainValue(aliases) }));
    const actions = html("div", { className: "detail-actions" });
    if (item.kind === "person") {
      if (state.mode === "overview" && !state.overviewShowAll && state.positions.has(item.id)) {
        const visibleIds = new Set(graphNodes().map((node) => node.id));
        const expanded = state.data.query.edges.some((edge) => edge.from === item.id && edge.relation !== "partner" && visibleIds.has(edge.to));
        const branch = html("button", { className: "primary-button", text: expanded ? "Collapse branch" : "Expand branch", attrs: { type: "button" } });
        branch.addEventListener("click", () => {
          const partners = new Set([item.id]), pending = [item.id];
          while (pending.length) {
            const id = pending.shift();
            for (const edge of state.data.query.edges) {
              if (edge.relation !== "partner") continue;
              const next = edge.from === id ? edge.to : edge.to === id ? edge.from : "";
              if (next && !partners.has(next)) { partners.add(next); pending.push(next); }
            }
          }
          for (const id of partners) {
            if (expanded) { state.overviewExpanded.delete(id); state.overviewCollapsed.add(id); }
            else { state.overviewExpanded.add(id); state.overviewCollapsed.delete(id); }
          }
          renderGraph();
          renderDetails();
        });
        if (state.data.query.edges.some((edge) => edge.from === item.id && edge.relation !== "partner")) actions.append(branch);
      }
      const family = html("button", { className: "primary-button", text: "Open family", attrs: { type: "button" } });
      family.addEventListener("click", () => { state.person = item.id; setMode("focus"); });
      actions.append(family);
    }
    const edit = html("button", { className: "quiet-button", text: "Edit note", attrs: { type: "button" } });
    edit.addEventListener("click", () => openEditor(item));
    actions.append(edit);
    const itemUrl = item.metadata?.url;
    if (item.kind === "source" && typeof itemUrl === "string" && /^https?:\/\//iu.test(itemUrl)) {
      actions.append(html("a", { className: "quiet-button", text: "Open source ↗", attrs: { href: itemUrl, target: "_blank", rel: "noopener noreferrer" } }));
    }
    header.append(actions);
    el.details.append(header);

    if (item.body) section("Story", html("div", { className: "prose", text: item.body.trim() }));
    renderFacts(item);
    renderRelations(item);
    renderEvents(item);
    renderEvidence(item);
    renderAttachments(item);
  }

  function section(title, content) {
    const wrapper = html("section", { className: "detail-section" });
    wrapper.append(html("h2", { text: title }), content);
    el.details.append(wrapper);
  }

  function renderFacts(item) {
    const omitted = new Set(["version", "id", "type", "name", "aliases", "attachments", "media", "sources", "from", "to", "parent", "child"]);
    const facts = Object.entries(item.metadata || {}).filter(([key, value]) => !omitted.has(key) && plainValue(value));
    if (!facts.length) return;
    const list = html("dl", { className: "facts" });
    for (const [key, value] of facts) {
      list.append(html("dt", { text: shortRelation(key) }), html("dd", { text: plainValue(value) }));
    }
    section("Facts", list);
  }

  function renderRelations(item) {
    const relations = (state.data?.query.edges || []).filter((edge) => edge.from === item.id || edge.to === item.id);
    if (!relations.length) return;
    const list = html("div");
    for (const edge of relations) {
      const otherId = edge.from === item.id ? edge.to : edge.from;
      const other = record(otherId);
      const button = html("button", { className: "relation-card", attrs: { type: "button" } });
      const row = html("span", { className: "card-row" });
      row.append(html("strong", { text: label(other) }), html("span", { className: `tag ${edge.status || ""}`, text: edge.status || "accepted" }));
      button.append(row, html("small", { text: shortRelation(edge.relation) }));
      button.addEventListener("click", () => select(otherId));
      list.append(button);
    }
    section("Relationships", list);
  }

  function renderEvents(item) {
    const events = eventsForPerson(item.id);
    if (!events.length) return;
    const list = html("div");
    for (const event of events) {
      const card = html("button", { className: "event-card", attrs: { type: "button" } });
      card.append(html("strong", { text: label(event) }), html("small", { text: plainValue(event.metadata?.date || event.metadata?.when || event.id) }));
      card.addEventListener("click", () => select(event.id));
      list.append(card);
    }
    section("Events", list);
  }

  function renderEvidence(item) {
    const relatedEdges = (state.data?.query.edges || []).filter((edge) => edge.from === item.id || edge.to === item.id);
    const sourceIds = new Set(relatedEdges.flatMap((edge) => edge.sources || []));
    for (const source of linkedIds(item, "sources")) sourceIds.add(source);
    const sources = [...sourceIds].map(record).filter(Boolean);
    if (!sources.length) return;
    const list = html("div");
    for (const source of sources) {
      const card = html("button", { className: "evidence-card", attrs: { type: "button" } });
      card.append(html("strong", { text: label(source) }));
      if (source.body) card.append(html("small", { text: truncate(source.body.trim(), 180) }));
      const sourceUrl = source.metadata?.url;
      if (typeof sourceUrl === "string" && /^https?:\/\//iu.test(sourceUrl)) {
        card.append(html("small", { text: `Source URL: ${sourceUrl}` }));
      }
      card.addEventListener("click", () => select(source.id));
      list.append(card);
    }
    section("Evidence", list);
  }

  function renderAttachments(item) {
    const direct = state.data.attachments.filter((attachment) => attachment.record === item.id);
    const edgeSources = new Set((state.data.query.edges || []).filter((edge) => edge.from === item.id || edge.to === item.id).flatMap((edge) => edge.sources || []));
    for (const source of linkedIds(item, "sources")) edgeSources.add(source);
    const related = state.data.attachments.filter((attachment) => edgeSources.has(attachment.record));
    const attachments = [...direct, ...related].filter((attachment, index, all) => all.findIndex((other) => other.path === attachment.path) === index);
    if (!attachments.length) return;
    const list = html("div");
    for (const attachment of attachments) {
      const link = html("a", { className: "attachment-link", text: `↗ ${attachment.label || attachment.path}`, attrs: { href: `/api/attachment?path=${encodeURIComponent(attachment.path)}`, target: "_blank", rel: "noopener" } });
      list.append(link);
    }
    section("Attachments", list);
  }

  function setMode(mode) {
    // A family opens with immediate relatives; ancestry queries start deeper.
    if (mode === "focus" && state.mode !== "focus") el.generations.value = "1";
    if ((mode === "ancestors" || mode === "descendants") && state.mode === "focus") el.generations.value = "4";
    state.mode = mode;
    for (const button of document.querySelectorAll("[data-mode]")) button.setAttribute("aria-pressed", String(button.dataset.mode === mode));
    el.path_picker.hidden = mode !== "path";
    el.overview_toggle.hidden = mode !== "overview";
    if (mode === "path" && !state.to) {
      el.graph_status.textContent = "Choose the second person above";
      return;
    }
    loadGraph();
  }

  function openEditor(item) {
    state.editorOriginal = item.raw;
    el.editor_title.textContent = `Edit ${label(item)}`;
    el.editor_text.value = item.raw;
    el.editor_text.dataset.id = item.id;
    el.editor_message.textContent = "";
    el.save_button.disabled = false;
    el.editor.showModal();
    el.editor_text.focus();
  }

  async function saveEditor() {
    const replacement = el.editor_text.value;
    if (replacement === state.editorOriginal) {
      el.editor.close();
      return;
    }
    el.save_button.disabled = true;
    el.editor_message.textContent = "Saving…";
    try {
      const response = await fetch("/api/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: el.editor_text.dataset.id, expected: state.editorOriginal, replacement })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `Save failed (${response.status})`);
      state.editorOriginal = replacement;
      el.editor.close();
      await loadGraph();
    } catch (error) {
      el.editor_message.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      el.save_button.disabled = false;
    }
  }

  function updateSearch() {
    const term = el.search.value.trim().toLocaleLowerCase();
    clear(el.search_results);
    if (!term) {
      el.search_results.hidden = true;
      return;
    }
    const matches = people().filter((person) => `${label(person)} ${plainValue(person.metadata?.aliases)} ${person.id}`.toLocaleLowerCase().includes(term)).slice(0, 12);
    for (const person of matches) {
      const button = html("button", { attrs: { type: "button" } });
      button.append(html("strong", { text: label(person) }), html("small", { text: lifeSpan(person) }));
      button.addEventListener("click", () => {
        state.person = person.id;
        state.selected = person.id;
        el.search.value = "";
        el.search_results.hidden = true;
        setMode("focus");
      });
      el.search_results.append(button);
    }
    if (!matches.length) el.search_results.append(html("p", { text: "No matching people" }));
    el.search_results.hidden = false;
  }

  function fitGraph() {
    if (!state.positions.size) return;
    const points = [...state.positions.values()];
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const minX = Math.min(...xs) - 148;
    const maxX = Math.max(...xs) + 148;
    const minY = Math.min(...ys) - 70;
    const maxY = Math.max(...ys) + 70;
    const bounds = el.graph.getBoundingClientRect();
    state.scale = Math.min(1.15, Math.max(.08, Math.min(bounds.width / Math.max(1, maxX - minX), bounds.height / Math.max(1, maxY - minY)) * .9));
    state.tx = bounds.width / 2 - ((minX + maxX) / 2) * state.scale;
    state.ty = bounds.height / 2 - ((minY + maxY) / 2) * state.scale;
    applyTransform();
  }

  function applyTransform() {
    el.zoom_level.textContent = `${Math.round(state.scale * 100)}%`;
    el.viewport.setAttribute("transform", `translate(${state.tx} ${state.ty}) scale(${state.scale})`);
  }

  document.querySelectorAll("[data-mode]").forEach((button) => button.addEventListener("click", () => setMode(button.dataset.mode)));
  el.generations.addEventListener("change", () => loadGraph());
  el.relation_filter.addEventListener("change", () => loadGraph());
  el.status_filter.addEventListener("change", () => loadGraph());
  el.show_evidence.addEventListener("change", renderGraph);
  el.overview_toggle.addEventListener("click", () => {
    state.overviewShowAll = !state.overviewShowAll;
    if (!state.overviewShowAll) { state.overviewExpanded.clear(); state.overviewCollapsed.clear(); }
    el.overview_toggle.textContent = state.overviewShowAll ? "Collapse all" : "Show all";
    renderGraph();
    renderDetails();
  });
  el.path_to.addEventListener("change", () => { state.to = el.path_to.value; if (state.to) loadGraph(); });
  el.fit_button.addEventListener("click", fitGraph);
  function zoomBy(factor) {
    const bounds = el.graph.getBoundingClientRect();
    const previous = state.scale;
    state.scale = Math.min(2.5, Math.max(.08, previous * factor));
    state.tx = bounds.width / 2 - (bounds.width / 2 - state.tx) * state.scale / previous;
    state.ty = bounds.height / 2 - (bounds.height / 2 - state.ty) * state.scale / previous;
    applyTransform();
  }
  el.zoom_in.addEventListener("click", () => zoomBy(1.25));
  el.zoom_out.addEventListener("click", () => zoomBy(.8));
  el.search.addEventListener("input", updateSearch);
  el.search.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { el.search.value = ""; el.search_results.hidden = true; el.search.blur(); }
    if (event.key === "Enter") el.search_results.querySelector("button")?.click();
  });
  el.save_button.addEventListener("click", saveEditor);
  el.help_button.addEventListener("click", () => {
    el.shortcuts.hidden = !el.shortcuts.hidden;
    el.help_button.setAttribute("aria-expanded", String(!el.shortcuts.hidden));
  });

  el.graph.addEventListener("wheel", (event) => {
    event.preventDefault();
    const bounds = el.graph.getBoundingClientRect();
    const mouseX = event.clientX - bounds.left;
    const mouseY = event.clientY - bounds.top;
    const previous = state.scale;
    state.scale = Math.min(2.5, Math.max(.08, state.scale * (event.deltaY > 0 ? .9 : 1.1)));
    state.tx = mouseX - (mouseX - state.tx) * (state.scale / previous);
    state.ty = mouseY - (mouseY - state.ty) * (state.scale / previous);
    applyTransform();
  }, { passive: false });
  el.graph.addEventListener("pointerdown", (event) => {
    if (event.target.closest?.(".node")) return;
    state.drag = { x: event.clientX, y: event.clientY, tx: state.tx, ty: state.ty };
    el.graph.setPointerCapture(event.pointerId);
  });
  el.graph.addEventListener("pointermove", (event) => {
    if (!state.drag) return;
    state.tx = state.drag.tx + event.clientX - state.drag.x;
    state.ty = state.drag.ty + event.clientY - state.drag.y;
    applyTransform();
  });
  el.graph.addEventListener("pointerup", () => { state.drag = null; });
  el.graph.addEventListener("pointercancel", () => { state.drag = null; });

  document.addEventListener("keydown", (event) => {
    if (event.key === "/" && !/input|textarea|select/i.test(document.activeElement?.tagName || "")) {
      event.preventDefault(); el.search.focus();
    }
    if (el.editor.open) return;
    // Preserve native caret movement, number editing, and names containing +/-.
    if (/input|textarea|select/i.test(document.activeElement?.tagName || "") || document.activeElement?.isContentEditable) return;
    if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && state.orderedIds.length) {
      event.preventDefault();
      const current = Math.max(0, state.orderedIds.indexOf(state.selected));
      const delta = event.key === "ArrowRight" ? 1 : -1;
      const next = (current + delta + state.orderedIds.length) % state.orderedIds.length;
      select(state.orderedIds[next]);
      el.nodes.children[next]?.focus();
    }
    if (event.key === "Enter" && state.selected && document.activeElement === document.body) {
      state.person = state.selected; setMode("focus");
    }
    if (event.key === "+" || event.key === "=") changeDepth(1);
    if (event.key === "-" || event.key === "_") changeDepth(-1);
    if (event.key === "Escape") { el.shortcuts.hidden = true; el.search_results.hidden = true; }
  });

  function changeDepth(delta) {
    const current = Number.parseInt(el.generations.value, 10) || 1;
    el.generations.value = String(Math.max(1, Math.min(64, current + delta)));
    loadGraph();
  }

  window.addEventListener("resize", fitGraph);
  loadGraph({ keepSelection: false });
})();
