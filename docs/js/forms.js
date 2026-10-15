/* Enquiry forms (franchise, careers, contact): POST /api/enquiries, show a clear success state. */
(function () {
  'use strict';
  document.querySelectorAll('form[data-enquiry]').forEach(function (form) {
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var err = form.querySelector('.xerr');
      var btn = form.querySelector('button[type="submit"]');
      err.textContent = '';
      var data = Object.fromEntries(new FormData(form).entries());
      data.type = form.getAttribute('data-enquiry');
      btn.disabled = true; var label = btn.textContent; btn.textContent = 'Sending...';
      try {
        var res = await fetch('/api/enquiries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        var out = await res.json();
        if (!res.ok) throw new Error(out.error || 'Could not send. Please try again.');
        var ok = document.getElementById(form.getAttribute('data-success'));
        form.hidden = true;
        if (ok) { ok.hidden = false; var ref = ok.querySelector('[data-ref]'); if (ref) ref.textContent = out.id; ok.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      } catch (ex) {
        err.textContent = ex.message || 'Could not send. Please try again.';
        btn.disabled = false; btn.textContent = label;
      }
    });
  });
})();
