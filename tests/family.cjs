const test = require("node:test");
const assert = require("node:assert/strict");

require("../src/web/family.js");

const { analyze, bloodRelatives, kinship, familyOf } = globalThis.KindredFamily;
const parent = (id, from, to, role = "parent") => ({
  id,
  from,
  to,
  relation: "biological_parent",
  role,
});
const partner = (id, from, to) => ({ id, from, to, relation: "partner" });
const roleForEdge = (edge) => edge.role;

test("maternal and paternal paths merge into both across shared ancestry", () => {
  const result = analyze(
    "focus",
    [
      parent("m-focus", "mother", "focus", "mother"),
      parent("f-focus", "father", "focus", "father"),
      parent("shared-m", "shared", "mother"),
      parent("shared-f", "shared", "father"),
      parent("older-shared", "older", "shared"),
    ],
    roleForEdge,
  );

  assert.equal(result.people.get("focus"), "selected");
  assert.equal(result.people.get("mother"), "maternal");
  assert.equal(result.people.get("father"), "paternal");
  assert.equal(result.people.get("shared"), "both");
  assert.equal(result.people.get("older"), "both");
  assert.equal(result.edges.get("shared-m"), "maternal");
  assert.equal(result.edges.get("shared-f"), "paternal");
  assert.equal(result.edges.get("older-shared"), "both");
});

test("unknown direct parent roles remain ungrouped ancestors upstream", () => {
  const result = analyze(
    "focus",
    [
      { ...parent("parent-focus", "parent", "focus"), relation: "adoptive_parent" },
      { ...parent("grand-parent", "grand", "parent"), relation: "foster_parent" },
    ],
    roleForEdge,
  );

  assert.equal(result.people.get("parent"), "ancestor");
  assert.equal(result.people.get("grand"), "ancestor");
  assert.equal(result.edges.get("grand-parent"), "ancestor");
});

test("collateral descendants retain complete sibling and cousin paths", () => {
  const result = analyze(
    "focus",
    [
      parent("parent-focus", "parent", "focus", "mother"),
      parent("grand-parent", "grand", "parent"),
      parent("parent-sibling", "parent", "sibling"),
      parent("grand-aunt", "grand", "aunt"),
      parent("aunt-cousin", "aunt", "cousin"),
      parent("cousin-once", "cousin", "once-removed"),
    ],
    roleForEdge,
  );

  for (const id of ["sibling", "aunt", "cousin", "once-removed"]) {
    assert.equal(result.people.get(id), "relative");
  }
  for (const id of ["parent-sibling", "grand-aunt", "aunt-cousin", "cousin-once"]) {
    assert.equal(result.edges.get(id), "relative");
  }
});

test("descendants and direct partners are highlighted without walking partner chains", () => {
  const result = analyze(
    "focus",
    [
      parent("focus-child", "focus", "child"),
      parent("child-grandchild", "child", "grandchild"),
      partner("focus-partner", "focus", "partner"),
      partner("partner-other", "partner", "other"),
    ],
    roleForEdge,
  );

  assert.equal(result.people.get("child"), "descendant");
  assert.equal(result.people.get("grandchild"), "descendant");
  assert.equal(result.people.get("partner"), "partner");
  assert.equal(result.people.has("other"), false);
  assert.equal(result.edges.get("focus-partner"), "partner");
  assert.equal(result.edges.has("partner-other"), false);
});

test("partners of highlighted descendants and ancestors are highlighted in-laws", () => {
  const result = analyze(
    "focus",
    [
      parent("focus-parent", "parent", "focus", "mother"),
      parent("parent-sibling", "parent", "sibling"),
      parent("focus-child", "focus", "child"),
      partner("child-in-law", "child", "in-law"),
      partner("parent-stepparent", "parent", "stepparent"),
      partner("sibling-partner", "sibling", "sibling-partner"),
      partner("in-law-other", "in-law", "in-law-other"),
    ],
    roleForEdge,
  );

  assert.equal(result.people.get("in-law"), "partner");
  assert.equal(result.people.get("stepparent"), "partner");
  assert.equal(result.edges.get("child-in-law"), "partner");
  assert.equal(result.edges.get("parent-stepparent"), "partner");
  // Relatives who are not blood-line descendants or ancestors keep their own in-laws unhighlighted.
  assert.equal(result.people.has("sibling-partner"), false);
  // In-laws do not pull in their own partners.
  assert.equal(result.people.has("in-law-other"), false);
});

test("cycles terminate, keep closing edges, and never reclassify the selection", () => {
  const result = analyze(
    "focus",
    [
      parent("a-focus", "a", "focus", "mother"),
      parent("b-a", "b", "a"),
      parent("focus-b", "focus", "b"),
    ],
    roleForEdge,
  );

  assert.equal(result.people.get("focus"), "selected");
  assert.equal(result.people.get("a"), "maternal");
  assert.equal(result.people.get("b"), "maternal");
  assert.equal(result.edges.get("focus-b"), "maternal");
  assert.equal(result.edges.size, 3);
});

test("analysis never reaches relationships omitted by the supplied filter", () => {
  const allEdges = [
    parent("accepted", "shown-parent", "focus", "mother"),
    parent("filtered", "hidden-parent", "focus", "father"),
  ];
  const result = analyze("focus", allEdges.filter((edge) => edge.id !== "filtered"), roleForEdge);

  assert.equal(result.people.get("shown-parent"), "maternal");
  assert.equal(result.people.has("hidden-parent"), false);
  assert.equal(result.edges.has("filtered"), false);
  assert.deepEqual(result.counts, {
    totalPeople: 2,
    totalEdges: 1,
    selected: 1,
    maternal: 1,
  });
});

test("blood relatives follow biological parent links only", () => {
  const edge = (from, to, relation = "biological_parent") => ({ id: `${from}-${to}`, from, to, relation });
  const edges = [edge("grandma", "mum"), edge("grandma", "aunt"), edge("aunt", "cousin"), edge("mum", "me"),
    edge("tove", "me", "adoptive_parent"), edge("tove", "tove-child"), edge("foster", "me", "foster_parent"),
    { id: "p", from: "mum", to: "stepdad", relation: "partner" }, edge("stepdad", "half", "adoptive_parent")];
  assert.deepEqual([...bloodRelatives("me", edges)].sort(), ["aunt", "cousin", "grandma", "me", "mum"]);
  assert.deepEqual([...bloodRelatives("", edges)], []);
});

const kin = (from, to, relation = "biological_parent") => ({ id: `${from}-${to}`, from, to, relation });
const tree = [
  kin("gp1", "mum"), kin("gp2", "mum"), kin("gp1", "aunt"), kin("gp2", "aunt"), kin("gp1", "halfuncle"),
  kin("mum", "me"), kin("dad", "me"), kin("mum", "sis"), kin("dad", "sis"), kin("mum", "half"),
  kin("aunt", "cousin"), kin("cousin", "cousinkid"), kin("me", "kid"), kin("kid", "grandkid"), kin("sis", "niece"),
  { id: "p1", from: "me", to: "spouse", relation: "partner" }, { id: "p2", from: "aunt", to: "auntspouse", relation: "partner" },
  kin("spouseparent", "spouse"), { id: "p3", from: "kid", to: "kidspouse", relation: "partner" }
];

test("kinship names the closest common ancestor's distance on both sides", () => {
  const of = (other) => { const found = kinship("me", other, tree); return found && [found.kind, found.up, found.down, found.half]; };
  assert.deepEqual(of("me"), ["self", undefined, undefined, undefined]);
  assert.deepEqual(of("mum"), ["blood", 1, 0, false]);
  assert.deepEqual(of("gp1"), ["blood", 2, 0, false]);
  assert.deepEqual(of("sis"), ["blood", 1, 1, false]);
  assert.deepEqual(of("half"), ["blood", 1, 1, true]);
  assert.deepEqual(of("aunt"), ["blood", 2, 1, false]);
  assert.deepEqual(of("cousin"), ["blood", 2, 2, false]);
  assert.deepEqual(of("cousinkid"), ["blood", 2, 3, false]);
  assert.deepEqual(of("grandkid"), ["blood", 0, 2, false]);
  assert.deepEqual(of("niece"), ["blood", 1, 2, false]);
  assert.deepEqual(of("halfuncle"), ["blood", 2, 1, true]);
  assert.deepEqual(kinship("me", "aunt", tree).via, ["gp1", "gp2"]);
});

test("kinship falls back to one partner link and reports unconnected people as null", () => {
  assert.equal(kinship("me", "spouse", tree).kind, "partner");
  const inLaw = kinship("me", "auntspouse", tree);
  assert.deepEqual([inLaw.kind, inLaw.partner, inLaw.up, inLaw.down], ["partnerOfRelative", "aunt", 2, 1]);
  const partnerParent = kinship("me", "spouseparent", tree);
  assert.deepEqual([partnerParent.kind, partnerParent.partner, partnerParent.up, partnerParent.down], ["relativeOfPartner", "spouse", 1, 0]);
  assert.equal(kinship("me", "nobody", tree), null);
});

test("familyOf lists parents, partners, children with their other parents, and half-siblings", () => {
  const family = familyOf("me", tree);
  assert.deepEqual(family.parents.sort(), ["dad", "mum"]);
  assert.deepEqual(family.partners, ["spouse"]);
  assert.deepEqual(family.children, [{ id: "kid", otherParents: [] }]);
  assert.deepEqual(family.siblings.sort((a, b) => a.id.localeCompare(b.id)), [{ id: "half", half: true }, { id: "sis", half: false }]);
});
