(function () {
  'use strict';

  const { api, esc, toast, setLoading, hideAlert, showAlert } = window.SAMS;

  const user = window.SAMS.layout.init({ roles: ['admin', 'teacher'], title: 'Reports' });
  if (!user) return;

  const isAdmin = user.role === 'admin';
  const LOW_MARK = 75; // percentages below this are shown in red (same mark as the exports)
  const HISTORY_LIMIT = 10;
  const DASH = '\u2014';
  const FUTURE = 'Reports cannot be generated for a future period.';
  const MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  const HINTS = {
    daily: 'Attendance for a single day.',
    weekly: 'Attendance for the Monday-to-Sunday week that contains the date you choose.',
    monthly: 'Attendance for a whole calendar month.',
    class: 'Every student in one class, for all dates or a date range.',
    student: "One student's attendance, day by day.",
  };

  // Which form fields each report type uses
  const FIELDS = {
    daily: ['date', 'class', 'course', 'status', 'empty'],
    weekly: ['date', 'class', 'course', 'status', 'empty'],
    monthly: ['month', 'class', 'course', 'status', 'empty'],
    class: ['class', 'course', 'range', 'status', 'empty'],
    student: ['student', 'range'],
  };

  const $ = (id) => document.getElementById(id);
  const els = {
    form: $('report-form'), formAlert: $('form-alert'),
    type: $('r-type'), typeHint: $('type-hint'),
    date: $('r-date'), dateLabel: $('date-label'), dateHint: $('date-hint'),
    month: $('r-month'), year: $('r-year'),
    cls: $('r-class'), classLabel: $('class-label'), course: $('r-course'),
    student: $('r-student'), from: $('r-from'), to: $('r-to'),
    status: $('r-status'), empty: $('r-empty'),
    generate: $('generate-btn'), excel: $('excel-btn'), pdf: $('pdf-btn'),
    result: $('result-area'),
    historyArea: $('history-area'), historyPager: $('history-pagination'), historySub: $('history-subtitle'),
  };

  let students = [];
  let catalog = null;
  let historyPage = 1;
  let historyRows = new Map();
  let historyRequest = 0;

  /* ---------- Helpers ---------- */
  const pad = (n) => String(n).padStart(2, '0');
  const todayStr = () => {
    const d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  };
  // Monday of the week that contains a YYYY-MM-DD date
  const mondayOf = (dateStr) => {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7));
    return dt.toISOString().slice(0, 10);
  };
  const natural = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
  const options = (values) => values.map((v) => '<option value="' + esc(v) + '">' + esc(v) + '</option>').join('');
  const pct = (p) => Number(p).toFixed(1).replace(/\.0$/, '') + '%';
  const pctHtml = (p) => '<span class="pct ' + (p >= LOW_MARK ? 'pct-ok' : 'pct-low') + '">' + esc(pct(p)) + '</span>';
  const fmtDay = (iso) =>
    new Date(iso).toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
  const fmtDateTime = (iso) =>
    new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const badge = (s) => '<span class="badge badge-' + esc(String(s).toLowerCase()) + '">' + esc(s) + '</span>';
  const tile = (cls, value, label) =>
    '<div class="mini-stat ' + cls + '"><strong>' + esc(value) + '</strong><span>' + esc(label) + '</span></div>';
  const loadingBlock = (text) =>
    '<div class="loading" role="status"><span class="spinner"></span><span>' + esc(text) + '</span></div>';
  const stateCard = (title, text) =>
    '<section class="card section"><div class="state"><div class="state-icon">' + window.icon('clipboard-list', 28) +
    '</div><h3>' + esc(title) + '</h3><p>' + esc(text) + '</p></div></section>';

  function filterText(f) {
    const parts = [];
    if (f.className) parts.push('Class: ' + f.className);
    if (f.course) parts.push('Course: ' + f.course);
    if (f.studentStatus) parts.push('Students: ' + f.studentStatus);
    return parts.join('  |  ');
  }

  function setError(input, message) {
    const holder = document.getElementById(input.id + '-error');
    if (holder) holder.textContent = message || '';
    input.classList.toggle('is-invalid', Boolean(message));
    input.setAttribute('aria-invalid', message ? 'true' : 'false');
  }

  function clearErrors() {
    [els.date, els.month, els.cls, els.student, els.from, els.to].forEach((input) => setError(input, ''));
    els.year.classList.remove('is-invalid');
    els.year.setAttribute('aria-invalid', 'false');
  }

  /* ---------- Form set-up ---------- */
  function fillPeriod() {
    const now = new Date();
    els.month.innerHTML = MONTHS.map((m, i) => '<option value="' + pad(i + 1) + '">' + m + '</option>').join('');
    const years = [];
    for (let y = now.getFullYear(); y >= now.getFullYear() - 5; y -= 1) years.push(y);
    els.year.innerHTML = years.map((y) => '<option value="' + y + '">' + y + '</option>').join('');
    els.month.value = pad(now.getMonth() + 1);
    els.year.value = String(now.getFullYear());
  }

  function fillStudents() {
    const groups = new Map();
    students.forEach((s) => {
      if (!groups.has(s.className)) groups.set(s.className, []);
      groups.get(s.className).push(s);
    });

    els.student.innerHTML =
      '<option value="">Select student</option>' +
      Array.from(groups.keys()).sort(natural).map((name) =>
        '<optgroup label="' + esc(name) + '">' +
        groups.get(name).sort((a, b) => natural(a.studentId, b.studentId)).map((s) =>
          '<option value="' + esc(s._id) + '">' + esc(s.studentId + ' - ' + s.fullName + (s.status === 'Inactive' ? ' (Inactive)' : '')) + '</option>'
        ).join('') + '</optgroup>'
      ).join('');
  }

  function fillCourses(selected) {
    const list = els.cls.value ? catalog.coursesFor(els.cls.value) : catalog.courses;
    els.course.innerHTML = '<option value="">All courses</option>' + options(list);
    if (selected && list.indexOf(selected) !== -1) els.course.value = selected;
  }

  function applyType() {
    const type = els.type.value;
    const active = FIELDS[type];

    document.querySelectorAll('[data-field]').forEach((el) => {
      el.classList.toggle('hidden', active.indexOf(el.dataset.field) === -1);
    });
    els.typeHint.textContent = HINTS[type];

    const isDaily = type === 'daily';
    els.dateLabel.innerHTML = (isDaily ? 'Date' : 'Any date in the week') + ' <span class="required" aria-hidden="true">*</span>';
    els.date.max = isDaily ? todayStr() : '';
    els.dateHint.textContent = isDaily ? '' : 'Weeks run Monday to Sunday.';

    const isClass = type === 'class';
    els.classLabel.innerHTML = 'Class ' + (isClass ? '<span class="required" aria-hidden="true">*</span>' : '<span class="optional">(optional)</span>');
    const keepClass = els.cls.value;
    els.cls.innerHTML = '<option value="">' + (isClass ? 'Select class' : 'All classes') + '</option>' + options(catalog.classes);
    els.cls.value = keepClass;
    fillCourses(els.course.value);

    clearErrors();
    hideAlert(els.formAlert);
  }

  /* ---------- Reading and checking the form ---------- */
  // Returns { path, exportQuery } for the selected report, or null after showing the problems
  function readRequest() {
    const type = els.type.value;
    hideAlert(els.formAlert);
    clearErrors();

    const q = new URLSearchParams();                  // parameters shared by the report and its export
    const ex = new URLSearchParams({ type: type });   // export parameters
    const today = todayStr();
    let path = '';
    let firstBad = null;

    const fail = (input, message) => {
      setError(input, message);
      if (!firstBad) firstBad = input;
    };
    const readRange = () => {
      const from = els.from.value;
      const to = els.to.value;
      if (from && to && from > to) {
        fail(els.to, 'The start date cannot be after the end date.');
        els.from.classList.add('is-invalid');
      }
      if (from) q.set('startDate', from);
      if (to) q.set('endDate', to);
    };

    if (type === 'daily' || type === 'weekly') {
      const date = els.date.value;
      if (!date) fail(els.date, 'Select a date.');
      else if (type === 'daily' && date > today) fail(els.date, FUTURE);
      else if (type === 'weekly' && mondayOf(date) > today) fail(els.date, FUTURE);
      q.set('date', date);
      path = '/api/reports/' + type;
    } else if (type === 'monthly') {
      const month = els.year.value + '-' + els.month.value;
      if (month > today.slice(0, 7)) {
        fail(els.month, FUTURE);
        els.year.classList.add('is-invalid');
      }
      q.set('month', month);
      path = '/api/reports/monthly';
    } else if (type === 'class') {
      if (!els.cls.value) fail(els.cls, 'Select a class.');
      path = '/api/reports/class/' + encodeURIComponent(els.cls.value);
      ex.set('className', els.cls.value);
      readRange();
    } else {
      if (!els.student.value) fail(els.student, 'Select a student.');
      path = '/api/reports/student/' + encodeURIComponent(els.student.value);
      ex.set('student', els.student.value);
      readRange();
    }

    if (type !== 'student') {
      if (type !== 'class' && els.cls.value) q.set('className', els.cls.value);
      if (els.course.value) q.set('course', els.course.value);
      q.set('studentStatus', els.status.value);
      if (els.empty.checked) q.set('includeEmpty', 'true');
    }

    if (firstBad) {
      firstBad.focus();
      return null;
    }

    q.forEach((value, key) => ex.set(key, value));
    const qs = q.toString();
    return { path: path + (qs ? '?' + qs : ''), exportQuery: ex.toString() };
  }

  // Shows a spinner on one button and disables the other two
  function busy(button, on, text) {
    [els.generate, els.excel, els.pdf].forEach((b) => {
      if (b !== button) b.disabled = on;
    });
    setLoading(button, on, text);
  }

  /* ---------- Generate ---------- */
  async function generate(prepared) {
    const request = prepared || readRequest();
    if (!request) return;

    busy(els.generate, true, 'Generating report...');
    els.result.innerHTML = '<section class="card section">' + loadingBlock('Generating report...') + '</section>';
    try {
      const data = await api(request.path);
      renderReport(data.report);
      loadHistory(1);
    } catch (err) {
      renderProblem(err);
    } finally {
      busy(els.generate, false);
    }
  }

  function renderProblem(err) {
    if (err.status === 404 && /no attendance/i.test(err.message)) {
      els.result.innerHTML = stateCard(
        'No attendance records found.',
        'There is no attendance for the period, class or student you selected. Try different options.'
      );
    } else {
      els.result.innerHTML =
        '<div class="alert alert-error" role="alert">' + window.icon('alert-circle', 18) + '<span>' + esc(err.message) + '</span></div>';
    }
  }

  function renderReport(r) {
    const filters = r.filters ? filterText(r.filters) : '';
    const header =
      '<div class="card-header"><div><h2 id="result-title" class="result-title" tabindex="-1">' + esc(r.title) + '</h2>' +
      '<div class="sheet-meta"><span>Period: ' + esc(r.period.label) + '</span>' +
      (filters ? '<span>Filters: ' + esc(filters) + '</span>' : '') +
      '<span>Generated by ' + esc(r.generatedBy.fullName) + ' on ' + esc(fmtDateTime(r.generatedAt)) + '</span></div></div></div>';

    els.result.innerHTML =
      '<section class="card section" id="report-result">' + header + (r.student ? studentBody(r) : listBody(r)) + '</section>';
    $('result-title').focus();
  }

  function listBody(r) {
    const o = r.overall;
    const num = (value) => '<td class="num">' + esc(value) + '</td>';

    const rows = r.students.map((s, i) =>
      '<tr>' + num(i + 1) + '<td>' + esc(s.studentId) + '</td><td>' + esc(s.registrationNumber) + '</td><td><strong>' +
      esc(s.fullName) + '</strong></td><td>' + esc(s.className) + '</td><td>' + esc(s.course) + '</td>' +
      num(s.present) + num(s.absent) + num(s.leave) + num(s.totalDays) + '<td class="num">' + pctHtml(s.percentage) + '</td></tr>'
    ).join('');

    const heads = ['#', 'Student ID', 'Registration No.', 'Student Name', 'Class', 'Course/Program', 'Present', 'Absent', 'Leave', 'Total days', 'Attendance %']
      .map((h, i) => '<th scope="col"' + (i === 0 || i >= 6 ? ' class="num"' : '') + '>' + esc(h) + '</th>').join('');

    const foot =
      '<tfoot><tr><td colspan="6" class="text-right">Overall (' + esc(o.students) + (o.students === 1 ? ' student' : ' students') + ')</td>' +
      num(o.present) + num(o.absent) + num(o.leave) + num(o.totalDays) + '<td class="num">' + pctHtml(o.percentage) + '</td></tr></tfoot>';

    return (
      '<div class="card-body"><div class="mini-stats cols-5">' +
      tile('', o.students, 'Students') + tile('is-present', o.present, 'Present days') + tile('is-absent', o.absent, 'Absent days') +
      tile('is-leave', o.leave, 'Leave days') + tile('is-pct', pct(o.percentage), 'Attendance') +
      '</div></div>' +
      '<div class="table-wrap"><table class="table"><caption class="sr-only">' + esc(r.title) + '</caption><thead><tr>' + heads +
      '</tr></thead><tbody>' + rows + '</tbody>' + foot + '</table></div>'
    );
  }

  function studentBody(r) {
    const s = r.student;
    const o = r.overall;

    const info = [
      ['Student Name', s.fullName], ['Student ID', s.studentId], ['Registration No.', s.registrationNumber],
      ['Class', s.className], ['Course/Program', s.course], ['Year of Study', s.yearOfStudy],
    ].map(([label, value]) =>
      '<div><div class="info-label">' + esc(label) + '</div><div class="info-value">' + esc(value) + '</div></div>'
    ).join('');

    const rows = r.records.map((x) =>
      '<tr><td>' + esc(fmtDay(x.date)) + '</td><td>' + esc(x.className) + '</td><td>' + esc(x.course) + '</td><td>' +
      esc(x.session) + '</td><td>' + badge(x.status) + '</td></tr>'
    ).join('');

    return (
      '<div class="card-body"><div class="info-grid">' + info + '</div></div>' +
      '<div class="card-body" style="padding-top:0"><div class="mini-stats cols-5">' +
      tile('', o.totalDays, 'Total days') + tile('is-present', o.present, 'Present') + tile('is-absent', o.absent, 'Absent') +
      tile('is-leave', o.leave, 'Leave') + tile('is-pct', pct(o.percentage), 'Attendance') +
      '</div></div>' +
      '<div class="table-wrap"><table class="table"><caption class="sr-only">Attendance history</caption><thead><tr>' +
      '<th scope="col">Date</th><th scope="col">Class</th><th scope="col">Course/Program</th><th scope="col">Session</th><th scope="col">Status</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>'
    );
  }

  /* ---------- Export ---------- */
  async function exportReport(format, button) {
    const request = readRequest();
    if (!request) return;

    const label = format === 'excel' ? 'Excel' : 'PDF';
    busy(button, true, 'Exporting report...');
    try {
      const name = await window.SAMS.download(
        '/api/reports/export/' + format + '?' + request.exportQuery,
        'attendance-report.' + (format === 'excel' ? 'xlsx' : 'pdf')
      );
      toast(label + ' report downloaded: ' + name, 'success');
      loadHistory(1);
    } catch (err) {
      toast(err.message, 'error', 8000);
    } finally {
      busy(button, false);
    }
  }

  /* ---------- Report history ---------- */
  async function loadHistory(page) {
    historyPage = page;
    const id = ++historyRequest;
    els.historySub.textContent = isAdmin ? 'Reports generated by all users.' : 'Reports you have generated.';

    try {
      const data = await api('/api/reports?' + new URLSearchParams({ page: historyPage, limit: HISTORY_LIMIT }).toString());
      if (id !== historyRequest) return;
      if (data.total > 0 && data.count === 0 && historyPage > 1) return loadHistory(data.pages);
      renderHistory(data);
    } catch (err) {
      if (id !== historyRequest) return;
      els.historyPager.classList.add('hidden');
      els.historyArea.innerHTML =
        '<div class="card-body"><div class="alert alert-error" role="alert">' + window.icon('alert-circle', 18) + '<span>' + esc(err.message) +
        '</span></div><button type="button" class="btn btn-primary" data-action="retry-history">Try again</button></div>';
    }
  }

  function renderHistory(data) {
    historyRows = new Map(data.reports.map((r) => [r._id, r]));

    if (data.total === 0) {
      els.historyPager.classList.add('hidden');
      els.historyArea.innerHTML =
        '<div class="state"><div class="state-icon">' + window.icon('file-text', 28) + '</div><h3>No reports available.</h3>' +
        '<p>Reports you generate or export will be listed here.</p></div>';
      return;
    }

    const formatOf = (r) => {
      const exported = r.parameters && r.parameters.exportedAs;
      return exported === 'excel' ? 'Excel' : exported === 'pdf' ? 'PDF' : 'On screen';
    };

    const rows = data.reports.map((r) =>
      '<tr><td><strong>' + esc(r.reportName) + '</strong></td><td><span class="badge badge-type">' + esc(r.reportType) + '</span></td><td>' +
      esc(r.generatedBy ? r.generatedBy.fullName : 'Deleted user') + '</td><td>' + esc(fmtDateTime(r.generatedAt)) + '</td><td>' +
      esc(formatOf(r)) + '</td><td><button type="button" class="btn btn-secondary btn-sm" data-action="rerun" data-id="' + esc(r._id) +
      '">Run again</button></td></tr>'
    ).join('');

    els.historyArea.innerHTML =
      '<div class="table-wrap"><table class="table"><caption class="sr-only">Recent reports</caption><thead><tr>' +
      '<th scope="col">Report</th><th scope="col">Type</th><th scope="col">Generated by</th><th scope="col">Date</th>' +
      '<th scope="col">Format</th><th scope="col">Actions</th></tr></thead><tbody>' + rows + '</tbody></table></div>';

    els.historyPager.classList.remove('hidden');
    els.historyPager.innerHTML =
      '<div>' + esc(data.total) + (data.total === 1 ? ' report' : ' reports') + '</div>' +
      '<div class="pager"><button type="button" class="btn btn-secondary btn-sm" data-page="prev"' + (data.page <= 1 ? ' disabled' : '') + '>Previous</button>' +
      '<span class="page-indicator">Page ' + data.page + ' of ' + data.pages + '</span>' +
      '<button type="button" class="btn btn-secondary btn-sm" data-page="next"' + (data.page >= data.pages ? ' disabled' : '') + '>Next</button></div>';
  }

  // Fills the form from a history entry and generates it again
  function rerun(report) {
    const p = report.parameters || {};
    const period = p.period || {};
    const type = report.reportType;

    els.type.value = type;
    applyType();
    clearErrors();

    if (type === 'daily' || type === 'weekly') els.date.value = period.start || '';

    if (type === 'monthly' && period.start) {
      const year = period.start.slice(0, 4);
      if (!Array.from(els.year.options).some((o) => o.value === year)) {
        els.year.insertAdjacentHTML('beforeend', '<option value="' + esc(year) + '">' + esc(year) + '</option>');
      }
      els.year.value = year;
      els.month.value = period.start.slice(5, 7);
    }

    if (type !== 'student') {
      els.cls.value = p.className || '';
      fillCourses(p.course || '');
      els.status.value = p.studentStatus || 'Active';
      els.empty.checked = Boolean(p.includeEmpty);
    }
    if (type === 'class' || type === 'student') {
      els.from.value = period.start || '';
      els.to.value = period.end || '';
    }
    if (type === 'student') els.student.value = p.student || '';

    if ((type === 'class' && !els.cls.value) || (type === 'student' && !els.student.value)) {
      toast('This report cannot be run again because its class or student no longer exists.', 'error');
      return;
    }

    const request = readRequest();
    if (request) generate(request);
  }

  /* ---------- Events ---------- */
  els.type.addEventListener('change', applyType);
  els.cls.addEventListener('change', () => fillCourses(''));
  els.form.addEventListener('input', (e) => {
    if (e.target.classList.contains('form-control')) setError(e.target, '');
  });
  els.form.addEventListener('submit', (e) => {
    e.preventDefault();
    generate();
  });
  els.excel.addEventListener('click', () => exportReport('excel', els.excel));
  els.pdf.addEventListener('click', () => exportReport('pdf', els.pdf));

  els.historyArea.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'retry-history') {
      loadHistory(historyPage);
    } else if (btn.dataset.action === 'rerun') {
      const report = historyRows.get(btn.dataset.id);
      if (report) rerun(report);
    }
  });
  els.historyPager.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-page]');
    if (!btn || btn.disabled) return;
    loadHistory(historyPage + (btn.dataset.page === 'next' ? 1 : -1));
  });

  /* ---------- Start ---------- */
  (async function init() {
    [els.generate, els.excel, els.pdf].forEach((b) => { b.disabled = true; });
    els.historyArea.innerHTML = loadingBlock('Loading reports...');

    try {
      students = await window.SAMS.lookups.loadAllStudents();
    } catch (err) {
      showAlert(els.formAlert, 'error', err.message + ' Reload the page to try again.');
      els.historyArea.innerHTML = '';
      return;
    }

    catalog = window.SAMS.lookups.buildCatalog(students);
    fillPeriod();
    fillStudents();
    els.date.value = todayStr();
    applyType();
    [els.generate, els.excel, els.pdf].forEach((b) => { b.disabled = false; });
    loadHistory(1);
  })();
})();