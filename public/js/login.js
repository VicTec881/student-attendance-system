(function () {
  'use strict';

  const { Auth, api, setLoading, showAlert, hideAlert } = window.SAMS;

  // Already logged in: go straight to the dashboard.
  // (If the saved token is no longer valid, the dashboard sends the user back here.)
  const existing = Auth.getUser();
  if (Auth.getToken() && existing) {
    window.location.replace(Auth.homeFor(existing.role));
    return;
  }

  const form = document.getElementById('login-form');
  const alertBox = document.getElementById('form-alert');
  const emailInput = document.getElementById('email');
  const passwordInput = document.getElementById('password');
  const emailError = document.getElementById('email-error');
  const passwordError = document.getElementById('password-error');
  const loginBtn = document.getElementById('login-btn');
  const toggleBtn = document.getElementById('toggle-password');

  const EMAIL_RE = /^\S+@\S+\.\S+$/;

  // Messages when the user is sent here from another page
  const reason = new URLSearchParams(window.location.search).get('reason');
  if (reason === 'expired') {
    showAlert(alertBox, 'warning', 'Your session has expired. Please log in again.');
  } else if (reason === 'loggedout') {
    showAlert(alertBox, 'success', 'You have been logged out successfully.');
  }

  /* ---------- Show / hide password ---------- */
  toggleBtn.innerHTML = window.icon('eye', 20);
  toggleBtn.addEventListener('click', () => {
    const show = passwordInput.type === 'password';
    passwordInput.type = show ? 'text' : 'password';
    toggleBtn.innerHTML = window.icon(show ? 'eye-off' : 'eye', 20);
    toggleBtn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    toggleBtn.setAttribute('aria-pressed', show ? 'true' : 'false');
    passwordInput.focus();
  });

  /* ---------- Validation ---------- */
  function setFieldError(input, errorEl, message) {
    errorEl.textContent = message || '';
    input.classList.toggle('is-invalid', Boolean(message));
    input.setAttribute('aria-invalid', message ? 'true' : 'false');
  }

  // Returns the first invalid input (so it can be focused), or null
  function validate() {
    let firstInvalid = null;

    const email = emailInput.value.trim();
    if (!email) {
      setFieldError(emailInput, emailError, 'Email is required.');
      firstInvalid = firstInvalid || emailInput;
    } else if (!EMAIL_RE.test(email)) {
      setFieldError(emailInput, emailError, 'Enter a valid email address.');
      firstInvalid = firstInvalid || emailInput;
    } else {
      setFieldError(emailInput, emailError, '');
    }

    if (!passwordInput.value) {
      setFieldError(passwordInput, passwordError, 'Password is required.');
      firstInvalid = firstInvalid || passwordInput;
    } else {
      setFieldError(passwordInput, passwordError, '');
    }

    return firstInvalid;
  }

  emailInput.addEventListener('input', () => setFieldError(emailInput, emailError, ''));
  passwordInput.addEventListener('input', () => setFieldError(passwordInput, passwordError, ''));

  /* ---------- Submit ---------- */
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    hideAlert(alertBox);

    const firstInvalid = validate();
    if (firstInvalid) {
      firstInvalid.focus();
      return;
    }

    setLoading(loginBtn, true, 'Signing in...');
    try {
      const data = await api('/api/auth/login', {
        method: 'POST',
        auth: false,
        body: { email: emailInput.value.trim(), password: passwordInput.value },
      });

      Auth.setSession(data.token, data.user);
      window.location.replace(Auth.homeFor(data.user.role)); // button stays disabled while redirecting
    } catch (err) {
      showAlert(alertBox, 'error', err.message);
      passwordInput.value = '';
      passwordInput.focus();
      setLoading(loginBtn, false);
    }
  });
})();