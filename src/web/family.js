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

    const partners = new Set();
    for (const edge of partnerEdges) {
      let partner;
      if (edge.from === selectedId) partner = edge.to;
      if (edge.to === selectedId) partner = edge.from;
      if (partner === undefined || partner === selectedId) continue;
      partners.add(partner);
      add(edgeTags, edge.id, "partner");
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

  global.KindredFamily = Object.freeze({ analyze });
})(globalThis);
