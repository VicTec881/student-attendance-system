// Adds "Export to Excel / PDF" buttons to the My Attendance page for students.
(function () {
  'use strict';

  const { Auth, api, toast, setLoading } = window.SAMS;

  const user = Auth.getUser();
  if (!user || user.role !== 'student') return;

  const header = document.querySelector('.page-header');
  if (!header) return;

  const box = document.createElement('div');
  box.className = 'header-actions';
  box.innerHTML =
    '<button type="button" class="btn btn-secondary" data-format="excel">' + window.icon('download', 18) + '<span>Export to Excel</span></button>' +
    '<button type="button" class="btn btn-secondary" data-format="pdf">' + window.icon('download', 18) + '<span>Export to PDF</span></button>';
  header.appendChild(box);

  let studentRef = null;

  // The login token identifies the student; the profile gives the linked student record ID
  async function getStudentRef() {
    if (!studentRef) {
      const data = await api('/api/auth/profile');
      if (!data.user.student || !data.user.student._id) {
        throw new Error('Your student record was not found. Please contact the administrator.');
      }
      studentRef = data.user.student._id;
    }
    return studentRef;
  }

  box.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-format]');
    if (!btn || btn.disabled) return;

    const from = document.getElementById('date-from').value;
    const to = document.getElementById('date-to').value;
    if (from && to && from > to) {
      toast('The start date cannot be after the end date.', 'error');
      return;
    }

    const format = btn.dataset.format;
    const buttons = box.querySelectorAll('button');
    buttons.forEach((b) => { if (b !== btn) b.disabled = true; });
    setLoading(btn, true, 'Exporting report...');

    try {
      const qs = new URLSearchParams({ type: 'student', student: await getStudentRef() });
      if (from) qs.set('startDate', from);
      if (to) qs.set('endDate', to);

      const name = await window.SAMS.download(
        '/api/reports/export/' + format + '?' + qs.toString(),
        'my-attendance.' + (format === 'excel' ? 'xlsx' : 'pdf')
      );
      toast((format === 'excel' ? 'Excel' : 'PDF') + ' report downloaded: ' + name, 'success');
    } catch (err) {
      toast(err.message, 'error', 8000);
    } finally {
      setLoading(btn, false);
      buttons.forEach((b) => { b.disabled = false; });
    }
  });
})();