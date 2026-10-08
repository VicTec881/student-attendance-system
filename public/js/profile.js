(function () {
  'use strict';

  const { Auth, api, esc, toast, setLoading, showAlert, hideAlert } = window.SAMS;

  const user = window.SAMS.layout.init({ title: 'Profile' });
  if (!user) return;

  const PHONE_RE = /^[+()\d\s-]{7,20}$/;
  const RULES = [
    { id: 'rule-length', ok: (p) => p.length >= 8, message: 'Password must contain at least 8 characters.' },
    { id: 'rule-upper', ok: (p) => /[A-Z]/.test(p), message: 'Password must contain an uppercase letter.' },
    { id: 'rule-lower', ok: (p) => /[a-z]/.test(p), message: 'Password must contain a lowercase letter.' },
    { id: 'rule-number', ok: (p) => /\d/.test(p), message: 'Password must contain a number.' },
  ];

  const $ = (id) => document.getElementById(id);
  const els = {
    status: $('status-area'), body: $('profile-body'),
    headAvatar: $('head-avatar'), headName: $('head-name'), headEmail: $('head-email'), headRole: $('head-role'), headStatus: $('head-status'),
    academic: $('academic'), academicGrid: $('academic-grid'),
    infoForm: $('info-form'), infoAlert: $('info-alert'), infoBtn: $('info-btn'),
    fullName: $('full-name'), fullNameError: $('full-name-error'),
    email: $('email'), role: $('role'), phone: $('phone'), phoneError: $('phone-error'),
    pwForm: $('password-form'), pwAlert: $('pw-alert'), pwBtn: $('pw-btn'), pwLast: $('pw-last'),
    current: $('current-password'), currentError: $('current-password-error'),
    next: $('new-password'), nextError: $('new-password-error'),
    confirm: $('confirm-password'), confirmError: $('confirm-password-error'),
  };

  let profile = null;

  /* ---------- Helpers ---------- */
  const initials = (name) =>
    String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  const capitalize = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);

  function setError(input, errorEl, message) {
    errorEl.textContent = message || '';
    input.classList.toggle('is-invalid', Boolean(message));
    input.setAttribute('aria-invalid', message ? 'true' : 'false');
  }

  function lastChangedText(iso) {
    if (!iso) return 'Your password has not been changed since your account was created.';
    const when = new Date(iso).toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
    return 'Your password was last changed on ' + when + '.';
  }

  // After the name changes, update every place that shows it (the shell was built from the old name)
  function applyName(fullName) {
    const stored = Auth.getUser();
    if (stored) {
      stored.fullName = fullName;
      Auth.setSession(Auth.getToken(), stored);
    }
    document.querySelectorAll('.sidebar-user-name, .user-name, .profile-name, .dropdown-menu:not(.notif-menu) .dropdown-header strong')
      .forEach((el) => { el.textContent = fullName; });
    document.querySelectorAll('.avatar').forEach((el) => { el.textContent = initials(fullName); });
  }

  /* ---------- Loading the profile ---------- */
  function fill() {
    els.headAvatar.textContent = initials(profile.fullName);
    els.headName.textContent = profile.fullName;
    els.headEmail.textContent = profile.email;
    els.headRole.className = 'badge badge-' + profile.role;
    els.headRole.textContent = profile.role;
    els.headStatus.className = 'badge badge-' + profile.status;
    els.headStatus.textContent = profile.status;

    els.fullName.value = profile.fullName;
    els.email.value = profile.email;
    els.role.value = capitalize(profile.role);
    els.phone.value = profile.phone || '';
    els.pwLast.textContent = lastChangedText(profile.passwordChangedAt);

    const s = profile.role === 'student' && profile.student && typeof profile.student === 'object' ? profile.student : null;
    els.academic.classList.toggle('hidden', !s);
    if (s) {
      const item = (label, value) =>
        '<div><div class="info-label">' + esc(label) + '</div><div class="info-value">' + esc(value) + '</div></div>';
      els.academicGrid.innerHTML =
        item('Student ID', s.studentId) + item('Registration No.', s.registrationNumber) + item('Class', s.className) +
        item('Course/Program', s.course) + item('Year of Study', s.yearOfStudy);
    }
  }

  function scrollToHash() {
    if (window.location.hash === '#security') $('security').scrollIntoView();
  }

  async function load() {
    els.status.innerHTML = '<div class="loading" role="status"><span class="spinner"></span><span>Loading profile...</span></div>';
    els.body.classList.add('hidden');
    try {
      const data = await api('/api/auth/profile');
      profile = data.user;
      fill();
      els.status.innerHTML = '';
      els.body.classList.remove('hidden');
      scrollToHash();
    } catch (err) {
      els.status.innerHTML =
        '<div class="alert alert-error" role="alert">' + window.icon('alert-circle', 18) + '<span>' + esc(err.message) +
        '</span></div><button type="button" class="btn btn-primary" id="retry-btn">Try again</button>';
      $('retry-btn').addEventListener('click', load);
    }
  }

  /* ---------- Personal information form ---------- */
  els.fullName.addEventListener('input', () => setError(els.fullName, els.fullNameError, ''));
  els.phone.addEventListener('input', () => setError(els.phone, els.phoneError, ''));

  els.infoForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    hideAlert(els.infoAlert);

    const fullName = els.fullName.value.trim();
    const phone = els.phone.value.trim();

    setError(els.fullName, els.fullNameError, fullName ? '' : 'Full name is required.');
    setError(els.phone, els.phoneError, phone && !PHONE_RE.test(phone) ? 'Enter a valid phone number.' : '');
    if (!fullName) return els.fullName.focus();
    if (phone && !PHONE_RE.test(phone)) return els.phone.focus();

    if (fullName === profile.fullName && phone === (profile.phone || '')) {
      toast('No changes to save.', 'info');
      return;
    }

    setLoading(els.infoBtn, true, 'Saving changes...');
    try {
      const data = await api('/api/auth/profile', { method: 'PUT', body: { fullName, phone } });
      profile.fullName = data.user.fullName;
      profile.phone = data.user.phone || '';
      els.fullName.value = profile.fullName;
      els.phone.value = profile.phone;
      applyName(profile.fullName);
      toast('Profile updated successfully.', 'success');
    } catch (err) {
      showAlert(els.infoAlert, 'error', err.message);
    } finally {
      setLoading(els.infoBtn, false);
    }
  });

  /* ---------- Change password ---------- */
  document.querySelectorAll('[data-toggle]').forEach((btn) => {
    const input = $(btn.dataset.toggle);
    btn.innerHTML = window.icon('eye', 20);
    btn.setAttribute('aria-label', 'Show ' + btn.dataset.label);
    btn.setAttribute('aria-pressed', 'false');
    btn.addEventListener('click', () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.innerHTML = window.icon(show ? 'eye-off' : 'eye', 20);
      btn.setAttribute('aria-label', (show ? 'Hide ' : 'Show ') + btn.dataset.label);
      btn.setAttribute('aria-pressed', show ? 'true' : 'false');
      input.focus();
    });
  });

  function resetToggles() {
    document.querySelectorAll('[data-toggle]').forEach((btn) => {
      $(btn.dataset.toggle).type = 'password';
      btn.innerHTML = window.icon('eye', 20);
      btn.setAttribute('aria-label', 'Show ' + btn.dataset.label);
      btn.setAttribute('aria-pressed', 'false');
    });
  }

  function updateRules() {
    const value = els.next.value;
    RULES.forEach((rule) => $(rule.id).classList.toggle('met', rule.ok(value)));
  }

  els.pwForm.addEventListener('input', (e) => {
    hideAlert(els.pwAlert);
    const map = { 'current-password': ['current', 'currentError'], 'new-password': ['next', 'nextError'], 'confirm-password': ['confirm', 'confirmError'] };
    const pair = map[e.target.id];
    if (pair) setError(els[pair[0]], els[pair[1]], '');
    if (e.target.id === 'new-password') updateRules();
  });

  function validatePassword() {
    const current = els.current.value;
    const next = els.next.value;
    const confirm = els.confirm.value;

    const errors = { current: '', next: '', confirm: '' };
    if (!current) errors.current = 'Current password is required.';

    if (!next) errors.next = 'New password is required.';
    else {
      const failed = RULES.find((rule) => !rule.ok(next));
      if (failed) errors.next = failed.message;
      else if (current && next === current) errors.next = 'New password must be different from the current password.';
    }

    if (!confirm) errors.confirm = 'Please confirm your new password.';
    else if (next && confirm !== next) errors.confirm = 'Passwords do not match.';

    setError(els.current, els.currentError, errors.current);
    setError(els.next, els.nextError, errors.next);
    setError(els.confirm, els.confirmError, errors.confirm);

    if (errors.current) return els.current;
    if (errors.next) return els.next;
    if (errors.confirm) return els.confirm;
    return null;
  }

  els.pwForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    hideAlert(els.pwAlert);

    const firstBad = validatePassword();
    if (firstBad) {
      firstBad.focus();
      return;
    }

    setLoading(els.pwBtn, true, 'Updating password...');
    try {
      const data = await api('/api/auth/change-password', {
        method: 'PUT',
        body: {
          currentPassword: els.current.value,
          newPassword: els.next.value,
          confirmPassword: els.confirm.value,
        },
      });

      // The server issues a new token (the old one stops working). Keep it, or the next click would log you out.
      Auth.setSession(data.token, Auth.getUser());

      els.pwForm.reset();
      resetToggles();
      updateRules();
      els.pwLast.textContent = lastChangedText(data.passwordChangedAt);
      showAlert(els.pwAlert, 'success', 'Password changed successfully.');
    } catch (err) {
      const message = err.message;
      if (/current password/i.test(message)) {
        setError(els.current, els.currentError, message);
        els.current.focus();
      } else if (/do not match/i.test(message)) {
        setError(els.confirm, els.confirmError, message);
        els.confirm.focus();
      } else if (/different from|at least 8/i.test(message)) {
        setError(els.next, els.nextError, message);
        els.next.focus();
      } else {
        showAlert(els.pwAlert, 'error', message);
      }
    } finally {
      setLoading(els.pwBtn, false);
    }
  });

  load();
})();