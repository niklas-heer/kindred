"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
require("../src/web/family.js");
require("../src/web/layout.js");
const person = (id, born) => ({ id, kind: "person", metadata: { born } });
const parent = (from, to, role = "parent") => ({ id: `${from}-${to}`, from, to, relation: "biological_parent", role });
const partner = (from, to) => ({ id: `${from}-${to}`, from, to, relation: "partner" });
const arrange = (nodes, edges, root = "child", options = {}) => KindredLayout.layout(nodes, edges, { root, roleForEdge: (edge) => edge.role, ...options });
function separated(positions) {
  const entries = [...positions];
  for (const [, point] of entries) assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
  for (let i = 0; i < entries.length; i++) for (let j = i + 1; j < entries.length; j++) {
    const [a, p] = entries[i], [b, q] = entries[j];
    assert.ok(Math.abs(p.x - q.x) >= 248 || Math.abs(p.y - q.y) >= 144, `${a} overlaps ${b}`);
  }
}
test("maternal and paternal generations stay on their own side regardless of IDs", () => {
  const nodes = ["child", "z-mother", "a-father", "z-grandmother", "a-grandfather"].map((id) => person(id));
  const edges = [parent("z-mother", "child", "mother"), parent("a-father", "child", "father"), parent("z-grandmother", "z-mother", "mother"), parent("a-grandfather", "a-father", "father")];
  const positions = arrange(nodes, edges);
  assert.ok(positions.get("z-mother").x < positions.get("a-father").x);
  assert.ok(positions.get("z-grandmother").x < positions.get("a-grandfather").x);
  for (const edge of edges) assert.ok(positions.get(edge.from).y < positions.get(edge.to).y);
  separated(positions);
  assert.deepEqual(arrange([...nodes].reverse(), [...edges].reverse()), positions);
});
test("explicit paired parents remain adjacent with mother left, father right", () => {
  const nodes = ["child", "z-mother", "a-father"].map((id) => person(id));
  const positions = arrange(nodes, [parent("z-mother", "child", "mother"), parent("a-father", "child", "father"), partner("a-father", "z-mother")]);
  assert.equal(positions.get("z-mother").y, positions.get("a-father").y);
  assert.ok(positions.get("z-mother").x < positions.get("a-father").x);
  separated(positions);
});
test("shared ancestors remain single nodes and multiple partnerships do not overlap cards", () => {
  const nodes = ["child", "mother", "father", "shared", "partner1", "partner2", "other"].map((id) => person(id));
  const edges = [parent("mother", "child", "mother"), parent("father", "child", "father"), parent("shared", "mother"), parent("shared", "father"), partner("child", "partner1"), partner("child", "partner2")];
  const positions = arrange(nodes, edges);
  assert.equal(positions.size, nodes.length);
  const partnerXs = ["child", "partner1", "partner2"].map((id) => positions.get(id).x).sort((a, b) => a - b);
  assert.equal(positions.get("child").x, partnerXs[1]);
  assert.ok(positions.get("shared").y < positions.get("mother").y);
  separated(positions);
});
test("siblings use exact recorded birth years instead of alphabetical IDs", () => {
  const nodes = [person("parent"), person("a-younger", "1952"), person("z-older", "1948")];
  const positions = arrange(nodes, [parent("parent", "a-younger"), parent("parent", "z-older")], "parent");
  assert.ok(positions.get("z-older").x < positions.get("a-younger").x);
  separated(positions);
});
test("cycles, isolated people and evidence stay finite and disjoint", () => {
  const nodes = ["a", "b", "c", "isolated"].map((id) => person(id));
  nodes.push({id: "source", kind: "source"});
  const edges = [parent("a", "b"), parent("b", "c"), parent("c", "a"), {id:"citation", from:"a", to:"source", relation:"evidence"}];
  const positions = arrange(nodes, edges, "a");
  assert.equal(positions.size, nodes.length);
  separated(positions);
});
test("path layout follows the selected endpoint, including reversed supplied edges", () => {
  const nodes = ["a", "b", "c"].map((id) => person(id));
  const positions = arrange(nodes, [parent("b", "a"), parent("c", "b")], "a", {mode:"path"});
  assert.ok(positions.get("a").x < positions.get("b").x && positions.get("b").x < positions.get("c").x);
  separated(positions);
});
