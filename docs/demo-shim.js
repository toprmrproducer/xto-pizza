/* XTO demo shim: answers /api/* locally so the demo runs on any static host. */
(function () {
  var D = window.__XTO_DEMO__;
  var SEQ = 'xto_demo_seq', ORD = 'xto_demo_orders';
  var FLOW = ['PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'SERVED'];
  function nextId() { var n = (+localStorage.getItem(SEQ) || 1000) + 1; localStorage.setItem(SEQ, n); return 'XT-' + n; }
  function allOrders() { try { return JSON.parse(localStorage.getItem(ORD) || '[]'); } catch (e) { return []; } }
  function saveOrders(a) { localStorage.setItem(ORD, JSON.stringify(a)); }
  function advance(order) {
    var i = FLOW.indexOf(order.status);
    var tick = function () {
      if (i >= FLOW.length - 1) return;
      i++; order.status = FLOW[i];
      order.history.push({ status: FLOW[i], at: new Date().toISOString() });
      var a = allOrders(); var k = a.findIndex(function (o) { return o.id === order.id; });
      if (k > -1) { a[k] = order; saveOrders(a); }
      setTimeout(tick, 9000);
    };
    setTimeout(tick, 9000);
  }
  function ok(body, status) { return new Response(JSON.stringify(body), { status: status || 200, headers: { 'Content-Type': 'application/json' } }); }
  var real = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : ((input && input.url) || '');
    if (url.indexOf('/api/') !== 0) return real(input, init);
    var path = url.split('?')[0], qs = new URLSearchParams(url.split('?')[1] || '');
    var body = {}; try { body = (init && init.body) ? JSON.parse(init.body) : {}; } catch (e) {}
    if (path === '/api/menu') return Promise.resolve(ok({ categories: D.menu.categories, items: D.menu.items.map(function (i) { return Object.assign({}, i, { available: true }); }), deliveryFee: D.menu.deliveryFee, freeDeliveryAbove: D.menu.freeDeliveryAbove, currency: 'INR' }));
    if (path === '/api/outlets') return Promise.resolve(ok({ outlets: D.outlets }));
    if (path === '/api/config') return Promise.resolve(ok({ brand: D.config.brand, razorpay: { keyId: 'rzp_test_demo', live: false }, vapid: null, outletsGeo: D.config.outletsGeo }));
    if (path === '/api/offers') return Promise.resolve(ok({ offers: D.offers }));
    if (path === '/api/coupon/validate') {
      var t = Math.round(+body.itemTotal || 0);
      var code = String(body.code || '').trim().toUpperCase();
      var o = D.offers.find(function (x) { return x.code.toUpperCase() === code; });
      if (!o) return Promise.resolve(ok({ error: 'Invalid or expired coupon code' }, 400));
      if (o.minOrder && t < o.minOrder) return Promise.resolve(ok({ error: 'Add Rs ' + (o.minOrder - t) + ' more to use ' + o.code }, 400));
      var d = o.type === 'percent' ? Math.min(t, Math.round(t * o.value / 100)) : Math.min(t, o.value);
      return Promise.resolve(ok({ code: o.code, discount: d }));
    }
    if (path === '/api/pay/intent') return Promise.resolve(ok({ live: false, keyId: 'rzp_test_demo', gatewayOrderId: 'order_demo_' + Math.random().toString(16).slice(2, 10), paymentId: 'pay_demo_' + Math.random().toString(16).slice(2, 10), amount: Math.round(body.amount) }));
    if (path === '/api/pay/capture') return Promise.resolve(ok({ paid: true, paymentId: 'pay_demo_ok' }));
    if (path === '/api/orders' && init && init.method === 'POST') {
      var c = body.customer || {};
      if (!c.name || String(c.name).trim().length < 2) return Promise.resolve(ok({ error: 'Name required' }, 400));
      if (!/^[6-9]\d{9}$/.test(String(c.phone || '').replace(/\D/g, '').slice(-10))) return Promise.resolve(ok({ error: 'Valid 10-digit phone required' }, 400));
      var mode = body.mode === 'dinein' ? 'dinein' : 'takeaway';
      if (mode === 'dinein' && !String(c.tableNumber || '').trim()) return Promise.resolve(ok({ error: 'Table number required for dine-in' }, 400));
      if (!body.payment || body.payment.status !== 'paid') return Promise.resolve(ok({ error: 'Payment not completed' }, 402));
      var itemTotal = 0;
      var lines = (body.items || []).map(function (l) {
        var it = D.menu.items.find(function (i) { return i.id === l.id; });
        var q = Math.max(1, Math.min(20, +l.qty || 1));
        itemTotal += it.price * q;
        return { id: it.id, name: it.name, price: it.price, qty: q };
      });
      if (!lines.length) return Promise.resolve(ok({ error: 'Empty cart' }, 400));
      var coupon = null;
      if (body.couponCode) {
        var off = D.offers.find(function (x) { return x.code.toUpperCase() === String(body.couponCode).toUpperCase(); });
        if (off && (!off.minOrder || itemTotal >= off.minOrder)) {
          var dd = off.type === 'percent' ? Math.round(itemTotal * off.value / 100) : off.value;
          coupon = { code: off.code, discount: Math.min(dd, itemTotal) };
        }
      }
      var order = { id: nextId(), createdAt: new Date().toISOString(), status: 'PLACED', mode: mode, outlet: body.outlet,
        customer: { name: String(c.name).trim(), phone: String(c.phone).replace(/\D/g, '').slice(-10), tableNumber: String(c.tableNumber || '').trim() },
        items: lines, itemTotal: itemTotal, deliveryFee: 0, coupon: coupon, total: itemTotal - (coupon ? coupon.discount : 0),
        payment: { method: 'razorpay', status: 'paid', paymentId: body.payment.paymentId || 'pay_demo' },
        rider: null, etaMin: mode === 'dinein' ? 20 : 15, history: [{ status: 'PLACED', at: new Date().toISOString() }] };
      var a = allOrders(); a.unshift(order); saveOrders(a);
      advance(order);
      return Promise.resolve(ok({ ok: true, order: order }, 201));
    }
    if (path === '/api/orders' && qs.get('phone')) {
      var ph = qs.get('phone').replace(/\D/g, '').slice(-10);
      return Promise.resolve(ok({ orders: allOrders().filter(function (o) { return o.customer.phone === ph; }) }));
    }
    var om = path.match(/^\/api\/orders\/(.+)$/);
    if (om) {
      var found = allOrders().find(function (o) { return o.id.toUpperCase() === om[1].toUpperCase(); });
      return Promise.resolve(found ? ok({ order: found }) : ok({ error: 'Order not found' }, 404));
    }
    if (path === '/api/track/rider') return Promise.resolve(ok({ rider: null }));
    return Promise.resolve(ok({ error: 'No route' }, 404));
  };
})();
