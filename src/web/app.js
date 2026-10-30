(() => {
  "use strict";
  const { t, formatDate, year } = KindredI18n;
  // Null on the local server. A static site declares its default view and suggestion target in a meta tag.
  const staticSite = readSiteSettings();

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
    layoutRoot: "",
    view: "research",
    loadError: ""
  };

  const el = Object.fromEntries([
    "arrangement-caption", "layout-order", "selection-summary", "selection-key", "branch-picker", "branch-root", "direction-label", "zoom-in", "zoom-out", "zoom-level", "search", "search-results", "generations", "relation-filter", "status-filter", "show-evidence", "overview-toggle", "fit-button",
    "diagnostics", "path-picker", "path-from", "path-to", "graph", "viewport",
    "edges", "nodes", "empty-state", "graph-status", "details", "editor",
    "editor-title", "editor-text", "editor-message", "save-button", "help-button", "shortcuts",
    "suggest-general", "suggestion", "suggestion-form", "suggestion-about", "suggestion-text", "suggestion-message", "suggestion-send"
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
    badge.append(icon(roleIcon(role)), document.createTextNode(known("role", role)));
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
      url: attachmentUrl(attachment.path),
      caption: media?.metadata?.caption || item.metadata?.portrait_caption || t("portraitOf", { name: label(item) }),
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
    const imageLink = html("a", { attrs: { href: portrait.url, target: "_blank", rel: "noopener", "aria-label": t("portraitOpen", { name: label(item) }) } });
    const photo = html("img", { attrs: { src: portrait.url, alt: portrait.caption, decoding: "async" } });
    photo.addEventListener("error", () => { figure.hidden = true; });
    imageLink.append(photo);
    const caption = html("figcaption", { text: portrait.credit || portrait.caption });
    if (portrait.media) {
      const details = html("button", { className: "portrait-credit", text: t("imageSource"), attrs: { type: "button" } });
      details.addEventListener("click", () => select(portrait.media.id));
      caption.append(details);
    } else {
      const source = typeof portrait.source === "string" ? portrait.source : portrait.source?.url;
      if (typeof source === "string" && /^https?:\/\//iu.test(source)) caption.append(html("a", { className: "portrait-credit", text: `${t("imageSource")} ↗`, attrs: { href: source, target: "_blank", rel: "noopener noreferrer" } }));
    }
    figure.append(imageLink, caption);
    return figure;
  }

  function dateValue(item, kind) {
    return plainValue(kind === "born"
      ? item.metadata?.born || item.metadata?.birth || item.metadata?.birth_date
      : item.metadata?.died || item.metadata?.death || item.metadata?.death_date);
  }

  // Cards pass compact: they show only the year, and the title carries the full localized date.
  function dateFact(item, kind, compact = false) {
    const name = t(kind === "born" ? "born" : "died");
    const raw = dateValue(item, kind);
    const full = raw ? formatDate(raw) : t("notRecorded");
    const fact = html("span", { className: "date-fact", attrs: { title: `${name}: ${full}` } });
    fact.append(icon(kind === "born" ? "baby" : "flower-2"));
    const copy = html("span");
    copy.append(html("small", { text: name }), html("span", { text: compact && raw ? year(raw) : full }));
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

  // Birth and death events derive from the person's note; their kind lives in the id, not in metadata.type.
  function lifeEventId(item, kind) {
    return `derived:${item.id}:${kind}`;
  }

  function eventsForPerson(id) {
    return state.data.records.filter((item) => item.kind === "event" && linkedIds(item, "people").includes(id));
  }

  function label(item) {
    return item?.name || item?.metadata?.title || item?.id || t("unnamedRecord");
  }

  function initials(name) {
    return name.split(/\s+/u).filter(Boolean).slice(0, 2).map((part) => [...part][0] || "").join("").toLocaleUpperCase() || "?";
  }

  function shortRelation(value) {
    return String(value || "related").replaceAll("_", " ").replace(/\b\w/gu, (letter) => letter.toLocaleUpperCase());
  }

  // Known values (roles, kinds, statuses, relation types) are translated; unknown ones stay readable.
  function known(group, value) {
    const key = `${group}.${value}`;
    return KindredI18n.has(key) ? t(key) : shortRelation(value);
  }

  async function loadGraph({ keepSelection = true } = {}) {
    const request = ++state.request;
    el.graph_status.textContent = t("readingArchive");
    const parameters = new URLSearchParams({
      mode: state.mode,
      generations: el.generations.value,
      relations: el.relation_filter.value,
      statuses: el.status_filter.value
    });
    if (state.mode !== "overview") parameters.set("person", state.person);
    if (state.mode === "path") parameters.set("to", state.to);

    try {
      const payload = staticSite ? await staticPayload(parameters) : await fetchPayload(parameters);
      if (request !== state.request) return;
      for (const item of [...payload.records, ...payload.query.nodes]) item.kind = item.kind || item.type;
      const previous = keepSelection ? state.selected : "";
      state.data = payload;
      state.loadError = "";
      state.selected = previous && record(previous) ? previous : state.person;
      if (!state.person) state.person = payload.query.nodes.find((item) => item.kind === "person")?.id || "";
      populatePeople();
      renderDiagnostics();
      renderGraph();
      renderDetails();
    } catch (error) {
      if (request !== state.request) return;
      state.loadError = error instanceof Error ? error.message : String(error);
      el.graph_status.textContent = t("couldNotLoad");
      el.empty_state.hidden = false;
      clear(el.nodes);
      clear(el.edges);
      showError(state.loadError);
    }
  }

  async function fetchPayload(parameters) {
    const response = await fetch(`/api/graph?${parameters}`, { headers: { Accept: "application/json" } });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.details ? `${payload.error}: ${payload.details}` : payload.error || t("requestFailed", { status: response.status }));
    return payload;
  }

  // Static sites read graph.json once; every view is then answered in the browser with the payload /api/graph returns.
  let staticGraph = null;
  function readStaticGraph() {
    staticGraph ??= fetch("graph.json", { headers: { Accept: "application/json" } }).then((response) => {
      if (!response.ok) throw new Error(t("requestFailed", { status: response.status }));
      return response.json();
    }).catch((error) => { staticGraph = null; throw error; });
    return staticGraph;
  }

  // Mirrors query_options and select_graph in src/web.rs, so both kinds of site answer the same questions.
  const ALL_STATUSES = ["accepted", "tentative", "disputed", "rejected"];
  const listParameter = (value) => (value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  async function staticPayload(parameters) {
    const graph = await readStaticGraph();
    const generations = Number.parseInt(parameters.get("generations") ?? "4", 10);
    if (!Number.isInteger(generations) || generations < 0) throw new Error(t("generationsInvalid"));
    const statuses = parameters.has("statuses") ? (parameters.get("statuses") === "all" ? ALL_STATUSES : listParameter(parameters.get("statuses"))) : undefined;
    const options = { generations: Math.min(64, generations), relations: listParameter(parameters.get("relations")), statuses };
    const need = (name, message) => {
      if (!parameters.get(name)) throw new Error(message);
      return parameters.get(name);
    };
    const queries = {
      overview: () => KindredQuery.overview(graph, options),
      focus: () => KindredQuery.neighborhood(graph, need("person", t("chooseAPerson")), options),
      ancestors: () => KindredQuery.ancestors(graph, need("person", t("chooseAPerson")), options),
      descendants: () => KindredQuery.descendants(graph, need("person", t("chooseAPerson")), options),
      path: () => KindredQuery.path(graph, need("person", t("chooseAPerson")), need("to", t("chooseSecondPerson")), options)
    };
    const mode = parameters.get("mode") || "overview";
    if (!Object.hasOwn(queries, mode)) throw new Error(t("unknownMode", { mode }));
    return { query: queries[mode](), records: graph.records, diagnostics: graph.diagnostics ?? [], attachments: graph.attachments ?? [], mode };
  }

  // Static sites serve portrait copies under attachments/, beside the page; the local server answers /api/attachment.
  function attachmentUrl(path) {
    return staticSite ? `attachments/${path.split("/").map(encodeURIComponent).join("/")}` : `/api/attachment?path=${encodeURIComponent(path)}`;
  }

  // Parsed defensively: a broken settings value still leaves a static page, with the defaults.
  function readSiteSettings() {
    const meta = document.querySelector('meta[name="kindred-site"]');
    if (!meta) return null;
    let settings = null;
    try { settings = JSON.parse(meta.getAttribute("content") || "null"); } catch { settings = null; }
    const view = settings?.view === "simple" || settings?.view === "research" ? settings.view : "";
    const suggest = typeof settings?.suggest === "string" && safeSuggestUrl(settings.suggest) ? settings.suggest : "";
    return { view, suggest };
  }

  // The same rule the site builder enforces: a path on this origin (not //), or an https:// URL, with no spaces or backslashes.
  function safeSuggestUrl(value) {
    return !/[\s\\]/u.test(value) && (/^\/(?!\/)/u.test(value) || /^https:\/\/\S/u.test(value));
  }

  function showError(message) {
    clear(el.diagnostics);
    el.diagnostics.append(html("strong", { text: `${t("archiveNeedsAttention")} ` }));
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
    el.diagnostics.append(html("strong", { text: `${t("archiveDiagnostics", { count: diagnostics.length })}. ` }));
    el.diagnostics.append(document.createTextNode(diagnostics.slice(0, 3).map((item) => item.message).join(" · ")));
    el.diagnostics.hidden = false;
  }

  function populatePeople() {
    const sorted = [...people()].sort((a, b) => label(a).localeCompare(label(b)));
    const current = el.path_to.value;
    clear(el.path_to);
    el.path_to.append(html("option", { text: t("choosePerson"), attrs: { value: "" } }));
    for (const person of sorted) {
      if (person.id === state.person) continue;
      el.path_to.append(html("option", { text: label(person), attrs: { value: person.id } }));
    }
    el.path_to.value = state.to || current;
    el.path_from.textContent = label(record(state.person)) || t("choosePersonLower");
    if (state.mode === "overview") {
      const childCount = (id) => new Set(state.data.query.edges.filter((edge) => edge.from === id && edge.relation !== "partner").map((edge) => edge.to)).size;
      const branches = sorted.filter((person) => childCount(person.id) > 0).sort((a, b) => childCount(b.id) - childCount(a.id) || label(a).localeCompare(label(b)));
      if (state.overviewRoot === null) state.overviewRoot = branches[0]?.id || "";
      if (state.overviewRoot && !branches.some((person) => person.id === state.overviewRoot)) state.overviewRoot = "";
      clear(el.branch_root);
      el.branch_root.append(html("option", { text: t("allFamilyRoots"), attrs: { value: "" } }));
      for (const person of branches) el.branch_root.append(html("option", { text: `${label(person)} · ${t("childCount", { count: childCount(person.id) })}`, attrs: { value: person.id } }));
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

  // Language and view switches re-render in place, so they pass fit: false to keep the current zoom.
  function renderGraph({ fit = true } = {}) {
    el.direction_label.textContent = state.mode === "path" ? t("connectionPath") : t("parentsAboveChildren");
    const nodes = graphNodes();
    if (state.selected && record(state.selected)?.kind === "person" && !nodes.some((node) => node.id === state.selected)) state.selected = nodes[0]?.id || "";
    const edges = graphEdges(nodes);
    const layoutRoot = state.layoutRoot || (state.mode === "overview" ? state.overviewRoot : state.person) || state.selected;
    el.arrangement_caption.textContent = state.mode === "path" ? t("connectionPath") : el.layout_order.value === "sides"
      ? t("arrangedAround", { name: label(record(layoutRoot)) })
      : t("compactGroups");
    state.positions = KindredLayout.layout(nodes, edges, { mode: state.mode, root: layoutRoot, sideOrdering: el.layout_order.value === "sides", roleForEdge: parentRole, cardWidth: CARD_WIDTH, cardHeight: CARD_HEIGHT });
    state.orderedIds = nodes.map((node) => node.id);
    clear(el.nodes);
    clear(el.edges);

    const rails = KindredLayout.familyRails(edges, state.positions, { cardWidth: CARD_WIDTH, cardHeight: CARD_HEIGHT });
    for (const edge of edges) renderEdge(edge, edges, rails);
    for (const node of nodes) renderNode(node);
    renderGraphSelection();

    el.empty_state.hidden = nodes.length !== 0;
    const peopleCount = nodes.filter((node) => node.kind === "person").length;
    const evidenceCount = nodes.length - peopleCount;
    const claimCount = edges.filter((edge) => edge.relation !== "evidence" && edge.relation !== "event").length;
    const allPeopleCount = state.data.query.nodes.filter((node) => node.kind === "person").length;
    const peopleText = state.mode === "overview" && !state.overviewShowAll
      ? t("peopleShown", { shown: peopleCount, count: allPeopleCount })
      : t("people", { count: peopleCount });
    const evidenceText = evidenceCount ? ` · ${t("evidenceCount", { count: evidenceCount })}` : "";
    const claimsText = t("claims", { count: claimCount });
    el.graph_status.textContent = state.view === "simple" ? peopleText : `${peopleText}${evidenceText} · ${claimsText}`;
    if (fit) requestAnimationFrame(fitGraph);
  }

  function renderEdge(edge, edges, rails) {
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
      const anchor = KindredLayout.parentAnchor(edge, edges, state.positions, { cardWidth: CARD_WIDTH, cardHeight: CARD_HEIGHT });
      const start = anchor || { x: from.x, y: from.y + direction * CARD_HEIGHT / 2 }, y2 = to.y - direction * CARD_HEIGHT / 2;
      const share = anchor ? .5 : parentRole(edge) === "mother" ? .36 : parentRole(edge) === "father" ? .64 : .5;
      const middle = anchor && rails.has(edge.id) ? rails.get(edge.id) : start.y + (y2 - start.y) * share;
      const dx = Math.sign(to.x - start.x), radius = Math.min(10, Math.abs(to.x - start.x) / 2, Math.abs(middle - start.y) / 2, Math.abs(y2 - middle) / 2);
      d = `M ${start.x} ${start.y} V ${middle - direction * radius} Q ${start.x} ${middle} ${start.x + dx * radius} ${middle} H ${to.x - dx * radius} Q ${to.x} ${middle} ${to.x} ${middle + direction * radius} V ${y2}`;
    }
    const status = String(edge.status || "accepted").toLocaleLowerCase();
    const group = svg("g", { className: `connection ${edge.relation} ${status}`, attrs: { "data-id": edge.id, "data-from": edge.from, "data-to": edge.to } });
    const path = svg("path", { className: "edge", attrs: { d } });
    group.append(path, svg("title", { text: `${label(record(edge.from))} → ${label(record(edge.to))} · ${known("relation", edge.relation.replace("_parent", ""))} · ${known("status", status)}` }));
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
      attrs: { transform: `translate(${position.x} ${position.y})`, tabindex: "0", role: "button", "aria-label": nodeAriaLabel(label(node)), "data-id": node.id }
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
    else description.append(html("span", { className: "record-kind", text: known("kind", node.kind) }));
    copy.append(description); head.append(avatar, copy); card.append(head);
    const occupation = plainValue(node.metadata?.occupation);
    const job = html("div", { className: "person-occupation", attrs: { title: occupation } });
    if (occupation) job.append(icon("briefcase-business"), html("span", { text: occupation }));
    else if (node.kind !== "person") job.textContent = t("evidenceAndResearch");
    card.append(job);
    const dates = html("div", { className: "person-dates" });
    if (node.kind === "person") dates.append(dateFact(node, "born", true), dateFact(node, "died", true));
    else dates.append(html("span", { text: t("openToReadSource") }));
    card.append(dates); content.append(card); group.append(content);
    group.append(svg("title", { text: `${label(node)} · ${lifeSpan(node)}${occupation ? ` · ${occupation}` : ""}` }));
    group.addEventListener("click", () => select(node.id));
    group.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); select(node.id, true); }
    });
    el.nodes.append(group);
  }

  function nodeAriaLabel(name, category) {
    return category ? t("nodeLabelRole", { name, role: t(familyLabels[category]) }) : t("nodeLabel", { name });
  }

  function truncate(value, length) {
    const characters = [...String(value)];
    return characters.length > length ? `${characters.slice(0, length - 1).join("")}…` : value;
  }

  function lifeSpan(item) {
    const born = item.metadata?.born || item.metadata?.birth || item.metadata?.birth_date || "";
    const died = item.metadata?.died || item.metadata?.death || item.metadata?.death_date || "";
    if (born || died) return `${formatDate(plainValue(born)) || "?"} – ${formatDate(plainValue(died))}`;
    return t("datesNotRecorded");
  }

  function plainValue(value) {
    if (value === undefined || value === null) return "";
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
    if (Array.isArray(value)) return value.map(plainValue).join(", ");
    // Named objects, such as places, read as their name; other objects stay as JSON.
    const named = [value.name, value.title].find((candidate) => typeof candidate === "string" && candidate);
    return named || JSON.stringify(value);
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

  const familyLabels = { selected: "family.selected", maternal: "family.maternal", paternal: "family.paternal", both: "family.both", ancestor: "family.ancestor", descendant: "family.descendant", partner: "family.partner", relative: "family.relative", connection: "family.connection" };

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
      node.setAttribute("aria-label", nodeAriaLabel(label(record(id)), category));
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
      el.selection_summary.textContent = t("connectionsOf", { name: label(record(focus)) });
      const counts = new Map();
      for (const [id, category] of family.people) if (id !== focus) counts.set(category, (counts.get(category) || 0) + 1);
      for (const category of Object.keys(familyLabels)) {
        const count = counts.get(category);
        if (!count) continue;
        const item = html("span", { className: `family-key ${category}`, text: `${t(familyLabels[category])} ${count}` });
        el.selection_key.append(item);
      }
    } else {
      el.selection_summary.textContent = t("selectPersonToTrace");
    }
  }

  function renderDetails() {
    const item = record(state.selected);
    if (!item) return;
    clear(el.details);
    if (state.view === "simple" && item.kind !== "person") return renderSimpleRecord(item);
    const simple = state.view === "simple";
    const header = html("header", { className: "detail-header" });
    header.append(html("span", { className: "eyebrow", text: item.kind ? known("kind", item.kind) : t("recordEyebrow") }));
    header.append(html("h1", { text: label(item) }));
    const portrait = portraitFigure(item);
    if (portrait) header.append(portrait);
    if (item.kind === "person") {
      const dates = html("div", { className: "detail-dates" });
      dates.append(dateFact(item, "born"), dateFact(item, "died"));
      header.append(dates);
      if (simple) {
        const places = ["birth", "death"].flatMap((kind) => {
          const place = record(record(lifeEventId(item, kind))?.metadata?.place);
          return place ? [kind === "birth" ? t("bornIn", { place: label(place) }) : t("diedIn", { place: label(place) })] : [];
        });
        if (places.length) header.append(html("p", { className: "detail-places", text: places.join(" · ") }));
      }
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
        const branch = html("button", { className: "primary-button", text: expanded ? t("collapseBranch") : t("expandBranch"), attrs: { type: "button" } });
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
      const family = html("button", { className: "primary-button", text: t("openFamily"), attrs: { type: "button" } });
      family.addEventListener("click", () => { state.person = item.id; setMode("focus"); });
      actions.append(family);
      const arrange = html("button", { className: "quiet-button", text: t("arrangeFamilySides"), attrs: { type: "button" } });
      arrange.addEventListener("click", () => { state.layoutRoot = item.id; el.layout_order.value = "sides"; renderGraph(); });
      actions.append(arrange);
    }
    const edit = html("button", { className: "quiet-button", text: item.owner ? t("editPersonNote") : t("editNote"), attrs: { type: "button" } });
    edit.addEventListener("click", () => openEditor(item));
    if (!simple && !staticSite) actions.append(edit);
    const itemUrl = item.metadata?.url;
    if (item.kind === "source" && typeof itemUrl === "string" && /^https?:\/\//iu.test(itemUrl)) {
      actions.append(html("a", { className: "quiet-button", text: t("openSource"), attrs: { href: itemUrl, target: "_blank", rel: "noopener noreferrer" } }));
    }
    if (staticSite?.suggest && item.kind === "person") {
      const suggest = html("button", { className: "quiet-button", text: t("suggestButton"), attrs: { type: "button" } });
      suggest.addEventListener("click", () => openSuggestion(item));
      actions.append(suggest);
    }
    header.append(actions);
    if (item.owner) {
      const owner = record(item.owner);
      const origin = html("button", { className: "portrait-credit", text: t("fromNote", { name: label(owner) }), attrs: { type: "button" } });
      origin.addEventListener("click", () => select(owner.id));
      header.append(origin);
    }
    el.details.append(header);

    renderParents(item);
    if (item.body) section(t("sectionStories"), renderProse(item.body), "book-open");
    if (!simple) renderFacts(item);
    renderRelations(item);
    renderEvents(item);
    if (simple) return;
    renderEvidence(item);
    renderAttachments(item);
    if (!item.owner && !staticSite) renderNoteComposer(item);
  }

  // Simple view shows a non-person record as its title, date and place, with links to the people it concerns.
  function renderSimpleRecord(item) {
    const people = relatedPeople(item);
    const header = html("header", { className: "detail-header" });
    const place = record(item.metadata?.place);
    const when = [formatDate(plainValue(item.metadata?.date || item.metadata?.when)), place ? label(place) : ""].filter(Boolean).join(" · ");
    // Relationship records have no name of their own; their title is the two people they join.
    const title = item.kind === "relationship" ? people.map((person) => label(person)).join(t("and")) || t("familyLink") : label(item);
    header.append(html("span", { className: "eyebrow", text: item.kind === "event" ? t("kind.event") : item.kind === "relationship" ? t("familyLink") : t("familyRecord") }), html("h1", { text: title }));
    if (when) header.append(html("p", { className: "detail-occupation", text: when }));
    el.details.append(header);
    if (!people.length) return;
    const list = html("div");
    for (const person of people) {
      const button = html("button", { className: "relation-card", text: label(person), attrs: { type: "button" } });
      button.addEventListener("click", () => select(person.id));
      list.append(button);
    }
    section(t("sectionPeople"), list, "users-round");
  }

  function relatedPeople(item) {
    const ids = new Set(linkedIds(item, "people"));
    for (const edge of state.data.query.edges) {
      if (edge.id === item.id || edge.sources?.includes(item.id)) { ids.add(edge.from); ids.add(edge.to); }
    }
    for (const person of people()) if (linkedIds(person, "sources").includes(item.id)) ids.add(person.id);
    return [...ids].map((id) => record(id)).filter((person) => person?.kind === "person");
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
      const status = state.view === "simple" && edge.status === "accepted" ? "" : ` · ${known("status", edge.status)}`;
      button.append(html("small", { text: `${known("relation", edge.relation.replace("_parent", ""))}${status}` }));
      button.addEventListener("click", () => select(parent.id));
      list.append(button);
    }
    section(t("sectionParents"), list, "users-round");
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
    const field = html("textarea", { attrs: { rows: 3, placeholder: t("composerPlaceholder"), "aria-label": t("researchNote"), required: "" } });
    const message = html("p", { className: "note-message", attrs: { role: "status" } });
    const save = html("button", { className: "quiet-button", text: t("addNote"), attrs: { type: "submit" } });
    form.append(field, save, message);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const text = field.value.trim();
      if (!text) return;
      const newline = item.raw.includes("\r\n") ? "\r\n" : "\n";
      const replacement = item.raw + `${newline}${newline}## Research note${newline}${newline}${text.replace(/\r?\n/gu, newline)}${newline}`;
      save.disabled = true;
      message.textContent = t("saving");
      try {
        const response = await fetch("/api/edit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: item.id, expected: item.raw, replacement }) });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || t("couldNotSaveNote"));
        await loadGraph();
      } catch (error) {
        message.textContent = error instanceof Error ? error.message : String(error);
        save.disabled = false;
      }
    });
    section(t("sectionResearchNote"), form, "notebook-pen");
  }

  function renderFacts(item) {
    const omitted = new Set(["version", "mother", "father", "parents", "partners", "events", "portrait", "portrait_credit", "portrait_caption", "portrait_source", "portrait_artist", "portrait_date", "portrait_license", "born", "birth", "birth_date", "died", "death", "death_date", "occupation", "id", "type", "name", "aliases", "attachments", "media", "sources", "from", "to", "parent", "child"]);
    const facts = Object.entries(item.metadata || {}).filter(([key, value]) => !omitted.has(key) && plainValue(value));
    if (!facts.length) return;
    const list = html("dl", { className: "facts" });
    for (const [key, value] of facts) {
      list.append(html("dt", { text: shortRelation(key) }), html("dd", { text: linkedIds(item, key).map((id) => label(record(id))).join(", ") || plainValue(value) }));
    }
    section(t("sectionFacts"), list, "briefcase-business");
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
      row.append(html("strong", { text: label(other) }));
      if (state.view !== "simple" || (edge.status || "accepted") !== "accepted") row.append(html("span", { className: `tag ${edge.status || ""}`, text: known("status", edge.status || "accepted") }));
      const direction = edge.relation === "partner" ? t("relation.partner") : edge.to === item.id ? known("role", parentRole(edge)) : t("direction.child");
      const relationType = edge.relation === "partner" ? "" : ` · ${known("relation", edge.relation.replace("_parent", ""))}`;
      button.append(row, html("small", { text: `${direction}${relationType}` }));
      button.addEventListener("click", () => select(otherId));
      list.append(button);
    }
    section(t("sectionRelationships"), list);
  }

  function renderEvents(item) {
    // Simple view shows birth and death through the life dates and places in the header instead.
    const events = eventsForPerson(item.id).filter((event) => state.view !== "simple" || !["birth", "death"].some((kind) => event.id === lifeEventId(item, kind)));
    if (!events.length) return;
    const list = html("div");
    for (const event of events) {
      const card = html("button", { className: "event-card", attrs: { type: "button" } });
      const when = formatDate(plainValue(event.metadata?.date || event.metadata?.when || event.id));
      const place = state.view === "simple" && record(event.metadata?.place);
      card.append(html("strong", { text: label(event) }), html("small", { text: place ? `${when} · ${label(place)}` : when }));
      card.addEventListener("click", () => select(event.id));
      list.append(card);
    }
    section(t("sectionEvents"), list);
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
        card.append(html("small", { text: t("sourceUrl", { url: sourceUrl }) }));
      }
      card.addEventListener("click", () => select(source.id));
      list.append(card);
    }
    section(t("evidence"), list);
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
      const link = html("a", { className: "attachment-link", text: `↗ ${attachment.label || attachment.path}`, attrs: { href: attachmentUrl(attachment.path), target: "_blank", rel: "noopener" } });
      list.append(link);
    }
    section(t("sectionAttachments"), list);
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
      el.graph_status.textContent = t("chooseSecondPerson");
      return;
    }
    loadGraph();
  }

  // ?view= wins and is remembered; otherwise the last choice; otherwise the site's default view; otherwise Research.
  function initialView() {
    const requested = new URLSearchParams(location.search).get("view");
    if (requested === "simple" || requested === "research") {
      try { localStorage.setItem("kindred.view", requested); } catch { /* Private browsing can refuse storage. */ }
      return requested;
    }
    let stored = "";
    try { stored = localStorage.getItem("kindred.view") || ""; } catch { /* Private browsing can refuse storage. */ }
    if (stored === "simple" || stored === "research") return stored;
    return staticSite?.view || "research";
  }

  // ?lang= wins and is remembered; otherwise the last choice; otherwise German when a German language is preferred, else English.
  function initialLang() {
    const requested = new URLSearchParams(location.search).get("lang");
    if (requested === "en" || requested === "de") {
      try { localStorage.setItem("kindred.lang", requested); } catch { /* Private browsing can refuse storage. */ }
      return requested;
    }
    try {
      const stored = localStorage.getItem("kindred.lang");
      if (stored === "en" || stored === "de") return stored;
    } catch { /* Private browsing can refuse storage. */ }
    // The browser's first supported language wins, so "en-US, de" stays English.
    const supported = (navigator.languages || [navigator.language]).map((tag) => String(tag).split("-")[0].toLocaleLowerCase()).find((tag) => tag === "en" || tag === "de");
    return supported || "en";
  }

  // Rewrites only the named parameters, so ?view= and ?lang= keep each other.
  function syncUrl(parameters) {
    const query = new URLSearchParams(location.search);
    for (const [name, value] of Object.entries(parameters)) query.set(name, value);
    history.replaceState(null, "", `?${query}`);
  }

  function filterKey() {
    return [el.status_filter.value, el.relation_filter.value, el.show_evidence.checked].join("|");
  }

  function applyView(view) {
    state.view = view;
    document.body.classList.toggle("simple-view", view === "simple");
    for (const button of document.querySelectorAll("[data-view]")) button.setAttribute("aria-pressed", String(button.dataset.view === view));
    // Hidden research filters must not silently shape the Simple graph, so they match what Simple shows.
    if (view === "simple") { el.status_filter.value = "accepted"; el.relation_filter.value = ""; el.show_evidence.checked = false; }
  }

  function switchView(view) {
    const before = filterKey();
    applyView(view);
    try { localStorage.setItem("kindred.view", view); } catch { /* Private browsing can refuse storage. */ }
    // Keep the URL in step so a ?view= link does not override the choice on reload.
    syncUrl({ view });
    if (view === "simple" && state.mode === "path") setMode("overview");
    else if (!state.data || filterKey() !== before) loadGraph();
    else { renderDiagnostics(); renderGraph(); renderDetails(); }
  }

  // Static strings come from data-i18n; labels set on click or by state are re-set here.
  function renderStrings() {
    KindredI18n.apply();
    el.overview_toggle.textContent = state.overviewShowAll ? t("collapseAll") : t("showAll");
    for (const button of document.querySelectorAll("[data-lang]")) button.setAttribute("aria-pressed", String(button.dataset.lang === KindredI18n.lang()));
  }

  // Re-renders in place: the graph keeps its zoom and filters, and the details keep the selected person.
  function switchLang(lang) {
    // An explicit click is remembered even when it matches the detected language.
    const changed = lang !== KindredI18n.lang();
    KindredI18n.setLang(lang);
    try { localStorage.setItem("kindred.lang", lang); } catch { /* Private browsing can refuse storage. */ }
    syncUrl({ lang });
    if (!changed) return;
    renderStrings();
    if (state.data) {
      // A note typed in the composer is not archive data, so it survives the re-render.
      const draft = el.details.querySelector(".note-composer textarea")?.value;
      populatePeople();
      renderDiagnostics();
      renderGraph({ fit: false });
      renderDetails();
      const field = el.details.querySelector(".note-composer textarea");
      if (field && draft) field.value = draft;
    } else if (state.loadError) {
      el.graph_status.textContent = t("couldNotLoad");
      showError(state.loadError);
    }
    updateSearch();
  }

  function openEditor(item) {
    if (item.owner) item = record(item.owner);
    if (!item?.raw) return;
    state.editorOriginal = item.raw;
    el.editor_title.textContent = t("editTitle", { name: label(item) });
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
    el.editor_message.textContent = t("saving");
    try {
      const response = await fetch("/api/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: el.editor_text.dataset.id, expected: state.editorOriginal, replacement })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || t("saveFailed", { status: response.status }));
      state.editorOriginal = replacement;
      el.editor.close();
      await loadGraph();
    } catch (error) {
      el.editor_message.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      el.save_button.disabled = false;
    }
  }

  // Suggestions go to the static site's suggestion URL. The dialog keeps an unsent draft, so a login redirect or reload does not lose it.
  const DRAFT_KEY = "kindred.suggestion.draft";
  let suggestion = { person: null, name: "" };

  function readDraft() {
    try {
      const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
      return draft && typeof draft.text === "string" ? draft : null;
    } catch { return null; }
  }

  function writeDraft(draft) {
    try {
      if (draft) localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
      else localStorage.removeItem(DRAFT_KEY);
    } catch { /* Private browsing can refuse storage. */ }
  }

  // A person's draft is restored when the same person is opened again; a general note starts empty unless it is the draft.
  function openSuggestion(item = null) {
    suggestion = { person: item ? item.id : null, name: item ? label(item) : "" };
    const draft = readDraft();
    el.suggestion_text.value = draft && draft.person === suggestion.person ? draft.text : "";
    el.suggestion_about.hidden = !item;
    el.suggestion_about.textContent = item ? t("suggestAbout", { name: label(item) }) : "";
    el.suggestion_message.textContent = "";
    el.suggestion_message.classList.remove("sent");
    el.suggestion_send.disabled = false;
    el.suggestion.showModal();
    el.suggestion_text.focus();
  }

  async function sendSuggestion(event) {
    // Cancel closes the dialog through the form's dialog method; only Send posts.
    if (event.submitter?.value === "cancel") return;
    event.preventDefault();
    const text = el.suggestion_text.value.trim();
    if (!text) {
      el.suggestion_message.textContent = t("suggestEmpty");
      return;
    }
    el.suggestion_send.disabled = true;
    el.suggestion_message.classList.remove("sent");
    el.suggestion_message.textContent = t("suggestSending");
    try {
      const response = await fetch(staticSite.suggest, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, person: suggestion.person, personName: suggestion.name || null, lang: KindredI18n.lang() })
      });
      if (response.status !== 201) throw new Error(`suggestion failed with ${response.status}`);
      writeDraft(null);
      el.suggestion_message.classList.add("sent");
      el.suggestion_message.textContent = t("suggestSent");
      setTimeout(() => el.suggestion.close(), 1600);
    } catch {
      // The text stays in the dialog and in the draft, so the reader can try again.
      el.suggestion_send.disabled = false;
      el.suggestion_message.textContent = t("suggestFailed");
    }
  }

  el.suggest_general.addEventListener("click", () => openSuggestion());
  el.suggestion_text.addEventListener("input", () => {
    const text = el.suggestion_text.value;
    writeDraft(text ? { person: suggestion.person, text } : null);
  });
  el.suggestion_form.addEventListener("submit", sendSuggestion);

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
    if (!matches.length) el.search_results.append(html("p", { text: t("noMatchingPeople") }));
    el.search_results.hidden = false;
  }

  const MIN_SCALE = .05;
  const MAX_SCALE = 4;
  const PAN_THRESHOLD = 6;
  const pointers = new Map();
  let suppressClick = false;

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
    state.scale = Math.min(1.15, Math.max(MIN_SCALE, Math.min(bounds.width / Math.max(1, maxX - minX), availableHeight / Math.max(1, maxY - minY)) * .9));
    state.tx = bounds.width / 2 - ((minX + maxX) / 2) * state.scale;
    state.ty = top + availableHeight / 2 - ((minY + maxY) / 2) * state.scale;
    applyTransform();
  }

  function applyTransform() {
    el.zoom_level.textContent = `${Math.round(state.scale * 100)}%`;
    el.viewport.setAttribute("transform", `translate(${state.tx} ${state.ty}) scale(${state.scale})`);
  }

  document.querySelectorAll("[data-mode]").forEach((button) => button.addEventListener("click", () => setMode(button.dataset.mode)));
  document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.view)));
  document.querySelectorAll("[data-lang]").forEach((button) => button.addEventListener("click", () => switchLang(button.dataset.lang)));
  el.layout_order.addEventListener("change", () => { state.layoutRoot = record(state.selected)?.kind === "person" ? state.selected : state.person; renderGraph(); });
  el.generations.addEventListener("change", () => loadGraph());
  el.relation_filter.addEventListener("change", () => loadGraph());
  el.status_filter.addEventListener("change", () => loadGraph());
  el.show_evidence.addEventListener("change", () => renderGraph());
  el.overview_toggle.addEventListener("click", () => {
    state.overviewShowAll = !state.overviewShowAll;
    if (!state.overviewShowAll) { state.overviewExpanded.clear(); state.overviewCollapsed.clear(); }
    el.overview_toggle.textContent = state.overviewShowAll ? t("collapseAll") : t("showAll");
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
  function zoomAt(x, y, factor) {
    const previous = state.scale;
    state.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, previous * factor));
    state.tx = x - (x - state.tx) * (state.scale / previous);
    state.ty = y - (y - state.ty) * (state.scale / previous);
    applyTransform();
  }
  function zoomBy(factor) {
    const bounds = el.graph.getBoundingClientRect();
    zoomAt(bounds.width / 2, bounds.height / 2, factor);
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
    zoomAt(event.clientX - bounds.left, event.clientY - bounds.top, Math.exp(-event.deltaY * (event.ctrlKey ? .01 : .0015)));
  }, { passive: false });
  function pointerMid() {
    const [first, second] = pointers.values(), bounds = el.graph.getBoundingClientRect();
    return { x: (first.x + second.x) / 2 - bounds.left, y: (first.y + second.y) / 2 - bounds.top };
  }
  function startPinch() {
    const [first, second] = pointers.values();
    state.drag = { pinch: true, dist: Math.max(1, Math.hypot(first.x - second.x, first.y - second.y)), mid: pointerMid(), scale: state.scale, tx: state.tx, ty: state.ty };
    suppressClick = true;
    el.graph.classList.add("panning");
    for (const id of pointers.keys()) el.graph.setPointerCapture(id);
  }
  function pinchTo() {
    const pinch = state.drag, [first, second] = pointers.values();
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, pinch.scale * Math.hypot(first.x - second.x, first.y - second.y) / pinch.dist));
    const ratio = scale / pinch.scale, mid = pointerMid();
    state.scale = scale;
    state.tx = mid.x - (pinch.mid.x - pinch.tx) * ratio;
    state.ty = mid.y - (pinch.mid.y - pinch.ty) * ratio;
    applyTransform();
  }
  function endPointer(event) {
    if (!pointers.delete(event.pointerId)) return;
    const [remaining] = pointers.values();
    // Lifting one finger of a pinch keeps panning with the other from where it is.
    if (remaining) state.drag = { x: remaining.x, y: remaining.y, tx: state.tx, ty: state.ty, panning: true };
    else { state.drag = null; el.graph.classList.remove("panning"); }
  }
  el.graph.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || pointers.size >= 2) return;
    if (!pointers.size) suppressClick = false;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2) startPinch();
    else state.drag = { x: event.clientX, y: event.clientY, tx: state.tx, ty: state.ty, panning: false };
  });
  el.graph.addEventListener("pointermove", (event) => {
    const pointer = pointers.get(event.pointerId);
    if (!pointer) return;
    pointer.x = event.clientX; pointer.y = event.clientY;
    if (state.drag.pinch) return pinchTo();
    const drag = state.drag;
    if (!drag.panning) {
      // Below the threshold this is still a tap, so the card's click passes through.
      if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < PAN_THRESHOLD) return;
      drag.panning = true; suppressClick = true;
      el.graph.setPointerCapture(event.pointerId);
      el.graph.classList.add("panning");
    }
    state.tx = drag.tx + event.clientX - drag.x;
    state.ty = drag.ty + event.clientY - drag.y;
    applyTransform();
  });
  // Window-level so a release over the graph's overlay controls still ends the pointer.
  window.addEventListener("pointerup", endPointer);
  window.addEventListener("pointercancel", endPointer);
  // Moving capture from a card to the graph fires lostpointercapture on the card, which must not end the gesture.
  el.graph.addEventListener("lostpointercapture", (event) => { if (event.target === el.graph) endPointer(event); });
  // Capture phase so the click the browser fires after a pan or pinch never reaches a card.
  el.graph.addEventListener("click", (event) => {
    if (!suppressClick) return;
    suppressClick = false;
    event.stopPropagation();
  }, true);

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
  // A static page cannot edit, so its editor goes; suggestion controls appear only when the site names a URL.
  if (staticSite) el.editor.remove();
  el.suggest_general.hidden = !staticSite?.suggest;
  if (!staticSite?.suggest) el.suggestion.remove();
  applyView(initialView());
  KindredI18n.setLang(initialLang());
  renderStrings();
  loadGraph({ keepSelection: false });
})();
