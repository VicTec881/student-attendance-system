(function () {
  'use strict';

  const { api, esc } = window.SAMS;

  const user = window.SAMS.layout.init({ title: 'Dashboard' });
  if (!user) return;

  const content = document.getElementById('content');
  const LOW_ATTENDANCE = 75; // same mark used in the exported reports

  /* ---------- Formatting ---------- */
  const pct = (n) => Number(n || 0).toFixed(1).replace(/\.0$/, '') + '%';
  const fmtDate = (iso) =>
    new Date(iso).toLocaleDateString('en-GB', { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric' });
  const badge = (status) => '<span class="badge badge-' + esc(String(status).toLowerCase()) + '">' + esc(status) + '</span>';

  /* ---------- Building blocks ---------- */
  function hero(subtitle) {
    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    const first = user.fullName.split(' ')[0];
    const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    return (
      '<section class="hero"><h1>' + greeting + ', ' + esc(first) + '</h1><p>' + esc(subtitle) + '</p>' +
      '<div class="hero-meta"><span>' + esc(today) + '</span></div></section>'
    );
  }

  function statCard(o) {
    return (
      '<div class="card stat-card' + (o.tone ? ' stat-' + o.tone : '') + (o.highlight ? ' is-highlight' : '') + '">' +
      '<div class="stat-icon">' + window.icon(o.icon, 24) + '</div>' +
      '<div><div class="stat-value">' + esc(o.value) + '</div><div class="stat-label">' + esc(o.label) + '</div>' +
      (o.note ? '<div class="stat-note">' + esc(o.note) + '</div>' : '') + '</div></div>'
    );
  }

  const statGrid = (cards) => '<section class="stat-grid" aria-label="Key statistics">' + cards.join('') + '</section>';

  function section(title, body, action, id) {
    return (
      '<section class="section"' + (id ? ' id="' + id + '"' : '') + '><div class="section-head"><h2>' + esc(title) + '</h2>' +
      (action || '') + '</div>' + body + '</section>'
    );
  }

  function quickActions(items) {
    return section(
      'Quick actions',
      '<div class="quick-grid">' +
        items.map((i) =>
          '<a class="quick-action" href="' + esc(i.href) + '"><span class="qa-icon">' + window.icon(i.icon, 20) + '</span>' + esc(i.label) + '</a>'
        ).join('') + '</div>'
    );
  }

  function emptyState(title, text, action) {
    return (
      '<div class="state"><div class="state-icon">' + window.icon('clipboard-list', 28) + '</div><h3>' + esc(title) + '</h3><p>' +
      esc(text) + '</p>' + (action || '') + '</div>'
    );
  }

  const table = (head, rows) =>
    '<div class="table-wrap"><table class="table"><thead><tr>' + head.map((h) => '<th scope="col">' + esc(h) + '</th>').join('') +
    '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div>';

  /* ---------- Admin: last 7 days chart and recent records ---------- */
  function chartCard(days) {
    const totals = days.map((d) => d.present + d.absent + d.leave);
    let body;

    if (totals.every((t) => t === 0)) {
      body = emptyState('No attendance yet', 'No attendance has been recorded in the last 7 days.');
    } else {
      const max = Math.max(1, ...totals);
      const cols = days.map((d, i) => {
        const label = new Date(d.date + 'T00:00:00Z').toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric' });
        const full = label + ': ' + d.present + ' present, ' + d.absent + ' absent, ' + d.leave + ' on leave';
        const seg = (cls, n) => (n ? '<span class="seg ' + cls + '" style="height:' + (n / max) * 100 + '%"></span>' : '');
        return (
          '<div class="chart-col" role="img" aria-label="' + esc(full) + '" title="' + esc(full) + '">' +
          '<span class="chart-total">' + (totals[i] || '') + '</span>' +
          '<div class="chart-stack">' + seg('seg-present', d.present) + seg('seg-absent', d.absent) + seg('seg-leave', d.leave) + '</div>' +
          '<span class="chart-label">' + esc(label) + '</span></div>'
        );
      }).join('');

      body =
        '<div class="chart">' + cols + '</div>' +
        '<div class="legend">' +
        '<span><span class="legend-dot seg-present"></span>Present</span>' +
        '<span><span class="legend-dot seg-absent"></span>Absent</span>' +
        '<span><span class="legend-dot seg-leave"></span>Leave</span></div>';
    }

    return section('Attendance statistics: last 7 days', '<div class="card"><div class="card-body">' + body + '</div></div>');
  }

  function recentCard(records) {
    let body;
    if (!records.length) {
      body = emptyState('No attendance records found.', 'Records appear here once attendance has been marked.',
        '<a class="btn btn-primary" href="/attendance">Mark Attendance</a>');
    } else {
      body = table(
        ['Date', 'Student ID', 'Student Name', 'Class', 'Status', 'Marked By'],
        records.map((r) =>
          '<tr><td>' + fmtDate(r.date) + '</td><td>' + esc(r.studentId) + '</td><td>' + esc(r.student ? r.student.fullName : '') +
          '</td><td>' + esc(r.className) + '</td><td>' + badge(r.status) + '</td><td>' + esc(r.markedBy ? r.markedBy.fullName : '') + '</td></tr>'
        )
      );
    }
    return section('Recent attendance records', '<div class="card">' + body + '</div>',
      '<a class="btn btn-secondary btn-sm" href="/records">View all</a>');
  }

  /* ---------- Role dashboards ---------- */
  function renderAdmin(d) {
    const t = d.totals;
    const td = d.today;
    const o = d.overall;

    return (
      hero("Here is today's attendance overview for the school.") +
      statGrid([
        statCard({ icon: 'users', value: t.students, label: 'Total Students', note: t.activeStudents + ' active' }),
        statCard({ icon: 'graduation-cap', value: t.teachers, label: 'Total Teachers' }),
        statCard({ icon: 'check-circle', value: td.present, label: 'Present Today', tone: 'success', note: td.total ? 'of ' + td.total + ' marked' : 'Not marked yet' }),
        statCard({ icon: 'alert-circle', value: td.absent, label: 'Absent Today', tone: 'danger' }),
        statCard({ icon: 'file-text', value: td.leave, label: 'Students on Leave', tone: 'warning' }),
        statCard({ icon: 'bar-chart', value: pct(o.percentage), label: 'Overall Attendance', highlight: true, note: o.totalDays + ' attendance records' }),
      ]) +
      quickActions([
        { label: 'Add Student', href: '/students?action=add', icon: 'plus' },
        { label: 'Mark Attendance', href: '/attendance', icon: 'calendar-check' },
        { label: 'View Attendance', href: '/records', icon: 'clipboard-list' },
        { label: 'Generate Report', href: '/reports', icon: 'file-text' },
      ]) +
      chartCard(d.last7Days) +
      recentCard(d.recentRecords)
    );
  }

  function renderTeacher(d) {
    const t = d.totals;
    const td = d.today;
    const o = d.overall;

    const notice = td.total
      ? ''
      : '<div class="alert alert-info" role="status">' + window.icon('info', 18) +
        '<span>Attendance has not been marked today. <a href="/attendance">Mark attendance now</a>.</span></div>';

    return (
      hero("Here is today's attendance at a glance.") +
      notice +
      statGrid([
        statCard({ icon: 'users', value: t.students, label: 'Total Students', note: t.activeStudents + ' active' }),
        statCard({ icon: 'check-circle', value: td.present, label: 'Present Today', tone: 'success', note: td.total ? 'of ' + td.total + ' marked' : 'Not marked yet' }),
        statCard({ icon: 'alert-circle', value: td.absent, label: 'Absent Today', tone: 'danger' }),
        statCard({ icon: 'file-text', value: td.leave, label: 'Students on Leave', tone: 'warning' }),
        statCard({ icon: 'bar-chart', value: pct(o.percentage), label: 'Attendance Percentage', highlight: true, note: o.totalDays + ' attendance records' }),
      ]) +
      quickActions([
        { label: 'Mark Attendance', href: '/attendance', icon: 'calendar-check' },
        { label: 'View Students', href: '/students', icon: 'users' },
        { label: 'View Attendance', href: '/records', icon: 'clipboard-list' },
        { label: 'Generate Report', href: '/reports', icon: 'file-text' },
      ])
    );
  }

  function renderStudent(d) {
    const s = d.student;
    const a = d.attendance;

    const info = [
      ['Student Name', s.fullName],
      ['Student ID', s.studentId],
      ['Registration No.', s.registrationNumber],
      ['Class', s.className],
      ['Course/Program', s.course],
      ['Year of Study', s.yearOfStudy],
    ].map(([label, value]) =>
      '<div><div class="info-label">' + esc(label) + '</div><div class="info-value">' + esc(value) + '</div></div>'
    ).join('');

    const warning =
      a.totalDays > 0 && a.percentage < LOW_ATTENDANCE
        ? '<div class="alert alert-warning" role="status">' + window.icon('alert-triangle', 18) +
          '<span>Your attendance is below ' + LOW_ATTENDANCE + '%. Please attend classes regularly or speak to your teacher.</span></div>'
        : '';

    const history = d.history.length
      ? table(
          ['Date', 'Class', 'Course/Program', 'Session', 'Status'],
          d.history.map((r) =>
            '<tr><td>' + fmtDate(r.date) + '</td><td>' + esc(r.className) + '</td><td>' + esc(r.course) + '</td><td>' +
            esc(r.session) + '</td><td>' + badge(r.status) + '</td></tr>'
          )
        )
      : emptyState('No attendance records found.', 'Your attendance will appear here once your teacher marks it.');

    return (
      hero('Here is your attendance summary.') +
      section('Student details', '<div class="card"><div class="card-body"><div class="info-grid">' + info + '</div></div></div>') +
      warning +
      statGrid([
        statCard({ icon: 'calendar-check', value: a.totalDays, label: 'Total Attendance Days' }),
        statCard({ icon: 'check-circle', value: a.present, label: 'Present Days', tone: 'success' }),
        statCard({ icon: 'alert-circle', value: a.absent, label: 'Absent Days', tone: 'danger' }),
        statCard({ icon: 'file-text', value: a.leave, label: 'Leave Days', tone: 'warning' }),
        statCard({ icon: 'bar-chart', value: pct(a.percentage), label: 'Attendance Percentage', highlight: true }),
      ]) +
      section('Attendance history', '<div class="card">' + history + '</div>',
        '<a class="btn btn-secondary btn-sm" href="/records">View full history</a>', 'history')
    );
  }

  /* ---------- Loading and errors ---------- */
  function renderError(message) {
    content.innerHTML =
      '<div class="alert alert-error" role="alert">' + window.icon('alert-circle', 18) + '<span>' + esc(message) + '</span></div>' +
      '<button type="button" class="btn btn-primary" id="retry-btn">Try again</button>';
    document.getElementById('retry-btn').addEventListener('click', load);
  }

  function scrollToHash() {
    if (!window.location.hash) return;
    try {
      const target = document.querySelector(window.location.hash);
      if (target) target.scrollIntoView();
    } catch (e) { /* ignore an invalid hash */ }
  }

  async function load() {
    content.innerHTML = '<div class="loading"><span class="spinner"></span><span>Loading dashboard...</span></div>';
    try {
      const data = await api('/api/dashboard');
      const render = { admin: renderAdmin, teacher: renderTeacher, student: renderStudent }[data.role];
      content.innerHTML = render(data.dashboard);
      scrollToHash();
    } catch (err) {
      renderError(err.message);
    }
  }

  load();
})();