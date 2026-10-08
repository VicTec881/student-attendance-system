// Shared helpers used by every page: session, API calls, alerts, toasts, loading buttons.
(function () {
  'use strict';

  const TOKEN_KEY = 'sams_token';
  const USER_KEY = 'sams_user';

  /* ---------- Session (the JWT is kept in localStorage) ---------- */
  const Auth = {
    getToken() {
      try { return localStorage.getItem(TOKEN_KEY); } catch (e) { return null; }
    },
    getUser() {
      try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch (e) { return null; }
    },
    setSession(token, user) {
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    },
    clearSession() {
      try {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
      } catch (e) { /* ignore */ }
    },
    // Every role lands on /dashboard, which shows that role's own dashboard
    homeFor() {
      return '/dashboard';
    },
    // Call at the top of every private page. Returns the user, or null after redirecting.
    requireAuth(roles) {
      const user = Auth.getUser();
      if (!Auth.getToken() || !user) {
        window.location.replace('/login');
        return null;
      }
      if (roles && !roles.includes(user.role)) {
        window.location.replace(Auth.homeFor(user.role));
        return null;
      }
      return user;
    },
    async logout() {
      try { await api('/api/auth/logout', { method: 'POST' }); } catch (e) { /* ignore */ }
      Auth.clearSession();
      window.location.replace('/login?reason=loggedout');
    },
  };

  /* ---------- API ---------- */
  class ApiError extends Error {
    constructor(message, status) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
    }
  }

  // api('/api/students?search=john')  or  api('/api/auth/login', { method: 'POST', body: {...}, auth: false })
  async function api(path, options) {
    const { method = 'GET', body, auth = true } = options || {};

    const headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth && Auth.getToken()) headers.Authorization = 'Bearer ' + Auth.getToken();

    let res;
    try {
      res = await fetch(path, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      throw new ApiError('Unable to connect to the server. Please try again later.', 0);
    }

    let data = null;
    try { data = await res.json(); } catch (e) { /* response had no JSON */ }

    if (!res.ok) {
      // An expired or invalid token on a private call: send the user back to log in
      if (res.status === 401 && auth) {
        Auth.clearSession();
        window.location.replace('/login?reason=expired');
      }
      throw new ApiError(
        (data && data.message) || 'Something went wrong. Please try again later.',
        res.status
      );
    }
    return data;
  }

  /* ---------- Small helpers ---------- */
  // Escapes text before it is placed inside HTML
  function esc(value) {
    return String(value === undefined || value === null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function hydrateIcons(root) {
    (root || document).querySelectorAll('[data-icon]').forEach((el) => {
      el.innerHTML = window.icon(el.dataset.icon, Number(el.dataset.size) || 20);
    });
  }

  const ALERT_ICONS = {
    success: 'check-circle',
    error: 'alert-circle',
    warning: 'alert-triangle',
    info: 'info',
  };

  // Inline alert box: showAlert(element, 'error', 'Invalid email or password.')
  function showAlert(el, type, message) {
    const kind = ALERT_ICONS[type] ? type : 'info';
    el.className = 'alert alert-' + kind;
    el.innerHTML = window.icon(ALERT_ICONS[kind], 18) + '<span></span>';
    el.querySelector('span').textContent = message;
  }

  function hideAlert(el) {
    el.className = 'alert hidden';
    el.textContent = '';
  }

  // Toast notification: toast('Attendance saved successfully.', 'success')
  function toast(message, type, timeout) {
    const kind = ALERT_ICONS[type] ? type : 'info';

    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.className = 'toast-container';
      document.body.appendChild(container);
    }

    const el = document.createElement('div');
    el.className = 'toast toast-' + kind;
    el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    el.innerHTML =
      window.icon(ALERT_ICONS[kind], 20) +
      '<span class="toast-msg"></span>' +
      '<button type="button" class="toast-close" aria-label="Dismiss notification">' +
      window.icon('x', 16) + '</button>';
    el.querySelector('.toast-msg').textContent = message;

    const remove = () => {
      if (!el.parentNode) return;
      el.classList.add('is-leaving');
      setTimeout(() => el.remove(), 200);
    };
    el.querySelector('.toast-close').addEventListener('click', remove);

    container.appendChild(el);
    if (timeout !== 0) setTimeout(remove, timeout || 4500);
    return el;
  }

  // Disables a button and shows a spinner while an operation runs
  function setLoading(button, isLoading, loadingText) {
    if (isLoading) {
      if (!button.dataset.originalHtml) button.dataset.originalHtml = button.innerHTML;
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      button.innerHTML =
        '<span class="spinner" aria-hidden="true"></span><span>' +
        esc(loadingText || 'Please wait...') + '</span>';
    } else {
      button.disabled = false;
      button.removeAttribute('aria-busy');
      if (button.dataset.originalHtml) {
        button.innerHTML = button.dataset.originalHtml;
        delete button.dataset.originalHtml;
      }
    }
  }

  window.SAMS = { Auth, api, ApiError, esc, hydrateIcons, showAlert, hideAlert, toast, setLoading };

  hydrateIcons();
})();