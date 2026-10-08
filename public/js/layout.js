// Page shell for every logged-in page: sidebar, top bar, menus and the confirm dialog.
(function () {
  'use strict';

  const { Auth, esc } = window.SAMS;

  const NAV = {
    admin: [
      { label: 'Dashboard', href: '/dashboard', icon: 'dashboard' },
      { label: 'Students', href: '/students', icon: 'users' },
      { label: 'Teachers', href: '/teachers', icon: 'graduation-cap' },
      { label: 'Mark Attendance', href: '/attendance', icon: 'calendar-check' },
      { label: 'Attendance Records', href: '/records', icon: 'clipboard-list' },
      { label: 'Reports', href: '/reports', icon: 'bar-chart' },
      { label: 'Profile', href: '/profile', icon: 'user' },
    ],
    teacher: [
      { label: 'Dashboard', href: '/dashboard', icon: 'dashboard' },
      { label: 'Students', href: '/students', icon: 'users' },
      { label: 'Mark Attendance', href: '/attendance', icon: 'calendar-check' },
      { label: 'Attendance Records', href: '/records', icon: 'clipboard-list' },
      { label: 'Reports', href: '/reports', icon: 'bar-chart' },
      { label: 'Profile', href: '/profile', icon: 'user' },
    ],
    student: [
      { label: 'Dashboard', href: '/dashboard', icon: 'dashboard' },
      { label: 'My Attendance', href: '/records', icon: 'calendar-check' },
      { label: 'Attendance History', href: '/dashboard#history', icon: 'clipboard-list' },
      { label: 'Profile', href: '/profile', icon: 'user' },
      { label: 'Change Password', href: '/profile#security', icon: 'lock' },
    ],
  };

  const initials = (name) =>
    String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

  /* ---------- Confirmation dialog: await SAMS.confirm({ title, message, ... }) ---------- */
  function confirmDialog(options) {
    const o = Object.assign(
      { title: 'Are you sure?', message: '', confirmText: 'Confirm', cancelText: 'Cancel', danger: false },
      options
    );

    return new Promise((resolve) => {
      const previous = document.activeElement;
      const backdrop = document.createElement('div');
      backdrop.className = 'modal-backdrop';
      backdrop.innerHTML =
        '<div class="modal" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-msg">' +
        '<div class="modal-header"><h2 id="confirm-title">' + esc(o.title) + '</h2></div>' +
        '<div class="modal-body"><p id="confirm-msg" style="margin:0">' + esc(o.message) + '</p></div>' +
        '<div class="modal-footer">' +
        '<button type="button" class="btn btn-secondary" data-act="cancel">' + esc(o.cancelText) + '</button>' +
        '<button type="button" class="btn ' + (o.danger ? 'btn-danger' : 'btn-primary') + '" data-act="ok">' + esc(o.confirmText) + '</button>' +
        '</div></div>';

      const buttons = backdrop.querySelectorAll('button');
      const close = (result) => {
        document.removeEventListener('keydown', onKey, true);
        backdrop.remove();
        if (previous && previous.focus) previous.focus();
        resolve(result);
      };
      const onKey = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); close(false); }
        if (e.key === 'Tab') { // keep focus inside the dialog
          const first = buttons[0];
          const last = buttons[buttons.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
      };

      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) close(false);
        const act = e.target.closest('[data-act]');
        if (act) close(act.dataset.act === 'ok');
      });
      document.addEventListener('keydown', onKey, true);
      document.body.appendChild(backdrop);
      backdrop.querySelector('[data-act="cancel"]').focus();
    });
  }

  async function logout() {
    const ok = await confirmDialog({
      title: 'Logout',
      message: 'Are you sure you want to logout?',
      confirmText: 'Logout',
    });
    if (ok) Auth.logout();
  }

  /* ---------- Markup ---------- */
  function sidebarHtml(user) {
    const links = (NAV[user.role] || NAV.student).map((item) => {
      const url = new URL(item.href, window.location.origin);
      return (
        '<a class="sidebar-link" href="' + esc(item.href) + '" data-nav data-path="' + esc(url.pathname) +
        '" data-hash="' + esc(url.hash) + '">' + window.icon(item.icon, 20) + '<span>' + esc(item.label) + '</span></a>'
      );
    }).join('');

    return (
      '<aside class="sidebar" id="sidebar">' +
      '<div class="sidebar-brand"><span class="brand-mark">' + window.icon('graduation-cap', 22) + '</span>' +
      '<span class="brand-title">Student Attendance<br>Management System</span></div>' +
      '<nav class="sidebar-nav" aria-label="Main navigation">' + links +
      '<button type="button" class="sidebar-link" id="sidebar-logout">' + window.icon('log-out', 20) + '<span>Logout</span></button>' +
      '</nav>' +
      '<div class="sidebar-footer"><div class="sidebar-user"><span class="avatar" aria-hidden="true">' + esc(initials(user.fullName)) + '</span>' +
      '<div style="min-width:0"><div class="sidebar-user-name">' + esc(user.fullName) + '</div>' +
      '<div class="sidebar-user-role">' + esc(user.role) + '</div></div></div></div>' +
      '</aside>'
    );
  }

  function topbarHtml(user, title) {
    return (
      '<header class="topbar">' +
      '<button type="button" class="btn btn-icon menu-toggle" id="menu-toggle" aria-label="Open menu" aria-controls="sidebar" aria-expanded="false">' + window.icon('menu', 22) + '</button>' +
      '<h2 class="topbar-title">' + esc(title) + '</h2>' +
      '<div class="topbar-actions">' +

      '<div class="dropdown" data-dropdown>' +
      '<button type="button" class="btn btn-icon" aria-haspopup="menu" aria-expanded="false" aria-label="Notifications">' + window.icon('bell', 20) + '</button>' +
      '<div class="dropdown-menu notif-menu hidden" role="menu">' +
      '<div class="dropdown-header"><strong>Notifications</strong></div>' +
      '<div class="dropdown-empty">No notifications.</div></div></div>' +

      '<div class="dropdown" data-dropdown>' +
      '<button type="button" class="user-chip" aria-haspopup="menu" aria-expanded="false" aria-label="Account menu">' +
      '<span class="avatar" aria-hidden="true">' + esc(initials(user.fullName)) + '</span>' +
      '<span class="user-meta"><span class="user-name">' + esc(user.fullName) + '</span><span class="user-role">' + esc(user.role) + '</span></span>' +
      window.icon('chevron-down', 16) + '</button>' +
      '<div class="dropdown-menu hidden" role="menu">' +
      '<div class="dropdown-header"><strong>' + esc(user.fullName) + '</strong><span>' + esc(user.email) + '</span></div>' +
      '<div class="dropdown-divider"></div>' +
      '<a href="/profile" role="menuitem">' + window.icon('user', 18) + 'Profile</a>' +
      '<a href="/profile#security" role="menuitem">' + window.icon('lock', 18) + 'Change Password</a>' +
      '<div class="dropdown-divider"></div>' +
      '<button type="button" class="is-danger" id="menu-logout" role="menuitem">' + window.icon('log-out', 18) + 'Logout</button>' +
      '</div></div>' +

      '</div></header>'
    );
  }

  /* ---------- Behaviour ---------- */
  function markActive() {
    const links = Array.from(document.querySelectorAll('.sidebar-link[data-nav]'));
    const samePath = links.filter((l) => l.dataset.path === window.location.pathname);
    const active =
      samePath.find((l) => l.dataset.hash && l.dataset.hash === window.location.hash) ||
      samePath.find((l) => !l.dataset.hash);

    links.forEach((l) => {
      const on = l === active;
      l.classList.toggle('active', on);
      if (on) l.setAttribute('aria-current', 'page');
      else l.removeAttribute('aria-current');
    });
  }

  function setupDropdowns() {
    const wrappers = Array.from(document.querySelectorAll('[data-dropdown]'));

    const closeAll = () => {
      wrappers.forEach((w) => {
        w.querySelector('.dropdown-menu').classList.add('hidden');
        w.querySelector('[aria-haspopup]').setAttribute('aria-expanded', 'false');
      });
    };

    wrappers.forEach((w) => {
      const btn = w.querySelector('[aria-haspopup]');
      const menu = w.querySelector('.dropdown-menu');
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const wasHidden = menu.classList.contains('hidden');
        closeAll();
        if (wasHidden) {
          menu.classList.remove('hidden');
          btn.setAttribute('aria-expanded', 'true');
        }
      });
    });

    document.addEventListener('click', closeAll);
    return closeAll;
  }

  function init(options) {
    const opts = options || {};
    const user = Auth.requireAuth(opts.roles);
    if (!user) return null;

    const app = document.getElementById('app');
    const main = app.querySelector('.main');

    document.body.insertAdjacentHTML('afterbegin', '<a class="skip-link" href="#content">Skip to main content</a>');
    app.insertAdjacentHTML('afterbegin', sidebarHtml(user) + '<div class="sidebar-overlay" id="sidebar-overlay"></div>');
    main.insertAdjacentHTML('afterbegin', topbarHtml(user, opts.title || ''));

    const toggle = document.getElementById('menu-toggle');
    const setSidebar = (open) => {
      app.classList.toggle('sidebar-open', open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    };
    toggle.addEventListener('click', () => setSidebar(!app.classList.contains('sidebar-open')));
    document.getElementById('sidebar-overlay').addEventListener('click', () => setSidebar(false));
    document.querySelectorAll('.sidebar-link[data-nav]').forEach((l) => l.addEventListener('click', () => setSidebar(false)));

    const closeDropdowns = setupDropdowns();
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { closeDropdowns(); setSidebar(false); }
    });

    document.getElementById('sidebar-logout').addEventListener('click', logout);
    document.getElementById('menu-logout').addEventListener('click', logout);

    markActive();
    window.addEventListener('hashchange', markActive);

    return user;
  }

  window.SAMS.layout = { init };
  window.SAMS.confirm = confirmDialog;
})();