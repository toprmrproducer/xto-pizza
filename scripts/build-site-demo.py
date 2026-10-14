#!/usr/bin/env python3
"""Build the static demo bundle for GitHub Pages (docs/).

GitHub Pages is static-only, so the customer experience runs client-side:
demo-data.js embeds the menu/outlets/offers, demo-shim.js intercepts every
/api/* fetch and serves it locally (localStorage orders, coupon math, mock
Razorpay capture, and a live status progression PLACED..SERVED).
Pages: site.html (website demo), app.html (app demo), qr.html (table cards),
index.html (digital menu, built by build-digital-menu.py).
Run: python3 scripts/build-site-demo.py   (after build-digital-menu.py)
"""
import json, os, shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS = os.path.join(ROOT, 'docs')
PUB = os.path.join(ROOT, 'public')

menu = json.load(open(os.path.join(ROOT, 'data', 'menu.json')))
db = json.load(open(os.path.join(ROOT, 'data', 'db.json')))
offers = [o for o in db.get('offers', []) if o.get('active', True)]

OUTLETS = [
  {"id":"shivane","name":"XTO Pizza Shivane (Khadakwasla)","address":"NDA Rd, near Add mart, Yashwant Nagar, Shivane, Pune 411023","phone":"+91 70300 00776","hours":"11:00 am - 10:30 pm","maps":"https://maps.google.com/?q=XTO+PIZZA+Shivane+Pune"},
  {"id":"nanded","name":"XTO Pizza Nanded City","address":"Destination Centre, Shop No. F-65, Sinhagad Road, Nanded City, Pune 411068","phone":"+91 70300 00886","hours":"11:00 am - 11:00 pm","maps":"https://maps.google.com/?q=XTO+Pizza+Nanded+City+Pune"}
]

# ---- assets ----
for sub in ('css', 'js', 'vendor', 'leaflet'):
    src, dst = os.path.join(PUB, sub), os.path.join(DOCS, sub)
    if os.path.exists(dst): shutil.rmtree(dst)
    shutil.copytree(src, dst)
for f in os.listdir(os.path.join(DOCS, 'js')):
    if f.startswith('admin'): os.remove(os.path.join(DOCS, 'js', f))
for f in os.listdir(os.path.join(DOCS, 'css')):
    if f.startswith('admin'): os.remove(os.path.join(DOCS, 'css', f))

# JS copies: image paths must be relative on the Pages subpath
for f in ('site.js', 'app.js'):
    p = os.path.join(DOCS, 'js', f)
    s = open(p).read()
    s = s.replace('/images/', 'images/')
    open(p, 'w').write(s)

# Leaflet default markers live at leaflet/images/ (resolved relative to leaflet.css)
li = os.path.join(DOCS, 'leaflet', 'images')
os.makedirs(li, exist_ok=True)
for f in ('marker-icon.png', 'marker-icon-2x.png', 'marker-shadow.png'):
    src = os.path.join(DOCS, 'leaflet', f)
    if os.path.exists(src):
        shutil.move(src, os.path.join(li, f))

# ---- demo data ----
data = {
    "menu": {"categories": menu['categories'], "items": menu['items'],
             "deliveryFee": menu.get('deliveryFee', 29), "freeDeliveryAbove": menu.get('freeDeliveryAbove', 499)},
    "outlets": OUTLETS,
    "offers": offers,
    "config": {"brand": {"name": "XTO Pizza", "tagline": "Pune's Tastiest Pizza"},
               "outletsGeo": {"shivane": [18.4637, 73.8090], "nanded": [18.4572, 73.8029]}}
}
open(os.path.join(DOCS, 'demo-data.js'), 'w').write(
    'window.__XTO_DEMO__ = ' + json.dumps(data, ensure_ascii=False) + ';\n')

SHIM = r'''/* XTO demo shim: answers /api/* locally so the demo runs on any static host. */
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
'''
open(os.path.join(DOCS, 'demo-shim.js'), 'w').write(SHIM)

INJECT = ('<script src="demo-data.js"></script>\n<script src="demo-shim.js"></script>\n'
          '<style>.hide-in-demo{display:none!important}</style>\n')

import time
V = str(int(time.time()))
def bust(s):
    for pat, rep in (('js/site.js', 'js/site.js?v=' + V), ('js/app.js', 'js/app.js?v=' + V),
                     ('css/site.css', 'css/site.css?v=' + V), ('css/app.css', 'css/app.css?v=' + V),
                     ('leaflet/leaflet.css', 'leaflet/leaflet.css?v=' + V), ('leaflet/leaflet.js', 'leaflet/leaflet.js?v=' + V),
                     ('vendor/qrcode.min.js', 'vendor/qrcode.min.js?v=' + V),
                     ('demo-data.js', 'demo-data.js?v=' + V), ('demo-shim.js', 'demo-shim.js?v=' + V)):
        s = s.replace('src="' + pat + '"', 'src="' + rep + '"').replace('href="' + pat + '"', 'href="' + rep + '"')
    return s

def demotify(src, dst, extra=None):
    s = open(src).read()
    s = s.replace('href="/css/', 'href="css/').replace('src="/js/', 'src="js/')
    s = s.replace('href="/leaflet/', 'href="leaflet/').replace('src="/leaflet/', 'src="leaflet/')
    s = s.replace('src="/vendor/', 'src="vendor/')
    s = s.replace('"/images/', '"images/')
    s = s.replace('href="/app"', 'href="app.html"')
    s = s.replace('id="enableUpdatesBtn"', 'id="enableUpdatesBtn" class="hide-in-demo"')
    if '<script src="js/site.js">' in s:
        s = s.replace('<script src="js/site.js">', INJECT + '<script src="js/site.js">')
    if '<script src="js/app.js">' in s:
        s = s.replace('<script src="js/app.js">', INJECT + '<script src="js/app.js">')
    if extra: s = extra(s)
    s = bust(s)
    open(dst, 'w').write(s)
    print('wrote', dst)

demotify(os.path.join(PUB, 'index.html'), os.path.join(DOCS, 'site.html'))
demotify(os.path.join(PUB, 'app.html'), os.path.join(DOCS, 'app.html'))
demotify(os.path.join(PUB, 'qr.html'), os.path.join(DOCS, 'qr.html'))
print('demo bundle complete')
