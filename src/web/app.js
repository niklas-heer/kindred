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
    overviewShowAll: false,
    overviewRoot: null,
    layoutRoot: ""
  };

  const el = Object.fromEntries([
    "arrangement-caption", "layout-order", "selection-summary", "selection-key", "branch-picker", "branch-root", "direction-label", "zoom-in", "zoom-out", "zoom-level", "search", "search-results", "generations", "relation-filter", "status-filter", "show-evidence", "overview-toggle", "fit-button",
    "diagnostics", "path-picker", "path-from", "path-to", "graph", "viewport",
    "edges", "nodes", "empty-state", "graph-status", "details", "editor",
    "editor-title", "editor-text", "editor-message", "save-button", "help-button", "shortcuts"
  ].map((id) => [id.replaceAll("-", "_"), document.getElementById(id)]));

  const svgNs = "http://www.w3.org/2000/svg";
  const CARD_WIDTH = 248;
  const CARD_HEIGHT = 144;

  function icon(name) {
    const image = svg("svg", { className: "icon", attrs: { viewBox: "0 0 24 24", width: 18, height: 18, "aria-hidden": "true", focusable: "false" } });
    image.append(svg("use", { attrs: { href: `/icons.svg#${name}` } }));
    return image;
  }

  function parentRole(edge) {
    const role = record(edge.id)?.metadata?.parent_role;
    return ["mother", "father"].includes(role) ? role : "parent";
  }

  function roleIcon(role) { return role === "mother" ? "venus" : role === "father" ? "mars" : "users-round"; }

  function roleBadge(role, status = "accepted") {
    const badge = html("span", { className: `parent-role ${role} ${status}` });
    badge.append(icon(roleIcon(role)), document.createTextNode(shortRelation(role)));
    return badge;
  }

  function portraitFor(item) {
    const direct = item.metadata?.portrait;
    const mediaId = item.kind === "media" ? item.id : linkedIds(item, "portrait")[0];
    const media = record(mediaId);
    const attachment = state.data.attachments.find((candidate) =>
      (media ? candidate.record === media.id : candidate.path === direct) && /\.(?:jpe?g|png|webp|gif)$/iu.test(candidate.path));
    if (!attachment) return null;
    return {
      media,
      url: `/api/attachment?path=${encodeURIComponent(attachment.path)}`,
      caption: media?.metadata?.caption || item.metadata?.portrait_caption || `Portrait of ${label(item)}`,
      credit: media
        ? [media.metadata?.credit || media.metadata?.artist, media.metadata?.date, media.metadata?.license].filter(Boolean).map(plainValue).join(" · ")
        : [item.metadata?.portrait_credit, item.metadata?.portrait_license].filter(Boolean).map(plainValue).join(" · "),
      source: media?.metadata?.url || item.metadata?.portrait_source
    };
  }

  function portraitFigure(item) {
    const portrait = portraitFor(item);
    if (!portrait) return null;
    const figure = html("figure", { className: "portrait-figure" });
    const imageLink = html("a", { attrs: { href: portrait.url, target: "_blank", rel: "noopener", "aria-label": `Open portrait of ${label(item)}` } });
    const photo = html("img", { attrs: { src: portrait.url, alt: portrait.caption, decoding: "async" } });
    photo.addEventListener("error", () => { figure.hidden = true; });
    imageLink.append(photo);
    const caption = html("figcaption", { text: portrait.credit || portrait.caption });
    if (portrait.media) {
      const details = html("button", { className: "portrait-credit", text: "Image source & credits", attrs: { type: "button" } });
      details.addEventListener("click", () => select(portrait.media.id));
      caption.append(details);
    } else {
      const source = typeof portrait.source === "string" ? portrait.source : portrait.source?.url;
      if (typeof source === "string" && /^https?:\/\//iu.test(source)) caption.append(html("a", { className: "portrait-credit", text: "Image source & credits ↗", attrs: { href: source, target: "_blank", rel: "noopener noreferrer" } }));
    }
    figure.append(imageLink, caption);
    return figure;
  }

  function dateValue(item, kind) {
    return plainValue(kind === "born"
      ? item.metadata?.born || item.metadata?.birth || item.metadata?.birth_date
      : item.metadata?.died || item.metadata?.death || item.metadata?.death_date);
  }

  function dateFact(item, kind) {
    const label = kind === "born" ? "Born" : "Died";
    const value = dateValue(item, kind) || "Not recorded";
    const fact = html("span", { className: "date-fact", attrs: { title: `${label}: ${value}` } });
    fact.append(icon(kind === "born" ? "baby" : "flower-2"));
    const copy = html("span");
    copy.append(html("small", { text: label }), html("span", { text: value }));
    fact.append(copy);
    return fact;
  }

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
      if (item.owner && typeof value === "string" && record(value)) { ids.push(value); continue; }
      if (field === "sources" || field === "portrait_source") {
        const id = typeof value === "object" && value ? value.id : null;
        const url = typeof value === "string" ? value : value?.url;
        const candidates = state.data.records.filter((candidate) => candidate.kind === "source" &&
          (id ? candidate.id === id : url && candidate.metadata?.url === url));
        if (candidates.length) { ids.push(...candidates.map((candidate) => candidate.id)); continue; }
      }
      if (typeof value !== "string") continue;
      const match = /^\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]$/u.exec(value.trim());
      if (!match) continue;
      const target = match[1];
      const candidates = state.data.records.filter((candidate) => {
        if (candidate.owner || !candidate.path) return false;
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
    if (state.mode === "overview") {
      const childCount = (id) => new Set(state.data.query.edges.filter((edge) => edge.from === id && edge.relation !== "partner").map((edge) => edge.to)).size;
      const branches = sorted.filter((person) => childCount(person.id) > 0).sort((a, b) => childCount(b.id) - childCount(a.id) || label(a).localeCompare(label(b)));
      if (state.overviewRoot === null) state.overviewRoot = branches[0]?.id || "";
      if (state.overviewRoot && !branches.some((person) => person.id === state.overviewRoot)) state.overviewRoot = "";
      clear(el.branch_root);
      el.branch_root.append(html("option", { text: "All family roots", attrs: { value: "" } }));
      for (const person of branches) el.branch_root.append(html("option", { text: `${label(person)} · ${childCount(person.id)} children`, attrs: { value: person.id } }));
      el.branch_root.value = state.overviewRoot;
      if (!state.selected && state.overviewRoot) state.selected = state.overviewRoot;
    }
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
      if (state.overviewRoot && !component.includes(state.overviewRoot)) continue;
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
      const root = state.overviewRoot || (roots.length ? roots : component).sort((a, b) => reach(b) - reach(a) || a.localeCompare(b))[0];
      const pending = [[root, 0]], seen = new Set();
      while (pending.length) {
        const [id, depth] = pending.shift();
        if (seen.has(id)) continue;
        seen.add(id); visible.add(id);
        for (const edge of claims) {
          if (edge.relation === "partner" && (edge.from === id || edge.to === id)) {
            pending.push([edge.from === id ? edge.to : edge.from, depth]);
          } else if (edge.from === id && (!state.overviewCollapsed.has(id) && (depth < (Number.parseInt(el.generations.value, 10) || 2) || state.overviewExpanded.has(id)))) {
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
    const layoutRoot = state.layoutRoot || (state.mode === "overview" ? state.overviewRoot : state.person) || state.selected;
    el.arrangement_caption.textContent = state.mode === "path" ? "Connection path" : el.layout_order.value === "sides"
      ? `Arranged around ${label(record(layoutRoot))} · Mother’s side left · Father’s side right`
      : "Compact family groups · Parents above children";
    state.positions = KindredLayout.layout(nodes, edges, { mode: state.mode, root: layoutRoot, sideOrdering: el.layout_order.value === "sides", roleForEdge: parentRole, cardWidth: CARD_WIDTH, cardHeight: CARD_HEIGHT });
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

  function renderEdge(edge) {
    const from = state.positions.get(edge.from), to = state.positions.get(edge.to);
    if (!from || !to) return;
    const sideLink = state.mode === "path" || edge.relation === "partner" || edge.relation === "evidence" || edge.relation === "event";
    let d;
    if (edge.relation === "partner" && state.mode !== "path" && Math.abs(to.x - from.x) > CARD_WIDTH + 40) {
      const y = Math.max(from.y, to.y) + CARD_HEIGHT / 2 + 20;
      d = `M ${from.x} ${from.y + CARD_HEIGHT / 2} V ${y} H ${to.x} V ${to.y + CARD_HEIGHT / 2}`;
    } else if (sideLink) {
      const direction = to.x >= from.x ? 1 : -1;
      const x1 = from.x + direction * CARD_WIDTH / 2, x2 = to.x - direction * CARD_WIDTH / 2;
      const bend = Math.max(24, Math.abs(x2 - x1) / 2);
      d = `M ${x1} ${from.y} C ${x1 + direction * bend} ${from.y}, ${x2 - direction * bend} ${to.y}, ${x2} ${to.y}`;
    } else {
      const direction = to.y > from.y ? 1 : -1;
      const y1 = from.y + direction * CARD_HEIGHT / 2, y2 = to.y - direction * CARD_HEIGHT / 2;
      const middle = y1 + (y2 - y1) * (parentRole(edge) === "mother" ? .36 : parentRole(edge) === "father" ? .64 : .5);
      const dx = Math.sign(to.x - from.x), radius = Math.min(10, Math.abs(to.x - from.x) / 2, Math.abs(middle - y1) / 2, Math.abs(y2 - middle) / 2);
      d = `M ${from.x} ${y1} V ${middle - direction * radius} Q ${from.x} ${middle} ${from.x + dx * radius} ${middle} H ${to.x - dx * radius} Q ${to.x} ${middle} ${to.x} ${middle + direction * radius} V ${y2}`;
    }
    const status = String(edge.status || "accepted").toLocaleLowerCase();
    const group = svg("g", { className: `connection ${edge.relation} ${status}`, attrs: { "data-id": edge.id, "data-from": edge.from, "data-to": edge.to } });
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
    const frame = { x: -CARD_WIDTH / 2, y: -CARD_HEIGHT / 2, width: CARD_WIDTH, height: CARD_HEIGHT };
    group.append(svg("rect", { className: "node-card", attrs: { ...frame, rx: 14 } }));
    const content = svg("foreignObject", { attrs: frame });
    const card = html("div", { className: "person-card" });
    const head = html("div", { className: "person-head" });
    const roles = [...new Set(state.data.query.edges.filter((edge) => edge.from === node.id && edge.relation !== "partner").map(parentRole))];
    const role = roles.length === 1 ? roles[0] : "parent";
    const avatar = html("span", { className: "person-avatar", attrs: { "aria-hidden": "true" } });
    avatar.textContent = node.kind === "person" ? initials(label(node)) : "";
    if (node.kind !== "person") avatar.append(icon("book-open"));
    const portrait = portraitFor(node);
    if (portrait) {
      const photo = html("img", { attrs: { src: portrait.url, alt: "", decoding: "async" } });
      photo.addEventListener("error", () => { avatar.textContent = initials(label(node)); });
      avatar.replaceChildren(photo);
    }
    const copy = html("div", { className: "person-copy" });
    copy.append(html("span", { className: "person-name", text: label(node) }));
    const description = html("span", { className: "person-description" });
    if (node.kind === "person" && roles.length) description.append(roleBadge(role));
    else description.append(html("span", { className: "record-kind", text: shortRelation(node.kind) }));
    copy.append(description); head.append(avatar, copy); card.append(head);
    const occupation = plainValue(node.metadata?.occupation);
    const job = html("div", { className: "person-occupation", attrs: { title: occupation } });
    if (occupation) job.append(icon("briefcase-business"), html("span", { text: occupation }));
    else if (node.kind !== "person") job.textContent = "Evidence & research";
    card.append(job);
    const dates = html("div", { className: "person-dates" });
    if (node.kind === "person") dates.append(dateFact(node, "born"), dateFact(node, "died"));
    else dates.append(html("span", { text: "Open to read the source" }));
    card.append(dates); content.append(card); group.append(content);
    group.append(svg("title", { text: `${label(node)} · ${lifeSpan(node)}${occupation ? ` · ${occupation}` : ""}` }));
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

  const familyLabels = { selected: "Selected person", maternal: "Mother’s side", paternal: "Father’s side", both: "Both sides", ancestor: "Ancestor · role unspecified", descendant: "Descendant", partner: "Partner", relative: "Other relative", connection: "Connection path" };

  function renderGraphSelection() {
    const visible = graphNodes();
    const visibleEdges = graphEdges(visible);
    const selected = record(state.selected);
    const focus = selected?.kind === "person" ? selected.id : selected?.owner || "";
    const family = KindredFamily.analyze(focus, visibleEdges.filter((edge) => !["evidence", "event"].includes(edge.relation)), parentRole);
    if (state.mode === "path" && focus) {
      for (const person of visible.filter((node) => node.kind === "person")) if (!family.people.has(person.id)) family.people.set(person.id, "connection");
      for (const edge of visibleEdges) if (!["evidence", "event"].includes(edge.relation) && !family.edges.has(edge.id)) family.edges.set(edge.id, "connection");
    }
    const active = Boolean(focus && family.people.size);
    for (const node of el.nodes.children) {
      const id = node.dataset.id;
      const category = family.people.get(id);
      node.classList.toggle("selected", id === state.selected);
      node.classList.toggle("family-muted", active && !category && record(id)?.kind === "person");
      node.dataset.family = category || "";
      node.setAttribute("aria-label", `${label(record(id))}${category ? ` · ${familyLabels[category]}` : ""}. Open details.`);
      node.setAttribute("aria-pressed", String(id === state.selected));
    }
    for (const edge of el.edges.children) {
      const category = family.edges.get(edge.dataset.id);
      const selectedClaim = edge.dataset.id === state.selected;
      edge.classList.toggle("highlight", Boolean(category) || selectedClaim);
      edge.classList.toggle("family-muted", active && !category && !selectedClaim);
      edge.dataset.family = category || "";
    }
    clear(el.selection_summary);
    clear(el.selection_key);
    if (active) {
      el.selection_summary.textContent = `Connections of ${label(record(focus))} · in this view`;
      const counts = new Map();
      for (const [id, category] of family.people) if (id !== focus) counts.set(category, (counts.get(category) || 0) + 1);
      for (const category of Object.keys(familyLabels)) {
        const count = counts.get(category);
        if (!count) continue;
        const item = html("span", { className: `family-key ${category}`, text: `${familyLabels[category]} ${count}` });
        el.selection_key.append(item);
      }
    } else {
      el.selection_summary.textContent = "Select a person to trace their family";
    }
  }

  function renderDetails() {
    const item = record(state.selected);
    if (!item) return;
    clear(el.details);
    const header = html("header", { className: "detail-header" });
    header.append(html("span", { className: "eyebrow", text: item.kind || "Record" }));
    header.append(html("h1", { text: label(item) }));
    const portrait = portraitFigure(item);
    if (portrait) header.append(portrait);
    if (item.kind === "person") {
      const dates = html("div", { className: "detail-dates" });
      dates.append(dateFact(item, "born"), dateFact(item, "died"));
      header.append(dates);
      const job = plainValue(item.metadata?.occupation);
      if (job) { const occupation = html("p", { className: "detail-occupation" }); occupation.append(icon("briefcase-business"), document.createTextNode(job)); header.append(occupation); }
    }
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
      const arrange = html("button", { className: "quiet-button", text: "Arrange family sides", attrs: { type: "button" } });
      arrange.addEventListener("click", () => { state.layoutRoot = item.id; el.layout_order.value = "sides"; renderGraph(); });
      actions.append(arrange);
    }
    const edit = html("button", { className: "quiet-button", text: item.owner ? "Edit person note" : "Edit note", attrs: { type: "button" } });
    edit.addEventListener("click", () => openEditor(item));
    actions.append(edit);
    const itemUrl = item.metadata?.url;
    if (item.kind === "source" && typeof itemUrl === "string" && /^https?:\/\//iu.test(itemUrl)) {
      actions.append(html("a", { className: "quiet-button", text: "Open source ↗", attrs: { href: itemUrl, target: "_blank", rel: "noopener noreferrer" } }));
    }
    header.append(actions);
    if (item.owner) {
      const owner = record(item.owner);
      const origin = html("button", { className: "portrait-credit", text: `From ${label(owner)}’s note`, attrs: { type: "button" } });
      origin.addEventListener("click", () => select(owner.id));
      header.append(origin);
    }
    el.details.append(header);

    renderParents(item);
    if (item.body) section("Stories & notes", renderProse(item.body), "book-open");
    renderFacts(item);
    renderRelations(item);
    renderEvents(item);
    renderEvidence(item);
    renderAttachments(item);
    if (!item.owner) renderNoteComposer(item);
  }

  function section(title, content, iconName) {
    const wrapper = html("section", { className: "detail-section" });
    const heading = html("h2");
    if (iconName) heading.append(icon(iconName));
    heading.append(document.createTextNode(title));
    wrapper.append(heading, content);
    el.details.append(wrapper);
  }

  function renderParents(item) {
    if (item.kind !== "person") return;
    const parents = state.data.query.edges.filter((edge) => edge.to === item.id && edge.relation !== "partner");
    if (!parents.length) return;
    const list = html("div", { className: "parent-list" });
    for (const edge of parents) {
      const parent = record(edge.from), role = parentRole(edge);
      const button = html("button", { className: `parent-summary ${role}`, attrs: { type: "button" } });
      button.append(roleBadge(role, edge.status), html("strong", { text: label(parent) }));
      button.append(html("small", { text: `${shortRelation(edge.relation.replace("_parent", ""))} · ${shortRelation(edge.status)}` }));
      button.addEventListener("click", () => select(parent.id));
      list.append(button);
    }
    section("Parents", list, "users-round");
  }

  function renderProse(body) {
    const wrapper = html("div", { className: "prose" });
    // Notes are data: construct text nodes, never interpret archive HTML.
    let paragraph = [], list = null;
    const flush = () => { if (paragraph.length) { wrapper.append(html("p", { text: paragraph.join(" ") })); paragraph = []; } };
    for (const line of body.trim().split(/\r?\n/u)) {
      const heading = /^#{1,6}\s+(.+)$/u.exec(line);
      const bullet = /^[-*]\s+(.+)$/u.exec(line);
      if (heading) { flush(); list = null; wrapper.append(html("h3", { text: heading[1] })); }
      else if (bullet) { flush(); if (!list) { list = html("ul"); wrapper.append(list); } list.append(html("li", { text: bullet[1] })); }
      else if (!line.trim()) { flush(); list = null; }
      else { list = null; paragraph.push(line); }
    }
    flush();
    return wrapper;
  }

  function renderNoteComposer(item) {
    const form = html("form", { className: "note-composer" });
    const field = html("textarea", { attrs: { rows: 3, placeholder: "A memory, a question, a detail to investigate…", "aria-label": "Research note", required: "" } });
    const message = html("p", { className: "note-message", attrs: { role: "status" } });
    const save = html("button", { className: "quiet-button", text: "Add note", attrs: { type: "submit" } });
    form.append(field, save, message);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const text = field.value.trim();
      if (!text) return;
      const newline = item.raw.includes("\r\n") ? "\r\n" : "\n";
      const replacement = item.raw + `${newline}${newline}## Research note${newline}${newline}${text.replace(/\r?\n/gu, newline)}${newline}`;
      save.disabled = true;
      message.textContent = "Saving…";
      try {
        const response = await fetch("/api/edit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: item.id, expected: item.raw, replacement }) });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Could not save note");
        await loadGraph();
      } catch (error) {
        message.textContent = error instanceof Error ? error.message : String(error);
        save.disabled = false;
      }
    });
    section("Add a research note", form, "notebook-pen");
  }

  function renderFacts(item) {
    const omitted = new Set(["version", "mother", "father", "parents", "partners", "events", "portrait", "portrait_credit", "portrait_caption", "portrait_source", "portrait_artist", "portrait_date", "portrait_license", "born", "birth", "birth_date", "died", "death", "death_date", "occupation", "id", "type", "name", "aliases", "attachments", "media", "sources", "from", "to", "parent", "child"]);
    const facts = Object.entries(item.metadata || {}).filter(([key, value]) => !omitted.has(key) && plainValue(value));
    if (!facts.length) return;
    const list = html("dl", { className: "facts" });
    for (const [key, value] of facts) {
      list.append(html("dt", { text: shortRelation(key) }), html("dd", { text: linkedIds(item, key).map((id) => label(record(id))).join(", ") || plainValue(value) }));
    }
    section("More facts", list, "briefcase-business");
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
      const direction = edge.relation === "partner" ? "Partner" : edge.to === item.id ? shortRelation(parentRole(edge)) : "Child";
      const relationType = edge.relation === "partner" ? "" : ` · ${shortRelation(edge.relation.replace("_parent", ""))}`;
      button.append(row, html("small", { text: `${direction}${relationType}` }));
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
    state.layoutRoot = "";
    if (record(state.selected)?.kind === "person") state.person = state.selected;
    // Each view starts at a readable depth; the control can then expand it.
    if (mode === "overview" && state.mode !== "overview") el.generations.value = "2";
    if (mode === "focus" && state.mode !== "focus") el.generations.value = "1";
    if ((mode === "ancestors" || mode === "descendants") && state.mode === "focus") el.generations.value = "4";
    state.mode = mode;
    for (const button of document.querySelectorAll("[data-mode]")) button.setAttribute("aria-pressed", String(button.dataset.mode === mode));
    el.path_picker.hidden = mode !== "path";
    el.overview_toggle.hidden = mode !== "overview";
    el.branch_picker.hidden = mode !== "overview";
    if (mode === "path" && !state.to) {
      el.graph_status.textContent = "Choose the second person above";
      return;
    }
    loadGraph();
  }

  function openEditor(item) {
    if (item.owner) item = record(item.owner);
    if (!item?.raw) return;
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
    const minY = Math.min(...ys) - CARD_HEIGHT / 2 - 38;
    const maxY = Math.max(...ys) + CARD_HEIGHT / 2 + 38;
    const bounds = el.graph.getBoundingClientRect();
    const heading = el.selection_summary.parentElement;
    const top = heading.offsetHeight ? heading.offsetTop + heading.offsetHeight + 12 : 16;
    const bottom = bounds.width > 560 ? 90 : 58;
    const availableHeight = Math.max(80, bounds.height - top - bottom);
    state.scale = Math.min(1.15, Math.max(.08, Math.min(bounds.width / Math.max(1, maxX - minX), availableHeight / Math.max(1, maxY - minY)) * .9));
    state.tx = bounds.width / 2 - ((minX + maxX) / 2) * state.scale;
    state.ty = top + availableHeight / 2 - ((minY + maxY) / 2) * state.scale;
    applyTransform();
  }

  function applyTransform() {
    el.zoom_level.textContent = `${Math.round(state.scale * 100)}%`;
    el.viewport.setAttribute("transform", `translate(${state.tx} ${state.ty}) scale(${state.scale})`);
  }

  document.querySelectorAll("[data-mode]").forEach((button) => button.addEventListener("click", () => setMode(button.dataset.mode)));
  el.layout_order.addEventListener("change", () => { state.layoutRoot = record(state.selected)?.kind === "person" ? state.selected : state.person; renderGraph(); });
  el.generations.addEventListener("change", () => loadGraph());
  el.relation_filter.addEventListener("change", () => loadGraph());
  el.status_filter.addEventListener("change", () => loadGraph());
  el.show_evidence.addEventListener("change", renderGraph);
  el.overview_toggle.addEventListener("click", () => {
    state.overviewShowAll = !state.overviewShowAll;
    if (!state.overviewShowAll) { state.overviewExpanded.clear(); state.overviewCollapsed.clear(); }
    el.overview_toggle.textContent = state.overviewShowAll ? "Collapse all" : "Show all";
    el.branch_root.disabled = state.overviewShowAll;
    renderGraph();
    renderDetails();
  });
  el.branch_root.addEventListener("change", () => {
    state.overviewRoot = el.branch_root.value;
    state.layoutRoot = "";
    state.overviewExpanded.clear(); state.overviewCollapsed.clear();
    state.selected = state.overviewRoot;
    renderGraph(); renderDetails();
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
