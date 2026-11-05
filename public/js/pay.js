/* XTO checkout helpers shared by the website and the app: store settings, delivery location, Cashfree payment */
(function () {
  var SDK = 'https://sdk.cashfree.com/js/v3/cashfree.js';
  var XPay = window.XPay = { settings: null, payments: null, geo: null };

  XPay.load = function () {
    return Promise.all([
      fetch('/api/settings').then(function (r) { return r.json(); }),
      fetch('/api/config').then(function (r) { return r.json(); })
    ]).then(function (a) { XPay.settings = a[0].settings; XPay.payments = a[0].payments; XPay.geo = a[1].outletsGeo || {}; return XPay; })
      .catch(function () { XPay.settings = XPay.settings || { deliveryEnabled: false }; return XPay; });
  };
  XPay.deliveryFee = function (itemTotal) {
    var s = XPay.settings; if (!s || !s.deliveryEnabled) return null;
    return (s.freeDeliveryAbove > 0 && itemTotal >= s.freeDeliveryAbove) ? 0 : s.deliveryFee;
  };
  XPay.km = function (a, b) {
    var R = 6371, rad = function (d) { return d * Math.PI / 180; };
    var dLat = rad(b[0] - a[0]), dLng = rad(b[1] - a[1]);
    var h = Math.pow(Math.sin(dLat / 2), 2) + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.pow(Math.sin(dLng / 2), 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  };
  XPay.nearest = function (lat, lng) {
    var best = null;
    Object.keys(XPay.geo || {}).forEach(function (id) {
      var d = XPay.km(XPay.geo[id], [lat, lng]);
      if (!best || d < best.km) best = { id: id, km: d };
    });
    return best;
  };
  XPay.locate = function () {
    return new Promise(function (resolve, reject) {
      if (!navigator.geolocation) return reject(new Error('Location is not available on this device.'));
      navigator.geolocation.getCurrentPosition(
        function (p) { resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }); },
        function () { reject(new Error('Could not get your location. Allow location access and try again.')); },
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
      );
    });
  };
  XPay.start = function (payload) {
    var send = function () {
      var h = { 'Content-Type': 'application/json' };
      if (window.XAuth) { var a = XAuth.headers(); if (a.Authorization) h.Authorization = a.Authorization; }
      return fetch('/api/checkout/start', { method: 'POST', headers: h, body: JSON.stringify(payload) })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, status: r.status, json: j }; }); });
    };
    if (!window.XAuth) return send();
    return XAuth.ensure().then(function (who) {
      if (who) { payload.customer = payload.customer || {}; payload.customer.phone = who.phone; if (!payload.customer.name) payload.customer.name = who.name; }
      return send();
    }).then(function (x) {
      if (x.status === 401 && x.json && x.json.needAuth) { XAuth.signOut(); return XAuth.ensure().then(function (who) { if (who) payload.customer.phone = who.phone; return send(); }); }
      return x;
    }).catch(function (e) { return { ok: false, status: 0, json: { error: e && e.message === 'cancelled' ? 'Verify your phone number to place the order.' : 'Could not verify your phone. Try again.' } }; });
  };
  XPay.confirm = function (orderId, tries) {
    tries = tries || 1;
    return fetch('/api/checkout/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId: orderId }) })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, json: j }; }); })
      .then(function (x) {
        if (x.json && x.json.ok && x.json.order) return { order: x.json.order };
        if (x.json && x.json.pending && tries < 5) return new Promise(function (res) { setTimeout(res, 1500); }).then(function () { return XPay.confirm(orderId, tries + 1); });
        return { error: x.json && x.json.pending ? 'Payment was not completed.' : (x.json && x.json.error) || 'Could not confirm payment.' };
      })
      .catch(function () { return { error: 'Connection problem while confirming payment.' }; });
  };
  function loadSdk() {
    return new Promise(function (resolve, reject) {
      if (window.Cashfree) return resolve();
      var s = document.createElement('script'); s.src = SDK; s.onload = resolve;
      s.onerror = function () { reject(new Error('Could not reach the payment gateway. Check your connection.')); };
      document.head.appendChild(s);
    });
  }
  /* Opens Cashfree checkout for a started order. Resolves { order } when paid, { error } otherwise. */
  XPay.pay = function (start) {
    return loadSdk().then(function () {
      var cf = window.Cashfree({ mode: start.env === 'sandbox' ? 'sandbox' : 'production' });
      return cf.checkout({ paymentSessionId: start.paymentSessionId, redirectTarget: '_modal' });
    }).then(function (result) {
      if (result && result.error && !(result.paymentDetails)) return { error: (result.error.message || 'Payment was cancelled. No money moved.') };
      return XPay.confirm(start.orderId);
    }).catch(function (e) { return { error: e && e.message || 'Payment could not start.' }; });
  };
})();
