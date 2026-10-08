(function () {
  'use strict';

  const { Auth, api, esc, toast, setLoading, showAlert, hideAlert } = window.SAMS;

  // The page title depends on the role, so read the role before building the shell
  const saved = Auth.getUser();
  const isStudent = Boolean(saved && saved.role === 'student');

  const user = window.SAMS.layout.init({ title: isStudent ? 'My Attendance' : 'Attendance Records' });
  if (!user) return;

  const isAdmin = user.role === 'admin';
  const isTeacher = user.role === 'teacher';
  const canManage = isAdmin || isTeacher; // staff see everyone's records; students only their own

  const PAGE_SIZES = [10, 25, 50, 100];
  const DASH = '\u2014';
  const RANGE_HINT = 'Tip: choose the same date in both boxes to see a single day.';
  const STATUSES = ['Present', 'Absent', 'Leave'];

  const els = {
    title: document.getElementById('page-title'),
    subtitle: document.getElementById('page-subtitle'),
    markLink: document.getElementById('mark-link'),
    summary: document.getElementById('summary'),
    search: document.getElementById('search'),
    fClass: document.getElementById('filter-class'),
    fCourse: document.getElementById('filter-course'),
    fStatus: document.getElementById('filter-status'),
    from: document.getElementById('date-from'),
    to: document.getElementById('date-to'),
    clear: document.getElementById('clear-filters'),
    rangeMsg: document.getElementById('range-msg'),
    tableArea: document.getElementById('table-area'),
    pagination: document.getElementById('pagination'),
  };

  const state = {
    search: '', className: '', course: '', status: '', startDate: '', endDate: '',
    sortBy: 'date', order: 'desc', page: 1, limit: 10,
  };

  let rows = new Map(); // _id -> record, for the rows on screen
  let requestId = 0;    // ignores out-of-date responses
  let focusAfter = null;

  /* ---------- Role set-up ---------- */
  document.querySelectorAll('[data-staff]').forEach((el) => el.classList.toggle('hidden', !canManage));
  els.markLink.classList.toggle('hidden', !canManage);
  if (isStudent) els.title.textContent = 'My Attendance';

  /* ---------- Helpers ---------- */
  const pad = (n) => String(n).padStart(2, '0');
  const todayStr = () => {
    const d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  };
  const fmtDate = (v) =>
    new Date(v).toLocaleDateString('en-GB', { timeZone: 'UTC', weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
  const pctText = (p) => Number(p).toFixed(1).replace(/\.0$/, '') + '%';
  const badge = (s) => '<span class="badge badge-' + esc(String(s).toLowerCase()) + '">' + esc(s) + '</span>';
  const hasFilters = () => Boolean(state.search || state.className || state.course || state.status || state.startDate || state.endDate);

  // Admins can edit any record; a teacher only the records they marked
  const canEdit = (r) =>
    isAdmin || (isTeacher && r.markedBy && String(r.markedBy._id) === String(user.id));

  const iconBtn = (action, icon, label, id, extra) =>
    '<button type="button" class="btn btn-icon' + (extra || '') + '" data-action="' + action + '" data-id="' + esc(id) +
    '" title="' + esc(label) + '" aria-label="' + esc(label) + '">' + window.icon(icon, 18) + '</button>';

  const stateBlock = (icon, title, text, actionHtml) =>
    '<div class="state"><div class="state-icon">' + window.icon(icon, 28) + '</div><h3>' + esc(title) + '</h3><p>' +
    esc(text) + '</p>' + (actionHtml || '') + '</div>';

  function restoreFocus() {
    if (!focusAfter) return;
    const el = document.querySelector(focusAfter);
    focusAfter = null;
    if (el && !el.disabled) el.focus();
  }

  function setRangeMsg(message) {
    els.rangeMsg.className = (message ? 'field-error' : 'field-hint') + ' toolbar-note';
    els.rangeMsg.textContent = message || RANGE_HINT;
    [els.from, els.to].forEach((input) => {
      input.classList.toggle('is-invalid', Boolean(message));
      input.setAttribute('aria-invalid', message ? 'true' : 'false');
    });
  }

  /* ---------- Table columns ---------- */
  const COLUMNS = [
    { label: 'Date', sort: 'date', cell: (r) => esc(fmtDate(r.date)) },
    { label: 'Student ID', sort: 'studentId', staff: true, cell: (r) => esc(r.studentId) },
    { label: 'Registration No.', staff: true, cell: (r) => esc(r.student ? r.student.registrationNumber : DASH) },
    { label: 'Student Name', staff: true, cell: (r) => '<strong>' + esc(r.student ? r.student.fullName : DASH) + '</strong>' },
    { label: 'Class', sort: 'className', cell: (r) => esc(r.className) + '<div class="cell-sub">' + esc(r.course) + '</div>' },
    { label: 'Session', cell: (r) => esc(r.session) },
    { label: 'Status', sort: 'status', cell: (r) => badge(r.status) },
    { label: 'Marked By', staff: true, cell: (r) => esc(r.markedBy ? r.markedBy.fullName : DASH) },
  ];
  const visibleColumns = () => COLUMNS.filter((c) => !c.staff || canManage);

  /* ---------- Loading and rendering ---------- */
  async function load(isFirst) {
    const id = ++requestId;
    if (isFirst) {
      els.tableArea.innerHTML = '<div class="loading" role="status"><span class="spinner"></span><span>Loading attendance records...</span></div>';
    } else {
      els.tableArea.classList.add('is-busy');
    }

    const qs = new URLSearchParams({ sortBy: state.sortBy, order: state.order, page: state.page, limit: state.limit });
    if (state.status) qs.set('status', state.status);
    if (state.startDate) qs.set('startDate', state.startDate);
    if (state.endDate) qs.set('endDate', state.endDate);
    if (canManage) {
      if (state.search) qs.set('search', state.search);
      if (state.className) qs.set('className', state.className);
      if (state.course) qs.set('course', state.course);
    }

    try {
      const data = await api('/api/attendance?' + qs.toString());
      if (id !== requestId) return;

      // The page no longer exists (for example after deleting its last row): go back one
      if (data.total > 0 && data.count === 0 && state.page > 1) {
        state.page = data.pages;
        return load(false);
      }
      render(data);
    } catch (err) {
      if (id !== requestId) return;
      renderError(err.message);
    } finally {
      if (id === requestId) els.tableArea.classList.remove('is-busy');
    }
  }

  function statCard(icon, value, label, tone, highlight) {
    return (
      '<div class="card stat-card' + (tone ? ' stat-' + tone : '') + (highlight ? ' is-highlight' : '') + '">' +
      '<div class="stat-icon">' + window.icon(icon, 24) + '</div>' +
      '<div><div class="stat-value">' + esc(value) + '</div><div class="stat-label">' + esc(label) + '</div></div></div>'
    );
  }

  function renderSummary(s) {
    els.summary.innerHTML =
      statCard('calendar-check', s.total, isStudent ? 'Days recorded' : 'Records') +
      statCard('check-circle', s.present, 'Present', 'success') +
      statCard('alert-circle', s.absent, 'Absent', 'danger') +
      statCard('file-text', s.leave, 'Leave', 'warning') +
      statCard('bar-chart', s.total ? pctText((s.present / s.total) * 100) : DASH, 'Attendance', null, true);
  }

  function render(data) {
    rows = new Map(data.records.map((r) => [r._id, r]));
    renderSummary(data.summary);
    els.subtitle.textContent =
      data.total + (data.total === 1 ? ' record' : ' records') + (hasFilters() ? ' match your filters' : ' in total') +
      (isTeacher ? '. You can edit only the attendance you marked.' : '');
    els.clear.classList.toggle('hidden', !hasFilters());

    if (data.total === 0) {
      els.pagination.classList.add('hidden');
      if (hasFilters()) {
        els.tableArea.innerHTML = stateBlock('clipboard-list', 'No attendance records found.', 'Try changing your search or filters.',
          '<button type="button" class="btn btn-secondary" data-action="clear">Clear Filters</button>');
      } else if (canManage) {
        els.tableArea.innerHTML = stateBlock('clipboard-list', 'No attendance records found.', 'Mark attendance to see records here.',
          '<a class="btn btn-primary" href="/attendance">Mark Attendance</a>');
      } else {
        els.tableArea.innerHTML = stateBlock('clipboard-list', 'No attendance records found.', 'Your attendance will appear here once your teacher marks it.');
      }
      return;
    }

    els.tableArea.innerHTML = tableHtml(data.records);
    renderPagination(data);
    restoreFocus();
  }

  function tableHtml(records) {
    const cols = visibleColumns();
    const heads = cols.map((c) => {
      if (!c.sort) return '<th scope="col">' + esc(c.label) + '</th>';
      const active = state.sortBy === c.sort;
      const aria = active ? ' aria-sort="' + (state.order === 'asc' ? 'ascending' : 'descending') + '"' : '';
      return '<th scope="col" class="sortable"' + aria + '><button type="button" class="sort-btn" data-sort="' + c.sort + '">' + esc(c.label) + '</button></th>';
    }).join('') + (canManage ? '<th scope="col">Actions</th>' : '');

    const body = records.map((r) => {
      const cells = cols.map((c) => '<td>' + c.cell(r) + '</td>').join('');
      return '<tr>' + cells + (canManage ? actionsCell(r) : '') + '</tr>';
    }).join('');

    return '<div class="table-wrap"><table class="table"><caption class="sr-only">Attendance records</caption><thead><tr>' + heads +
      '</tr></thead><tbody>' + body + '</tbody></table></div>';
  }

  function actionsCell(r) {
    const who = r.student ? r.student.fullName : r.studentId;
    let html = '';
    if (canEdit(r)) html += iconBtn('edit', 'edit', 'Edit attendance for ' + who, r._id);
    if (isAdmin) html += iconBtn('delete', 'trash', 'Delete attendance for ' + who, r._id, ' danger');
    if (!html) html = '<span class="text-muted" title="Only the teacher who marked this record can edit it.">' + DASH + '</span>';
    return '<td><div class="actions">' + html + '</div></td>';
  }

  function renderPagination(data) {
    const from = (data.page - 1) * state.limit + 1;
    const to = from + data.count - 1;
    const sizes = PAGE_SIZES.map((n) => '<option value="' + n + '"' + (n === state.limit ? ' selected' : '') + '>' + n + ' per page</option>').join('');

    els.pagination.classList.remove('hidden');
    els.pagination.innerHTML =
      '<div>Showing ' + from + '&ndash;' + to + ' of ' + data.total + ' records</div>' +
      '<div class="pagination-controls">' +
      '<label class="sr-only" for="page-size">Rows per page</label>' +
      '<select id="page-size" class="form-control page-size">' + sizes + '</select>' +
      '<div class="pager">' +
      '<button type="button" class="btn btn-secondary btn-sm" data-page="prev"' + (data.page <= 1 ? ' disabled' : '') + '>Previous</button>' +
      '<span class="page-indicator">Page ' + data.page + ' of ' + data.pages + '</span>' +
      '<button type="button" class="btn btn-secondary btn-sm" data-page="next"' + (data.page >= data.pages ? ' disabled' : '') + '>Next</button>' +
      '</div></div>';
  }

  function renderError(message) {
    els.pagination.classList.add('hidden');
    els.summary.innerHTML = '';
    els.subtitle.textContent = 'Attendance records could not be loaded.';
    els.tableArea.innerHTML =
      '<div class="card-body"><div class="alert alert-error" role="alert">' + window.icon('alert-circle', 18) + '<span>' + esc(message) +
      '</span></div><button type="button" class="btn btn-primary" data-action="retry">Try again</button></div>';
  }

  /* ---------- Filters ---------- */
  function setOptions(select, allLabel, values) {
    select.innerHTML = '<option value="">' + esc(allLabel) + '</option>' +
      values.map((v) => '<option value="' + esc(v) + '">' + esc(v) + '</option>').join('');
  }

  async function loadFilterOptions() {
    if (!canManage) return;
    try {
      const catalog = window.SAMS.lookups.buildCatalog(await window.SAMS.lookups.loadAllStudents());
      setOptions(els.fClass, 'All classes', catalog.classes);
      setOptions(els.fCourse, 'All courses', catalog.courses);
    } catch (e) { /* the dropdowns simply stay on "All" */ }
  }

  function clearFilters() {
    state.search = state.className = state.course = state.status = state.startDate = state.endDate = '';
    state.page = 1;
    els.search.value = '';
    els.fClass.value = '';
    els.fCourse.value = '';
    els.fStatus.value = '';
    els.from.value = '';
    els.to.value = '';
    setRangeMsg('');
    load(false);
  }

  let searchTimer;
  els.search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.search = els.search.value.trim();
      state.page = 1;
      load(false);
    }, 300);
  });

  [['fClass', 'className'], ['fCourse', 'course'], ['fStatus', 'status']].forEach(([el, key]) => {
    els[el].addEventListener('change', () => {
      state[key] = els[el].value;
      state.page = 1;
      load(false);
    });
  });

  function onDateChange() {
    const start = els.from.value;
    const end = els.to.value;
    if (start && end && start > end) {
      setRangeMsg('The start date cannot be after the end date.');
      return; // keep the table as it is until the range is valid
    }
    setRangeMsg('');
    state.startDate = start;
    state.endDate = end;
    state.page = 1;
    load(false);
  }
  els.from.addEventListener('change', onDateChange);
  els.to.addEventListener('change', onDateChange);
  els.clear.addEventListener('click', clearFilters);

  /* ---------- Table and pagination clicks ---------- */
  els.tableArea.addEventListener('click', (e) => {
    const sort = e.target.closest('[data-sort]');
    if (sort) {
      const key = sort.dataset.sort;
      if (state.sortBy === key) state.order = state.order === 'asc' ? 'desc' : 'asc';
      else { state.sortBy = key; state.order = key === 'date' ? 'desc' : 'asc'; }
      state.page = 1;
      focusAfter = '[data-sort="' + key + '"]';
      load(false);
      return;
    }

    const act = e.target.closest('[data-action]');
    if (!act) return;
    const action = act.dataset.action;
    if (action === 'clear') return clearFilters();
    if (action === 'retry') return load(true);

    const record = rows.get(act.dataset.id);
    if (!record) return;
    if (action === 'edit') openEdit(record);
    else if (action === 'delete') removeRecord(record);
  });

  els.pagination.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-page]');
    if (!btn || btn.disabled) return;
    state.page += btn.dataset.page === 'next' ? 1 : -1;
    focusAfter = '[data-page="' + btn.dataset.page + '"]';
    load(false);
  });

  els.pagination.addEventListener('change', (e) => {
    if (e.target.id !== 'page-size') return;
    state.limit = Number(e.target.value);
    state.page = 1;
    focusAfter = '#page-size';
    load(false);
  });

  /* ---------- Edit a record's status ---------- */
  function openEdit(rec) {
    const who = rec.student ? rec.student.fullName + ' (' + rec.studentId + ')' : rec.studentId;
    const item = (label, value) =>
      '<div><div class="info-label">' + esc(label) + '</div><div class="info-value">' + esc(value) + '</div></div>';
    const option = (value, cls) =>
      '<label class="status-option ' + cls + '"><input type="radio" name="edit-status" value="' + value + '"' +
      (rec.status === value ? ' checked' : '') + '><span>' + value + '</span></label>';

    const modal = window.SAMS.modal.open({
      title: 'Edit Attendance',
      body:
        '<form id="edit-form" novalidate>' +
        '<div id="edit-alert" class="alert hidden" role="alert"></div>' +
        '<div class="info-grid" style="margin-bottom:20px">' +
        item('Student', who) + item('Date', fmtDate(rec.date)) + item('Class', rec.className + ' \u00B7 ' + rec.course) + item('Session', rec.session) +
        '</div>' +
        '<div class="form-group"><span class="label" id="edit-status-label">Status</span>' +
        '<div class="status-group" role="radiogroup" aria-labelledby="edit-status-label">' +
        option('Present', 'opt-present') + option('Absent', 'opt-absent') + option('Leave', 'opt-leave') +
        '</div></div></form>',
      footer:
        '<button type="button" class="btn btn-secondary" data-modal-close>Cancel</button>' +
        '<button type="submit" form="edit-form" class="btn btn-primary" id="edit-save">Save Changes</button>',
    });

    const form = modal.root.querySelector('#edit-form');
    const alertBox = modal.root.querySelector('#edit-alert');
    const saveBtn = modal.root.querySelector('#edit-save');

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      hideAlert(alertBox);

      const checked = form.querySelector('input[name="edit-status"]:checked');
      const status = checked ? checked.value : '';
      if (STATUSES.indexOf(status) === -1) {
        showAlert(alertBox, 'error', 'Select an attendance status.');
        return;
      }
      if (status === rec.status) {
        modal.close();
        toast('No changes to save.', 'info');
        return;
      }

      setLoading(saveBtn, true, 'Saving changes...');
      modal.setLocked(true);
      try {
        await api('/api/attendance/' + rec._id, { method: 'PUT', body: { status } });
        modal.setLocked(false);
        modal.close();
        toast('Attendance updated successfully.', 'success');
        load(false);
      } catch (err) {
        modal.setLocked(false);
        if (err.status === 404) {
          modal.close();
          toast(err.message, 'error');
          load(false);
          return;
        }
        setLoading(saveBtn, false);
        showAlert(alertBox, 'error', err.message);
      }
    });
  }

  /* ---------- Delete a record (admin) ---------- */
  async function removeRecord(rec) {
    const who = rec.student ? rec.student.fullName + ' (' + rec.studentId + ')' : rec.studentId;
    const ok = await window.SAMS.confirm({
      title: 'Delete attendance record',
      message:
        'Are you sure you want to delete this attendance record? ' + who + ' on ' + fmtDate(rec.date) + ' (' +
        rec.status + ', ' + rec.session + ' session) will be removed.',
      confirmText: 'Delete',
      danger: true,
    });
    if (!ok) return;

    try {
      await api('/api/attendance/' + rec._id, { method: 'DELETE' });
      toast('Attendance record deleted successfully.', 'success');
      load(false);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  /* ---------- Start ---------- */
  const today = todayStr();
  els.from.max = today;
  els.to.max = today;
  setRangeMsg('');
  loadFilterOptions();
  load(true);
})();