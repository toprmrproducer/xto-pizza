/* XTO phone sign-up: one sheet (number -> 6-digit SMS code -> name) shared by the website, the app and the digital menu checkout.
   Verification only switches on when the server has an SMS provider (GET /api/settings -> auth.required). */
(function () {
  var TK = 'xto_auth_token', PK = 'xto_auth_phone', NK = 'xto_auth_name';
  var XAuth = window.XAuth = {};
  var required = null, checked = false, pending = null;

  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k) || ''; if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} return ''; }
  XAuth.token = function () { return ls(TK); };
  XAuth.phone = function () { return ls(PK); };
  XAuth.name = function () { return ls(NK); };
  XAuth.headers = function () { var t = XAuth.token(); return t ? { Authorization: 'Bearer ' + t } : {}; };
  XAuth.signOut = function () { ls(TK, null); ls(PK, null); ls(NK, null); checked = false; unlockFields(); };

  function isRequired() {
    if (required !== null) return Promise.resolve(required);
    return fetch('/api/settings').then(function (r) { return r.json(); }).then(function (j) { required = !!(j.auth && j.auth.required); return required; }).catch(function () { required = false; return false; });
  }
  XAuth.isRequired = isRequired;

  /* Resolves { token, phone, name } once the phone is verified, or null when verification is not switched on.
     Rejects with Error('cancelled') if the customer closes the sheet. */
  XAuth.ensure = function () {
    return isRequired().then(function (req) {
      if (!req) return null;
      if (pending) return pending;
      var have = function () { return { token: XAuth.token(), phone: XAuth.phone(), name: XAuth.name() }; };
      var start = function () { pending = openSheet().then(function (r) { pending = null; return r; }, function (e) { pending = null; throw e; }); return pending; };
      if (!XAuth.token()) return start();
      if (checked) return have();
      return fetch('/api/auth/me', { headers: XAuth.headers() }).then(function (r) {
        if (r.status === 401) { XAuth.signOut(); return start(); }
        return r.json().then(function (j) { if (j.name) ls(NK, j.name); checked = true; return have(); });
      }).catch(function () { return have(); });
    });
  };

  /* fetch JSON with the sign-in token; if the server says sign-in is needed, ask once and retry */
  XAuth.getJSON = function (url) {
    var go = function () { return fetch(url, { headers: XAuth.headers() }).then(function (r) { return r.json().then(function (j) { return { status: r.status, json: j }; }); }); };
    return go().then(function (x) {
      if (x.status !== 401 || !x.json || !x.json.needAuth) return x.json;
      XAuth.signOut();
      return XAuth.ensure().then(function () { return go().then(function (y) { return y.json; }); });
    });
  };

  function lockFields() {
    var p = XAuth.phone(); if (!p) return;
    var ph = document.getElementById('ckPhone');
    if (ph) {
      ph.value = p; ph.readOnly = true; ph.style.opacity = '.75';
      if (!document.getElementById('xaChange')) {
        var a = document.createElement('a'); a.id = 'xaChange'; a.href = '#'; a.textContent = 'Not you? Change number';
        a.style.cssText = 'display:block;font-size:12px;margin-top:4px;color:#b3271e;text-decoration:underline';
        a.onclick = function (e) { e.preventDefault(); XAuth.signOut(); XAuth.ensure().catch(function () {}); };
        ph.parentNode.appendChild(a);
      }
    }
    var nm = document.getElementById('ckName');
    if (nm && !nm.value && XAuth.name()) nm.value = XAuth.name();
  }
  function unlockFields() {
    var ph = document.getElementById('ckPhone'); if (ph) { ph.readOnly = false; ph.style.opacity = ''; ph.value = ''; }
    var a = document.getElementById('xaChange'); if (a) a.remove();
  }
  XAuth.fill = lockFields;

  function css() {
    if (document.getElementById('xaCss')) return;
    var s = document.createElement('style'); s.id = 'xaCss';
    s.textContent = '.xa-back{position:fixed;inset:0;background:rgba(18,12,6,.6);z-index:99999;display:flex;align-items:flex-end;justify-content:center;font-family:Inter,system-ui,sans-serif}'
      + '.xa-card{background:#fffdf9;color:#1b120c;width:100%;max-width:440px;border-radius:22px 22px 0 0;padding:22px 20px calc(22px + env(safe-area-inset-bottom));box-shadow:0 -20px 50px -20px rgba(0,0,0,.5)}'
      + '@media(min-width:560px){.xa-back{align-items:center}.xa-card{border-radius:22px}}'
      + '.xa-card h3{margin:0 0 4px;font-size:20px;font-weight:800}.xa-card p{margin:0 0 14px;color:#76675a;font-size:14px;line-height:1.45}'
      + '.xa-row{display:flex;gap:8px;margin-bottom:10px}.xa-pre{display:flex;align-items:center;padding:0 12px;border:1.5px solid #eadfce;border-radius:12px;background:#fff8ef;font-weight:600}'
      + '.xa-card input{flex:1;min-width:0;border:1.5px solid #eadfce;border-radius:12px;padding:13px 14px;font-size:17px;background:#fff;color:#1b120c;outline:none}'
      + '.xa-card input:focus{border-color:#f0731d}.xa-code{letter-spacing:.35em;text-align:center;font-weight:700;font-size:22px!important}'
      + '.xa-btn{width:100%;border:0;border-radius:12px;padding:14px;font-size:16px;font-weight:700;color:#fff;background:linear-gradient(135deg,#f0731d,#b3271e);cursor:pointer}'
      + '.xa-btn[disabled]{opacity:.55}.xa-err{color:#b3271e;font-size:13px;min-height:18px;margin:2px 0 8px}'
      + '.xa-links{display:flex;justify-content:space-between;margin-top:10px;font-size:13px}.xa-links a{color:#76675a;text-decoration:underline;cursor:pointer}'
      + '.xa-x{float:right;border:0;background:none;font-size:22px;color:#76675a;cursor:pointer;line-height:1}';
    document.head.appendChild(s);
  }

  function openSheet() {
    css();
    return new Promise(function (resolve, reject) {
      var back = document.createElement('div'); back.className = 'xa-back';
      back.innerHTML = '<div class="xa-card" role="dialog" aria-modal="true" aria-label="Verify your phone"><button class="xa-x" aria-label="Close">&times;</button><div id="xaBody"></div></div>';
      document.body.appendChild(back);
      var body = back.querySelector('#xaBody'), phone = '', isNew = true, timer = null;
      function done(err, val) { clearInterval(timer); back.remove(); err ? reject(err) : resolve(val); }
      back.querySelector('.xa-x').onclick = function () { done(new Error('cancelled')); };
      back.addEventListener('click', function (e) { if (e.target === back) done(new Error('cancelled')); });
      function post(url, data) {
        return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
          .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, json: j }; }); })
          .catch(function () { return { ok: false, json: { error: 'No connection. Check your internet and try again.' } }; });
      }
      function stepPhone(msg) {
        body.innerHTML = '<h3>Verify your mobile</h3><p>We text a 6-digit code to confirm it is you, and keep your orders on this number.</p>'
          + '<div class="xa-row"><span class="xa-pre">+91</span><input id="xaPhone" type="tel" inputmode="numeric" maxlength="10" placeholder="10-digit mobile" autocomplete="tel-national"></div>'
          + '<div class="xa-err" id="xaErr">' + (msg || '') + '</div><button class="xa-btn" id="xaSend">Send code</button>';
        var inp = body.querySelector('#xaPhone'), btn = body.querySelector('#xaSend'), err = body.querySelector('#xaErr');
        inp.value = phone; setTimeout(function () { inp.focus(); }, 50);
        function go() {
          phone = inp.value.replace(/\D/g, '').slice(-10);
          if (!/^[6-9]\d{9}$/.test(phone)) { err.textContent = 'Enter a valid 10-digit mobile number.'; return; }
          btn.disabled = true; btn.textContent = 'Sending...'; err.textContent = '';
          post('/api/auth/otp/send', { phone: phone }).then(function (r) {
            if (!r.ok) { btn.disabled = false; btn.textContent = 'Send code'; err.textContent = r.json.error || 'Could not send the code.'; return; }
            isNew = r.json.isNew !== false; stepCode(r.json.devOtp);
          });
        }
        btn.onclick = go; inp.onkeydown = function (e) { if (e.key === 'Enter') go(); };
      }
      function stepCode(devOtp) {
        var needName = isNew || !XAuth.name();
        body.innerHTML = '<h3>Enter the code</h3><p>Sent to +91 ' + phone + (devOtp ? ' (test code ' + devOtp + ')' : '') + '</p>'
          + '<div class="xa-row"><input id="xaCode" class="xa-code" type="tel" inputmode="numeric" maxlength="6" placeholder="------" autocomplete="one-time-code"></div>'
          + (needName ? '<div class="xa-row"><input id="xaName" type="text" maxlength="60" placeholder="Your name" autocomplete="name" value="' + XAuth.name().replace(/"/g, '') + '"></div>' : '')
          + '<div class="xa-err" id="xaErr"></div><button class="xa-btn" id="xaGo">Verify and continue</button>'
          + '<div class="xa-links"><a id="xaChangeNum">Change number</a><a id="xaResend">Resend in 30s</a></div>';
        var code = body.querySelector('#xaCode'), name = body.querySelector('#xaName'), btn = body.querySelector('#xaGo'), err = body.querySelector('#xaErr'), rs = body.querySelector('#xaResend');
        setTimeout(function () { code.focus(); }, 50);
        var left = 30; clearInterval(timer);
        timer = setInterval(function () { left -= 1; if (left > 0) rs.textContent = 'Resend in ' + left + 's'; else { clearInterval(timer); rs.textContent = 'Resend code'; rs.dataset.ready = '1'; } }, 1000);
        rs.onclick = function () {
          if (!rs.dataset.ready) return; rs.dataset.ready = ''; rs.textContent = 'Sending...';
          post('/api/auth/otp/send', { phone: phone }).then(function (r) { if (!r.ok) { err.textContent = r.json.error || 'Could not resend.'; rs.textContent = 'Resend code'; rs.dataset.ready = '1'; } else stepCode(r.json.devOtp); });
        };
        body.querySelector('#xaChangeNum').onclick = function () { clearInterval(timer); stepPhone(); };
        function go() {
          var c = code.value.replace(/\D/g, '');
          if (c.length !== 6) { err.textContent = 'Enter the 6-digit code.'; return; }
          if (name && name.value.trim().length < 2) { err.textContent = 'Enter your name.'; return; }
          btn.disabled = true; btn.textContent = 'Checking...'; err.textContent = '';
          post('/api/auth/otp/verify', { phone: phone, code: c, name: name ? name.value.trim() : XAuth.name() }).then(function (r) {
            if (!r.ok) { btn.disabled = false; btn.textContent = 'Verify and continue'; err.textContent = r.json.error || 'Wrong code.'; return; }
            ls(TK, r.json.token); ls(PK, r.json.customer.phone); ls(NK, r.json.customer.name || ''); checked = true;
            lockFields(); done(null, { token: r.json.token, phone: r.json.customer.phone, name: r.json.customer.name || '' });
          });
        }
        btn.onclick = go; code.onkeydown = function (e) { if (e.key === 'Enter') go(); };
        code.oninput = function () { if (code.value.replace(/\D/g, '').length === 6 && !name) go(); };
      }
      stepPhone();
    });
  }

  document.addEventListener('DOMContentLoaded', function () { if (XAuth.token()) isRequired().then(function (r) { if (r) lockFields(); }); });
})();
