(function () {
  'use strict';

  const { api, esc, toast, setLoading } = window.SAMS;

  const user = window.SAMS.layout.init({ roles: ['admin', 'teacher'], title: 'Mark Attendance' });
  if (!user) return;

  const STORE_KEY = 'sams_mark_last';
  const SESSIONS = ['Full Day', 'Morning', 'Afternoon', 'Evening'];

  const els = {
    form: document.getElementById('filter-form'),
    date: document.getElementById('date'),
    cls: document.getElementById('class'),
    course: document.getElementById('course'),
    session: document.getElementById('session'),
    loadBtn: document.getElementById('load-btn'),
    sheet: document.getElementById('sheet'),
    errors: {
      date: document.getElementById('date-error'),
      cls: document.getElementById('class-error'),
      course: document.getElementById('course-error'),
    },
  };

  let catalog = null;
  let current = null; // the sheet on screen: { date, className, course, session }

  /* ---------- Helpers ---------- */
  const pad = (n) => String(n).padStart(2, '0');
  const todayStr = () => {
    const d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  };
  const fmtLong = (iso) =>
    new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', {
      timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });

  const options = (values, selected) =>
    values.map((v) => '<option value="' + esc(v) + '"' + (v === selected ? ' selected' : '') + '>' + esc(v) + '</option>').join('');

  const stateBlock = (icon, title, text, actionHtml) =>
    '<div class="card"><div class="state"><div class="state-icon">' + window.icon(icon, 28) + '</div><h3>' + esc(title) + '</h3><p>' +
    esc(text) + '</p>' + (actionHtml || '') + '</div></div>';

  const banner = (type, icon, html) =>
    '<div class="alert alert-' + type + '" role="status">' + window.icon(icon, 18) + '<span>' + html + '</span></div>';

  function remember() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ className: els.cls.value, course: els.course.value, session: els.session.value }));
    } catch (e) { /* storage unavailable: ignore */ }
  }

  function recall() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { return {}; }
  }

  /* ---------- Filter form ---------- */
  function fillCourses(selected) {
    const list = catalog.coursesFor(els.cls.value);
    els.course.innerHTML =
      '<option value="">' + (els.cls.value ? 'Select course/program' : 'Select a class first') + '</option>' + options(list, selected);
    els.course.disabled = !els.cls.value;
    if (selected && list.indexOf(selected) !== -1) els.course.value = selected;
    else if (list.length === 1) els.course.value = list[0]; // only one choice: select it
  }

  function setError(key, input, message) {
    els.errors[key].textContent = message || '';
    input.classList.toggle('is-invalid', Boolean(message));
    input.setAttribute('aria-invalid', message ? 'true' : 'false');
  }

  function validateFilters() {
    let firstBad = null;
    const check = (key, input, message) => {
      setError(key, input, message);
      if (message && !firstBad) firstBad = input;
    };

    if (!els.date.value) check('date', els.date, 'Select a date.');
    else if (els.date.value > todayStr()) check('date', els.date, 'Attendance cannot be marked for a future date.');
    else check('date', els.date, '');

    check('cls', els.cls, els.cls.value ? '' : 'Select a class.');
    check('course', els.course, els.course.value ? '' : 'Select a course/program.');

    if (firstBad) firstBad.focus();
    return !firstBad;
  }

  els.date.addEventListener('input', () => setError('date', els.date, ''));
  els.cls.addEventListener('change', () => {
    setError('cls', els.cls, '');
    fillCourses('');
  });
  els.course.addEventListener('change', () => setError('course', els.course, ''));

  els.form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!validateFilters()) return;
    remember();
    loadSheet({ date: els.date.value, className: els.cls.value, course: els.course.value, session: els.session.value });
  });

  /* ---------- Loading the class list ---------- */
  async function loadSheet(params) {
    setLoading(els.loadBtn, true, 'Loading students...');
    els.sheet.innerHTML = '<div class="loading" role="status"><span class="spinner"></span><span>Loading students...</span></div>';
    try {
      const data = await api('/api/attendance/sheet?' + new URLSearchParams(params).toString());
      renderSheet(data);
    } catch (err) {
      current = null;
      els.sheet.innerHTML = '<div class="alert alert-error" role="alert">' + window.icon('alert-circle', 18) + '<span>' + esc(err.message) + '</span></div>';
    } finally {
      setLoading(els.loadBtn, false);
    }
  }

  function statusGroup(index, studentRef, fullName) {
    const opt = (value, cls, checked) =>
      '<label class="status-option ' + cls + '"><input type="radio" name="status-' + index + '" value="' + value + '"' +
      (checked ? ' checked' : '') + '><span>' + value + '</span></label>';

    return (
      '<div class="status-group" role="radiogroup" aria-label="Attendance status for ' + esc(fullName) + '" data-student="' + esc(studentRef) + '">' +
      opt('Present', 'opt-present', true) + opt('Absent', 'opt-absent', false) + opt('Leave', 'opt-leave', false) + '</div>'
    );
  }

  function renderSheet(data) {
    const students = data.students;
    current = { date: data.date, className: data.className, course: data.course, session: data.session };

    if (students.length === 0) {
      current = null;
      els.sheet.innerHTML = stateBlock(
        'users', 'No students found.',
        'There are no active students in ' + data.className + ' (' + data.course + ').',
        '<a class="btn btn-primary" href="/students?action=add">Add Student</a>'
      );
      return;
    }

    const open = students.filter((s) => !s.attendanceId);
    const recorded = students.length - open.length;

    let notice;
    if (recorded === students.length) {
      notice = banner('info', 'info',
        'Attendance for this date and session has already been recorded. To change a status, use <a href="/records">Attendance Records</a>.');
    } else if (recorded > 0) {
      notice = banner('warning', 'alert-triangle',
        'Attendance was already recorded for ' + recorded + ' of ' + students.length + ' students. Only the remaining ' + open.length + ' can be marked here.');
    } else {
      notice = banner('info', 'info', 'All students start as Present. Change the exceptions, then save.');
    }

    const bulk = open.length
      ? '<div class="bulk-actions"><span class="bulk-label">Mark all as:</span>' +
        '<button type="button" class="btn btn-secondary btn-sm" data-bulk="Present">Present</button>' +
        '<button type="button" class="btn btn-secondary btn-sm" data-bulk="Absent">Absent</button>' +
        '<button type="button" class="btn btn-secondary btn-sm" data-bulk="Leave">Leave</button></div>'
      : '';

    let index = 0;
    const body = students.map((s, i) => {
      const status = s.attendanceId
        ? '<span class="badge badge-' + esc(s.status.toLowerCase()) + '">' + esc(s.status) + '</span><span class="locked-note">Recorded</span>'
        : statusGroup(index++, s.student, s.fullName);
      return (
        '<tr><td class="num">' + (i + 1) + '</td><td>' + esc(s.studentId) + '</td><td>' + esc(s.registrationNumber) +
        '</td><td><strong>' + esc(s.fullName) + '</strong></td><td>' + esc(s.className) + '</td><td>' + status + '</td></tr>'
      );
    }).join('');

    const saveBar = open.length
      ? '<div class="save-bar"><div class="tally">' +
        '<span class="badge badge-present">Present <strong id="n-present">0</strong></span>' +
        '<span class="badge badge-absent">Absent <strong id="n-absent">0</strong></span>' +
        '<span class="badge badge-leave">Leave <strong id="n-leave">0</strong></span></div>' +
        '<button type="button" id="save-btn" class="btn btn-primary btn-lg">' + window.icon('check', 18) + 'Save Attendance</button></div>'
      : '';

    els.sheet.innerHTML =
      notice +
      '<section class="card" aria-label="Attendance sheet">' +
      '<div class="card-header"><div><h2>' + esc(data.className) + ' &middot; ' + esc(data.course) + '</h2>' +
      '<div class="sheet-meta"><span>' + esc(fmtLong(data.date)) + '</span><span>Session: ' + esc(data.session) +
      '</span><span>' + students.length + (students.length === 1 ? ' student' : ' students') + '</span></div></div></div>' +
      bulk +
      '<div class="table-wrap"><table class="table"><caption class="sr-only">Attendance for ' + esc(data.className) + ' on ' + esc(data.date) + '</caption>' +
      '<thead><tr><th scope="col" class="num">#</th><th scope="col">Student ID</th><th scope="col">Registration No.</th>' +
      '<th scope="col">Student Name</th><th scope="col">Class</th><th scope="col">Status</th></tr></thead><tbody>' + body + '</tbody></table></div>' +
      '</section>' + saveBar;

    updateTally();
  }

  /* ---------- Marking and saving ---------- */
  function updateTally() {
    const counts = { Present: 0, Absent: 0, Leave: 0 };
    els.sheet.querySelectorAll('.status-group input:checked').forEach((r) => { counts[r.value] += 1; });

    const set = (id, n) => {
      const el = document.getElementById(id);
      if (el) el.textContent = n;
    };
    set('n-present', counts.Present);
    set('n-absent', counts.Absent);
    set('n-leave', counts.Leave);
  }

  els.sheet.addEventListener('change', (e) => {
    if (e.target.matches('.status-group input')) updateTally();
  });

  els.sheet.addEventListener('click', (e) => {
    const bulk = e.target.closest('[data-bulk]');
    if (bulk) {
      els.sheet.querySelectorAll('.status-group').forEach((group) => {
        const radio = group.querySelector('input[value="' + bulk.dataset.bulk + '"]');
        if (radio) radio.checked = true;
      });
      updateTally();
      return;
    }
    if (e.target.closest('#save-btn')) save();
  });

  async function save() {
    if (!current) return;

    const records = [];
    els.sheet.querySelectorAll('.status-group').forEach((group) => {
      const checked = group.querySelector('input:checked');
      if (checked) records.push({ student: group.dataset.student, status: checked.value });
    });
    if (!records.length) return;

    const saveBtn = document.getElementById('save-btn');
    const sheetParams = Object.assign({}, current);
    setLoading(saveBtn, true, 'Saving attendance...');

    try {
      const res = await api('/api/attendance', { method: 'POST', body: Object.assign({}, sheetParams, { records }) });
      const s = res.summary;
      toast('Attendance saved successfully. ' + s.present + ' present, ' + s.absent + ' absent, ' + s.leave + ' on leave.', 'success');
      loadSheet(sheetParams); // reload: the saved students now show as recorded
    } catch (err) {
      setLoading(saveBtn, false);
      toast(
        err.status === 0 ? 'Unable to save attendance. Please check your connection and try again.' : err.message,
        'error', 8000
      );
      if (err.status === 409) loadSheet(sheetParams); // someone else saved first: show the current state
    }
  }

  /* ---------- Start ---------- */
  async function init() {
    els.date.value = todayStr();
    els.date.max = todayStr();
    els.session.innerHTML = options(SESSIONS, 'Full Day');
    els.sheet.innerHTML = '';

    try {
      catalog = window.SAMS.lookups.buildCatalog(await window.SAMS.lookups.loadAllStudents({ status: 'Active' }));
    } catch (err) {
      els.sheet.innerHTML =
        '<div class="alert alert-error" role="alert">' + window.icon('alert-circle', 18) + '<span>' + esc(err.message) + '</span></div>' +
        '<button type="button" class="btn btn-primary" id="retry-btn">Try again</button>';
      document.getElementById('retry-btn').addEventListener('click', init);
      return;
    }

    if (!catalog.classes.length) {
      els.cls.innerHTML = '<option value="">No classes yet</option>';
      els.sheet.innerHTML = stateBlock(
        'users', 'No students found.', 'Add students before you mark attendance.',
        '<a class="btn btn-primary" href="/students?action=add">Add Student</a>'
      );
      return;
    }

    const last = recall();
    els.cls.innerHTML = '<option value="">Select class</option>' + options(catalog.classes);
    els.cls.disabled = false;
    if (last.className && catalog.classes.indexOf(last.className) !== -1) els.cls.value = last.className;
    fillCourses(last.course);
    if (last.session && SESSIONS.indexOf(last.session) !== -1) els.session.value = last.session;

    els.loadBtn.disabled = false;
  }

  init();
})();