// Reusable dialog.
//   const m = SAMS.modal.open({ title, body, footer, size, closeOnBackdrop, onClose });
//   m.root (the dialog element), m.close(), m.setLocked(true) (blocks closing while saving)
// body and footer are HTML strings: escape any user text with SAMS.esc() first.
// Any element with data-modal-close closes the dialog.
(function () {
  'use strict';

  const { esc } = window.SAMS;
  const FOCUSABLE =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  let counter = 0;

  function open(options) {
    const o = Object.assign(
      { title: '', body: '', footer: '', size: '', closeOnBackdrop: true, onClose: null },
      options
    );
    const uid = 'modal-' + (++counter);
    const previous = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    let locked = false;
    let closed = false;

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML =
      '<div class="modal' + (o.size ? ' modal-' + o.size : '') + '" role="dialog" aria-modal="true" aria-labelledby="' + uid + '-title">' +
      '<div class="modal-header"><h2 id="' + uid + '-title">' + esc(o.title) + '</h2>' +
      '<button type="button" class="btn btn-icon" data-modal-close aria-label="Close dialog">' + window.icon('x', 20) + '</button></div>' +
      '<div class="modal-body">' + o.body + '</div>' +
      (o.footer ? '<div class="modal-footer">' + o.footer + '</div>' : '') +
      '</div>';
    const root = backdrop.querySelector('.modal');

    function close() {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKey, true);
      backdrop.remove();
      document.body.style.overflow = previousOverflow;
      if (previous && previous.focus) previous.focus();
      if (typeof o.onClose === 'function') o.onClose();
    }

    // Closing by the user (Esc, X, Cancel, backdrop) is blocked while locked
    function requestClose() {
      if (!locked) close();
    }

    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        requestClose();
        return;
      }
      if (e.key !== 'Tab') return;

      // Keep keyboard focus inside the dialog
      const items = Array.from(root.querySelectorAll(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop && o.closeOnBackdrop) requestClose();
      else if (e.target.closest('[data-modal-close]')) requestClose();
    });

    document.addEventListener('keydown', onKey, true);
    document.body.style.overflow = 'hidden';
    document.body.appendChild(backdrop);

    const firstField = root.querySelector(
      '.modal-body input:not([disabled]), .modal-body select:not([disabled]), .modal-body textarea:not([disabled])'
    );
    (firstField || root.querySelector('[data-modal-close]')).focus();

    return { root, close, setLocked(value) { locked = Boolean(value); } };
  }

  window.SAMS.modal = { open };
})();