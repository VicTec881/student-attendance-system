// Builds the class and course lists used by dropdowns, from the students on record.
(function () {
  'use strict';

  const { api } = window.SAMS;
  const MAX_PAGES = 30; // safety limit: up to 3,000 students

  const natural = (a, b) =>
    String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });

  // Fetches every student (all pages). Example: loadAllStudents({ status: 'Active' })
  async function loadAllStudents(params) {
    const all = [];
    let page = 1;
    let pages = 1;
    do {
      const qs = new URLSearchParams(Object.assign({ limit: 100, page: page }, params || {}));
      const data = await api('/api/students?' + qs.toString());
      all.push.apply(all, data.students);
      pages = data.pages;
      page += 1;
    } while (page <= pages && page <= MAX_PAGES);
    return all;
  }

  function buildCatalog(students) {
    const classes = new Map(); // lowercase -> display name (so "year 2" and "Year 2" merge)
    const courses = new Map();
    const years = new Set();
    const byClass = new Map(); // lowercase class -> Map(lowercase course -> display name)

    students.forEach((s) => {
      const classKey = s.className.toLowerCase();
      const courseKey = s.course.toLowerCase();
      if (!classes.has(classKey)) classes.set(classKey, s.className);
      if (!courses.has(courseKey)) courses.set(courseKey, s.course);
      years.add(s.yearOfStudy);
      if (!byClass.has(classKey)) byClass.set(classKey, new Map());
      if (!byClass.get(classKey).has(courseKey)) byClass.get(classKey).set(courseKey, s.course);
    });

    return {
      classes: Array.from(classes.values()).sort(natural),
      courses: Array.from(courses.values()).sort(natural),
      years: Array.from(years).sort((a, b) => a - b),
      coursesFor(className) {
        const map = byClass.get(String(className || '').toLowerCase());
        return map ? Array.from(map.values()).sort(natural) : [];
      },
    };
  }

  window.SAMS.lookups = { loadAllStudents, buildCatalog };
})();