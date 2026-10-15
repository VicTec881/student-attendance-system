(function () {
  'use strict';

  const { api, esc, toast, setLoading, showAlert, hideAlert } = window.SAMS;

  const user = window.SAMS.layout.init({ roles: ['admin', 'teacher'], title: 'Students' });
  if (!user) return;

  const isAdmin = user.role === 'admin'; // only admins can edit, delete or create logins
  const EMAIL_RE = /^\S+@\S+\.\S+$/;
  const PAGE_SIZES = [10, 25, 50, 100];
  const DASH = '—';

  const PW_RULES = [
    { ok: (p) => p.length >= 8, message: 'Password must contain at least 8 characters.' },
    { ok: (p) => /[A-Z]/.test(p), message: 'Password must contain an uppercase letter.' },
    { ok: (p) => /[a-z]/.test(p), message: 'Password must contain a lowercase letter.' },
    { ok: (p) => /\d/.test(p), message: 'Password must contain a number.' },
  ];

  const COLUMNS = [
    { key: 'studentId', label: 'Student ID' },
    { key: 'registrationNumber', label: 'Registration No.' },
    { key: 'fullName', label: 'Student Name' },
    { key: 'className', label: 'Class' },
    { key: 'course', label: 'Course/Program' },
    { key: 'yearOfStudy', label: 'Year', num: true },
  ];

  const ALL_FIELDS = [
    'studentId', 'registrationNumber', 'fullName', 'gender', 'dateOfBirth', 'email',
    'phone', 'className', 'course', 'yearOfStudy', 'admissionDate', 'status',
  ];

  const els = {
    subtitle: document.getElementById('page-subtitle'),
    addBtn: document.getElementById('add-btn'),
    search: document.getElementById('search'),
    fClass: document.getElementById('filter-class'),
    fCourse: document.getElementById('filter-course'),
    fYear: document.getElementById('filter-year'),
    fStatus: document.getElementById('filter-status'),
    clear: document.getElementById('clear-filters'),
    tableArea: document.getElementById('table-area'),
    pagination: document.getElementById('pagination'),
  };

  const state = {
    search: '', className: '', course: '', yearOfStudy: '', status: '',
    sortBy: 'studentId', order: 'asc', page: 1, limit: 10,
  };

  let rows = new Map(); // _id -> student, for the rows on screen
  let catalog = null;   // class, course and year lists
  let requestId = 0;    // ignores out-of-date responses
  let focusAfter = null;

  /* ---------- Helpers ---------- */
  const pad = (n) => String(n).padStart(2, '0');
  const todayStr = () => {
    const d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  };
  const isoDay = (v) => (v ? String(v).slice(0, 10) : '');
  const fmtDate = (v) =>
    v ? new Date(v).toLocaleDateString('en-GB', { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric' }) : DASH;
  const statusBadge = (s) => '<span class="badge badge-' + esc(String(s).toLowerCase()) + '">' + esc(s) + '</span>';
  const hasFilters = () => Boolean(state.search || state.className || state.course || state.yearOfStudy || state.status);

  const iconBtn = (action, icon, label, id, extraClass) =>
    '<button type="button" class="btn btn-icon' + (extraClass || '') + '" data-action="' + action + '" data-id="' + esc(id) +
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

  /* ---------- Temporary password helpers ---------- */
  function randomInt(max) {
    const buffer = new Uint32Array(1);
    window.crypto.getRandomValues(buffer);
    return buffer[0] % max;
  }

  // 12 characters with an uppercase letter, a lowercase letter and a number
  function generatePassword() {
    const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const lower = 'abcdefghijkmnopqrstuvwxyz';
    const digits = '23456789';
    const pick = (set) => set.charAt(randomInt(set.length));
    const chars = [pick(upper), pick(lower), pick(digits)];
    while (chars.length < 12) chars.push(pick(upper + lower + digits));
    for (let i = chars.length - 1; i > 0; i -= 1) {
      const j = randomInt(i + 1);
      const swap = chars[i]; chars[i] = chars[j]; chars[j] = swap;
    }
    return chars.join('');
  }

  function accountBlock() {
    return (
      '<div class="form-block"><h3 class="form-section">Login account</h3>' +
      '<label class="check-field"><input type="checkbox" id="f-createLogin" checked> Create a login account for this student</label>' +
      '<div id="login-fields" style="margin-top:12px">' +
      '<p class="field-hint" style="margin:0 0 12px">The student logs in with the email above and this temporary password.</p>' +
      '<div class="form-group"><label for="f-password">Temporary Password <span class="required" aria-hidden="true">*</span></label>' +
      '<div class="input-icon"><span data-icon="lock"></span>' +
      '<input id="f-password" name="password" type="password" class="form-control has-toggle" autocomplete="new-password" placeholder="Enter a temporary password">' +
      '<button type="button" class="input-toggle" id="pw-toggle"></button></div>' +
      '<div class="field-actions"><button type="button" class="btn btn-secondary btn-sm" id="pw-generate">Generate password</button></div>' +
      '<p class="field-hint">At least 8 characters with an uppercase letter, a lowercase letter and a number. Note it down: it cannot be shown again. The student can change it on their Profile page.</p>' +
      '<p class="field-error" id="e-password" role="alert"></p></div>' +
      '</div></div>'
    );
  }

  /* ---------- Loading and rendering the table ---------- */
  async function load(isFirst) {
    const id = ++requestId;
    if (isFirst) {
      els.tableArea.innerHTML = '<div class="loading" role="status"><span class="spinner"></span><span>Loading students...</span></div>';
    } else {
      els.tableArea.classList.add('is-busy');
    }

    const qs = new URLSearchParams({
      sortBy: state.sortBy, order: state.order, page: state.page, limit: state.limit,
    });
    if (state.search) qs.set('search', state.search);
    if (state.className) qs.set('className', state.className);
    if (state.course) qs.set('course', state.course);
    if (state.yearOfStudy) qs.set('yearOfStudy', state.yearOfStudy);
    if (state.status) qs.set('status', state.status);

    try {
      const data = await api('/api/students?' + qs.toString());
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

  function render(data) {
    rows = new Map(data.students.map((s) => [s._id, s]));
    els.subtitle.textContent =
      data.total + (data.total === 1 ? ' student' : ' students') + (hasFilters() ? ' match your filters' : ' on record');
    els.clear.classList.toggle('hidden', !hasFilters());

    if (data.total === 0) {
      els.pagination.classList.add('hidden');
      els.tableArea.innerHTML = hasFilters()
        ? stateBlock('users', 'No students found.', 'Try changing your search or filters.',
            '<button type="button" class="btn btn-secondary" data-action="clear">Clear Filters</button>')
        : stateBlock('users', 'No students found.', 'Add your first student to get started.',
            '<button type="button" class="btn btn-primary" data-action="add">Add Student</button>');
      return;
    }

    els.tableArea.innerHTML = tableHtml(data.students);
    renderPagination(data);
    restoreFocus();
  }

  function tableHtml(students) {
    const heads = COLUMNS.map((c) => {
      const active = state.sortBy === c.key;
      const aria = active ? ' aria-sort="' + (state.order === 'asc' ? 'ascending' : 'descending') + '"' : '';
      return '<th scope="col" class="sortable' + (c.num ? ' num' : '') + '"' + aria + '><button type="button" class="sort-btn" data-sort="' +
        c.key + '">' + esc(c.label) + '</button></th>';
    }).join('') + '<th scope="col">Status</th><th scope="col">Actions</th>';

    const body = students.map((s) => {
      let actions = iconBtn('view', 'eye', 'View ' + s.fullName, s._id);
      if (isAdmin) {
        actions += iconBtn('edit', 'edit', 'Edit ' + s.fullName, s._id);
        actions += iconBtn('delete', 'trash', 'Delete ' + s.fullName, s._id, ' danger');
      }
      return (
        '<tr><td>' + esc(s.studentId) + '</td><td>' + esc(s.registrationNumber) + '</td><td><strong>' + esc(s.fullName) +
        '</strong></td><td>' + esc(s.className) + '</td><td>' + esc(s.course) + '</td><td class="num">' + esc(s.yearOfStudy) +
        '</td><td>' + statusBadge(s.status) + '</td><td><div class="actions">' + actions + '</div></td></tr>'
      );
    }).join('');

    return '<div class="table-wrap"><table class="table"><caption class="sr-only">Students</caption><thead><tr>' + heads +
      '</tr></thead><tbody>' + body + '</tbody></table></div>';
  }

  function renderPagination(data) {
    const from = (data.page - 1) * state.limit + 1;
    const to = from + data.count - 1;
    const sizes = PAGE_SIZES.map((n) =>
      '<option value="' + n + '"' + (n === state.limit ? ' selected' : '') + '>' + n + ' per page</option>'
    ).join('');

    els.pagination.classList.remove('hidden');
    els.pagination.innerHTML =
      '<div>Showing ' + from + '&ndash;' + to + ' of ' + data.total + ' students</div>' +
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
    els.subtitle.textContent = 'Students could not be loaded.';
    els.tableArea.innerHTML =
      '<div class="card-body"><div class="alert alert-error" role="alert">' + window.icon('alert-circle', 18) + '<span>' + esc(message) +
      '</span></div><button type="button" class="btn btn-primary" data-action="retry">Try again</button></div>';
  }

  /* ---------- Filters ---------- */
  function setOptions(select, allLabel, pairs, selected) {
    select.innerHTML = '<option value="">' + esc(allLabel) + '</option>' +
      pairs.map(([value, label]) =>
        '<option value="' + esc(value) + '"' + (value === selected ? ' selected' : '') + '>' + esc(label) + '</option>'
      ).join('');
    return select.value; // '' when the old selection no longer exists
  }

  // Returns true when a selected filter disappeared (for example its last student was deleted)
  function fillFilters() {
    if (!catalog) return false;
    const before = [state.className, state.course, state.yearOfStudy].join('|');
    state.className = setOptions(els.fClass, 'All classes', catalog.classes.map((c) => [c, c]), state.className);
    state.course = setOptions(els.fCourse, 'All courses', catalog.courses.map((c) => [c, c]), state.course);
    state.yearOfStudy = setOptions(els.fYear, 'All years', catalog.years.map((y) => [String(y), 'Year ' + y]), state.yearOfStudy);
    return before !== [state.className, state.course, state.yearOfStudy].join('|');
  }

  async function refreshOptions() {
    try {
      catalog = window.SAMS.lookups.buildCatalog(await window.SAMS.lookups.loadAllStudents());
    } catch (e) {
      return; // the dropdowns simply keep their current options
    }
    if (fillFilters()) {
      state.page = 1;
      load(false);
    }
  }

  function clearFilters() {
    state.search = state.className = state.course = state.yearOfStudy = state.status = '';
    state.page = 1;
    els.search.value = '';
    els.fClass.value = '';
    els.fCourse.value = '';
    els.fYear.value = '';
    els.fStatus.value = '';
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

  [['fClass', 'className'], ['fCourse', 'course'], ['fYear', 'yearOfStudy'], ['fStatus', 'status']].forEach(([el, key]) => {
    els[el].addEventListener('change', () => {
      state[key] = els[el].value;
      state.page = 1;
      load(false);
    });
  });
  els.clear.addEventListener('click', clearFilters);

  /* ---------- Table and pagination clicks ---------- */
  els.tableArea.addEventListener('click', (e) => {
    const sort = e.target.closest('[data-sort]');
    if (sort) {
      const key = sort.dataset.sort;
      if (state.sortBy === key) state.order = state.order === 'asc' ? 'desc' : 'asc';
      else { state.sortBy = key; state.order = 'asc'; }
      state.page = 1;
      focusAfter = '[data-sort="' + key + '"]';
      load(false);
      return;
    }

    const act = e.target.closest('[data-action]');
    if (!act) return;
    const action = act.dataset.action;

    if (action === 'add') return openForm(null);
    if (action === 'clear') return clearFilters();
    if (action === 'retry') return load(true);

    const student = rows.get(act.dataset.id);
    if (!student) return;
    if (action === 'view') openView(student);
    else if (action === 'edit') openForm(student);
    else if (action === 'delete') removeStudent(student);
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

  /* ---------- Add and edit dialog ---------- */
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

  const selectHtml = (name, options, value, placeholder) =>
    '<select id="f-' + name + '" name="' + name + '" class="form-control">' +
    (placeholder ? '<option value="">' + esc(placeholder) + '</option>' : '') +
    options.map((o) => '<option value="' + esc(o) + '"' + (o === value ? ' selected' : '') + '>' + esc(o) + '</option>').join('') +
    '</select>';

  const datalist = (id, values) =>
    '<datalist id="' + id + '">' + values.map((v) => '<option value="' + esc(v) + '"></option>').join('') + '</datalist>';

  function formBody(student) {
    const edit = Boolean(student);
    const v = student || {};
    const classes = catalog ? catalog.classes : [];
    const courses = catalog ? catalog.courses : [];

    return (
      '<form id="student-form" novalidate>' +
      '<div id="form-alert" class="alert hidden" role="alert"></div>' +

      '<div class="form-block"><h3 class="form-section">Student details</h3><div class="form-row">' +
      field('studentId', 'Student ID', inputHtml('studentId', 'text', v.studentId, 'placeholder="e.g. S001" autocomplete="off"' + (edit ? ' disabled' : '')),
        { required: !edit, hint: edit ? 'The Student ID cannot be changed.' : '' }) +
      field('registrationNumber', 'Registration Number', inputHtml('registrationNumber', 'text', v.registrationNumber, 'placeholder="e.g. ACS/001/2025" autocomplete="off"'), { required: true }) +
      field('fullName', 'Full Name', inputHtml('fullName', 'text', v.fullName, 'placeholder="e.g. John Mwangi" autocomplete="off"'), { required: true }) +
      field('gender', 'Gender', selectHtml('gender', ['Male', 'Female', 'Other'], v.gender, 'Select gender'), { required: true }) +
      field('dateOfBirth', 'Date of Birth', inputHtml('dateOfBirth', 'date', isoDay(v.dateOfBirth), 'max="' + todayStr() + '"'), { required: true }) +
      '</div></div>' +

      '<div class="form-block"><h3 class="form-section">Contact</h3><div class="form-row">' +
      field('email', 'Email', inputHtml('email', 'email', v.email, 'placeholder="student@school.com" autocomplete="off"'), { required: true }) +
      field('phone', 'Phone Number', inputHtml('phone', 'tel', v.phone, 'placeholder="e.g. 0712345678" autocomplete="off"')) +
      '</div></div>' +

      '<div class="form-block"><h3 class="form-section">Academic details</h3><div class="form-row">' +
      field('className', 'Class', inputHtml('className', 'text', v.className, 'list="dl-class" placeholder="e.g. Year 2" autocomplete="off"') + datalist('dl-class', classes), { required: true }) +
      field('course', 'Course/Program', inputHtml('course', 'text', v.course, 'list="dl-course" placeholder="e.g. Applied Computer Science" autocomplete="off"') + datalist('dl-course', courses), { required: true }) +
      field('yearOfStudy', 'Year of Study', inputHtml('yearOfStudy', 'number', v.yearOfStudy, 'min="1" max="10" step="1" placeholder="1 to 10"'), { required: true }) +
      field('admissionDate', 'Admission Date', inputHtml('admissionDate', 'date', isoDay(v.admissionDate)), { required: true }) +
      field('status', 'Status', selectHtml('status', ['Active', 'Inactive'], v.status || 'Active'), { required: true }) +
      '</div></div>' +
      (edit || !isAdmin ? '' : accountBlock()) +
      '</form>'
    );
  }

  function readForm(form) {
    const values = {};
    ALL_FIELDS.forEach((name) => {
      values[name] = form.elements[name] ? form.elements[name].value.trim() : '';
    });
    return values;
  }

  function validate(v, edit) {
    const e = {};
    if (!edit && !v.studentId) e.studentId = 'Student ID is required.';
    if (!v.registrationNumber) e.registrationNumber = 'Registration number is required.';
    if (!v.fullName) e.fullName = 'Full name is required.';
    if (!v.gender) e.gender = 'Gender is required.';
    if (!v.dateOfBirth) e.dateOfBirth = 'Date of birth is required.';
    else if (v.dateOfBirth > todayStr()) e.dateOfBirth = 'Date of birth cannot be in the future.';
    if (!v.email) e.email = 'Email is required.';
    else if (!EMAIL_RE.test(v.email)) e.email = 'Enter a valid email address.';
    if (!v.className) e.className = 'Class is required.';
    if (!v.course) e.course = 'Course/Program is required.';
    const year = Number(v.yearOfStudy);
    if (!v.yearOfStudy) e.yearOfStudy = 'Year of study is required.';
    else if (!Number.isInteger(year) || year < 1 || year > 10) e.yearOfStudy = 'Year of study must be a whole number from 1 to 10.';
    if (!v.admissionDate) e.admissionDate = 'Admission date is required.';
    return e;
  }

  function setFieldError(form, name, message) {
    const input = form.elements[name];
    const holder = form.querySelector('#e-' + name);
    if (holder) holder.textContent = message || '';
    if (input) {
      input.classList.toggle('is-invalid', Boolean(message));
      input.setAttribute('aria-invalid', message ? 'true' : 'false');
    }
  }

  function openForm(student) {
    const edit = Boolean(student);
    const modal = window.SAMS.modal.open({
      title: edit ? 'Edit Student' : 'Add Student',
      size: 'lg',
      closeOnBackdrop: false, // so typed data is not lost by a stray click
      body: formBody(student),
      footer:
        '<button type="button" class="btn btn-secondary" data-modal-close>Cancel</button>' +
        '<button type="submit" form="student-form" class="btn btn-primary" id="save-btn">' + (edit ? 'Save Changes' : 'Add Student') + '</button>',
    });

    const form = modal.root.querySelector('#student-form');
    const alertBox = modal.root.querySelector('#form-alert');
    const saveBtn = modal.root.querySelector('#save-btn');

    window.SAMS.hydrateIcons(modal.root);
    const loginBox = form.querySelector('#f-createLogin');
    const loginFields = form.querySelector('#login-fields');
    const pwInput = form.elements.password;
    const pwToggle = form.querySelector('#pw-toggle');

    if (loginBox) {
      const setVisible = (show) => {
        pwInput.type = show ? 'text' : 'password';
        pwToggle.innerHTML = window.icon(show ? 'eye-off' : 'eye', 20);
        pwToggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
      };
      setVisible(false);
      pwToggle.addEventListener('click', () => { setVisible(pwInput.type === 'password'); pwInput.focus(); });
      form.querySelector('#pw-generate').addEventListener('click', () => {
        pwInput.value = generatePassword();
        setFieldError(form, 'password', '');
        setVisible(true);
        toast('Password generated. Note it down before saving.', 'info');
      });
      loginBox.addEventListener('change', () => {
        loginFields.classList.toggle('hidden', !loginBox.checked);
        setFieldError(form, 'password', '');
      });
    }

    form.addEventListener('input', (e) => {
      if (e.target.name) setFieldError(form, e.target.name, '');
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      hideAlert(alertBox);

      const v = readForm(form);
      const errors = validate(v, edit);
      ALL_FIELDS.forEach((name) => setFieldError(form, name, errors[name]));
      const firstBad = ALL_FIELDS.find((name) => errors[name]);
      if (firstBad) {
        form.elements[firstBad].focus();
        return;
      }

      const wantLogin = Boolean(loginBox && loginBox.checked);
      if (wantLogin) {
        const pw = pwInput.value;
        let pwError = '';
        if (!pw) pwError = 'Password is required.';
        else {
          const failed = PW_RULES.find((rule) => !rule.ok(pw));
          if (failed) pwError = failed.message;
        }
        setFieldError(form, 'password', pwError);
        if (pwError) { pwInput.focus(); return; }
      }

      const body = {
        registrationNumber: v.registrationNumber,
        fullName: v.fullName,
        gender: v.gender,
        dateOfBirth: v.dateOfBirth,
        email: v.email,
        className: v.className,
        course: v.course,
        yearOfStudy: Number(v.yearOfStudy),
        admissionDate: v.admissionDate,
        status: v.status,
      };
      if (edit) {
        body.phone = v.phone; // an empty value clears the phone number
      } else {
        body.studentId = v.studentId;
        if (v.phone) body.phone = v.phone;
      }

      setLoading(saveBtn, true, edit ? 'Saving changes...' : 'Adding student...');
      modal.setLocked(true);
      try {
        await api(edit ? '/api/students/' + student._id : '/api/students', { method: edit ? 'PUT' : 'POST', body });

        // Optionally create the student's login right after the record is saved
        let accountError = '';
        if (wantLogin) {
          try {
            const account = { fullName: v.fullName, email: v.email, password: pwInput.value, role: 'student', studentId: v.studentId };
            if (v.phone) account.phone = v.phone;
            await api('/api/auth/register', { method: 'POST', body: account });
          } catch (accErr) {
            accountError = accErr.message;
          }
        }

        modal.setLocked(false);
        modal.close();
        if (accountError) {
          toast('Student added, but the login account was not created: ' + accountError + ' Create it from Teachers, then Student accounts.', 'error', 10000);
        } else {
          toast(edit ? 'Student updated successfully.' : wantLogin ? 'Student added and login account created.' : 'Student added successfully.', 'success');
        }
        await load(false);
        refreshOptions();
      } catch (err) {
        modal.setLocked(false);
        setLoading(saveBtn, false);

        // Point at the duplicate field when the server reports one
        let marked = null;
        if (err.status === 409) {
          if (/student id/i.test(err.message)) marked = 'studentId';
          else if (/registration number/i.test(err.message)) marked = 'registrationNumber';
        }
        if (marked) {
          setFieldError(form, marked, err.message);
          form.elements[marked].focus();
        } else {
          showAlert(alertBox, 'error', err.message);
          alertBox.scrollIntoView({ block: 'nearest' });
        }
      }
    });
  }

  /* ---------- View dialog ---------- */
  function openView(s) {
    const item = (label, valueHtml) =>
      '<div><div class="info-label">' + esc(label) + '</div><div class="info-value">' + valueHtml + '</div></div>';

    const details = [
      item('Student ID', esc(s.studentId)),
      item('Registration No.', esc(s.registrationNumber)),
      item('Full Name', esc(s.fullName)),
      item('Gender', esc(s.gender)),
      item('Date of Birth', esc(fmtDate(s.dateOfBirth))),
      item('Email', esc(s.email)),
      item('Phone', esc(s.phone || DASH)),
      item('Class', esc(s.className)),
      item('Course/Program', esc(s.course)),
      item('Year of Study', esc(s.yearOfStudy)),
      item('Admission Date', esc(fmtDate(s.admissionDate))),
      item('Status', statusBadge(s.status)),
    ].join('');

    const modal = window.SAMS.modal.open({
      title: s.fullName,
      size: 'lg',
      body:
        '<div class="info-grid">' + details + '</div>' +
        '<h3 class="view-title">Attendance summary</h3>' +
        '<div id="view-summary"><div class="loading" role="status"><span class="spinner"></span><span>Loading attendance summary...</span></div></div>',
      footer:
        (isAdmin ? '<button type="button" class="btn btn-secondary" id="view-edit">Edit</button>' : '') +
        '<button type="button" class="btn btn-primary" data-modal-close>Close</button>',
    });

    const editBtn = modal.root.querySelector('#view-edit');
    if (editBtn) {
      editBtn.addEventListener('click', () => {
        modal.close();
        openForm(s);
      });
    }

    const box = modal.root.querySelector('#view-summary');
    api('/api/attendance/summary?studentStatus=All&studentId=' + encodeURIComponent(s.studentId))
      .then((data) => {
        const r = data.students[0];
        if (!r || r.totalDays === 0) {
          box.innerHTML = '<p class="text-muted" style="margin:0">No attendance has been recorded for this student yet.</p>';
          return;
        }
        const tile = (cls, value, label) => '<div class="mini-stat ' + cls + '"><strong>' + esc(value) + '</strong><span>' + esc(label) + '</span></div>';
        box.innerHTML =
          '<div class="mini-stats">' +
          tile('is-present', r.present, 'Present') + tile('is-absent', r.absent, 'Absent') +
          tile('is-leave', r.leave, 'Leave') + tile('is-pct', Number(r.percentage).toFixed(1).replace(/\.0$/, '') + '%', 'Attendance') +
          '</div><p class="field-hint">Based on ' + esc(r.totalDays) + ' attendance days.</p>';
      })
      .catch(() => {
        box.innerHTML = '<p class="text-muted" style="margin:0">The attendance summary is unavailable right now.</p>';
      });
  }

  /* ---------- Delete ---------- */
  async function removeStudent(s) {
    const ok = await window.SAMS.confirm({
      title: 'Delete student',
      message:
        'Are you sure you want to delete this student? ' + s.fullName + ' (' + s.studentId + ') will be removed together with their ' +
        'attendance records and login account. To keep their history, set them to Inactive instead.',
      confirmText: 'Delete',
      danger: true,
    });
    if (!ok) return;

    try {
      await api('/api/students/' + s._id, { method: 'DELETE' });
      toast('Student deleted successfully.', 'success');
      await load(false);
      refreshOptions();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  /* ---------- Start ---------- */
  (async function init() {
    els.addBtn.addEventListener('click', () => openForm(null));

    const optionsReady = refreshOptions();
    load(true);
    await optionsReady;

    // The admin dashboard's "Add Student" shortcut opens this page with ?action=add
    if (new URLSearchParams(window.location.search).get('action') === 'add') {
      window.history.replaceState(null, '', '/students');
      openForm(null);
    }
  })();
})();