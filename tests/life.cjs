"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
require("../src/web/life.js");
const { age, deceased, questions, upcoming } = KindredLife;
const today = new Date(2026, 10, 1);
const person = (metadata) => ({ id: "p", kind: "person", metadata });

test("age counts completed years with full dates and stays open by a year without them", () => {
  assert.deepEqual(age(person({ born: "1954-10-21" }), today), { years: 72, exact: true, deceased: false });
  assert.deepEqual(age(person({ born: "1991-12-07" }), today), { years: 34, exact: true, deceased: false });
  assert.deepEqual(age(person({ born: "2017" }), today), { years: 9, exact: false, deceased: false });
  assert.deepEqual(age(person({ born: "about 1930", living: false, died: "2001-05-02" }), today), { years: 71, exact: false, deceased: true });
});

test("age at death uses the death date, and an unknown death date leaves the age unknown", () => {
  assert.deepEqual(age(person({ born: "1928-09-21", died: "2005-07-20" }), today), { years: 76, exact: true, deceased: true });
  assert.equal(age(person({ born: "1934-03-23", living: false }), today), null);
  assert.equal(age(person({ died: "2005" }), today), null);
});

test("a person without a recorded death counts as living unless the archive says otherwise", () => {
  assert.equal(deceased(person({ born: "1950" })), false);
  assert.equal(deceased(person({ born: "1950", living: false })), true);
  assert.equal(deceased(person({ died: "2005" })), true);
});

test("open questions list the gaps a relative could fill, most useful first", () => {
  assert.deepEqual(questions(person({}), { today }), ["birthDate", "birthPlace", "occupation", "parents", "portrait"]);
  assert.deepEqual(questions(person({ born: "1962", birth_place: "Gaildorf", occupation: "Lehrer" }), { parents: 2, portrait: true, today }), ["birthDay"]);
  assert.deepEqual(questions(person({ born: "1934-03-23", living: false, died: "1962", death_place: "Cape Town" }), { parents: 0, portrait: true, today }), ["birthPlace", "occupation", "parents", "deathDay"]);
});

test("children need no occupation, and deliberate gaps are not questions", () => {
  assert.deepEqual(questions(person({ born: "2017", birth_place: "Cape Town" }), { parents: 2, portrait: true, today }), ["birthDay"]);
  assert.deepEqual(questions(person({ born: "2017", birth_place: "Cape Town", date_display: "year" }), { parents: 2, portrait: true, today }), []);
  assert.deepEqual(questions(person({ born: "1950-01-01", birth_place: "X", occupation: "Y", parents: [] }), { portrait: true, today }), []);
});

test("only an implausible age asks whether someone is still alive", () => {
  const base = { birth_place: "X", occupation: "Y" };
  assert.deepEqual(questions(person({ ...base, born: "1927-05-01" }), { parents: 2, portrait: true, today }), []);
  assert.deepEqual(questions(person({ ...base, born: "1925-05-01" }), { parents: 2, portrait: true, today }), ["stillAlive"]);
  assert.deepEqual(questions(person({ ...base, born: "1925-05-01", died: "2010-01-02", death_place: "Z" }), { parents: 2, portrait: true, today }), []);
});

test("upcoming lists birthdays, memorials and weddings with full dates only, nearest first", () => {
  const people = [
    person({ born: "1954-11-05" }), { ...person({ born: "1950-11-20" }), id: "b" }, { ...person({ born: "2017" }), id: "minor" },
    { ...person({ born: "1928-09-21", died: "2005-11-03" }), id: "late" }, { ...person({ born: "1920-11-10" }), id: "old" },
    { ...person({ born: "1960-01-01", living: false }), id: "gone" }, { ...person({ born: "1990-03-01" }), id: "far" }
  ];
  const marriages = [{ ids: ["p", "b"], date: "1980-11-02" }, { ids: ["p", "late"], date: "1975-11-04" }, { ids: ["p", "b"], date: "1985" }];
  const list = upcoming(people, marriages, { today, days: 30 });
  assert.deepEqual(list.map((item) => [item.type, item.ids.join("+"), item.inDays, item.years]), [
    ["wedding", "p+b", 1, 46], ["memorial", "late", 2, 21], ["birthday", "p", 4, 72], ["birthday", "b", 19, 76]
  ]);
});

test("a 29 February birthday falls on 28 February in other years", () => {
  const list = upcoming([{ id: "leap", kind: "person", metadata: { born: "1980-02-29" } }], [], { today: new Date(2027, 1, 1), days: 60 });
  assert.deepEqual(list.map((item) => [item.date.getMonth(), item.date.getDate(), item.years]), [[1, 28, 47]]);
});
