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
    overviewShowAll: false
  };

  const el = Object.fromEntries([
    "search", "search-results", "generations", "relation-filter", "status-filter", "show-evidence", "overview-toggle", "fit-button",
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
    const sourceIds = new Set((state.data?.query.edges || []).flatMap((edge) => edge.sources || []));
    for (const person of persons) for (const source of linkedIds(person, "sources")) sourceIds.add(source);
    const evidence = state.data.records.filter((item) => sourceIds.has(item.id) || (item.kind === "event" && linkedIds(item, "people").some((id) => personIds.has(id))));
    return [...persons, ...evidence.filter((item, index, all) => all.findIndex((other) => other.id === item.id) === index)];
  }

  function collapsedOverview(persons) {
    const personIds = new Set(persons.map((person) => person.id));
    const claims = (state.data?.query.edges || []).filter((edge) => personIds.has(edge.from) && personIds.has(edge.to));
    const children = new Set(claims.filter((edge) => edge.relation !== "partner").map((edge) => edge.to));
    const roots = persons.filter((person) => !children.has(person.id));
    const visible = new Set((roots.length ? roots : persons.slice(0, 1)).map((person) => person.id));
    const queue = [...visible];
    while (queue.length) {
      const id = queue.shift();
      if (!state.overviewExpanded.has(id)) continue;
      for (const edge of claims) {
        const next = edge.from === id ? edge.to : edge.to === id ? edge.from : "";
        if (next && !visible.has(next)) {
          visible.add(next);
          queue.push(next);
        }
      }
    }
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
    const nodes = graphNodes();
    const edges = graphEdges(nodes);
    state.positions = layout(nodes, edges);
    state.orderedIds = nodes.map((node) => node.id);
    clear(el.nodes);
    clear(el.edges);

    for (const edge of edges) renderEdge(edge);
    for (const node of nodes) renderNode(node);

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
    el.graph_status.textContent = `${peopleText}${evidenceText} · ${claimsText} · reloaded just now`;
    requestAnimationFrame(fitGraph);
  }

  function layout(nodes, edges) {
    const positions = new Map();
    if (!nodes.length) return positions;
    if (state.mode === "overview") {
      const columns = Math.max(1, Math.ceil(Math.sqrt(nodes.length * 1.6)));
      [...nodes].sort((a, b) => label(a).localeCompare(label(b))).forEach((node, index) => {
        const column = index % columns;
        const row = Math.floor(index / columns);
        positions.set(node.id, { x: column * 190, y: row * 105 + (column % 2) * 24 });
      });
      return positions;
    }

    const start = state.person || nodes[0].id;
    const levels = new Map([[start, 0]]);
    const queue = [start];
    while (queue.length) {
      const id = queue.shift();
      const current = levels.get(id) || 0;
      for (const edge of edges) {
        let next = "";
        if (edge.relation === "evidence" || edge.relation === "event") next = edge.from === id ? edge.to : edge.to === id ? edge.from : "";
        else if (state.mode === "ancestors" && edge.to === id) next = edge.from;
        else if (state.mode === "descendants" && edge.from === id) next = edge.to;
        else if (state.mode === "path" || state.mode === "focus") next = edge.from === id ? edge.to : edge.to === id ? edge.from : "";
        if (next && !levels.has(next)) {
          levels.set(next, current + 1);
          queue.push(next);
        }
      }
    }
    let orphanLevel = Math.max(0, ...levels.values()) + 1;
    for (const node of nodes) {
      if (!levels.has(node.id)) levels.set(node.id, orphanLevel++);
    }
    const buckets = new Map();
    for (const node of nodes) {
      const level = levels.get(node.id) || 0;
      if (!buckets.has(level)) buckets.set(level, []);
      buckets.get(level).push(node);
    }
    for (const [level, bucket] of buckets) {
      bucket.sort((a, b) => label(a).localeCompare(label(b)));
      bucket.forEach((node, index) => {
        if (state.mode === "path") positions.set(node.id, { x: level * 220, y: 0 });
        else {
          const vertical = (index - (bucket.length - 1) / 2) * 112;
          const horizontal = state.mode === "ancestors" ? -level * 220 : level * 220;
          positions.set(node.id, { x: horizontal, y: vertical });
        }
      });
    }
    return positions;
  }

  function renderEdge(edge) {
    const from = state.positions.get(edge.from);
    const to = state.positions.get(edge.to);
    if (!from || !to) return;
    const x1 = from.x + 73;
    const y1 = from.y;
    const x2 = to.x - 73;
    const y2 = to.y;
    const bend = Math.max(35, Math.abs(x2 - x1) * .45);
    const status = String(edge.status || "accepted").toLocaleLowerCase();
    const path = svg("path", {
      className: `edge ${status === "accepted" ? "" : status}`,
      attrs: { d: `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`, "marker-end": "url(#arrow)" }
    });
    const title = svg("title", { text: `${shortRelation(edge.relation)} · ${status}` });
    path.append(title);
    el.edges.append(path);
    if (state.mode !== "overview" && state.data.query.edges.length < 18) {
      el.edges.append(svg("text", {
        className: "edge-label",
        text: shortRelation(edge.relation),
        attrs: { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 - 7, "text-anchor": "middle" }
      }));
    }
  }

  function renderNode(node) {
    const position = state.positions.get(node.id);
    if (!position) return;
    const group = svg("g", {
      className: `node${node.kind === "person" ? "" : " evidence"}${state.selected === node.id ? " selected" : ""}`,
      attrs: { transform: `translate(${position.x} ${position.y})`, tabindex: "0", role: "button", "aria-label": `${label(node)}. Open details.` }
    });
    group.append(svg("rect", { className: "node-card", attrs: { x: -78, y: -32, width: 156, height: 64, rx: 12 } }));
    group.append(svg("circle", { className: "node-avatar", attrs: { cx: -50, cy: 0, r: 20 } }));
    group.append(svg("text", { className: "node-initials", text: initials(label(node)), attrs: { x: -50, y: 1 } }));
    group.append(svg("text", { className: "node-name", text: truncate(label(node), 17), attrs: { x: -23, y: -3 } }));
    group.append(svg("text", { className: "node-meta", text: node.kind === "person" ? lifeSpan(node) : shortRelation(node.kind), attrs: { x: -23, y: 14 } }));
    group.append(svg("title", { text: label(node) }));
    group.addEventListener("click", () => select(node.id));
    group.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        select(node.id, true);
      }
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
    return item.id;
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
  }

  function renderDetails() {
    const item = record(state.selected);
    if (!item) return;
    clear(el.details);
    const header = html("header", { className: "detail-header" });
    header.append(html("span", { className: "eyebrow", text: item.kind || "Record" }));
    header.append(html("h1", { text: label(item) }));
    const aliases = item.metadata?.aliases;
    if (aliases) header.append(html("p", { className: "aliases", text: plainValue(aliases) }));
    const actions = html("div", { className: "detail-actions" });
    if (item.kind === "person") {
      if (state.mode === "overview" && !state.overviewShowAll) {
        const expanded = state.overviewExpanded.has(item.id);
        const branch = html("button", { className: "primary-button", text: expanded ? "Collapse branch" : "Expand branch", attrs: { type: "button" } });
        branch.addEventListener("click", () => {
          if (expanded) state.overviewExpanded.delete(item.id);
          else state.overviewExpanded.add(item.id);
          renderGraph();
          renderDetails();
        });
        actions.append(branch);
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
    const omitted = new Set(["id", "type", "name", "aliases", "attachments", "media", "sources", "from", "to", "parent", "child"]);
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
    const minX = Math.min(...xs) - 105;
    const maxX = Math.max(...xs) + 105;
    const minY = Math.min(...ys) - 70;
    const maxY = Math.max(...ys) + 70;
    const bounds = el.graph.getBoundingClientRect();
    state.scale = Math.min(1.15, Math.max(.25, Math.min(bounds.width / Math.max(1, maxX - minX), bounds.height / Math.max(1, maxY - minY)) * .9));
    state.tx = bounds.width / 2 - ((minX + maxX) / 2) * state.scale;
    state.ty = bounds.height / 2 - ((minY + maxY) / 2) * state.scale;
    applyTransform();
  }

  function applyTransform() {
    el.viewport.setAttribute("transform", `translate(${state.tx} ${state.ty}) scale(${state.scale})`);
  }

  document.querySelectorAll("[data-mode]").forEach((button) => button.addEventListener("click", () => setMode(button.dataset.mode)));
  el.generations.addEventListener("change", () => loadGraph());
  el.relation_filter.addEventListener("change", () => loadGraph());
  el.status_filter.addEventListener("change", () => loadGraph());
  el.show_evidence.addEventListener("change", renderGraph);
  el.overview_toggle.addEventListener("click", () => {
    state.overviewShowAll = !state.overviewShowAll;
    if (!state.overviewShowAll) state.overviewExpanded.clear();
    el.overview_toggle.textContent = state.overviewShowAll ? "Collapse all" : "Show all";
    renderGraph();
    renderDetails();
  });
  el.path_to.addEventListener("change", () => { state.to = el.path_to.value; if (state.to) loadGraph(); });
  el.fit_button.addEventListener("click", fitGraph);
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
    state.scale = Math.min(2.5, Math.max(.2, state.scale * (event.deltaY > 0 ? .9 : 1.1)));
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
