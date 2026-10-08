(function () {
  'use strict';

  const { api, esc, toast, setLoading, showAlert, hideAlert } = window.SAMS;

  const user = window.SAMS.layout.init({ roles: ['admin'], title: 'Teachers & Accounts' });
  if (!user) return;

  const EMAIL_RE = /^\S+@\S+\.\S+$/;
  const PHONE_RE = /^[+()\d\s-]{7,20}$/;
  const PAGE_SIZES = [10, 25, 50, 100];
  const DASH = '\u2014';
  const MAX_PAGES = 30; // safety limit when reading every student account

  const RULES = [
    { ok: (p) => p.length >= 8, message: 'Password must contain at least 8 characters.' },
    { ok: (p) => /[A-Z]/.test(p), message: 'Password must contain an uppercase letter.' },
    { ok: (p) => /[a-z]/.test(p), message: 'Password must contain a lowercase letter.' },
    { ok: (p) => /\d/.test(p), message: 'Password must contain a number.' },
  ];

  const ROLES = {
    teacher: { singular: 'teacher', plural: 'teachers', add: 'Add Teacher' },
    student: { singular: 'student account', plural: 'student accounts', add: 'Add Student Account' },
    admin: { singular: 'administrator', plural: 'administrators', add: null }, // administrators are not created here
  };

  const els = {
    subtitle: document.getElementById('page-subtitle'),
    addBtn: document.getElementById('add-btn'),
    tabs: document.getElementById('tabs'),
    search: document.getElementById('search'),
    fStatus: document.getElementById('filter-status'),
    clear: document.getElementById('clear-filters'),
    tableArea: document.getElementById('table-area'),
    pagination: document.getElementById('pagination'),
  };

  const state = { role: 'teacher', search: '', status: '', page: 1, limit: 10 };

  let rows = new Map(); // _id -> account, for the rows on screen
  let requestId = 0;    // ignores out-of-date responses
  let focusAfter = null;

  /* ---------- Helpers ---------- */
  const fmtDateTime = (iso) =>
    new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const badge = (value) => '<span class="badge badge-' + esc(String(value).toLowerCase()) + '">' + esc(value) + '</span>';
  const isSelf = (u) => String(u._id) === String(user.id);
  const hasFilters = () => Boolean(state.search || state.status);
  const lastChange = (u) => (u.passwordChangedAt ? esc(fmtDateTime(u.passwordChangedAt)) : '<span class="text-muted">Not changed yet</span>');

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

  function renderAddButton() {
    const label = ROLES[state.role].add;
    els.addBtn.classList.toggle('hidden', !label);
    if (label) els.addBtn.innerHTML = window.icon('plus', 18) + '<span>' + esc(label) + '</span>';
  }

  /* ---------- Table ---------- */
  const COLUMN_DEFS = {
    name: {
      label: 'Name',
      cell: (u) =>
        '<strong>' + esc(u.fullName) + '</strong>' + (isSelf(u) ? ' <span class="badge badge-admin">You</span>' : '') +
        '<div class="cell-sub">' + esc(u.email) + '</div>',
    },
    phone: { label: 'Phone', cell: (u) => esc(u.phone || DASH) },
    student: {
      label: 'Student',
      cell: (u) => (u.student ? esc(u.student.studentId) + '<div class="cell-sub">' + esc(u.student.registrationNumber) + '</div>' : esc(DASH)),
    },
    status: { label: 'Status', cell: (u) => badge(u.status) },
    password: { label: 'Last password change', cell: lastChange },
    updated: { label: 'Last updated', cell: (u) => esc(fmtDateTime(u.updatedAt)) },
  };
  const COLUMNS = {
    teacher: ['name', 'phone', 'status', 'password', 'updated'],
    student: ['name', 'student', 'status', 'password', 'updated'],
    admin: ['name', 'phone', 'status', 'password', 'updated'],
  };

  function actionsHtml(u) {
    let html = iconBtn('view', 'eye', 'View ' + u.fullName, u._id);
    if (isSelf(u)) {
      // Your own account is edited on the Profile page, and cannot be deleted here
      html += '<a class="btn btn-icon" href="/profile" title="Edit your own details on the Profile page" aria-label="Edit your own details on the Profile page">' +
        window.icon('edit', 18) + '</a>';
    } else {
      html += iconBtn('edit', 'edit', 'Edit ' + u.fullName, u._id);
      html += iconBtn('delete', 'trash', 'Delete ' + u.fullName, u._id, ' danger');
    }
    return html;
  }

  function tableHtml(users) {
    const cols = COLUMNS[state.role].map((key) => COLUMN_DEFS[key]);
    const heads = cols.map((c) => '<th scope="col">' + esc(c.label) + '</th>').join('') + '<th scope="col">Actions</th>';
    const body = users.map((u) =>
      '<tr>' + cols.map((c) => '<td>' + c.cell(u) + '</td>').join('') + '<td><div class="actions">' + actionsHtml(u) + '</div></td></tr>'
    ).join('');

    return '<div class="table-wrap"><table class="table"><caption class="sr-only">' + esc(ROLES[state.role].plural) +
      '</caption><thead><tr>' + heads + '</tr></thead><tbody>' + body + '</tbody></table></div>';
  }

  function renderPagination(data) {
    const from = (data.page - 1) * state.limit + 1;
    const to = from + data.count - 1;
    const sizes = PAGE_SIZES.map((n) => '<option value="' + n + '"' + (n === state.limit ? ' selected' : '') + '>' + n + ' per page</option>').join('');

    els.pagination.classList.remove('hidden');
    els.pagination.innerHTML =
      '<div>Showing ' + from + '&ndash;' + to + ' of ' + data.total + ' ' + esc(ROLES[state.role].plural) + '</div>' +
      '<div class="pagination-controls">' +
      '<label class="sr-only" for="page-size">Rows per page</label>' +
      '<select id="page-size" class="form-control page-size">' + sizes + '</select>' +
      '<div class="pager">' +
      '<button type="button" class="btn btn-secondary btn-sm" data-page="prev"' + (data.page <= 1 ? ' disabled' : '') + '>Previous</button>' +
      '<span class="page-indicator">Page ' + data.page + ' of ' + data.pages + '</span>' +
      '<button type="button" class="btn btn-secondary btn-sm" data-page="next"' + (data.page >= data.pages ? ' disabled' : '') + '>Next</button>' +
      '</div></div>';
  }

  function render(data) {
    const info = ROLES[state.role];
    rows = new Map(data.users.map((u) => [u._id, u]));
    els.subtitle.textContent =
      data.total + ' ' + (data.total === 1 ? info.singular : info.plural) + (hasFilters() ? ' match your filters' : ' on record') +
      '. Passwords are never displayed.';
    els.clear.classList.toggle('hidden', !hasFilters());

    if (data.total === 0) {
      els.pagination.classList.add('hidden');
      if (hasFilters()) {
        els.tableArea.innerHTML = stateBlock('users', 'No ' + info.plural + ' found.', 'Try changing your search or filters.',
          '<button type="button" class="btn btn-secondary" data-action="clear">Clear Filters</button>');
      } else if (info.add) {
        els.tableArea.innerHTML = stateBlock('users', 'No ' + info.plural + ' found.', 'Add the first one to get started.',
          '<button type="button" class="btn btn-primary" data-action="add">' + esc(info.add) + '</button>');
      } else {
        els.tableArea.innerHTML = stateBlock('users', 'No ' + info.plural + ' found.', '');
      }
      return;
    }

    els.tableArea.innerHTML = tableHtml(data.users);
    renderPagination(data);
    restoreFocus();
  }

  function renderError(message) {
    els.pagination.classList.add('hidden');
    els.subtitle.textContent = 'Accounts could not be loaded.';
    els.tableArea.innerHTML =
      '<div class="card-body"><div class="alert alert-error" role="alert">' + window.icon('alert-circle', 18) + '<span>' + esc(message) +
      '</span></div><button type="button" class="btn btn-primary" data-action="retry">Try again</button></div>';
  }

  async function load(isFirst) {
    const id = ++requestId;
    if (isFirst) {
      els.tableArea.innerHTML = '<div class="loading" role="status"><span class="spinner"></span><span>Loading accounts...</span></div>';
    } else {
      els.tableArea.classList.add('is-busy');
    }

    const qs = new URLSearchParams({ role: state.role, page: state.page, limit: state.limit });
    if (state.search) qs.set('search', state.search);
    if (state.status) qs.set('status', state.status);

    try {
      const data = await api('/api/users?' + qs.toString());
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

  /* ---------- Tabs, search and filters ---------- */
  function setRole(role) {
    state.role = role;
    state.page = 1;
    state.search = '';
    state.status = '';
    els.search.value = '';
    els.fStatus.value = '';
    els.tabs.querySelectorAll('[data-role]').forEach((btn) => {
      btn.setAttribute('aria-pressed', btn.dataset.role === role ? 'true' : 'false');
    });
    renderAddButton();
    load(true);
  }

  els.tabs.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-role]');
    if (btn && btn.dataset.role !== state.role) setRole(btn.dataset.role);
  });

  let searchTimer;
  els.search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.search = els.search.value.trim();
      state.page = 1;
      load(false);
    }, 300);
  });

  els.fStatus.addEventListener('change', () => {
    state.status = els.fStatus.value;
    state.page = 1;
    load(false);
  });

  function clearFilters() {
    state.search = state.status = '';
    state.page = 1;
    els.search.value = '';
    els.fStatus.value = '';
    load(false);
  }
  els.clear.addEventListener('click', clearFilters);

  els.tableArea.addEventListener('click', (e) => {
    const act = e.target.closest('[data-action]');
    if (!act) return;
    const action = act.dataset.action;

    if (action === 'add') return startAdd();
    if (action === 'clear') return clearFilters();
    if (action === 'retry') return load(true);

    const account = rows.get(act.dataset.id);
    if (!account) return;
    if (action === 'view') openView(account);
    else if (action === 'edit') openEdit(account);
    else if (action === 'delete') removeAccount(account);
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

  /* ---------- Form helpers ---------- */
  const field = (name, label, control, opts) => {
    const o = opts || {};
    return (
      '<div class="form-group"><label for="f-' + name + '">' + esc(label) +
      (o.required ? ' <span class="required" aria-hidden="true">*</span>' : '') + '</label>' + control +
      (o.hint ? '<p class="field-hint">' + esc(o.hint) + '</p>' : '') +
      '<p class="field-error" id="e-' + name + '" role="alert"></p></div>'
    );
  };

  const inputHtml = (name, type, value, attrs) =>
    '<input id="f-' + name + '" name="' + name + '" type="' + type + '" class="form-control" value="' + esc(value) + '" ' + (attrs || '') + '>';

  const selectHtml = (name, pairs, value) =>
    '<select id="f-' + name + '" name="' + name + '" class="form-control">' +
    pairs.map(([v, label]) => '<option value="' + esc(v) + '"' + (v === value ? ' selected' : '') + '>' + esc(label) + '</option>').join('') +
    '</select>';

  function setFieldError(form, name, message) {
    const input = form.elements[name];
    const holder = form.querySelector('#e-' + name);
    if (holder) holder.textContent = message || '';
    if (input) {
      input.classList.toggle('is-invalid', Boolean(message));
      input.setAttribute('aria-invalid', message ? 'true' : 'false');
    }
  }

  function randomInt(max) {
    const buffer = new Uint32Array(1);
    window.crypto.getRandomValues(buffer);
    return buffer[0] % max;
  }

  // 12 characters with an uppercase letter, a lowercase letter and a number (no look-alike characters)
  function generatePassword() {
    const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const lower = 'abcdefghijkmnopqrstuvwxyz';
    const digits = '23456789';
    const pick = (set) => set.charAt(randomInt(set.length));
    const chars = [pick(upper), pick(lower), pick(digits)];
    while (chars.length < 12) chars.push(pick(upper + lower + digits));
    for (let i = chars.length - 1; i > 0; i -= 1) {
      const j = randomInt(i + 1);
      const swap = chars[i];
      chars[i] = chars[j];
      chars[j] = swap;
    }
    return chars.join('');
  }

  /* ---------- Add a teacher or a student account ---------- */
  async function loadLinkedStudentIds() {
    const linked = new Set();
    let page = 1;
    let pages = 1;
    do {
      const data = await api('/api/users?' + new URLSearchParams({ role: 'student', limit: 100, page: page }).toString());
      data.users.forEach((u) => {
        if (u.student && u.student.studentId) linked.add(u.student.studentId);
      });
      pages = data.pages;
      page += 1;
    } while (page <= pages && page <= MAX_PAGES);
    return linked;
  }

  // Active students who do not have a login account yet
  async function loadAvailableStudents() {
    const [all, linked] = await Promise.all([
      window.SAMS.lookups.loadAllStudents({ status: 'Active' }),
      loadLinkedStudentIds(),
    ]);
    return all.filter((s) => !linked.has(s.studentId));
  }

  function startAdd() {
    if (state.role === 'student') openStudentAdd();
    else if (state.role === 'teacher') openAccountForm('teacher', null);
  }

  async function openStudentAdd() {
    setLoading(els.addBtn, true, 'Loading students...');
    let available;
    try {
      available = await loadAvailableStudents();
    } catch (err) {
      toast(err.message, 'error');
      return;
    } finally {
      setLoading(els.addBtn, false);
      renderAddButton();
    }

    if (available.length === 0) {
      window.SAMS.modal.open({
        title: 'No students available',
        body: '<p style="margin:0">Every active student already has a login account. Add a new student first, then come back to create their account.</p>',
        footer:
          '<button type="button" class="btn btn-secondary" data-modal-close>Close</button>' +
          '<a class="btn btn-primary" href="/students?action=add">Add Student</a>',
      });
      return;
    }
    openAccountForm('student', available);
  }

  function openAccountForm(role, available) {
    const byId = new Map((available || []).map((s) => [s.studentId, s]));

    const studentField = role === 'student'
      ? field(
          'student', 'Student',
          '<select id="f-student" name="student" class="form-control"><option value="">Select student</option>' +
          available.map((s) =>
            '<option value="' + esc(s.studentId) + '">' + esc(s.studentId + ' - ' + s.fullName + ' (' + s.className + ')') + '</option>'
          ).join('') + '</select>',
          { required: true, hint: 'Only active students without a login account are listed.' }
        )
      : '';

    const passwordField = field(
      'password', 'Temporary Password',
      '<div class="input-icon"><span data-icon="lock"></span>' +
      '<input id="f-password" name="password" type="password" class="form-control has-toggle" autocomplete="new-password" placeholder="Enter a temporary password">' +
      '<button type="button" class="input-toggle" id="pw-toggle"></button></div>' +
      '<div class="field-actions"><button type="button" class="btn btn-secondary btn-sm" id="pw-generate">Generate password</button></div>',
      {
        required: true,
        hint: 'At least 8 characters with an uppercase letter, a lowercase letter and a number. Note it down: it cannot be shown again. The user can change it on their Profile page.',
      }
    );

    const modal = window.SAMS.modal.open({
      title: ROLES[role].add,
      size: 'lg',
      closeOnBackdrop: false, // so typed data is not lost by a stray click
      body:
        '<form id="account-form" novalidate>' +
        '<div id="form-alert" class="alert hidden" role="alert"></div>' +
        '<div class="form-block"><h3 class="form-section">Account details</h3>' + studentField +
        '<div class="form-row">' +
        field('fullName', 'Full Name', inputHtml('fullName', 'text', '', 'placeholder="e.g. Mary Wanjiru" autocomplete="off"'), { required: true }) +
        field('email', 'Email', inputHtml('email', 'email', '', 'placeholder="name@school.com" autocomplete="off"'), { required: true }) +
        field('phone', 'Phone Number', inputHtml('phone', 'tel', '', 'placeholder="e.g. 0712345678" autocomplete="off"')) +
        '</div></div>' +
        '<div class="form-block"><h3 class="form-section">Login</h3>' + passwordField + '</div>' +
        '</form>',
      footer:
        '<button type="button" class="btn btn-secondary" data-modal-close>Cancel</button>' +
        '<button type="submit" form="account-form" class="btn btn-primary" id="save-btn">Create Account</button>',
    });
    window.SAMS.hydrateIcons(modal.root);

    const form = modal.root.querySelector('#account-form');
    const alertBox = modal.root.querySelector('#form-alert');
    const saveBtn = modal.root.querySelector('#save-btn');
    const pwInput = form.elements.password;
    const toggle = modal.root.querySelector('#pw-toggle');
    const touched = new Set();

    // Show / hide the password
    const setVisible = (show) => {
      pwInput.type = show ? 'text' : 'password';
      toggle.innerHTML = window.icon(show ? 'eye-off' : 'eye', 20);
      toggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      toggle.setAttribute('aria-pressed', show ? 'true' : 'false');
    };
    setVisible(false);
    toggle.addEventListener('click', () => {
      setVisible(pwInput.type === 'password');
      pwInput.focus();
    });
    modal.root.querySelector('#pw-generate').addEventListener('click', () => {
      pwInput.value = generatePassword();
      setFieldError(form, 'password', '');
      setVisible(true);
      toast('Password generated. Note it down before saving.', 'info');
    });

    // Typing clears that field's error; typed fields are not overwritten by the student prefill
    form.addEventListener('input', (e) => {
      if (!e.target.name) return;
      setFieldError(form, e.target.name, '');
      if (e.target.name !== 'student') touched.add(e.target.name);
    });

    if (role === 'student') {
      form.elements.student.addEventListener('change', () => {
        const s = byId.get(form.elements.student.value);
        if (!s) return;
        [['fullName', s.fullName], ['email', s.email], ['phone', s.phone || '']].forEach(([name, value]) => {
          if (!touched.has(name)) form.elements[name].value = value;
        });
      });
    }

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      hideAlert(alertBox);

      const v = {
        student: form.elements.student ? form.elements.student.value : '',
        fullName: form.elements.fullName.value.trim(),
        email: form.elements.email.value.trim(),
        phone: form.elements.phone.value.trim(),
        password: form.elements.password.value,
      };

      const errors = {};
      if (role === 'student' && !v.student) errors.student = 'Select a student.';
      if (!v.fullName) errors.fullName = 'Full name is required.';
      if (!v.email) errors.email = 'Email is required.';
      else if (!EMAIL_RE.test(v.email)) errors.email = 'Enter a valid email address.';
      if (v.phone && !PHONE_RE.test(v.phone)) errors.phone = 'Enter a valid phone number.';
      if (!v.password) errors.password = 'Password is required.';
      else {
        const failed = RULES.find((rule) => !rule.ok(v.password));
        if (failed) errors.password = failed.message;
      }

      const order = ['student', 'fullName', 'email', 'phone', 'password'];
      order.forEach((name) => setFieldError(form, name, errors[name]));
      const firstBad = order.find((name) => errors[name]);
      if (firstBad) {
        form.elements[firstBad].focus();
        return;
      }

      const body = { fullName: v.fullName, email: v.email, password: v.password, role: role };
      if (v.phone) body.phone = v.phone;
      if (role === 'student') body.studentId = v.student;

      setLoading(saveBtn, true, 'Creating account...');
      modal.setLocked(true);
      try {
        await api('/api/auth/register', { method: 'POST', body });
        modal.setLocked(false);
        modal.close();
        toast((role === 'student' ? 'Student' : 'Teacher') + ' account created successfully.', 'success');
        load(false);
      } catch (err) {
        modal.setLocked(false);
        setLoading(saveBtn, false);

        if (err.status === 409 && /email/i.test(err.message)) {
          setFieldError(form, 'email', err.message);
          form.elements.email.focus();
        } else if (err.status === 422 && /password/i.test(err.message)) {
          setFieldError(form, 'password', err.message);
          form.elements.password.focus();
        } else {
          showAlert(alertBox, 'error', err.message);
          alertBox.scrollIntoView({ block: 'nearest' });
        }
      }
    });
  }

  /* ---------- View ---------- */
  function openView(u) {
    const item = (label, valueHtml) =>
      '<div><div class="info-label">' + esc(label) + '</div><div class="info-value">' + valueHtml + '</div></div>';

    const student = u.student
      ? item('Student', esc(u.student.studentId + ' - ' + u.student.fullName) + '<div class="cell-sub">' + esc(u.student.registrationNumber) + '</div>')
      : '';

    window.SAMS.modal.open({
      title: u.fullName,
      size: 'lg',
      body:
        '<div class="info-grid">' +
        item('Full Name', esc(u.fullName)) + item('Email', esc(u.email)) +
        item('Role', badge(u.role)) + item('Account Status', badge(u.status)) +
        item('Phone', esc(u.phone || DASH)) + student +
        item('Account Created', esc(fmtDateTime(u.createdAt))) +
        item('Last Updated', esc(fmtDateTime(u.updatedAt))) +
        item('Last Password Change', lastChange(u)) +
        '</div>' +
        '<p class="field-hint" style="margin-top:20px">Passwords are never displayed. Users change their own password from their Profile page.</p>',
      footer: '<button type="button" class="btn btn-primary" data-modal-close>Close</button>',
    });
  }

  /* ---------- Edit ---------- */
  function openEdit(u) {
    const roleInfo =
      '<div class="info-grid" style="margin-bottom:8px"><div><div class="info-label">Role</div><div class="info-value">' + badge(u.role) + '</div></div>' +
      (u.student
        ? '<div><div class="info-label">Student</div><div class="info-value">' + esc(u.student.studentId + ' - ' + u.student.fullName) + '</div></div>'
        : '') +
      '</div>';

    const modal = window.SAMS.modal.open({
      title: 'Edit Account',
      size: 'lg',
      closeOnBackdrop: false,
      body:
        '<form id="edit-form" novalidate>' +
        '<div id="edit-alert" class="alert hidden" role="alert"></div>' + roleInfo +
        '<div class="form-row">' +
        field('fullName', 'Full Name', inputHtml('fullName', 'text', u.fullName, 'autocomplete="off"'), { required: true }) +
        field('email', 'Email', inputHtml('email', 'email', u.email, 'autocomplete="off"'), { required: true }) +
        field('phone', 'Phone Number', inputHtml('phone', 'tel', u.phone || '', 'autocomplete="off"')) +
        field('status', 'Account Status', selectHtml('status', [['active', 'Active'], ['inactive', 'Inactive']], u.status),
          { required: true, hint: 'Inactive accounts cannot log in.' }) +
        '</div>' +
        '<p class="field-hint">Passwords cannot be changed here. Users change their own password from their Profile page.</p>' +
        '</form>',
      footer:
        '<button type="button" class="btn btn-secondary" data-modal-close>Cancel</button>' +
        '<button type="submit" form="edit-form" class="btn btn-primary" id="edit-save">Save Changes</button>',
    });

    const form = modal.root.querySelector('#edit-form');
    const alertBox = modal.root.querySelector('#edit-alert');
    const saveBtn = modal.root.querySelector('#edit-save');

    form.addEventListener('input', (e) => {
      if (e.target.name) setFieldError(form, e.target.name, '');
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      hideAlert(alertBox);

      const v = {
        fullName: form.elements.fullName.value.trim(),
        email: form.elements.email.value.trim(),
        phone: form.elements.phone.value.trim(),
        status: form.elements.status.value,
      };

      const errors = {};
      if (!v.fullName) errors.fullName = 'Full name is required.';
      if (!v.email) errors.email = 'Email is required.';
      else if (!EMAIL_RE.test(v.email)) errors.email = 'Enter a valid email address.';
      if (v.phone && !PHONE_RE.test(v.phone)) errors.phone = 'Enter a valid phone number.';

      const order = ['fullName', 'email', 'phone'];
      order.forEach((name) => setFieldError(form, name, errors[name]));
      const firstBad = order.find((name) => errors[name]);
      if (firstBad) {
        form.elements[firstBad].focus();
        return;
      }

      // Send only what changed
      const body = {};
      if (v.fullName !== u.fullName) body.fullName = v.fullName;
      if (v.email.toLowerCase() !== u.email) body.email = v.email;
      if (v.phone !== (u.phone || '')) body.phone = v.phone;
      if (v.status !== u.status) body.status = v.status;

      if (Object.keys(body).length === 0) {
        modal.close();
        toast('No changes to save.', 'info');
        return;
      }

      setLoading(saveBtn, true, 'Saving changes...');
      modal.setLocked(true);
      try {
        await api('/api/users/' + u._id, { method: 'PUT', body });
        modal.setLocked(false);
        modal.close();
        toast('Account updated successfully.', 'success');
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
        if (err.status === 409 && /email/i.test(err.message)) {
          setFieldError(form, 'email', err.message);
          form.elements.email.focus();
        } else {
          showAlert(alertBox, 'error', err.message);
        }
      }
    });
  }

  /* ---------- Delete ---------- */
  async function removeAccount(u) {
    const kept = u.role === 'student'
      ? ' Their student record and attendance are kept.'
      : u.role === 'teacher' ? ' Attendance they marked is kept.' : '';

    const ok = await window.SAMS.confirm({
      title: 'Delete user',
      message: 'Are you sure you want to delete this user? ' + u.fullName + ' (' + u.email + ') will no longer be able to log in.' + kept,
      confirmText: 'Delete',
      danger: true,
    });
    if (!ok) return;

    try {
      await api('/api/users/' + u._id, { method: 'DELETE' });
      toast('User deleted successfully.', 'success');
      load(false);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  /* ---------- Start ---------- */
  els.addBtn.addEventListener('click', startAdd);
  renderAddButton();
  load(true);
})();