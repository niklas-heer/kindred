"use strict";
(() => {
  // Ages and open questions, read from a person's own metadata. Dates are ISO (YYYY, YYYY-MM or YYYY-MM-DD);
  // other wording ("about 1930") still yields its year, marked as approximate.
  const ISO = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/u;
  // Without a recorded death a person counts as living; from this age on the viewer asks instead of assuming.
  const OLD_AGE = 100;
  const ADULT = 18;

  function firstValue(metadata, keys) {
    for (const key of keys) {
      const value = metadata?.[key];
      const text = value && typeof value === "object" ? value.date ?? value.value : value;
      if (text !== undefined && text !== null && String(text).trim()) return String(text).trim();
    }
    return "";
  }

  function parse(value) {
    const exact = ISO.exec(value);
    if (exact) return { year: Number(exact[1]), month: exact[2] ? Number(exact[2]) : 0, day: exact[3] ? Number(exact[3]) : 0, approximate: false };
    const loose = /\b(\d{4})\b/u.exec(value);
    return loose ? { year: Number(loose[1]), month: 0, day: 0, approximate: true } : null;
  }

  const birth = (person) => parse(firstValue(person.metadata, ["born", "birth", "birth_date"]));
  const death = (person) => parse(firstValue(person.metadata, ["died", "death", "death_date"]));

  // Deceased when a death is recorded or the archive says so; everyone else is presumed living.
  function deceased(person) {
    return Boolean(firstValue(person.metadata, ["died", "death", "death_date"])) || person.metadata?.living === false;
  }

  // Completed years at death, or today for the living. `exact` is false when a year-only date leaves it one year open;
  // the value is then the higher of the two.
  function age(person, today = new Date()) {
    const born = birth(person);
    if (!born) return null;
    const dead = deceased(person);
    const end = dead ? death(person) : { year: today.getFullYear(), month: today.getMonth() + 1, day: today.getDate(), approximate: false };
    if (!end) return null;
    let years = end.year - born.year;
    const exact = Boolean(born.day && end.day && !born.approximate && !end.approximate);
    if (exact && (end.month < born.month || (end.month === born.month && end.day < born.day))) years -= 1;
    return years < 0 ? null : { years, exact, deceased: dead };
  }

  // What a relative could still add, most useful first. `parents` is the number of recorded parent links and
  // `portrait` whether a photo shows; a deliberate `parents: []` or a year-only display is not a gap.
  function questions(person, { parents = 0, portrait = false, today = new Date() } = {}) {
    const metadata = person.metadata || {};
    const open = [];
    const born = birth(person);
    const years = age(person, today);
    if (!born) open.push("birthDate");
    else if (!born.day && metadata.date_display !== "year") open.push("birthDay");
    if (!metadata.birth_place) open.push("birthPlace");
    if (!metadata.occupation && (!years || years.years >= ADULT)) open.push("occupation");
    const confirmedUnknown = Array.isArray(metadata.parents) && metadata.parents.length === 0;
    if (!parents && !confirmedUnknown) open.push("parents");
    if (deceased(person)) {
      const died = death(person);
      if (!died) open.push("deathDate");
      else if (!died.day) open.push("deathDay");
      if (!metadata.death_place) open.push("deathPlace");
    } else if (years && years.years >= OLD_AGE) {
      open.push("stillAlive");
    }
    if (!portrait) open.push("portrait");
    return open;
  }

  globalThis.KindredLife = Object.freeze({ age, deceased, questions, OLD_AGE });
})();
