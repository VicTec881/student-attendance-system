// Downloads a file from a protected API route (the login token must be sent as a header).
// Usage: const filename = await SAMS.download('/api/reports/export/pdf?type=daily&date=2026-10-02', 'report.pdf');
(function () {
  'use strict';

  const { Auth, ApiError } = window.SAMS;

  async function download(path, fallbackName) {
    let res;
    try {
      res = await fetch(path, { headers: { Authorization: 'Bearer ' + Auth.getToken() } });
    } catch (err) {
      throw new ApiError('Unable to connect to the server. Please try again later.', 0);
    }

    if (!res.ok) {
      let message = 'Something went wrong. Please try again later.';
      try {
        const data = await res.json();
        if (data && data.message) message = data.message;
      } catch (e) { /* the response had no JSON */ }

      if (res.status === 401) {
        Auth.clearSession();
        window.location.replace('/login?reason=expired');
      }
      throw new ApiError(message, res.status);
    }

    const blob = await res.blob();
    const match = /filename="?([^";]+)"?/i.exec(res.headers.get('Content-Disposition') || '');
    const filename = match ? match[1] : fallbackName;

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);

    return filename;
  }

  window.SAMS.download = download;
})();