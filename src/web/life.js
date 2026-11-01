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

  // Birthdays of the living, anniversaries of deaths, and wedding anniversaries of couples who are both living,
  // within `days` of today. Only full dates count, so year-only (protected) dates never produce an occasion.
  // `marriages` are { ids, date }; `byId` maps person IDs to records.
  function upcoming(people, marriages, { today = new Date(), days = 60 } = {}) {
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const byId = new Map(people.map((person) => [person.id, person]));
    const occasions = [];
    const add = (type, ids, parsed) => {
      if (!parsed || !parsed.day || parsed.approximate) return;
      // A 29 February falls on 28 February in other years, as the site's reminders have it.
      const on = (year) => new Date(year, parsed.month - 1, parsed.month === 2 && parsed.day === 29 && new Date(year, 1, 29).getMonth() !== 1 ? 28 : parsed.day);
      let date = on(start.getFullYear());
      if (date < start) date = on(start.getFullYear() + 1);
      const inDays = Math.round((date - start) / 864e5);
      const years = date.getFullYear() - parsed.year;
      if (inDays <= days && years > 0) occasions.push({ type, ids, date, inDays, years });
    };
    for (const person of people) {
      if (!deceased(person)) {
        const years = age(person, today);
        if (!years || years.years < OLD_AGE) add("birthday", [person.id], birth(person));
      } else {
        add("memorial", [person.id], death(person));
      }
    }
    for (const marriage of marriages) {
      const couple = marriage.ids.map((id) => byId.get(id));
      if (couple.length === 2 && couple.every((person) => person && !deceased(person))) add("wedding", marriage.ids, parse(String(marriage.date || "").trim()));
    }
    return occasions.sort((left, right) => left.inDays - right.inDays || left.type.localeCompare(right.type) || left.ids.join().localeCompare(right.ids.join()));
  }

  globalThis.KindredLife = Object.freeze({ age, deceased, questions, upcoming, OLD_AGE });
})();
