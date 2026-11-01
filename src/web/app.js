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
    sheet: "hidden",
    questions: false,
    pendingCamera: null,
    allEdges: null,
    page: "",
    me: readMe(),
    familyAsTree: false,
    loadError: ""
  };

  const el = Object.fromEntries([
    "arrangement-caption", "layout-order", "selection-summary", "selection-key", "branch-picker", "branch-root", "direction-label", "zoom-in", "zoom-out", "zoom-level", "search", "search-results", "generations", "relation-filter", "status-filter", "show-evidence", "overview-toggle", "fit-button",
    "diagnostics", "path-picker", "path-from", "path-to", "graph", "viewport",
    "edges", "nodes", "empty-state", "graph-status", "details", "editor",
    "editor-title", "editor-text", "editor-message", "save-button", "help-button", "shortcuts",
    "suggest-general", "suggestion", "suggestion-form", "suggestion-about", "suggestion-text", "suggestion-message", "suggestion-send",
    "workspace", "toolbar", "query-options", "view-switch", "lang-switch", "menu-button", "menu-panel", "details-body", "sheet-handle", "sheet-close", "sheet-peek", "sheet-name", "sheet-years", "sheet-occupation", "questions-toggle", "theme-toggle", "more-options", "centre-button", "first-hint", "first-hint-close", "empty-reset", "empty-search", "home-button", "upcoming-button", "upcoming-page", "family-page", "bands"
  ].map((id) => [id.replaceAll("-", "_"), document.getElementById(id)]));

  const svgNs = "http://www.w3.org/2000/svg";
  const CARD_WIDTH = 216;
  // Research cards add a row for the parent role; applyView sets the height for the view.
  let CARD_HEIGHT = 96;
  // Phones: the same breakpoint as the stylesheet. Below READABLE_SCALE a card name is too small to read.
  const phoneQuery = window.matchMedia("(max-width: 560px)");
  const READABLE_SCALE = .7;
  // Below this scale cards switch to large type with only the name and life line (semantic zoom).
  const FAR_SCALE = .8;
  const START_SCALE = .85;

  function icon(name) {
    const image = svg("svg", { className: "icon", attrs: { viewBox: "0 0 24 24", width: 18, height: 18, "aria-hidden": "true", focusable: "false" } });
    image.append(svg("use", { attrs: { href: `/icons.svg#${name}` } }));
    return image;
  }

  function parentRole(edge) {
    const role = record(edge.id)?.metadata?.parent_role;
    return ["mother", "father"].includes(role) ? role : "parent";
  }

  // Roles are words: the archive records roles, not sexes, so no gender symbols.
  function roleBadge(role, status = "accepted") {
    return html("span", { className: `parent-role ${role} ${status}`, text: known("role", role) });
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

  function dateFact(item, kind) {
    const raw = dateValue(item, kind);
    return fact(t(kind === "born" ? "born" : "died"), raw ? formatDate(raw) : t("notRecorded"), kind === "born" ? "birth-mark" : "flower-2");
  }

  function fact(name, value, iconName) {
    const node = html("span", { className: "date-fact", attrs: { title: `${name}: ${value}` } });
    if (iconName) node.append(icon(iconName));
    const copy = html("span");
    copy.append(html("small", { text: name }), html("span", { text: value }));
    node.append(copy);
    return node;
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
    if (item?.kind === "event") {
      // Derived events use their ID as name when unnamed, so an ID is never shown as a title.
      const named = [item.name, item.metadata?.title].find((text) => text && text !== item.id);
      return named || eventLabel(item);
    }
    return item?.name || item?.metadata?.title || item?.id || t("unnamedRecord");
  }

  // The event type is event_type on derived events (their metadata type is the record kind) and type on notes.
  function eventLabel(item) {
    const type = String(item.metadata?.event_type || item.metadata?.type || "").trim();
    if (!type || type === "event") return t("kind.event");
    const key = `eventType.${type}`;
    return KindredI18n.has(key) ? t(key) : type.replaceAll("_", " ").replace(/^\p{L}/u, (letter) => letter.toLocaleUpperCase());
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
      state.allEdges ??= await archiveEdges();
      if (request !== state.request) return;
      state.loadError = "";
      el.empty_state.classList.remove("failed");
      el.empty_state.querySelector("strong").dataset.i18n = "noConnections";
      el.empty_state.querySelector("p").dataset.i18n = "noConnectionsHint";
      KindredI18n.apply(el.empty_state);
      state.selected = previous && record(previous) ? previous : state.person;
      if (!state.person) state.person = payload.query.nodes.find((item) => item.kind === "person")?.id || "";
      populatePeople();
      renderDiagnostics();
      renderGraph();
      renderDetails();
      if (!keepSelection) {
        const query = new URLSearchParams(location.search);
        const requested = query.get("person");
        if (requested && record(requested)?.kind === "person") { state.selected = requested; renderGraphSelection(); renderDetails(); }
        if (query.get("page") === "upcoming") { state.page = "upcoming"; renderUpcomingPage(); }
      }
      if (!history.state?.kindred) history.replaceState(snapshot(), "");
      if (!keepSelection && phoneQuery.matches && record(state.selected)?.kind === "person" && !state.page) setSheet("peek", { focus: false });
    } catch (error) {
      if (request !== state.request) return;
      state.loadError = error instanceof Error ? error.message : String(error);
      el.graph_status.textContent = t("couldNotLoad");
      // Relatives get a way forward; the technical message stays in the Research diagnostics.
      el.empty_state.classList.add("failed");
      el.empty_state.querySelector("strong").dataset.i18n = "couldNotLoad";
      el.empty_state.querySelector("p").dataset.i18n = "reloadHint";
      KindredI18n.apply(el.empty_state);
      el.empty_state.hidden = false;
      clear(el.nodes);
      clear(el.edges);
      showError(state.loadError);
    }
  }

  // Accepted claims of the whole archive: family rows, kinship and the family page need more than the current view.
  async function archiveEdges() {
    try {
      const edges = staticSite
        ? (await readStaticGraph()).edges
        : (await fetchPayload(new URLSearchParams({ mode: "overview", generations: "64", relations: "", statuses: "accepted" }))).query.edges;
      return edges.filter((edge) => (edge.status || "accepted") === "accepted");
    } catch { return null; }
  }
  function familyEdges() { return state.allEdges || state.data?.query.edges || []; }

  function readMe() {
    try { return localStorage.getItem("kindred.me") || ""; } catch { return ""; }
  }
  function setMe(id) {
    state.me = id;
    try { if (id) localStorage.setItem("kindred.me", id); else localStorage.removeItem("kindred.me"); } catch { /* Private browsing can refuse storage. */ }
    el.home_button.hidden = !id;
    renderGraph({ fit: false });
    renderDetails();
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
    // Reminders need a same-origin registration path and the server's VAPID public key.
    const push = typeof settings?.push?.url === "string" && /^\/(?!\/)\S*$/u.test(settings.push.url) && /^[A-Za-z0-9_-]{87}$/u.test(settings?.push?.key || "")
      ? { url: settings.push.url, key: settings.push.key } : null;
    const name = typeof settings?.name === "string" ? settings.name.trim().slice(0, 60) : "";
    return { view, suggest, push, name };
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
    const layoutRoot = layoutRootId();
    el.arrangement_caption.textContent = state.mode === "path" ? t("connectionPath") : el.layout_order.value === "sides"
      ? t("arrangedAround", { name: label(record(layoutRoot)) })
      : t("compactGroups");
    state.positions = KindredLayout.layout(nodes, edges, { mode: state.mode, root: layoutRoot, sideOrdering: el.layout_order.value === "sides", roleForEdge: parentRole, cardWidth: CARD_WIDTH, cardHeight: CARD_HEIGHT });
    state.orderedIds = nodes.map((node) => node.id);
    clear(el.nodes);
    clear(el.edges);
    renderFamilyPage();

    const rails = KindredLayout.familyRails(edges, state.positions, { cardWidth: CARD_WIDTH, cardHeight: CARD_HEIGHT });
    renderBands(nodes);
    for (const edge of edges) renderEdge(edge, edges, rails);
    for (const edge of edges) renderMarriage(edge, edges);
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
    const open = state.questions ? nodes.filter((node) => node.kind === "person").reduce((sum, node) => sum + openQuestions(node).length, 0) : 0;
    const questionsText = state.questions ? ` · ${t("missingCount", { count: open })}` : "";
    el.graph_status.textContent = phoneQuery.matches ? peopleText : state.view === "simple" ? `${peopleText}${questionsText}` : `${peopleText}${evidenceText} · ${claimsText}${questionsText}`;
    if (fit) requestAnimationFrame(startGraph);
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

  // A card is name, life line and one line of detail. Lineage shows as a bar on the left (see renderGraphSelection);
  // the surface stays neutral, so no colour can be read as a gender code.
  // A recorded marriage between two partners shows as rings and its year where the couple's line meets the children's.
  // Recorded marriage events by the pair of people they name, built once per payload.
  let marriages = { data: null, byPair: new Map() };
  function marriageOf(first, second) {
    if (marriages.data !== state.data) {
      const byPair = new Map();
      for (const item of state.data.records) {
        if (item.kind !== "event" || String(item.metadata?.event_type || item.metadata?.type) !== "marriage") continue;
        const people = [...new Set([...linkedIds(item, "people"), ...(item.owner ? [item.owner] : [])])].sort();
        for (let i = 0; i < people.length; i += 1) for (let j = i + 1; j < people.length; j += 1) {
          const key = `${people[i]}\u0000${people[j]}`;
          if (!byPair.has(key)) byPair.set(key, item);
        }
      }
      marriages = { data: state.data, byPair };
    }
    return marriages.byPair.get([first, second].sort().join("\u0000")) || null;
  }

  // Faint alternating bands, one per generation row, labelled with the row's median birth year, or relative to
  // "me" when that person is in the view.
  function renderBands(nodes) {
    clear(el.bands);
    if (state.mode === "path") return;
    const rows = new Map();
    for (const node of nodes) {
      if (node.kind !== "person" || !state.positions.has(node.id)) continue;
      const y = state.positions.get(node.id).y;
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y).push(node);
    }
    if (rows.size < 2) return;
    const ys = [...rows.keys()].sort((a, b) => a - b);
    const xs = [...state.positions.values()].map((point) => point.x);
    const left = Math.min(...xs) - CARD_WIDTH / 2, right = Math.max(...xs) + CARD_WIDTH / 2;
    const step = Math.min(...ys.slice(1).map((y, index) => y - ys[index]));
    const meY = state.me && state.positions.has(state.me) ? state.positions.get(state.me).y : null;
    ys.forEach((y, index) => {
      if (index % 2 === 0) el.bands.append(svg("rect", { className: "band", attrs: { x: left - 4000, y: y - step / 2, width: right - left + 8000, height: step } }));
      const years = rows.get(y).map((node) => Number.parseInt(year(dateValue(node, "born")), 10)).filter(Number.isFinite).sort((a, b) => a - b);
      const around = years.length ? t("generationAround", { year: Math.round(years[Math.floor(years.length / 2)] / 5) * 5 }) : "";
      const offset = meY === null ? null : Math.round((y - meY) / step);
      const relative = offset !== null && KindredI18n.has(`generation.${offset}`) ? t(`generation.${offset}`) : "";
      const text = [relative, around].filter(Boolean).join(" · ");
      if (text) el.bands.append(svg("text", { className: "band-label", text, attrs: { x: left - 28, y, "text-anchor": "end", "dominant-baseline": "central" } }));
    });
  }

  // A recorded marriage is a knot on the couple's descent line: a small disc with interlocking rings, centred on the
  // line to the children, with the year beside it. A couple without a shared child gets a short stub so it does not float.
  function renderMarriage(edge, edges) {
    if (edge.relation !== "partner" || state.mode === "path") return;
    const from = state.positions.get(edge.from), to = state.positions.get(edge.to);
    if (!from || !to || from.y !== to.y) return;
    const marriage = marriageOf(edge.from, edge.to);
    if (!marriage) return;
    const date = plainValue(marriage.metadata?.date);
    const place = record(marriage.metadata?.place);
    // A year taken from wording such as "about 1950" keeps its uncertainty.
    const shown = date ? `${/^\d{4}(?:-\d{2}){0,2}$/u.test(date) ? "" : "~"}${year(date)}` : "";
    const adjacent = Math.abs(to.x - from.x) <= CARD_WIDTH + 40;
    const drop = CARD_HEIGHT / 2 + (adjacent ? 16 : 20);
    const isParent = (link) => !["partner", "evidence", "event"].includes(link.relation);
    const sharedChild = edges.some((first) => first.from === edge.from && isParent(first)
      && edges.some((second) => second.from === edge.to && second.to === first.to && isParent(second)));
    const description = [date ? t("marriedOn", { date: formatDate(date) }) : t("marriedUndated"), place ? label(place) : ""].filter(Boolean).join(" · ");
    const group = svg("g", { className: "marriage-mark", attrs: { transform: `translate(${(from.x + to.x) / 2} ${from.y + drop})`, role: "img", "aria-label": description, "data-from": edge.from, "data-to": edge.to } });
    if (adjacent && !sharedChild) group.append(svg("line", { className: "marriage-stub", attrs: { x1: 0, x2: 0, y1: -drop, y2: -10 } }));
    const body = svg("g", { className: "marriage-body" });
    body.append(svg("circle", { className: "marriage-disc", attrs: { r: 10 } }));
    body.append(svg("use", { attrs: { href: "/icons.svg#rings", x: -7.5, y: -7.5, width: 15, height: 15 } }));
    if (shown) body.append(svg("text", { text: shown, attrs: { x: 15, y: 0, "dominant-baseline": "central" } }));
    group.append(body, svg("title", { text: description }));
    el.edges.append(group);
  }



  function renderNode(node) {
    const position = state.positions.get(node.id);
    if (!position) return;
    const person = node.kind === "person";
    const deceased = person && KindredLife.deceased(node);
    const group = html("div", {
      className: `node${person ? "" : " evidence"}${deceased ? " deceased" : ""}${state.selected === node.id ? " selected" : ""}`,
      attrs: { tabindex: "0", role: "button", "aria-label": nodeAriaLabel(node), "data-id": node.id }
    });
    // Positioned through the CSSOM, which the page's style-src policy allows (unlike inline style attributes).
    Object.assign(group.style, { left: `${position.x - CARD_WIDTH / 2}px`, top: `${position.y - CARD_HEIGHT / 2}px`, width: `${CARD_WIDTH}px`, height: `${CARD_HEIGHT}px` });
    const card = html("div", { className: "person-card" });
    const head = html("div", { className: "person-head" });
    const portrait = portraitFor(node);
    const missing = person && state.questions ? openQuestions(node) : [];
    const avatar = html("span", { className: `person-avatar${missing.includes("portrait") ? " wanted" : ""}`, attrs: { "aria-hidden": "true" } });
    avatar.textContent = person ? initials(label(node)) : "";
    if (!person) avatar.append(icon("book-open"));
    if (portrait) {
      const photo = html("img", { attrs: { src: portrait.url, alt: "", decoding: "async" } });
      photo.addEventListener("error", () => { avatar.textContent = initials(label(node)); });
      avatar.replaceChildren(photo);
    }
    const copy = html("div", { className: "person-copy" });
    copy.append(html("span", { className: "person-name", text: label(node) }));
    head.append(avatar, copy);
    // Birth mark, years, then the age in its own span, so compact cards can drop it for the deceased.
    const life = html("div", { className: "person-life" });
    if (person) {
      const parts = lifeParts(node);
      if (parts.born) { const mark = icon("birth-mark"); mark.classList.add("life-symbol"); life.append(mark); }
      if (parts.years) life.append(html("span", { className: "life-years", text: parts.years }));
      if (parts.age) life.append(html("span", { className: "life-age", text: parts.years ? ` · ${parts.age}` : parts.age }));
      if (!parts.years && !parts.age) life.append(html("span", { className: "life-years", text: t("datesNotRecorded") }));
    } else life.textContent = known("kind", node.kind);
    card.append(head, life);
    // Research names the parent role in words; Simple leaves it to the lines.
    if (person && state.view !== "simple") {
      const roles = [...new Set(state.data.query.edges.filter((edge) => edge.from === node.id && edge.relation !== "partner").map(parentRole))];
      card.append(html("div", { className: "person-role", text: roles.length ? known("role", roles.length === 1 ? roles[0] : "parent") : "" }));
    }
    const occupation = plainValue(node.metadata?.occupation);
    const birthPlaceRecord = record(record(lifeEventId(node, "birth"))?.metadata?.place);
    const birthPlace = birthPlaceRecord ? label(birthPlaceRecord) : /^\[\[/u.test(plainValue(node.metadata?.birth_place)) ? "" : plainValue(node.metadata?.birth_place);
    const meta = person ? [occupation, birthPlace].filter(Boolean).join(" · ") : t("openToReadSource");
    if (missing.length) {
      const row = html("div", { className: "person-meta missing" });
      row.append(html("span", { className: "missing-names", text: `${t("missingShort")} ${missing.slice(0, 2).map((key) => t(`question.${key}`)).join(", ")}` }));
      if (missing.length > 2) row.append(html("span", { className: "missing-more", text: `+${missing.length - 2}` }));
      card.append(row, html("span", { className: "missing-flag", text: `? ${missing.length}`, attrs: { "aria-hidden": "true" } }));
      card.classList.add("flagged");
    } else if (meta) {
      card.append(html("div", { className: "person-meta", text: meta }));
    }
    group.append(card);
    const missingText = missing.length ? ` · ${t("missingCount", { count: missing.length })}` : "";
    group.title = `${label(node)} · ${lifeSummary(node, { full: true })}${meta && person ? ` · ${meta}` : ""}${missingText}`;
    group.addEventListener("click", () => select(node.id));
    group.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); select(node.id, true); }
    });
    el.nodes.append(group);
  }

  function nodeAriaLabel(item, category) {
    const name = label(item);
    const base = category ? t("nodeLabelRole", { name, role: t(familyLabels[category]) }) : t("nodeLabel", { name });
    const life = item?.kind === "person" ? lifeDescription(item) : "";
    return life ? `${base.replace(/\.$/u, "")}. ${life}` : base;
  }

  function truncate(value, length) {
    const characters = [...String(value)];
    return characters.length > length ? `${characters.slice(0, length - 1).join("")}…` : value;
  }

  // "* 1954 · 72 years" or "1928 – 2005 · 76 years"; full: true writes the dates out. Without a recorded death a person
  // counts as living; past KindredLife.OLD_AGE the age is left out, since the death is more likely just unrecorded.
  function lifeSummary(item, { full = false } = {}) {
    if (item.kind !== "person") return known("kind", item.kind);
    const parts = lifeParts(item, { full });
    const span = parts.years && !parts.deceased ? t("bornShort", { date: parts.years }) : parts.years;
    return [span, parts.age].filter(Boolean).join(" · ") || t("datesNotRecorded");
  }

  // The pieces of a life line: the years (or full dates), whether a birth is known, and the age.
  function lifeParts(item, { full = false } = {}) {
    const born = dateValue(item, "born"), died = dateValue(item, "died");
    const show = full ? formatDate : year;
    const deceased = KindredLife.deceased(item);
    const years = deceased && (born || died) ? t(full ? "lifeSpanFull" : "lifeSpan", { born: born ? show(born) : "?", died: died ? show(died) : "?" }) : born ? show(born) : "";
    return { years, born: Boolean(born), deceased, age: ageText(item) };
  }

  // Spoken form for assistive technology: "Born 1928, died 2005, 76 years".
  function lifeDescription(item) {
    const born = dateValue(item, "born"), died = dateValue(item, "died");
    return [born ? `${t("born")} ${formatDate(born)}` : "", died ? `${t("died")} ${formatDate(died)}` : "", ageText(item)].filter(Boolean).join(", ");
  }

  function ageText(item) {
    const age = KindredLife.age(item);
    if (!age || (!age.deceased && age.years >= KindredLife.OLD_AGE)) return "";
    return t(age.exact ? "ageYears" : "ageAbout", { count: age.years });
  }

  // What is still missing about a person. Parent links come from the claims and from the note itself.
  function openQuestions(item) {
    const metadata = item.metadata || {};
    const linked = new Set((state.data?.query.edges || []).filter((edge) => edge.to === item.id && edge.relation !== "partner").map((edge) => edge.from)).size;
    const noted = (Array.isArray(metadata.parents) ? metadata.parents.length : 0) + (metadata.mother ? 1 : 0) + (metadata.father ? 1 : 0);
    return KindredLife.questions(item, { parents: Math.max(linked, noted), portrait: Boolean(portraitFor(item)) });
  }

  function plainValue(value) {
    if (value === undefined || value === null) return "";
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
    if (Array.isArray(value)) return value.map(plainValue).join(", ");
    // Named objects, such as places, read as their name; other objects stay as JSON.
    const named = [value.name, value.title].find((candidate) => typeof candidate === "string" && candidate);
    return named || JSON.stringify(value);
  }

  // A one-time hint on how to explore; it goes for good once closed, or once the reader pans or picks someone.
  function dismissHint() {
    if (el.first_hint.hidden) return;
    el.first_hint.hidden = true;
    try { localStorage.setItem("kindred.hint", "done"); } catch { /* Private browsing can refuse storage. */ }
  }
  function showHint() {
    let done = false;
    try { done = localStorage.getItem("kindred.hint") === "done"; } catch { done = false; }
    el.first_hint.querySelector("span").dataset.i18n = window.matchMedia("(pointer: coarse)").matches ? "firstHintTouch" : "firstHintPointer";
    KindredI18n.apply(el.first_hint);
    el.first_hint.hidden = done;
  }

  function showMode(mode) {
    for (const button of document.querySelectorAll("[data-mode]")) button.setAttribute("aria-pressed", String(button.dataset.mode === mode));
    el.path_picker.hidden = mode !== "path";
    el.overview_toggle.hidden = mode !== "overview";
    el.branch_picker.hidden = mode !== "overview";
  }

  // Back and forward walk through the people and views a reader chose. Panning and zooming add no steps; the step
  // being left keeps its camera, so going back returns to the same place.
  const STEP_KEYS = ["selected", "person", "to", "mode", "overviewRoot", "generations", "page"];
  let restoring = false;
  function snapshot() {
    return { kindred: 1, selected: state.selected, person: state.person, to: state.to, mode: state.mode, overviewRoot: state.overviewRoot, generations: el.generations.value, page: state.page };
  }
  function leaveStep() {
    if (restoring || !history.state?.kindred) return;
    history.replaceState({ ...history.state, camera: { scale: state.scale, tx: state.tx, ty: state.ty } }, "");
  }
  function enterStep() {
    if (restoring || !state.data) return;
    const next = snapshot();
    if (history.state?.kindred && STEP_KEYS.every((key) => history.state[key] === next[key])) return;
    history.pushState(next, "");
  }
  window.addEventListener("popstate", (event) => {
    const step = event.state;
    if (!step?.kindred || !state.data) return;
    restoring = true;
    const reload = step.mode !== state.mode || step.person !== state.person || step.to !== state.to || step.generations !== el.generations.value;
    Object.assign(state, { selected: step.selected, person: step.person, to: step.to, overviewRoot: step.overviewRoot, mode: step.mode, layoutRoot: "", pendingCamera: step.camera || null, page: step.page || "" });
    renderUpcomingPage();
    el.generations.value = step.generations;
    showMode(step.mode);
    // A path step from before its second person was chosen waits for that choice again.
    if (step.mode === "path" && !step.to) { el.path_to.value = ""; el.graph_status.textContent = t("chooseSecondPerson"); }
    else if (reload) loadGraph();
    else { populatePeople(); renderGraph(); renderDetails(); }
    restoring = false;
  });

  function select(id, openFamily = false) {
    leaveStep();
    dismissHint();
    state.selected = id;
    if (!state.person) state.person = id;
    renderGraphSelection();
    renderDetails();
    if (state.sheet === "hidden") setSheet("peek", { focus: false });
    else if (state.sheet === "expanded") el.details_body.scrollTop = 0;
    revealSelected();
    if (record(id)?.kind === "person" && openFamily) {
      state.person = id;
      setMode("focus");
    }
    enterStep();
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
    const blood = KindredFamily.bloodRelatives(focus, visibleEdges);
    for (const node of el.nodes.children) {
      const id = node.dataset.id;
      const category = family.people.get(id);
      node.classList.toggle("selected", id === state.selected);
      node.classList.toggle("blood", active && blood.has(id));
      node.classList.toggle("family-muted", active && !category && record(id)?.kind === "person");
      node.dataset.family = category || "";
      node.setAttribute("aria-label", nodeAriaLabel(record(id), category));
      node.setAttribute("aria-pressed", String(id === state.selected));
    }
    for (const edge of el.edges.children) {
      if (edge.classList.contains("marriage-mark")) {
        edge.classList.toggle("family-muted", active && !(family.people.has(edge.dataset.from) && family.people.has(edge.dataset.to)));
        continue;
      }
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
    renderPeek(item);
    clear(el.details_body);
    if (state.view === "simple" && item.kind !== "person") return renderSimpleRecord(item);
    const simple = state.view === "simple";
    const header = html("header", { className: "detail-header" });
    header.append(html("span", { className: "eyebrow", text: item.kind ? known("kind", item.kind) : t("recordEyebrow") }));
    header.append(html("h1", { text: label(item) }));
    const portrait = portraitFigure(item);
    if (portrait) header.append(portrait);
    if (item.kind === "person") {
      const dates = html("div", { className: "detail-dates" });
      const deceased = KindredLife.deceased(item), age = ageText(item);
      dates.append(dateFact(item, "born"));
      if (deceased) dates.append(dateFact(item, "died"));
      if (age) dates.append(fact(t(deceased ? "ageAtDeath" : "age"), age));
      header.append(dates);
      if (simple) {
        const places = ["birth", "death"].flatMap((kind) => {
          const place = record(record(lifeEventId(item, kind))?.metadata?.place);
          return place ? [kind === "birth" ? t("bornIn", { place: label(place) }) : t("diedIn", { place: label(place) })] : [];
        });
        if (places.length) { const line = html("p", { className: "detail-places" }); line.append(icon("map-pin"), document.createTextNode(places.join(" · "))); header.append(line); }
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
        const branch = html("button", { className: "quiet-button", text: expanded ? t("collapseBranch") : t("expandBranch"), attrs: { type: "button" } });
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
      // One filled action: opening the family. Branch folding is secondary; arranging around a person is a research tool.
      const family = html("button", { className: "primary-button", text: t("openFamily"), attrs: { type: "button" } });
      family.addEventListener("click", () => { state.person = item.id; setSheet("peek"); setMode("focus"); });
      actions.prepend(family);
      if (!simple) {
        const arrange = html("button", { className: "quiet-button", text: t("arrangeFamilySides"), attrs: { type: "button" } });
        arrange.addEventListener("click", () => { state.layoutRoot = item.id; el.layout_order.value = "sides"; renderGraph(); });
        actions.append(arrange);
      }
    }
    const edit = html("button", { className: "quiet-button", text: item.owner ? t("editPersonNote") : t("editNote"), attrs: { type: "button" } });
    edit.addEventListener("click", () => openEditor(item));
    if (!simple && !staticSite) actions.append(edit);
    const itemUrl = item.metadata?.url;
    if (item.kind === "source" && typeof itemUrl === "string" && /^https?:\/\//iu.test(itemUrl)) {
      actions.append(html("a", { className: "quiet-button", text: t("openSource"), attrs: { href: itemUrl, target: "_blank", rel: "noopener noreferrer" } }));
    }
    if (item.kind === "person") {
      const mine = state.me === item.id;
      const me = html("button", { className: `quiet-button me-button${mine ? " is-me" : ""}`, attrs: { type: "button", "aria-pressed": String(mine) } });
      me.append(icon("user-round-check"), document.createTextNode(t(mine ? "thisIsYou" : "thisIsMe")));
      me.title = t(mine ? "notMeHint" : "thisIsMeHint");
      me.addEventListener("click", () => setMe(mine ? "" : item.id));
      actions.append(me);
    }
    header.append(actions);
    if (item.owner) {
      const owner = record(item.owner);
      const origin = html("button", { className: "portrait-credit", text: t("fromNote", { name: label(owner) }), attrs: { type: "button" } });
      origin.addEventListener("click", () => select(owner.id));
      header.append(origin);
    }
    el.details_body.append(header);

    if (item.kind === "person") renderKinship(item);
    if (state.questions && item.kind === "person") renderQuestions(item);
    if (simple && item.kind === "person") renderFamilyRows(item);
    else renderParents(item);
    if (item.body) section(t("sectionStories"), renderProse(item.body), "book-open");
    if (item.kind === "person") renderTimeline(item);
    if (!simple) { renderFacts(item); renderRelations(item); renderEvents(item); }
    if (!simple) {
      renderEvidence(item);
      renderAttachments(item);
      if (!item.owner && !staticSite) renderNoteComposer(item);
    }
    // Suggestions come after the person's own content.
    if (staticSite?.suggest && item.kind === "person") {
      const footer = html("div", { className: "detail-footer" });
      const suggest = html("button", { className: "quiet-button", text: t("suggestButton"), attrs: { type: "button" } });
      suggest.addEventListener("click", () => openSuggestion(item));
      footer.append(suggest);
      el.details_body.append(footer);
    }
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
    el.details_body.append(header);
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
    el.details_body.append(wrapper);
  }

  // Kinship terms are neutral: the archive records roles, not genders, so "aunt or uncle" rather than a guess.
  function kinTerm(found) {
    if (!found) return "";
    if (found.kind === "self") return t("kin.self");
    if (found.kind === "partner") return t("kin.partner");
    const { up, down } = found;
    const repeat = (count, word) => count <= 0 ? "" : count <= 3 ? word.repeat(count) : `${count}× ${word}`;
    let term;
    if (up === 0) term = down === 1 ? t("kin.child") : down === 2 ? t("kin.grandchild") : t("kin.greatGrandchild", { greats: repeat(down - 2, t("kin.great")) });
    else if (down === 0) term = up === 1 ? t("kin.parent") : up === 2 ? t("kin.grandparent") : t("kin.greatGrandparent", { greats: repeat(up - 2, t("kin.great")) });
    else if (up === 1 && down === 1) term = t(found.half ? "kin.halfSibling" : "kin.sibling");
    else if (up === 1) term = down === 2 ? t("kin.nibling") : t("kin.grandNibling", { greats: repeat(down - 3, t("kin.great")) });
    else if (down === 1) term = up === 2 ? t("kin.auntUncle") : t("kin.grandAuntUncle", { greats: repeat(up - 3, t("kin.great")) });
    else {
      const degree = Math.min(up, down) - 1, removed = Math.abs(up - down);
      term = degree === 1 ? t("kin.cousin") : t("kin.cousinDegree", { degree });
      if (removed) term = t("kin.removed", { term, count: removed });
    }
    if (found.half && !(up === 1 && down === 1)) term = t("kin.half", { term });
    term = term.charAt(0).toLocaleUpperCase() + term.slice(1);
    if (found.kind === "partnerOfRelative") return t("kin.partnerOf", { name: label(record(found.partner)), term });
    if (found.kind === "relativeOfPartner") return t("kin.ofPartner", { name: label(record(found.partner)), term });
    return term;
  }

  function kinshipTo(id) {
    return state.me && id && record(state.me) ? KindredFamily.kinship(state.me, id, familyEdges()) : null;
  }

  function renderKinship(item) {
    if (!state.me || state.me === item.id || !record(state.me)) return;
    const found = kinshipTo(item.id);
    const box = html("div", { className: "kinship" });
    box.append(html("strong", { className: "kinship-term", text: found ? kinTerm(found) : t("kin.none") }));
    if (found?.via?.length && found.kind !== "partner") {
      const line = html("p", { className: "kinship-via" });
      line.append(document.createTextNode(`${t(found.via.length > 1 ? "kin.commonAncestors" : "kin.commonAncestor")} `));
      found.via.forEach((id, index) => {
        if (index) line.append(document.createTextNode(t("and")));
        const link = html("button", { className: "link-button", text: label(record(id)), attrs: { type: "button" } });
        link.addEventListener("click", () => select(id));
        line.append(link);
      });
      box.append(line);
    }
    section(t("kin.title", { name: label(record(state.me)) }), box, "users-round");
  }

  // Simple view: parents, partners (with the marriage), children and siblings as compact rows.
  function personRow(id, extra = "", open = select) {
    const person = record(id);
    const row = html("button", { className: "family-row", attrs: { type: "button" } });
    if (!person) return row;
    const avatar = html("span", { className: `row-avatar${KindredLife.deceased(person) ? " deceased" : ""}`, text: initials(label(person)), attrs: { "aria-hidden": "true" } });
    const copy = html("span", { className: "row-copy" });
    copy.append(html("strong", { text: label(person) }), html("small", { text: [lifeSummary(person), extra].filter(Boolean).join(" · ") }));
    row.append(avatar, copy);
    row.addEventListener("click", () => open(id));
    return row;
  }

  // On phones the Family tab is a page of rows: the person, parents, each partner with their children, siblings.
  // Tapping someone makes them the centre; "Show as tree" returns to the graph until the tab is opened again.
  function renderFamilyPage() {
    const person = record(state.person);
    const show = phoneQuery.matches && state.mode === "focus" && !state.familyAsTree && person?.kind === "person";
    el.family_page.hidden = !show;
    clear(el.family_page);
    if (!show) return;
    // The page already shows the person; the peek sheet would only repeat it.
    if (state.sheet === "peek") setSheet("hidden", { focus: false });
    const go = (id) => { leaveStep(); state.person = id; state.selected = id; setMode("focus"); };
    const family = KindredFamily.familyOf(person.id, familyEdges());
    const hero = html("button", { className: "family-hero", attrs: { type: "button" } });
    const copy = html("span", { className: "row-copy" });
    copy.append(html("strong", { text: label(person) }), html("small", { text: lifeSummary(person, { full: true }) }));
    const birthPlace = record(record(lifeEventId(person, "birth"))?.metadata?.place);
    const meta = [plainValue(person.metadata?.occupation), birthPlace ? label(birthPlace) : ""].filter(Boolean).join(" · ");
    if (meta) copy.append(html("small", { text: meta }));
    hero.append(html("span", { className: `row-avatar large${KindredLife.deceased(person) ? " deceased" : ""}`, text: initials(label(person)), attrs: { "aria-hidden": "true" } }), copy);
    hero.addEventListener("click", () => { select(person.id); setSheet("expanded"); });
    const tree = html("button", { className: "quiet-button family-tree-button", text: t("showAsTree"), attrs: { type: "button" } });
    tree.addEventListener("click", () => { state.familyAsTree = true; renderGraph(); });
    el.family_page.append(hero, tree);
    const block = (title, rows) => {
      if (!rows.length) return;
      const group = html("section", { className: "family-block" });
      group.append(html("h3", { text: title }));
      const list = html("div", { className: "family-rows" });
      list.append(...rows);
      group.append(list);
      el.family_page.append(group);
    };
    const born = (id) => String(dateValue(record(id) || {}, "born") || "9999");
    const byBirth = (ids) => [...ids].sort((a, b) => born(a).localeCompare(born(b)));
    block(t("familyParents"), byBirth(family.parents).map((id) => personRow(id, relationExtra(id, person.id), go)));
    const placed = new Set();
    for (const partner of family.partners) {
      const children = family.children.filter((child) => child.otherParents.includes(partner)).map((child) => child.id);
      children.forEach((id) => placed.add(id));
      const rows = [personRow(partner, marriageExtra(person.id, partner), go), ...byBirth(children).map((id) => personRow(id, relationExtra(person.id, id), go))];
      block(t("familyWith", { name: label(record(partner)) }), rows);
    }
    block(t("familyChildren"), byBirth(family.children.map((child) => child.id).filter((id) => !placed.has(id))).map((id) => personRow(id, relationExtra(person.id, id), go)));
    block(t("familySiblings"), family.siblings.map((sibling) => personRow(sibling.id, sibling.half ? t("kin.halfSibling") : "", go)));
  }

  // The "Coming up" page: the next twelve months of birthdays, memorial days and wedding anniversaries, by month,
  // from full dates only, and the reminder settings when the site offers reminders.
  function setPage(page) {
    leaveStep();
    state.page = page;
    // A page takes the whole area: the menu closes, and on phones the peek sheet steps aside.
    setMenu(false);
    if (page && phoneQuery.matches && state.sheet === "peek") setSheet("hidden", { focus: false });
    enterStep();
    renderUpcomingPage();
  }

  function occasionsAhead(days) {
    const persons = state.data.records.filter((item) => item.kind === "person");
    const marriages = state.data.records.filter((item) => item.kind === "event" && String(item.metadata?.event_type || item.metadata?.type) === "marriage")
      .map((item) => ({ ids: [...new Set([...(item.owner ? [item.owner] : []), ...linkedIds(item, "people")])], date: plainValue(item.metadata?.date) }));
    return KindredLife.upcoming(persons, marriages, { days });
  }

  function renderUpcomingPage() {
    const open = state.page === "upcoming" && Boolean(state.data);
    el.upcoming_page.hidden = !open;
    el.upcoming_button.setAttribute("aria-pressed", String(open));
    clear(el.upcoming_page);
    if (!open) return;
    const head = html("header", { className: "page-head" });
    head.append(html("h2", { text: t("upcomingTitle") }));
    const close = html("button", { className: "quiet-button", text: t("backToTree"), attrs: { type: "button" } });
    close.addEventListener("click", () => setPage(""));
    head.append(close);
    el.upcoming_page.append(head);
    if (staticSite?.push) el.upcoming_page.append(reminderCard());
    const locale = KindredI18n.lang() === "de" ? "de-DE" : "en-GB";
    const day = new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short" });
    const month = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" });
    const occasions = occasionsAhead(365);
    if (!occasions.length) el.upcoming_page.append(html("p", { className: "upcoming-none", text: t("upcomingNone") }));
    let list = null, current = "";
    for (const occasion of occasions) {
      const heading = month.format(occasion.date);
      if (heading !== current) {
        current = heading;
        el.upcoming_page.append(html("h3", { className: "upcoming-month", text: heading }));
        list = html("div", { className: "upcoming-list" });
        el.upcoming_page.append(list);
      }
      const names = occasion.ids.map((id) => label(record(id)));
      const text = t(`upcoming.${occasion.type}`, { name: names[0], names: names.join(" & "), count: occasion.years });
      const when = occasion.inDays === 0 ? t("today") : occasion.inDays === 1 ? t("tomorrow") : t("inDays", { count: occasion.inDays });
      const row = html("button", { className: `upcoming-row ${occasion.type}`, attrs: { type: "button" } });
      const date = html("span", { className: "upcoming-date" });
      date.append(html("strong", { text: day.format(occasion.date) }), html("small", { text: when }));
      row.append(date, html("span", { className: "upcoming-text", text }));
      row.addEventListener("click", () => { setPage(""); select(occasion.ids[0]); });
      list.append(row);
    }
  }

  // Reminders arrive as Web Push messages from the site's server. iPhones only allow them for a site added to the
  // Home Screen, so the card explains that first. The choices are kept in this browser and sent with the subscription.
  const REMINDER_KEY = "kindred.reminders";
  function reminderChoices() {
    try {
      const stored = JSON.parse(localStorage.getItem(REMINDER_KEY) || "null");
      if (stored && Array.isArray(stored.offsets) && Array.isArray(stored.kinds)) return stored;
    } catch { /* Fall back to the defaults. */ }
    return { offsets: [1, 7], kinds: ["birthday", "wedding"] };
  }

  function base64urlBytes(text) {
    const padded = text.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - text.length % 4) % 4);
    return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
  }

  function reminderCard() {
    const card = html("section", { className: "reminder-card" });
    card.append(html("h3", { text: t("reminders.title") }));
    const status = html("p", { className: "reminder-status", attrs: { role: "status" } });
    const ios = /iPad|iPhone|iPod/u.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const installed = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
    const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    if (ios && !installed) { status.textContent = t("reminders.installFirst"); card.append(status); return card; }
    if (!supported) { status.textContent = t("reminders.unsupported"); card.append(status); return card; }
    const choices = reminderChoices();
    const options = html("div", { className: "reminder-options" });
    const box = (group, value, text) => {
      const field = html("label", { className: "reminder-choice" });
      const input = html("input", { attrs: { type: "checkbox", value, "data-group": group } });
      input.checked = choices[group].includes(group === "offsets" ? Number(value) : value);
      field.append(input, document.createTextNode(` ${text}`));
      return field;
    };
    const when = html("fieldset");
    when.append(html("legend", { text: t("reminders.when") }), box("offsets", "0", t("reminders.onTheDay")), box("offsets", "1", t("reminders.dayBefore")), box("offsets", "7", t("reminders.weekBefore")));
    const what = html("fieldset");
    what.append(html("legend", { text: t("reminders.what") }), box("kinds", "birthday", t("reminders.birthdays")), box("kinds", "wedding", t("reminders.weddings")), box("kinds", "memorial", t("reminders.memorials")));
    options.append(when, what);
    const actions = html("div", { className: "reminder-actions" });
    const enable = html("button", { className: "primary-button", attrs: { type: "button" } });
    const disable = html("button", { className: "quiet-button", text: t("reminders.off"), attrs: { type: "button" } });
    actions.append(enable, disable);
    card.append(options, actions, status);
    const read = () => ({
      offsets: [...card.querySelectorAll('input[data-group="offsets"]:checked')].map((input) => Number(input.value)),
      kinds: [...card.querySelectorAll('input[data-group="kinds"]:checked')].map((input) => input.value)
    });
    const show = async () => {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      enable.textContent = t(subscription ? "reminders.save" : "reminders.on");
      disable.hidden = !subscription;
      if (!status.textContent) status.textContent = subscription ? t("reminders.active") : "";
    };
    enable.addEventListener("click", async () => {
      const chosen = read();
      if (!chosen.offsets.length || !chosen.kinds.length) { status.textContent = t("reminders.chooseSomething"); return; }
      enable.disabled = true;
      status.textContent = t("reminders.working");
      try {
        if (await Notification.requestPermission() !== "granted") throw new Error("permission");
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription()
          || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64urlBytes(staticSite.push.key) });
        const response = await fetch(staticSite.push.url, {
          method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subscription: subscription.toJSON(), offsets: chosen.offsets, kinds: chosen.kinds, lang: KindredI18n.lang() })
        });
        if (!response.ok) throw new Error(`status ${response.status}`);
        try { localStorage.setItem(REMINDER_KEY, JSON.stringify(chosen)); } catch { /* Private browsing can refuse storage. */ }
        status.textContent = t("reminders.saved");
      } catch (error) {
        status.textContent = t(error.message === "permission" ? "reminders.denied" : "reminders.failed");
      } finally {
        enable.disabled = false;
        show();
      }
    });
    disable.addEventListener("click", async () => {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await fetch(staticSite.push.url, { method: "DELETE", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: subscription.endpoint }) }).catch(() => {});
        await subscription.unsubscribe();
      }
      status.textContent = t("reminders.stopped");
      show();
    });
    show();
    return card;
  }

  function relationExtra(parent, child) {
    const edge = familyEdges().find((candidate) => candidate.from === parent && candidate.to === child && candidate.relation !== "partner");
    return edge && edge.relation !== "biological_parent" ? known("relation", edge.relation.replace("_parent", "")) : "";
  }

  function marriageExtra(first, second) {
    const marriage = marriageOf(first, second);
    if (!marriage) return "";
    const date = plainValue(marriage.metadata?.date);
    return date ? t("marriedOn", { date: year(date) }) : t("married");
  }

  function renderFamilyRows(item) {
    const family = KindredFamily.familyOf(item.id, familyEdges());
    const byBirth = (ids) => [...ids].sort((a, b) => String(dateValue(record(a) || {}, "born") || "9999").localeCompare(String(dateValue(record(b) || {}, "born") || "9999")));
    const groups = [
      ["familyParents", byBirth(family.parents).map((id) => personRow(id, relationExtra(id, item.id)))],
      ["familyPartners", family.partners.map((id) => personRow(id, marriageExtra(item.id, id)))],
      ["familyChildren", byBirth(family.children.map((child) => child.id)).map((id) => personRow(id, relationExtra(item.id, id)))],
      ["familySiblings", family.siblings.sort((a, b) => byBirth([a.id, b.id])[0] === a.id ? -1 : 1).map((sibling) => personRow(sibling.id, sibling.half ? t("kin.halfSibling") : ""))]
    ];
    for (const [key, rows] of groups) {
      if (!rows.length) continue;
      const list = html("div", { className: "family-rows" });
      list.append(...rows);
      section(t(key), list, "users-round");
    }
  }

  // A life in order: birth, marriages, children's births, other recorded events, death. Only dated entries.
  function renderTimeline(item) {
    const sortable = (value) => { const match = /(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/u.exec(String(value || "")); return match ? `${match[1]}-${match[2] || "00"}-${match[3] || "00"}` : ""; };
    const entries = [];
    const placeOf = (kind) => record(record(lifeEventId(item, kind))?.metadata?.place);
    const born = dateValue(item, "born"), died = dateValue(item, "died");
    if (born) entries.push({ date: born, text: placeOf("birth") ? t("timeline.bornIn", { place: label(placeOf("birth")) }) : t("timeline.born"), kind: "birth" });
    const family = KindredFamily.familyOf(item.id, familyEdges());
    for (const partner of family.partners) {
      const marriage = marriageOf(item.id, partner);
      const date = plainValue(marriage?.metadata?.date);
      if (date) entries.push({ date, text: t("timeline.married", { name: label(record(partner)) }), kind: "marriage", id: partner });
    }
    for (const child of family.children) {
      const date = dateValue(record(child.id) || {}, "born");
      if (date) entries.push({ date, text: t("timeline.child", { name: label(record(child.id)) }), kind: "child", id: child.id });
    }
    for (const event of eventsForPerson(item.id)) {
      const type = String(event.metadata?.event_type || event.metadata?.type || "");
      if (["birth", "death", "marriage"].includes(type) || event.id === lifeEventId(item, "birth") || event.id === lifeEventId(item, "death")) continue;
      const date = plainValue(event.metadata?.date || event.metadata?.when);
      if (date) entries.push({ date, text: label(event), kind: "event", event: event.id });
    }
    if (died) entries.push({ date: died, text: placeOf("death") ? t("timeline.diedIn", { place: label(placeOf("death")) }) : t("timeline.died"), kind: "death" });
    const dated = entries.filter((entry) => sortable(entry.date)).sort((a, b) => sortable(a.date).localeCompare(sortable(b.date)));
    if (dated.length < 2) return;
    const list = html("ol", { className: "timeline" });
    for (const entry of dated) {
      const row = html("li", { className: `timeline-${entry.kind}` });
      row.append(html("span", { className: "timeline-year", text: year(entry.date) }));
      const target = entry.id || entry.event;
      if (target) {
        const link = html("button", { className: "link-button", text: entry.text, attrs: { type: "button" } });
        link.addEventListener("click", () => select(target));
        row.append(link);
      } else row.append(html("span", { text: entry.text }));
      list.append(row);
    }
    section(t("timeline.title"), list, "calendar-days");
  }

  // Each gap can be answered through the suggestion form, which starts with the gap's name.
  function renderQuestions(item) {
    const open = openQuestions(item);
    if (!open.length) return section(t("stillMissing"), html("p", { className: "questions-done", text: t("nothingMissing") }), "circle-question-mark");
    const list = html("ul", { className: "question-list" });
    for (const key of open) {
      const entry = html("li");
      entry.append(html("span", { text: t(`question.${key}`) }));
      if (staticSite?.suggest) {
        const answer = html("button", { className: "quiet-button", text: t(key === "portrait" ? "iHaveOne" : "iKnow"), attrs: { type: "button" } });
        answer.addEventListener("click", () => openSuggestion(item, `${t(`question.${key}`)}: `));
        entry.append(answer);
      }
      list.append(entry);
    }
    section(t("stillMissing"), list, "circle-question-mark");
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
    const omitted = new Set(["version", "mother", "father", "parents", "partners", "events", "portrait", "portrait_credit", "portrait_caption", "portrait_source", "portrait_artist", "portrait_date", "portrait_license", "born", "birth", "birth_date", "died", "death", "death_date", "occupation", "id", "type", "name", "aliases", "attachments", "media", "sources", "from", "to", "parent", "child", "birth_place", "death_place", "living", "date_display"]);
    const facts = Object.entries(item.metadata || {}).filter(([key, value]) => !omitted.has(key) && plainValue(value));
    if (!facts.length) return;
    const list = html("dl", { className: "facts" });
    for (const [key, value] of facts) {
      list.append(html("dt", { text: KindredI18n.has(`field.${key}`) ? t(`field.${key}`) : shortRelation(key) }), html("dd", { text: linkedIds(item, key).map((id) => label(record(id))).join(", ") || plainValue(value) }));
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
      const marriage = edge.relation === "partner" ? marriageOf(edge.from, edge.to) : null;
      const marriageDate = marriage ? formatDate(plainValue(marriage.metadata?.date)) : "";
      const married = marriage ? ` · ${marriageDate ? t("marriedOn", { date: marriageDate }) : t("married")}` : "";
      const direction = edge.relation === "partner" ? `${t("relation.partner")}${married}` : edge.to === item.id ? known("role", parentRole(edge)) : t("direction.child");
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
      const when = formatDate(plainValue(event.metadata?.date || event.metadata?.when));
      const place = state.view === "simple" && record(event.metadata?.place);
      const detail = place ? [when, label(place)].filter(Boolean).join(" · ") : when;
      card.append(html("strong", { text: label(event) }));
      if (detail) card.append(html("small", { text: detail }));
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
    leaveStep();
    state.layoutRoot = "";
    if (record(state.selected)?.kind === "person") state.person = state.selected;
    // Each view starts at a readable depth; the control can then expand it.
    if (mode === "overview" && state.mode !== "overview") el.generations.value = "2";
    if (mode === "focus" && state.mode !== "focus") { el.generations.value = "1"; state.familyAsTree = false; }
    if ((mode === "ancestors" || mode === "descendants") && state.mode === "focus") el.generations.value = "4";
    state.mode = mode;
    showMode(mode);
    enterStep();
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

  // The open-questions mode is off unless ?questions=1 asks for it or it was left on.
  function initialQuestions() {
    const requested = new URLSearchParams(location.search).get("questions");
    if (requested === "1" || requested === "0") return requested === "1";
    try { return localStorage.getItem("kindred.questions") === "on"; } catch { return false; }
  }

  function setQuestions(on) {
    state.questions = on;
    el.questions_toggle.setAttribute("aria-pressed", String(on));
    document.body.classList.toggle("questions-mode", on);
  }

  function toggleQuestions() {
    setQuestions(!state.questions);
    try { localStorage.setItem("kindred.questions", state.questions ? "on" : "off"); } catch { /* Private browsing can refuse storage. */ }
    syncUrl({ questions: state.questions ? "1" : "0" });
    if (state.data) { renderGraph({ fit: false }); renderDetails(); }
  }

  // The theme follows the system until the reader picks one; the choice is remembered.
  const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
  function storedTheme() {
    try { const theme = localStorage.getItem("kindred.theme"); return theme === "dark" || theme === "light" ? theme : ""; } catch { return ""; }
  }
  function isDark() {
    return (storedTheme() || (darkQuery.matches ? "dark" : "light")) === "dark";
  }
  function renderTheme() {
    const theme = storedTheme();
    if (theme) document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
    const dark = isDark();
    el.theme_toggle.setAttribute("aria-pressed", String(dark));
    el.theme_toggle.setAttribute("aria-label", t(dark ? "lightMode" : "darkMode"));
    el.theme_toggle.title = t(dark ? "lightMode" : "darkMode");
    el.theme_toggle.replaceChildren(icon(dark ? "sun" : "moon"));
  }
  function toggleTheme() {
    try { localStorage.setItem("kindred.theme", isDark() ? "light" : "dark"); } catch { /* Private browsing can refuse storage. */ }
    renderTheme();
  }

  // Rewrites only the named parameters, so ?view= and ?lang= keep each other.
  function syncUrl(parameters) {
    const query = new URLSearchParams(location.search);
    for (const [name, value] of Object.entries(parameters)) query.set(name, value);
    history.replaceState(history.state, "", `?${query}`);
  }

  function filterKey() {
    return [el.status_filter.value, el.relation_filter.value, el.show_evidence.checked].join("|");
  }

  function applyView(view) {
    state.view = view;
    CARD_HEIGHT = view === "simple" ? 96 : 112;
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
    renderTheme();
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
      const draft = el.details_body.querySelector(".note-composer textarea")?.value;
      populatePeople();
      renderDiagnostics();
      renderGraph({ fit: false });
      renderDetails();
      const field = el.details_body.querySelector(".note-composer textarea");
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
  function openSuggestion(item = null, prompt = "") {
    suggestion = { person: item ? item.id : null, name: item ? label(item) : "" };
    const draft = readDraft();
    const kept = draft && draft.person === suggestion.person ? draft.text : "";
    el.suggestion_text.value = kept && prompt ? `${kept.trimEnd()}\n${prompt}` : kept || prompt;
    el.suggestion_about.hidden = !item;
    el.suggestion_about.textContent = item ? t("suggestAbout", { name: label(item) }) : "";
    el.suggestion_message.textContent = "";
    el.suggestion_message.classList.remove("sent");
    el.suggestion_send.disabled = false;
    el.suggestion.showModal();
    el.suggestion_text.focus();
    el.suggestion_text.setSelectionRange(el.suggestion_text.value.length, el.suggestion_text.value.length);
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
      button.append(html("strong", { text: label(person) }), html("small", { text: lifeSummary(person, { full: true }) }));
      button.addEventListener("click", () => {
        state.person = person.id;
        state.selected = person.id;
        el.search.value = "";
        el.search_results.hidden = true;
        setSheet("peek", { focus: false });
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

  // The scale and offset that fit every node in view. Desktop and the Fit button use it as it is.
  function fitView() {
    if (!state.positions.size) return null;
    const points = [...state.positions.values()];
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const minX = Math.min(...xs) - CARD_WIDTH / 2 - 24;
    const maxX = Math.max(...xs) + CARD_WIDTH / 2 + 24;
    const minY = Math.min(...ys) - CARD_HEIGHT / 2 - 38;
    const maxY = Math.max(...ys) + CARD_HEIGHT / 2 + 38;
    const bounds = el.graph.getBoundingClientRect();
    const heading = el.selection_summary.parentElement;
    const top = heading.offsetHeight ? heading.offsetTop + heading.offsetHeight + 12 : 16;
    const bottom = bounds.width > 560 ? 90 : 58;
    const availableHeight = Math.max(80, bounds.height - top - bottom);
    const scale = Math.min(1.15, Math.max(MIN_SCALE, Math.min(bounds.width / Math.max(1, maxX - minX), availableHeight / Math.max(1, maxY - minY)) * .9));
    return { scale, tx: bounds.width / 2 - ((minX + maxX) / 2) * scale, ty: top + availableHeight / 2 - ((minY + maxY) / 2) * scale };
  }

  function fitGraph() {
    const view = fitView();
    if (view) glide(view);
  }

  // Deliberate camera moves (Fit, centring, revealing a card) glide for 260 ms; dragging and pinching never do,
  // and reduced motion jumps straight there.
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let glideFrame = 0;
  function glide(target) {
    cancelAnimationFrame(glideFrame);
    if (reducedMotion.matches) { Object.assign(state, target); return applyTransform(); }
    const start = { scale: state.scale, tx: state.tx, ty: state.ty }, began = performance.now();
    const step = (now) => {
      const progress = Math.min(1, (now - began) / 260), eased = 1 - (1 - progress) ** 3;
      for (const key of ["scale", "tx", "ty"]) state[key] = start[key] + (target[key] - start[key]) * eased;
      applyTransform();
      if (progress < 1) glideFrame = requestAnimationFrame(step);
    };
    glideFrame = requestAnimationFrame(step);
  }

  // A phone that would have to fit everything below a readable scale centres the focus person instead; the Fit button still fits everything.
  // Desktops do the same once fitting would need the far zoom: they start at START_SCALE.
  function startGraph() {
    if (state.pendingCamera) {
      Object.assign(state, state.pendingCamera);
      state.pendingCamera = null;
      return applyTransform();
    }
    const view = fitView();
    if (!view) return;
    const focus = focusPoint();
    const phone = phoneQuery.matches;
    if (focus && view.scale < (phone ? READABLE_SCALE : FAR_SCALE)) {
      centreOn(focus, phone ? READABLE_SCALE : START_SCALE);
      // Centring a person in the top generation would leave the upper half empty: lift the tree's top edge to the top.
      const treeTop = Math.min(...[...state.positions.values()].map((point) => point.y)) - CARD_HEIGHT / 2;
      const heading = el.selection_summary.parentElement;
      const headroom = phone || !heading.offsetHeight ? 56 : heading.offsetTop + heading.offsetHeight + 16;
      if (state.ty + treeTop * state.scale > headroom) {
        state.ty = headroom - treeTop * state.scale;
        applyTransform();
      }
      return;
    }
    Object.assign(state, view);
    applyTransform();
  }

  function layoutRootId() {
    return state.layoutRoot || (state.mode === "overview" ? state.overviewRoot : state.person) || state.selected;
  }

  function focusPoint() {
    const id = state.positions.has(state.selected) ? state.selected : layoutRootId();
    return state.positions.get(id) || null;
  }

  // Height of the graph covered from its bottom edge by the details sheet on a phone.
  function sheetCover() {
    return phoneQuery.matches && state.sheet !== "hidden" ? el.details.offsetHeight : 0;
  }

  function centreOn(point, scale, { animate = false } = {}) {
    const bounds = el.graph.getBoundingClientRect();
    const target = { scale, tx: bounds.width / 2 - point.x * scale, ty: (bounds.height - sheetCover()) / 2 - point.y * scale };
    if (animate) return glide(target);
    cancelAnimationFrame(glideFrame);
    Object.assign(state, target);
    applyTransform();
  }

  // A tapped card must not stay under the peek sheet: pan it to the middle of the part of the graph above the sheet.
  function revealSelected() {
    const point = state.positions.get(state.selected);
    if (!point || !phoneQuery.matches || state.sheet !== "peek") return;
    const visibleBottom = el.graph.getBoundingClientRect().height - sheetCover();
    const top = state.ty + (point.y - CARD_HEIGHT / 2) * state.scale;
    const bottom = top + CARD_HEIGHT * state.scale;
    if (top >= 8 && bottom <= visibleBottom - 8) return;
    glide({ scale: state.scale, tx: state.tx, ty: state.ty + visibleBottom / 2 - (state.ty + point.y * state.scale) });
  }

  // Phones: hidden until a person is chosen, then peek (name, years, occupation), then expanded (the full details, scrolling).
  // Desktop keeps the side panel; the states only change the attribute there, which the stylesheet reads on phones.
  let sheetReturn = null;
  function setSheet(next, { focus = true } = {}) {
    const previous = state.sheet;
    if (next === previous) return;
    const hadFocus = el.details.contains(document.activeElement);
    if (previous === "hidden" && !hadFocus) sheetReturn = document.activeElement !== document.body ? document.activeElement : el.graph;
    state.sheet = next;
    el.workspace.dataset.sheet = next;
    el.sheet_handle.setAttribute("aria-expanded", String(next === "expanded"));
    if (!focus || !phoneQuery.matches) return;
    if (next === "expanded") el.details_body.focus({ preventScroll: true });
    else if (next === "peek" && previous === "expanded" && hadFocus) el.sheet_handle.focus({ preventScroll: true });
    else if (next === "hidden" && hadFocus) (sheetReturn?.isConnected ? sheetReturn : el.graph).focus({ preventScroll: true });
  }

  // The peek summary is always the selected person, so it can show before the full details are rendered.
  function renderPeek(item) {
    el.sheet_name.textContent = label(item);
    el.sheet_years.textContent = lifeSummary(item, { full: true });
    if (item.kind === "person" && dateValue(item, "born")) {
      // The birth mark replaces the word "born" here.
      const parts = lifeParts(item, { full: true });
      el.sheet_years.textContent = ` ${[parts.years, parts.age].filter(Boolean).join(" · ")}`;
      const mark = icon("birth-mark"); mark.classList.add("life-symbol"); el.sheet_years.prepend(mark);
    }
    const kin = item.kind === "person" && state.me && state.me !== item.id ? kinTerm(kinshipTo(item.id)) : "";
    const occupation = kin ? t("kin.forYou", { term: kin }) : plainValue(item.metadata?.occupation);
    el.sheet_occupation.textContent = occupation;
    el.sheet_occupation.hidden = !occupation;
  }

  // On a phone the switches and filters live in the menu panel; on desktop they go back to the masthead and toolbar.
  function placeMenu() {
    if (phoneQuery.matches) {
      el.menu_panel.append(el.view_switch, el.lang_switch, el.questions_toggle, el.upcoming_button, el.theme_toggle, el.query_options);
      // The menu panel is already a disclosure, so its options are always open there.
      el.more_options.open = true;
    } else {
      el.more_options.open = false;
      el.help_button.before(el.view_switch, el.lang_switch, el.questions_toggle, el.upcoming_button, el.theme_toggle);
      el.toolbar.append(el.query_options);
      setMenu(false);
    }
  }

  function setMenu(open, { focus = false } = {}) {
    el.menu_panel.hidden = !open;
    el.menu_button.setAttribute("aria-expanded", String(open));
    if (!focus) return;
    (open ? el.view_switch.querySelector("button") : el.menu_button)?.focus();
  }

  let cameraTimer = 0;
  function applyTransform() {
    clearTimeout(cameraTimer);
    cameraTimer = setTimeout(() => {
      if (!restoring && history.state?.kindred) history.replaceState({ ...history.state, camera: { scale: state.scale, tx: state.tx, ty: state.ty } }, "");
    }, 250);
    el.zoom_level.textContent = `${Math.round(state.scale * 100)}%`;
    el.graph.dataset.zoom = state.scale < FAR_SCALE ? "far" : "near";
    el.viewport.setAttribute("transform", `translate(${state.tx} ${state.ty}) scale(${state.scale})`);
    el.nodes.style.transform = `translate(${state.tx}px, ${state.ty}px) scale(${state.scale})`;
  }

  document.querySelectorAll("[data-mode]").forEach((button) => button.addEventListener("click", () => setMode(button.dataset.mode)));
  document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.view)));
  document.querySelectorAll("[data-lang]").forEach((button) => button.addEventListener("click", () => switchLang(button.dataset.lang)));
  el.questions_toggle.addEventListener("click", toggleQuestions);
  el.upcoming_button.addEventListener("click", () => { if (state.data) setPage(state.page === "upcoming" ? "" : "upcoming"); });
  el.home_button.addEventListener("click", () => {
    if (!state.me || !record(state.me)) return;
    if (!state.positions.has(state.me)) { leaveStep(); state.person = state.me; state.selected = state.me; setMode("focus"); return; }
    select(state.me);
    centreOn(state.positions.get(state.me), Math.max(state.scale, phoneQuery.matches ? READABLE_SCALE : START_SCALE), { animate: true });
  });
  el.first_hint_close.addEventListener("click", dismissHint);
  // An empty view offers a way out: back to the defaults, or straight to the search.
  el.empty_reset.addEventListener("click", () => {
    el.status_filter.value = "accepted"; el.relation_filter.value = ""; el.show_evidence.checked = false;
    if (state.mode === "path") { setMode("overview"); return; }
    loadGraph();
  });
  el.empty_search.addEventListener("click", () => { setMenu(false); el.search.focus(); });
  el.theme_toggle.addEventListener("click", toggleTheme);
  darkQuery.addEventListener("change", renderTheme);
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
    leaveStep();
    state.overviewRoot = el.branch_root.value;
    state.layoutRoot = "";
    state.overviewExpanded.clear(); state.overviewCollapsed.clear();
    state.selected = state.overviewRoot;
    enterStep();
    renderGraph(); renderDetails();
  });
  el.path_to.addEventListener("change", () => {
    leaveStep();
    state.to = el.path_to.value;
    enterStep();
    if (state.to) loadGraph();
  });
  el.fit_button.addEventListener("click", fitGraph);
  // Back to the selected person after panning: keep the zoom when it is readable, otherwise use the start zoom.
  el.centre_button.addEventListener("click", () => {
    const focus = focusPoint();
    const readable = phoneQuery.matches ? READABLE_SCALE : START_SCALE;
    if (focus) centreOn(focus, state.scale >= readable ? state.scale : readable, { animate: true });
  });
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
  el.menu_button.addEventListener("click", () => setMenu(el.menu_panel.hidden, { focus: true }));
  document.addEventListener("pointerdown", (event) => {
    if (!el.menu_panel.hidden && !el.menu_panel.contains(event.target) && !el.menu_button.contains(event.target)) setMenu(false);
    if (!phoneQuery.matches && el.more_options.open && !el.more_options.contains(event.target)) el.more_options.open = false;
  });
  // The handle is the keyboard and assistive path to the sheet states; a drag past 24 px changes state as soon as it crosses.
  let handleGesture = null;
  el.sheet_handle.addEventListener("pointerdown", (event) => {
    handleGesture = { y: event.clientY, acted: false };
    el.sheet_handle.setPointerCapture(event.pointerId);
  });
  el.sheet_handle.addEventListener("pointermove", (event) => {
    if (!handleGesture || handleGesture.acted || Math.abs(event.clientY - handleGesture.y) < 24) return;
    handleGesture.acted = true;
    if (event.clientY < handleGesture.y) {
      if (state.sheet === "peek") setSheet("expanded");
    } else if (state.sheet === "expanded") setSheet("peek");
    else if (state.sheet === "peek") setSheet("hidden");
  });
  el.sheet_handle.addEventListener("click", () => {
    const dragged = handleGesture?.acted;
    handleGesture = null;
    if (!dragged) setSheet(state.sheet === "expanded" ? "peek" : "expanded");
  });
  el.sheet_peek.addEventListener("click", () => { if (state.sheet === "peek") setSheet("expanded"); });
  el.sheet_close.addEventListener("click", () => setSheet("hidden"));
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
    cancelAnimationFrame(glideFrame);
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
      dismissHint();
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

  // Escape closes the innermost open thing first: the menu panel, then the details sheet.
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || el.editor.open || el.suggestion.open) return;
    if (!el.menu_panel.hidden) setMenu(false, { focus: true });
    else if (state.sheet !== "hidden") setSheet("hidden");
  });

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

  // Phones also get resize events when the browser toolbar shows or hides; only a width change refits them.
  let viewportWidth = window.innerWidth;
  window.addEventListener("resize", () => {
    const widthChanged = window.innerWidth !== viewportWidth;
    viewportWidth = window.innerWidth;
    if (widthChanged || !phoneQuery.matches) startGraph();
  });
  // A static page cannot edit, so its editor goes; suggestion controls appear only when the site names a URL.
  if (staticSite) el.editor.remove();
  el.suggest_general.hidden = !staticSite?.suggest;
  if (!staticSite?.suggest) el.suggestion.remove();
  placeMenu();
  phoneQuery.addEventListener("change", () => { placeMenu(); if (state.data) renderFamilyPage(); });
  applyView(initialView());
  setQuestions(initialQuestions());
  el.home_button.hidden = !state.me;
  // A published site names itself in the masthead; Kindred stays as the small line beneath.
  if (staticSite?.name && staticSite.name !== "Kindred") {
    const brand = document.querySelector(".brand strong"), line = document.querySelector(".brand small");
    brand.textContent = staticSite.name;
    line.removeAttribute("data-i18n");
    line.textContent = "Kindred";
  }
  // Published sites register the service worker that shows pushed reminders; it caches nothing.
  if (staticSite && "serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  KindredI18n.setLang(initialLang());
  renderStrings();
  showHint();
  loadGraph({ keepSelection: false });
})();
