(function installKindredFamily(global) {
  "use strict";

  const PARENT_RELATIONS = new Set([
    "biological_parent",
    "adoptive_parent",
    "foster_parent",
  ]);

  function add(map, key, value) {
    let values = map.get(key);
    if (!values) {
      values = new Set();
      map.set(key, values);
    }
    const changed = !values.has(value);
    values.add(value);
    return changed;
  }

  function ancestryCategory(values) {
    if (values?.has("maternal") && values.has("paternal")) return "both";
    if (values?.has("maternal")) return "maternal";
    if (values?.has("paternal")) return "paternal";
    return "ancestor";
  }

  function edgeCategory(values) {
    const ancestry = ancestryCategory(values);
    if (
      ancestry !== "ancestor" ||
      values.has("ancestor") ||
      values.has("maternal") ||
      values.has("paternal")
    ) {
      return ancestry;
    }
    for (const category of ["descendant", "partner", "relative"]) {
      if (values.has(category)) return category;
    }
    return "relative";
  }

  function directSide(edge, roleForEdge) {
    const role = typeof roleForEdge === "function" ? roleForEdge(edge) : undefined;
    const normalized = typeof role === "string" ? role.toLowerCase() : "";
    if (normalized === "mother" || normalized === "maternal") return "maternal";
    if (normalized === "father" || normalized === "paternal") return "paternal";
    return "ancestor";
  }

  function analyze(selectedId, suppliedEdges, roleForEdge) {
    const edges = Array.isArray(suppliedEdges) ? suppliedEdges : [];
    const parentsByChild = new Map();
    const childrenByParent = new Map();
    const partnerEdges = [];

    for (const edge of edges) {
      if (!edge || typeof edge.id !== "string") continue;
      if (edge.relation === "partner") {
        partnerEdges.push(edge);
      } else if (PARENT_RELATIONS.has(edge.relation)) {
        const parents = parentsByChild.get(edge.to) || [];
        parents.push(edge);
        parentsByChild.set(edge.to, parents);
        const children = childrenByParent.get(edge.from) || [];
        children.push(edge);
        childrenByParent.set(edge.from, children);
      }
    }

    const ancestorSides = new Map();
    const edgeTags = new Map();
    const ancestorQueue = [];
    const markAncestor = (personId, side, edge) => {
      add(edgeTags, edge.id, side);
      if (personId === selectedId) return;
      if (add(ancestorSides, personId, side)) ancestorQueue.push([personId, side]);
    };

    for (const edge of parentsByChild.get(selectedId) || []) {
      markAncestor(edge.from, directSide(edge, roleForEdge), edge);
    }
    for (let index = 0; index < ancestorQueue.length; index += 1) {
      const [personId, side] = ancestorQueue[index];
      for (const edge of parentsByChild.get(personId) || []) {
        markAncestor(edge.from, side, edge);
      }
    }

    const descendants = new Set();
    const descendantQueue = [selectedId];
    const visitedDescendants = new Set([selectedId]);
    for (let index = 0; index < descendantQueue.length; index += 1) {
      const personId = descendantQueue[index];
      for (const edge of childrenByParent.get(personId) || []) {
        add(edgeTags, edge.id, "descendant");
        if (edge.to === selectedId) continue;
        descendants.add(edge.to);
        if (!visitedDescendants.has(edge.to)) {
          visitedDescendants.add(edge.to);
          descendantQueue.push(edge.to);
        }
      }
    }

    const relatives = new Set();
    const relativeQueue = [...ancestorSides.keys()];
    const visitedRelatives = new Set(relativeQueue);
    for (let index = 0; index < relativeQueue.length; index += 1) {
      const personId = relativeQueue[index];
      for (const edge of childrenByParent.get(personId) || []) {
        add(edgeTags, edge.id, "relative");
        if (
          edge.to === selectedId ||
          ancestorSides.has(edge.to) ||
          descendants.has(edge.to)
        ) {
          continue;
        }
        relatives.add(edge.to);
        if (!visitedRelatives.has(edge.to)) {
          visitedRelatives.add(edge.to);
          relativeQueue.push(edge.to);
        }
      }
    }

    // Partners of the selection and of its highlighted blood line are in-laws; partners of in-laws are not followed.
    const bloodLine = new Set([...ancestorSides.keys(), ...descendants]);
    const linked = (personId) => personId === selectedId || bloodLine.has(personId);
    const partners = new Set();
    for (const edge of partnerEdges) {
      if (!linked(edge.from) && !linked(edge.to)) continue;
      add(edgeTags, edge.id, "partner");
      for (const personId of [edge.from, edge.to]) {
        if (!linked(personId)) partners.add(personId);
      }
    }

    const people = new Map([[selectedId, "selected"]]);
    for (const [personId, sides] of ancestorSides) {
      if (personId !== selectedId) people.set(personId, ancestryCategory(sides));
    }
    for (const personId of descendants) {
      if (!people.has(personId)) people.set(personId, "descendant");
    }
    for (const personId of partners) {
      if (!people.has(personId)) people.set(personId, "partner");
    }
    for (const personId of relatives) {
      if (!people.has(personId)) people.set(personId, "relative");
    }

    const categorizedEdges = new Map();
    for (const [edgeId, values] of edgeTags) {
      categorizedEdges.set(edgeId, edgeCategory(values));
    }
    const counts = { totalPeople: people.size, totalEdges: categorizedEdges.size };
    for (const category of people.values()) {
      counts[category] = (counts[category] || 0) + 1;
    }
    return { people, edges: categorizedEdges, counts };
  }

  // Blood relatives share a biological ancestor with the selected person: everyone up its biological parent
  // links, and everyone down from those. Adoptive and foster links and partners never make a blood relative.
  function bloodRelatives(selectedId, edges) {
    const parents = new Map(), children = new Map();
    for (const edge of edges) {
      if (edge.relation !== "biological_parent") continue;
      add(parents, edge.to, edge.from);
      add(children, edge.from, edge.to);
    }
    const ancestors = new Set([selectedId]);
    const up = [selectedId];
    while (up.length) for (const parent of parents.get(up.pop()) || []) if (!ancestors.has(parent)) { ancestors.add(parent); up.push(parent); }
    const blood = new Set(ancestors);
    const down = [...ancestors];
    while (down.length) for (const child of children.get(down.pop()) || []) if (!blood.has(child)) { blood.add(child); down.push(child); }
    return selectedId ? blood : new Set();
  }

  function parentAndPartnerMaps(edges) {
    const parents = new Map(), children = new Map(), partners = new Map();
    for (const edge of edges) {
      if (PARENT_RELATIONS.has(edge.relation)) { add(parents, edge.to, edge.from); add(children, edge.from, edge.to); }
      else if (edge.relation === "partner") { add(partners, edge.from, edge.to); add(partners, edge.to, edge.from); }
    }
    return { parents, children, partners };
  }

  // How `otherId` is related to `selfId`. Blood (and adoptive) kinship comes from the closest common ancestor:
  // `up` generations from self to it, `down` from it to the other person; `via` lists those ancestors. Failing that,
  // one partner link: the other is self's partner, the partner of a relative, or a relative of self's partner.
  // Returns null when no such connection exists. Names and genders play no part.
  function kinship(selfId, otherId, edges) {
    if (!selfId || !otherId) return null;
    if (selfId === otherId) return { kind: "self", via: [] };
    const { parents, partners } = parentAndPartnerMaps(edges);
    const depths = (start) => {
      const found = new Map([[start, 0]]);
      const queue = [start];
      for (let index = 0; index < queue.length; index += 1) {
        const id = queue[index];
        for (const parent of parents.get(id) || []) if (!found.has(parent)) { found.set(parent, found.get(id) + 1); queue.push(parent); }
      }
      return found;
    };
    const blood = (first, second) => {
      const up = depths(first), down = depths(second);
      let best = null;
      for (const [id, upDepth] of up) {
        if (!down.has(id)) continue;
        const total = upDepth + down.get(id);
        if (!best || total < best.up + best.down || (total === best.up + best.down && upDepth < best.up)) best = { up: upDepth, down: down.get(id) };
      }
      if (!best) return null;
      const via = [...up].filter(([id, depth]) => depth === best.up && down.get(id) === best.down).map(([id]) => id).sort();
      // Half kin: the two lines meet in one recorded ancestor although a person just below it on either line has
      // two recorded parents (half-siblings, a parent's half-sibling, half-cousins).
      const below = (found, depth) => [...found].filter(([id, d]) => d === depth - 1 && parents.get(id)?.has(via[0])).map(([id]) => id);
      const half = best.up >= 1 && best.down >= 1 && via.length === 1
        && [...below(up, best.up), ...below(down, best.down)].some((id) => (parents.get(id)?.size || 0) > 1);
      return { kind: "blood", up: best.up, down: best.down, half, via };
    };
    const direct = blood(selfId, otherId);
    if (direct) return direct;
    if (partners.get(selfId)?.has(otherId)) return { kind: "partner", via: [] };
    for (const partner of [...(partners.get(otherId) || [])].sort()) {
      const found = blood(selfId, partner);
      if (found) return { ...found, kind: "partnerOfRelative", partner };
    }
    for (const partner of [...(partners.get(selfId) || [])].sort()) {
      const found = blood(partner, otherId);
      if (found) return { ...found, kind: "relativeOfPartner", partner };
    }
    return null;
  }

  // A person's immediate family from parent and partner links: parents, partners, children (with their other
  // recorded parents), and siblings (marked half when they share only some recorded parents).
  function familyOf(id, edges) {
    const { parents, children, partners } = parentAndPartnerMaps(edges);
    const own = parents.get(id) || new Set();
    const siblings = new Map();
    for (const parent of own) for (const child of children.get(parent) || []) {
      if (child === id) continue;
      const theirs = parents.get(child) || new Set();
      const shared = [...own].filter((other) => theirs.has(other)).length;
      siblings.set(child, shared < Math.max(own.size, theirs.size));
    }
    return {
      parents: [...own],
      partners: [...(partners.get(id) || [])],
      children: [...(children.get(id) || [])].map((child) => ({ id: child, otherParents: [...(parents.get(child) || [])].filter((other) => other !== id) })),
      siblings: [...siblings].map(([sibling, half]) => ({ id: sibling, half }))
    };
  }

  global.KindredFamily = Object.freeze({ analyze, bloodRelatives, kinship, familyOf });
})(globalThis);
