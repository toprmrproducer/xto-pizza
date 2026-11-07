#!/usr/bin/env node
/**
 * XTO Pizza: one server for the website, the iOS/Android PWA app and the
 * Central Administrative System (CES). Zero npm dependencies.
 *
 * Run:  node server.js   (or: bash run.sh)
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA = path.join(ROOT, 'data');
const PORT = process.env.PORT || 7788;

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------
function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { return fallback; }
}
function writeJSON(file, obj) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, file);
}

const menu = readJSON(path.join(DATA, 'menu.json'), { categories: [], items: [] });
const config = readJSON(path.join(DATA, 'config.json'), {});
config.adminPin = config.adminPin || '4321';
config.brand = config.brand || { name: 'XTO Pizza', tagline: "Pune's Tastiest Pizza" };
config.razorpay = Object.assign({
  // Mock checkout by default. To go live later: set env RAZORPAY_LIVE=1 and
  // RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET, then restart. No code changes.
  keyId: process.env.RAZORPAY_KEY_ID || 'rzp_test_xto_mock_1xAa2Bb3Cc4Dd5',
  live: false
}, config.razorpay || {});
config.razorpay.live = (process.env.RAZORPAY_LIVE === '1') && !!process.env.RAZORPAY_KEY_SECRET;
let db = readJSON(path.join(DATA, 'db.json'), { orderSeq: 1000, orders: [], payments: {}, riders: [], unavailable: [] });
db.riders = db.riders || []; db.offers = db.offers || []; db.pushSubs = db.pushSubs || []; db.riderPos = db.riderPos || {}; db.sim = db.sim || {}; db.riderSeq = db.riderSeq || 0; db.enquiries = db.enquiries || []; db.enquirySeq = db.enquirySeq || 0;

function saveDb() { writeJSON(path.join(DATA, 'db.json'), db); }

// ---------------------------------------------------------------------------
// Admin-editable store settings (delivery fee, radius, minimum order)
// ---------------------------------------------------------------------------
const DEFAULT_SETTINGS = { outletsOpen: { shivane: false, nanded: true }, deliveryEnabled: true, deliveryFee: 40, freeDeliveryAbove: 0, deliveryRadiusKm: 5, minOrderValue: 0, minOrderDelivery: 199 };
db.settings = Object.assign({}, DEFAULT_SETTINGS, db.settings || {});
db.settings.outletsOpen = Object.assign({}, DEFAULT_SETTINGS.outletsOpen, db.settings.outletsOpen || {});
function posStoreOff(id) { const o = (db.settings.posStoreOff || {})[id]; if (!o) return false; if (o.until && Date.now() >= o.until) { delete db.settings.posStoreOff[id]; saveDb(); return false; } return true; }
function outletOpen(id) { return db.settings.outletsOpen[id] !== false && !posStoreOff(id); }
db.pending = db.pending || {};
function num(x, lo, hi, dflt) { const n = Number(x); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt; }
function sanitizeSettings(b) {
  const s = db.settings;
  const oo = Object.assign({}, s.outletsOpen);
  if (b.outletsOpen && typeof b.outletsOpen === 'object') for (const id of Object.keys(oo)) if (b.outletsOpen[id] !== undefined) oo[id] = !!b.outletsOpen[id];
  if (!Object.values(oo).some(Boolean)) Object.assign(oo, s.outletsOpen); // never close every outlet
  return {
    outletsOpen: oo,
    deliveryEnabled: b.deliveryEnabled === undefined ? s.deliveryEnabled : !!b.deliveryEnabled,
    deliveryFee: Math.round(num(b.deliveryFee, 0, 500, s.deliveryFee)),
    freeDeliveryAbove: Math.round(num(b.freeDeliveryAbove, 0, 10000, s.freeDeliveryAbove)),
    deliveryRadiusKm: Math.round(num(b.deliveryRadiusKm, 0.5, 50, s.deliveryRadiusKm) * 10) / 10,
    minOrderValue: Math.round(num(b.minOrderValue, 0, 10000, s.minOrderValue)),
    minOrderDelivery: Math.round(num(b.minOrderDelivery, 0, 10000, s.minOrderDelivery))
  };
}
function distanceKm(a, b) {
  const R = 6371, rad = (d) => d * Math.PI / 180;
  const dLat = rad(b[0] - a[0]), dLng = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// ---------------------------------------------------------------------------
// Cashfree Payment Gateway. Keys come from env (never from the repo):
//   CASHFREE_APP_ID, CASHFREE_SECRET_KEY, CASHFREE_ENV=production|sandbox
// Without keys, checkout is closed unless ALLOW_MOCK_PAY=1 (local demos only).
// ---------------------------------------------------------------------------
const cashfree = {
  appId: process.env.CASHFREE_APP_ID || '',
  secret: process.env.CASHFREE_SECRET_KEY || '',
  env: process.env.CASHFREE_ENV === 'sandbox' ? 'sandbox' : 'production',
  get configured() { return !!(this.appId && this.secret); },
  get base() { return process.env.CASHFREE_API_BASE || (this.env === 'sandbox' ? 'https://sandbox.cashfree.com/pg' : 'https://api.cashfree.com/pg'); }
};
const ALLOW_MOCK_PAY = process.env.ALLOW_MOCK_PAY === '1';
if (process.env.NODE_ENV === "production" && ALLOW_MOCK_PAY) throw new Error("Mock payments are not allowed in production");
function cfFetch(pth, opts) {
  return fetch(cashfree.base + pth, Object.assign({
    headers: { 'x-client-id': cashfree.appId, 'x-client-secret': cashfree.secret, 'x-api-version': '2023-08-01', 'Content-Type': 'application/json' }
  }, opts || {}));
}
function paymentsInfo() { return { provider: cashfree.configured ? 'cashfree' : (ALLOW_MOCK_PAY ? 'mock' : 'none'), configured: cashfree.configured, env: cashfree.env }; }

const outlets = [
  {
    id: 'shivane',
    name: 'XTO Pizza Shivane (Khadakwasla)',
    address: 'NDA Rd, near Add mart, Yashwant Nagar, Deshmukh Nagar, Shivane, Pune, Maharashtra 411023',
    phone: '+91 70300 00776',
    hours: '11:00 am - 10:30 pm',
    maps: 'https://maps.google.com/?q=XTO+PIZZA+Shivane+Pune'
  },
  {
    id: 'nanded',
    name: 'XTO Pizza Nanded City',
    address: 'Destination Centre, Shop No. F-65, Sinhagad Road, Nanded City, Pune, Maharashtra 411068',
    phone: '+91 70300 00886',
    hours: '11:00 am - 11:00 pm',
    maps: 'https://maps.google.com/?q=XTO+Pizza+Nanded+City+Pune'
  }
];

const STATUS_FLOW = ['PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'SERVED'];
const DELIVERY_FLOW = ['PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED']; // sit-down and takeaway only: SERVED covers both

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch (e) { resolve({}); }
    });
  });
}
function todayKey(d) {
  const dt = d || new Date();
  return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
}
function isToday(isoLike) {
  // Seeds use "TODAY HH:MM:SS"; live orders store ISO strings.
  if (typeof isoLike === 'string' && isoLike.startsWith('TODAY')) return true;
  try { return todayKey(new Date(isoLike)) === todayKey(); } catch (e) { return false; }
}
function itemById(id) { return menu.items.find((i) => i.id === id) || null; }
function isAvailable(id) { return !db.unavailable.includes(id); }

function priceOrder(lines) {
  let itemTotal = 0;
  const items = [];
  for (const line of lines) {
    const mi = itemById(line.id);
    if (!mi) return { error: 'Unknown item: ' + line.id };
    if (!isAvailable(mi.id)) return { error: 'Item unavailable: ' + mi.name };
    const qty = Math.max(1, Math.min(20, parseInt(line.qty, 10) || 1));
    // size add-ons (extra cheese, cheese burst...) priced per size from the menu card
    const ids = Array.isArray(line.addons) ? Array.from(new Set(line.addons.map(String))) : [];
    let unit = mi.price;
    const names = [];
    for (const aid of ids) {
      const ad = (menu.addons || []).find((a) => a.id === aid);
      const add = ad && mi.size && ad.prices ? Number(ad.prices[mi.size]) : 0;
      if (!ad || !add) return { error: 'Add-on not available for ' + mi.name + ': ' + aid };
      unit += add;
      names.push(ad.name);
    }
    itemTotal += unit * qty;
    items.push({ id: mi.id, name: names.length ? mi.name + ' + ' + names.join(', ') : mi.name, price: unit, qty, addons: ids, addonNames: names });
  }
  if (!items.length) return { error: 'Empty cart' };
  return { items, itemTotal, deliveryFee: 0, total: itemTotal };
}
function publicOrder(o) {
  return {
    id: o.id, createdAt: o.createdAt, status: o.status, mode: o.mode, outlet: o.outlet,
    customer: { name: o.customer.name, phone: o.customer.phone, tableNumber: o.customer.tableNumber || null },
    items: o.items, itemTotal: o.itemTotal, deliveryFee: o.deliveryFee, coupon: o.coupon || null, total: o.total,
    payment: o.payment, rider: o.rider || null, history: o.history, etaMin: o.etaMin || null, address: o.address ? { line: o.address.line, landmark: o.address.landmark } : null
  };
}
function adminOrder(o) {
  return Object.assign({}, o, { customer: o.customer });
}

// ---------------------------------------------------------------------------
// SSE (live order feed for the CES)
// ---------------------------------------------------------------------------
const sseClients = new Set();
function sseHandler(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.write('retry: 2000\n\n');
  sseClients.add(res);
  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch (e) {} }, 25000);
  req.on('close', () => { clearInterval(ping); sseClients.delete(res); });
}
function broadcast(event, data) {
  const payload = 'event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n';
  for (const res of sseClients) { try { res.write(payload); } catch (e) {} }
}

// ---------------------------------------------------------------------------
// Mock Razorpay engine (real-gateway seam below)
// ---------------------------------------------------------------------------
function createPaymentIntent(amountPaise, receipt) {
  const rzp = config.razorpay;
  if (rzp.live) {
    // REAL RAZORPAY PATH: standard Orders API call with basic auth.
    return fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(rzp.keyId + ':' + process.env.RAZORPAY_KEY_SECRET).toString('base64'),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ amount: amountPaise, currency: 'INR', receipt })
    })
      .then((r) => r.json())
      .then((ord) => ({ live: true, keyId: rzp.keyId, gatewayOrderId: ord.id, amount: amountPaise }));
  }
  const gid = 'order_mock_' + crypto.randomBytes(6).toString('hex');
  const pid = 'pay_mock_' + crypto.randomBytes(6).toString('hex');
  db.payments[gid] = { id: pid, amount: amountPaise, receipt, status: 'created', createdAt: new Date().toISOString() };
  return Promise.resolve({ live: false, keyId: rzp.keyId, gatewayOrderId: gid, paymentId: pid, amount: amountPaise });
}
function captureMockPayment(gatewayOrderId) {
  const p = db.payments[gatewayOrderId];
  if (!p) return null;
  p.status = 'paid';
  p.paidAt = new Date().toISOString();
  return p;
}
function verifyLiveCapture(body) {
  const secret = process.env.RAZORPAY_KEY_SECRET;
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = body;
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) return null;
  const expected = crypto.createHmac('sha256', secret).update(razorpay_order_id + '|' + razorpay_payment_id).digest('hex');
  const got = String(razorpay_signature);
  if (got.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(got))) return null;
  return { paid: true, paymentId: razorpay_payment_id, gatewayOrderId: razorpay_order_id };
}

// ---------------------------------------------------------------------------
// Petpooja POS (Online Ordering API v2.1.0): see petpooja.js. Env in /opt/xto-pizza/petpooja.env on the server.
// ---------------------------------------------------------------------------
// where an order came from: the website, or the app (Android / iOS / installed web app)
function orderSource(body, req) {
  const ua = String((req && req.headers && req.headers['user-agent']) || '');
  const channel = body && body.source === 'app' ? 'app' : 'website';
  let platform = 'web';
  if (/Android/i.test(ua)) platform = 'android';
  else if (/iPhone|iPad|iPod/i.test(ua)) platform = 'ios';
  const label = channel === 'website'
    ? 'This purchase came from the website'
    : 'This purchase came from the ' + (platform === 'android' ? 'Android app' : platform === 'ios' ? 'iOS app' : 'app (web)');
  return { channel, platform, label };
}
const auth = require('./auth')({ DATA, readJSON, writeJSON, db, saveDb });
const pp = require('./petpooja')({ DATA, readJSON, writeJSON, db, saveDb, broadcast, menu, outlets, pushTarget, storeOpen: (id) => outletOpen(id) });
const accessSecret = readJSON(path.join(DATA, "auth-secret.json"), {}).s;
function readAccess(req, name) {
  try {
    const cookie = String(req.headers.cookie || "").split(";").map((entry) => entry.trim()).find((entry) => entry.startsWith(name + "="));
    if (!cookie) return null;
    const [encoded, signature] = cookie.slice(name.length + 1).split(".");
    const expected = crypto.createHmac("sha256", accessSecret).update(name + ":" + encoded).digest("base64url");
    if (!signature || signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString());
    return payload.exp > Date.now() ? payload : null;
  } catch (error) { return null; }
}
function setAccess(req, res, name, payload, seconds) {
  const encoded = Buffer.from(JSON.stringify(Object.assign({}, payload, { exp: Date.now() + seconds * 1000 }))).toString("base64url");
  const signature = crypto.createHmac("sha256", accessSecret).update(name + ":" + encoded).digest("base64url");
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", name + "=" + encoded + "." + signature + "; Path=/; HttpOnly; SameSite=Strict; Max-Age=" + seconds + secure);
}
function canReadOrder(req, order) {
  const who = auth.fromReq(req);
  if (who && who.phone === order.customer.phone) return true;
  const access = readAccess(req, "xto_orders");
  return !!(access && Array.isArray(access.orders) && order.payment && access.orders.includes(order.payment.gatewayOrderId));
}

// ---------------------------------------------------------------------------
// Web Push: VAPID (RFC 8292) + aes128gcm payload encryption (RFC 8291), zero deps.
// Keys live in data/vapid.json. Subscriptions in db.pushSubs.
// ---------------------------------------------------------------------------
const B64U = (buf) => Buffer.from(buf).toString('base64url');
const b64uJson = (o) => B64U(Buffer.from(JSON.stringify(o)));
const b64uBuf = (s) => Buffer.from(String(s), 'base64url');
const EC_PARAMS = Buffer.from('3059301306072a8648ce3d020106082a8648ce3d030107034200', 'hex');
// PKCS8 EC PrivateKeyInfo: version 0, algid ecPublicKey/prime256v1, SEC1 key with pub
const PKCS8_HEAD = Buffer.from('308187020100301306072a8648ce3d020106082a8648ce3d030107046d306b0201010420', 'hex');
const PKCS8_MID = Buffer.from('a144034200', 'hex');

function ensureVapid() {
  const file = path.join(DATA, 'vapid.json');
  let v = readJSON(file, null);
  if (v && v.d && v.pub) return v;
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  v = { d: B64U(ecdh.getPrivateKey()), pub: B64U(ecdh.getPublicKey(null, 'uncompressed')) };
  writeJSON(file, v);
  return v;
}
const vapid = ensureVapid();
function vapidPrivKeyObj() { return crypto.createPrivateKey({ key: Buffer.concat([PKCS8_HEAD, b64uBuf(vapid.d), PKCS8_MID, b64uBuf(vapid.pub)]), format: 'der', type: 'pkcs8' }); }
function pubKeyObj(raw) { return crypto.createPublicKey({ key: Buffer.concat([EC_PARAMS, raw]), format: 'der', type: 'spki' }); }
function derSigToP1363(sig) {
  let r = sig.slice(4, 4 + sig[3]);
  let s = sig.slice(6 + sig[3], 6 + sig[3] + sig[5 + sig[3]]);
  if (r.length > 32 && r[0] === 0) r = r.slice(1);
  if (s.length > 32 && s[0] === 0) s = s.slice(1);
  const pad = (b) => Buffer.concat([Buffer.alloc(32 - b.length), b]);
  return Buffer.concat([pad(r), pad(s)]);
}
function hkdf(ikm, salt, info, len) { return Buffer.from(crypto.hkdfSync('sha256', ikm, salt, info, len)); }

function vapidAuthHeader(endpoint) {
  const origin = new URL(endpoint).origin;
  const now = Math.floor(Date.now() / 1000);
  const head = b64uJson({ typ: 'JWT', alg: 'ES256' });
  const body = b64uJson({ aud: origin, exp: now + 43200, sub: 'mailto:shreyas@rapid-xai.com' });
  const unsigned = head + '.' + body;
  const sig = derSigToP1363(crypto.sign('sha256', Buffer.from(unsigned), vapidPrivKeyObj()));
  return 'vapid t=' + unsigned + '.' + B64U(sig) + ', k=' + vapid.pub;
}
function encryptPush(payload, sub) {
  const clientPub = b64uBuf(sub.keys.p256dh);
  const authSecret = b64uBuf(sub.keys.auth);
  const ecdh = crypto.diffieHellman({ privateKey: vapidPrivKeyObj(), publicKey: pubKeyObj(clientPub) });
  const serverPub = b64uBuf(vapid.pub);
  const ikm = hkdf(ecdh, Buffer.alloc(32), Buffer.concat([Buffer.from('WebPush: info\0'), clientPub, serverPub]), 32);
  const salt = crypto.randomBytes(16);
  const cek = hkdf(ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12);
  const plain = Buffer.concat([Buffer.from(JSON.stringify(payload)), Buffer.from([2])]);
  const c = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const ct = Buffer.concat([c.update(plain), c.final()]);
  const cipher = Buffer.concat([ct, c.getAuthTag()]); // record = ciphertext + 16-byte GCM tag (RFC 8188)
  const rs = Buffer.alloc(4); rs.writeUInt32BE(plain.length + 16);
  const head = Buffer.concat([salt, rs, Buffer.from([65]), serverPub]);
  return Buffer.concat([head, cipher]);
}
async function sendPush(sub, payload) {
  const body = encryptPush(payload, sub);
  const r = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      TTL: '3600', Urgency: 'high',
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      Authorization: vapidAuthHeader(sub.endpoint)
    },
    body
  });
  return r.status; // 201/200 delivered, 404/410 gone
}
function pushTarget(phone, payload) {
  const subs = (db.pushSubs || []).filter((s) => !phone || s.phone === phone);
  return Promise.all(subs.map(async (s) => {
    try {
      const status = await sendPush(s, payload);
      if (status === 404 || status === 410) db.pushSubs = db.pushSubs.filter((x) => x !== s);
      saveDb();
      return status;
    } catch (e) { return String(e.message || e); }
  }));
}

// ---------------------------------------------------------------------------
// Offers: percent or flat rupees off, minimum order, active toggle.
// ---------------------------------------------------------------------------
function findOffer(code) {
  const c = String(code || '').trim().toUpperCase();
  return (db.offers || []).find((o) => o.code.toUpperCase() === c && o.active !== false) || null;
}
function applyCoupon(itemTotal, offer) {
  if (!offer) return { error: 'Invalid or expired coupon code' };
  if (offer.minOrder && itemTotal < offer.minOrder) return { error: 'Add ' + INR(offer.minOrder - itemTotal) + ' more to use ' + offer.code };
  const discount = offer.type === 'percent' ? Math.min(itemTotal, Math.round(itemTotal * offer.value / 100)) : Math.min(itemTotal, offer.value);
  return { code: offer.code, discount };
}
function INR(n) { return '\u20B9' + Number(n || 0).toLocaleString('en-IN'); }

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Riders: managed in admin, live GPS from the /rider page, or demo simulation.
// Coordinates: Shivane outlet 18.4637,73.8090 / Nanded City 18.4572,73.8029 (approx).
// ---------------------------------------------------------------------------
const RIDER_HOME = { shivane: [18.4637, 73.8090], nanded: [18.4572, 73.8029] };
function riderState() { db.riderPos = db.riderPos || {}; return db.riderPos; }
function setRiderPos(id, lat, lng, orderId) {
  riderState()[id] = { lat, lng, at: new Date().toISOString(), orderId: orderId || null };
}
setInterval(() => {
  const sim = db.sim || {};
  let moved = false;
  for (const [id, s] of Object.entries(sim)) {
    if (!s.to) continue;
    const pos = riderState()[id] || { lat: s.from[0], lng: s.from[1] };
    const dLat = s.to[0] - pos.lat, dLng = s.to[1] - pos.lng;
    const dist = Math.hypot(dLat, dLng);
    if (dist < 0.0004) { delete sim[id].to; continue; }
    const step = 0.0009; // ~100 m tick, city speeds
    setRiderPos(id, pos.lat + dLat / dist * Math.min(step, dist), pos.lng + dLng / dist * Math.min(step, dist), s.orderId);
    moved = true;
  }
  if (moved) broadcast('rider:pos', riderState());
}, 3000);

const MIME = {
  '.xml': 'application/xml; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp', '.woff2': 'font/woff2'
};
const BUILD_ID = Date.now().toString(36); // changes on every deploy; stamped into css/js URLs so they can be cached for a year
const ASSET_RE = /(href|src)="(\/(?:css|js|leaflet|vendor)\/[^"?#]+)"/g;
function serveFile(res, absPath, status) {
  const req = res.req;
  const ext = path.extname(absPath).toLowerCase();
  const rel = path.relative(PUBLIC, absPath).split(path.sep).join('/');
  // modern browsers get the smaller .webp twin of a photo at the same URL
  let file = absPath, type = MIME[ext] || 'application/octet-stream', vary = null;
  if ((ext === '.jpg' || ext === '.jpeg') && rel.startsWith('images/')) {
    vary = 'Accept';
    const accept = String((req && req.headers.accept) || '');
    const wp = absPath.replace(/\.jpe?g$/i, '.webp');
    if (/image\/webp/.test(accept) && fs.existsSync(wp)) { file = wp; type = 'image/webp'; }
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { json(res, 404, { error: 'Not found' }); return; }
    const headers = { 'Content-Type': type };
    if (vary) headers.Vary = vary;
    if (ext === '.html') {
      fs.readFile(file, 'utf8', (e2, txt) => {
        if (e2) { json(res, 404, { error: 'Not found' }); return; }
        const body = Buffer.from(txt.replace(ASSET_RE, '$1="$2?v=' + BUILD_ID + '"'));
        const etag = 'W/"' + crypto.createHash('md5').update(body).digest('hex').slice(0, 16) + '"';
        headers.ETag = etag; headers['Cache-Control'] = 'no-cache';
        if (req && req.headers['if-none-match'] === etag) { res.writeHead(304, headers); return res.end(); }
        res.writeHead(status || 200, headers); res.end(body);
      });
      return;
    }
    const etag = 'W/"' + st.size.toString(16) + '-' + Math.floor(st.mtimeMs).toString(16) + '"';
    headers.ETag = etag; headers['Last-Modified'] = st.mtime.toUTCString();
    if (/^(css|js|leaflet|vendor)\//.test(rel)) headers['Cache-Control'] = 'public, max-age=31536000, immutable'; // URLs carry ?v=BUILD_ID
    else if (rel.startsWith('images/')) headers['Cache-Control'] = 'public, max-age=604800, stale-while-revalidate=86400';
    else if (rel === 'sw.js') headers['Cache-Control'] = 'no-cache';
    else headers['Cache-Control'] = 'public, max-age=3600';
    if (req && req.headers['if-none-match'] === etag) { res.writeHead(304, headers); return res.end(); }
    fs.readFile(file, (e3, buf) => {
      if (e3) { json(res, 404, { error: 'Not found' }); return; }
      res.writeHead(status || 200, headers); res.end(buf);
    });
  });
}
function jsonCached(res, code, obj, maxAge) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=' + maxAge + ', stale-while-revalidate=60' });
  res.end(JSON.stringify(obj));
}


function readRaw(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => resolve(data));
  });
}
function buildDraft(body, req) {
  const mode = ['dinein', 'takeaway', 'delivery'].includes(body.mode) ? body.mode : null;
  if (!mode) return { error: 'Choose dine-in, takeaway or delivery' };
  const outlet = outlets.find((o) => o.id === body.outlet);
  if (!outlet) return { error: 'Choose an outlet' };
  if (!outletOpen(outlet.id)) return { error: outlet.name + ' is not taking online orders right now. Please choose another outlet.' };
  const c = body.customer || {};
  const name = String(c.name || '').trim();
  const phone = String(c.phone || '').replace(/\D/g, '').slice(-10);
  if (name.length < 2) return { error: 'Name required' };
  if (!/^[6-9]\d{9}$/.test(phone)) return { error: 'Valid 10-digit phone required' };
  if (mode === 'dinein' && !String(c.tableNumber || '').trim()) return { error: 'Table number required for dine-in' };
  const priced = priceOrder(body.items || []);
  if (priced.error) return { error: priced.error };
  const S = db.settings;
  if (S.minOrderValue && priced.itemTotal < S.minOrderValue) return { error: 'Minimum order is Rs ' + S.minOrderValue + '. Add a little more to continue.' };
  let coupon = null;
  if (body.couponCode) {
    const cp = applyCoupon(priced.itemTotal, findOffer(body.couponCode));
    if (cp.error) return { error: cp.error };
    coupon = { code: cp.code, discount: cp.discount };
  }
  let deliveryFee = 0, address = null;
  if (mode === 'delivery') {
    if (!S.deliveryEnabled) return { error: 'Delivery is not available right now. Choose takeaway or dine-in.' };
    if (priced.itemTotal < S.minOrderDelivery) return { error: 'Minimum order for delivery is Rs ' + S.minOrderDelivery + '.' };
    const a = body.address || {};
    const line = String(a.line || '').trim().slice(0, 240), landmark = String(a.landmark || '').trim().slice(0, 120);
    const lat = Number(a.lat), lng = Number(a.lng);
    if (line.length < 8) return { error: 'Please enter your full delivery address.' };
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return { error: 'Please tap "Use my location" so we can check the delivery distance.' };
    const geo = RIDER_HOME[outlet.id] || RIDER_HOME.shivane;
    const d = distanceKm(geo, [lat, lng]);
    if (d > S.deliveryRadiusKm) return { error: outlet.name + ' delivers within ' + S.deliveryRadiusKm + ' km. Your location is ' + d.toFixed(1) + ' km away.' };
    deliveryFee = (S.freeDeliveryAbove > 0 && priced.itemTotal >= S.freeDeliveryAbove) ? 0 : S.deliveryFee;
    address = { line, landmark, lat, lng, distanceKm: Math.round(d * 10) / 10 };
  }
  const total = priced.itemTotal - (coupon ? coupon.discount : 0) + deliveryFee;
  if (total < 1) return { error: 'Invalid total' };
  return { draft: { mode, outlet: outlet.id, customer: { name, phone, tableNumber: String(c.tableNumber || '').trim() }, items: priced.items, itemTotal: priced.itemTotal, deliveryFee, coupon, total, address, source: orderSource(body, req) } };
}
// Turn a paid pending checkout into a real order. Idempotent: webhook and browser can both call it.
async function settlePending(orderId) {
  const existing = db.orders.find((o) => o.payment && o.payment.gatewayOrderId === orderId);
  if (existing) return { order: existing };
  const pend = db.pending[orderId];
  if (!pend) return { error: 'Unknown order', status: 404 };
  const d = pend.draft;
  let paymentId;
  if (cashfree.configured) {
    let j;
    try { const r = await cfFetch('/orders/' + encodeURIComponent(orderId)); j = await r.json(); if (!r.ok) return { error: 'Could not verify payment', status: 502 }; }
    catch (e) { return { error: 'Could not reach the payment gateway', status: 502 }; }
    if (j.order_status !== 'PAID') return { pending: true, status: j.order_status };
    if (Math.abs(Number(j.order_amount) - d.total) > 0.01) return { error: 'Paid amount does not match the order', status: 409 };
    paymentId = orderId;
    try {
      const pr = await cfFetch('/orders/' + encodeURIComponent(orderId) + '/payments'); const pj = await pr.json();
      const ok = Array.isArray(pj) ? pj.find((x) => x.payment_status === 'SUCCESS') : null;
      if (ok && ok.cf_payment_id) paymentId = String(ok.cf_payment_id);
    } catch (e) {}
  } else if (ALLOW_MOCK_PAY && pend.mockPaid) {
    paymentId = 'pay_mock_' + crypto.randomBytes(5).toString('hex');
  } else {
    return { pending: true, status: 'PENDING' };
  }
  const again = db.orders.find((o) => o.payment && o.payment.gatewayOrderId === orderId); // another call may have finished while we awaited
  if (again) return { order: again };
  db.orderSeq += 1;
  const order = {
    id: 'XT-' + db.orderSeq, createdAt: new Date().toISOString(), status: 'PLACED',
    mode: d.mode, outlet: d.outlet, customer: d.customer, items: d.items, itemTotal: d.itemTotal, deliveryFee: d.deliveryFee,
    coupon: d.coupon, total: d.total, address: d.address || null,
    payment: { method: cashfree.configured ? 'cashfree' : 'mock', status: 'paid', paymentId, gatewayOrderId: orderId },
    source: d.source, rider: null, posMenuReceivedAt: d.posMenuReceivedAt || null, pos: { status: "queued" },
    etaMin: d.mode === 'delivery' ? 40 : d.mode === 'dinein' ? 20 : 15,
    history: [{ status: 'PLACED', at: new Date().toISOString() }]
  };
  db.orders.unshift(order);
  delete db.pending[orderId];
  saveDb();
  broadcast('order:new', adminOrder(order));
  pp.pushOrder(order).catch((e) => console.error("petpooja push", e));
  return { order };
}

async function handleRequest(req, res) {
  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch (e) { res.writeHead(400); res.end('Bad request'); return; }
  const p = url.pathname;
  const method = req.method;

  // ---- subdomain routing (xtopizza.in): menu./shivane./nanded. = live digital menu, admin. = CES ----
  const hostName = String(req.headers.host || '').split(':')[0].toLowerCase();
  const onXto = hostName.endsWith('.xtopizza.in');
  const sub = onXto ? hostName.slice(0, -'.xtopizza.in'.length) : '';
  if (method === 'GET' && ['shivane', 'nanded'].includes(sub) && !outletOpen(sub)) {
    const to = ['nanded', 'shivane'].find((id) => outletOpen(id)) || 'menu';
    res.writeHead(302, { Location: 'https://' + to + '.xtopizza.in' + req.url });
    return res.end();
  }
  if (method === 'GET' && (p === '/' || p === '/index.html')) {
    if (['menu', 'shivane', 'nanded'].includes(sub)) return serveFile(res, path.join(PUBLIC, 'menu.html'));
    if (sub === 'admin') return serveFile(res, path.join(PUBLIC, 'admin.html'));
  }
  if (method === 'GET' && p === '/menu') return serveFile(res, path.join(PUBLIC, 'menu.html'));
  // the admin page lives on admin.xtopizza.in only (apex and other hosts do not expose it)
  if (method === 'GET' && (hostName === 'xtopizza.in' || (onXto && sub !== 'admin')) && (p === '/admin' || p === '/rider')) return json(res, 404, { error: 'Not found' });

  // ---- Petpooja webhooks (called by Petpooja). One base URL, fixed names, so the sandbox "Base URL + endpoint" setup works:
  //   https://xtopizza.in/api/petpooja/{pushmenu|item_stock|item_stock_off|get_store_status|update_store_status|callback}
  // Auth token accepted three ways: header X-XTO-Token (or Authorization: Bearer), ?t= query, or /menu/<token> path (legacy).
  if (method === 'POST' && p.startsWith('/api/petpooja/')) {
    const parts = p.split('/');
    const name = parts[3] || '';
    const hdr = String(req.headers['x-xto-token'] || '').trim() || String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    const tok = hdr || url.searchParams.get('t') || parts[4] || '';
    const body = await readBody(req);
    if (['pushmenu', 'pushmenu_endpoint', 'menu'].includes(name)) {
      if (!pp.cfg.pushToken || tok !== pp.cfg.pushToken) {
        pp.log({ type: "menu-auth", status: "rejected", endpoint: name, tokenProvided: !!tok });
        return json(res, 401, { success: "0", message: "Unauthorized" });
      }
      const result = pp.handleMenuPush(body);
      return json(res, result.http_code || 200, result);
    }
    if (['item_stock', 'item_stock_off', 'get_store_status', 'update_store_status', 'callback'].includes(name)) {
      const fn = name.startsWith('item_stock') ? pp.handleStock : name === 'get_store_status' ? pp.handleStoreGet : name === 'update_store_status' ? pp.handleStoreSet : pp.handleCallback;
      const out = fn(body, tok);
      return json(res, out.code, out.json);
    }
  }

  // ---- static & pages -----------------------------------------------------
  if (method === 'GET') {
    if (p === '/' || p === '/index.html') return serveFile(res, path.join(PUBLIC, 'index.html'));
    if (p === '/app') return serveFile(res, path.join(PUBLIC, 'app.html'));
    if (p === '/admin') return serveFile(res, path.join(PUBLIC, 'admin.html'));
    if (p === '/qr') return serveFile(res, path.join(PUBLIC, 'qr.html'));
    if (p === '/rider') return serveFile(res, path.join(PUBLIC, 'rider.html'));
    if (p === '/franchise') return serveFile(res, path.join(PUBLIC, 'franchise.html'));
    if (p === '/careers') return serveFile(res, path.join(PUBLIC, 'careers.html'));
    if (p === '/contact') return serveFile(res, path.join(PUBLIC, 'contact.html'));
    if (p === '/privacy') return serveFile(res, path.join(PUBLIC, 'privacy.html'));
    if (p === '/terms') return serveFile(res, path.join(PUBLIC, 'terms.html'));
    if (p === '/delete-data') return serveFile(res, path.join(PUBLIC, 'delete-data.html'));
    if (p === '/blog' || p === '/blog/') return serveFile(res, path.join(PUBLIC, 'blog', 'index.html'));
    if (/^\/blog\/[a-z0-9-]+$/.test(p)) return serveFile(res, path.join(PUBLIC, 'blog', p.slice(6) + '.html'));
    if (p === '/sitemap.xml') return serveFile(res, path.join(PUBLIC, 'sitemap.xml'));
    if (p === '/robots.txt') return serveFile(res, path.join(PUBLIC, 'robots.txt'));
    if (p === '/order') return serveFile(res, path.join(PUBLIC, 'index.html'));
    if (p === '/pay/return') return serveFile(res, path.join(PUBLIC, 'pay-return.html'));
    if (p === '/refund') return serveFile(res, path.join(PUBLIC, 'refund.html'));
    if (p === '/track') return serveFile(res, path.join(PUBLIC, 'index.html'));
    if (p === '/api/events') {
      const access = readAccess(req, "xto_admin");
      const version = crypto.createHmac("sha256", accessSecret).update(String(config.adminPin)).digest("hex");
      if (!access || access.version !== version) return json(res, 401, { error: "Admin sign-in required" });
      return sseHandler(req, res);
    }
    if (p === '/healthz') return json(res, 200, { ok: true, uptime: process.uptime() });
    if (p === '/api/offers' && method === 'GET') return json(res, 200, { offers: (db.offers || []).filter((o) => o.active !== false) });
    if (p === '/api/push/key' && method === 'GET') return json(res, 200, { key: vapid.pub });
    if (p === '/api/track/rider' && method === 'GET') {
      const orderId = (url.searchParams.get('order') || '').toUpperCase();
      const order = db.orders.find((o) => o.id === orderId);
      if (order && !canReadOrder(req, order)) return json(res, 401, { error: "Order access required" });
      if (!order || order.status !== 'OUT_FOR_DELIVERY' || !order.rider) return json(res, 200, { rider: null });
      const rider = db.riders.find((r) => r.name === order.rider || r.id === order.rider) || { name: order.rider, phone: '' };
      const pos = riderState()[rider.id] || null;
      const outletGeo = RIDER_HOME[order.outlet] || RIDER_HOME.shivane;
      return json(res, 200, { rider: { name: rider.name, phone: rider.phone }, pos, outletGeo });
    }
    const safe = path.normalize(p).replace(/^(\.\.[/\\])+/, '');
    const abs = path.join(PUBLIC, safe);
    if (abs.startsWith(PUBLIC) && fs.existsSync(abs) && fs.statSync(abs).isFile()) return serveFile(res, abs);
  }

  // ---- public API ----------------------------------------------------------
  if (p === '/api/menu' && method === 'GET') {
    const items = menu.items.map((i) => Object.assign({}, i, { available: isAvailable(i.id) }));
    return jsonCached(res, 200, { categories: menu.categories, items, addons: menu.addons || [], deliveryFee: menu.deliveryFee, freeDeliveryAbove: menu.freeDeliveryAbove, currency: 'INR' }, 20);
  }
  if (p === '/api/outlets' && method === 'GET') return jsonCached(res, 200, { outlets: outlets.filter((o) => outletOpen(o.id)) }, 20);
  if (p === '/api/config' && method === 'GET') return jsonCached(res, 200, { brand: config.brand, razorpay: { keyId: config.razorpay.keyId, live: config.razorpay.live }, vapid: vapid.pub, outletsGeo: Object.fromEntries(Object.entries(RIDER_HOME).filter(([id]) => outletOpen(id))) }, 20);

  if (p === '/api/push/subscribe' && method === 'POST') {
    const body = await readBody(req);
    if (!body.subscription || !body.subscription.endpoint || !body.subscription.keys) return json(res, 400, { error: 'Bad subscription' });
    const ep = body.subscription.endpoint;
    db.pushSubs = (db.pushSubs || []).filter((x) => x.endpoint !== ep);
    db.pushSubs.push({ phone: String(body.phone || '').replace(/\D/g, '').slice(-10) || null, endpoint: ep, keys: body.subscription.keys, at: new Date().toISOString() });
    saveDb();
    return json(res, 201, { ok: true, count: db.pushSubs.length });
  }
  if (p === '/api/coupon/validate' && method === 'POST') {
    const body = await readBody(req);
    const offer = findOffer(body.code);
    const out = applyCoupon(Math.round(Number(body.itemTotal) || 0), offer);
    if (out.error) return json(res, 400, { error: out.error });
    return json(res, 200, out);
  }
  if (p === '/api/rider/ping' && method === 'POST') {
    const body = await readBody(req);
    const rider = (db.riders || []).find((r) => r.phone === String(body.phone || '').replace(/\D/g, '').slice(-10) && r.active !== false);
    if (!rider) return json(res, 403, { error: 'Rider not on the roster' });
    setRiderPos(rider.id, Number(body.lat), Number(body.lng), body.orderId);
    broadcast('rider:pos', riderState());
    const order = body.orderId ? db.orders.find((o) => o.id === body.orderId) : null;
    return json(res, 200, { ok: true, rider: rider.name, order: order ? { id: order.id, customer: order.customer.name, phone: order.customer.phone, address: order.customer.address, mode: order.mode } : null });
  }
  if (p === '/api/enquiries' && method === 'POST') {
    const b = await readBody(req);
    if (b.website) return json(res, 200, { ok: true }); // honeypot: bots fill hidden fields
    const type = ['franchise', 'contact', 'career'].includes(b.type) ? b.type : 'contact';
    const clip = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
    const name = clip(b.name, 80);
    const phone = String(b.phone || '').replace(/\D/g, '').slice(-10);
    const email = clip(b.email, 120);
    if (name.length < 2) return json(res, 400, { error: 'Please enter your name' });
    if (!/^[6-9]\d{9}$/.test(phone)) return json(res, 400, { error: 'Please enter a valid 10-digit mobile number' });
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(res, 400, { error: 'Please enter a valid email address' });
    if (type === 'franchise' && !clip(b.city, 80)) return json(res, 400, { error: 'Please tell us your city' });
    db.enquirySeq += 1;
    const row = {
      id: 'ENQ-' + db.enquirySeq, type, status: 'NEW', createdAt: new Date().toISOString(),
      name, lastName: clip(b.lastName, 80), phone, email, city: clip(b.city, 80),
      message: clip(b.message, 2000), extra: { investment: clip(b.investment, 40), space: clip(b.space, 40), role: clip(b.role, 60) }
    };
    db.enquiries.unshift(row);
    saveDb();
    broadcast('enquiry:new', row);
    return json(res, 201, { ok: true, id: row.id });
  }

  // ---- phone sign-up / OTP (see auth.js) ----
  if (p === '/api/auth/otp/send' && method === 'POST') {
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    const out = await auth.send(await readBody(req), ip);
    return json(res, out.code, out.json);
  }
  if (p === '/api/auth/otp/verify' && method === 'POST') {
    const out = auth.verify(await readBody(req));
    return json(res, out.code, out.json);
  }
  if (p === '/api/auth/me' && method === 'GET') {
    const who = auth.fromReq(req);
    if (!who) return json(res, 401, { error: 'Not signed in' });
    return json(res, 200, { phone: who.phone, name: (who.customer && who.customer.name) || '' });
  }

  if (p === '/api/settings' && method === 'GET') return jsonCached(res, 200, { settings: db.settings, payments: paymentsInfo(), auth: { required: auth.required() } }, 20);

  // ---- checkout: price on the server, open a Cashfree order, confirm only after Cashfree says PAID ----
  if (p === '/api/checkout/start' && method === 'POST') {
    // abuse guard: 30 checkout starts per IP per 10 minutes (each one opens a gateway order)
    const cip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    const hits = (global.__coHits = global.__coHits || {});
    hits[cip] = (hits[cip] || []).filter((t) => Date.now() - t < 600000);
    if (hits[cip].length >= 30) return json(res, 429, { error: 'Too many checkout attempts. Please wait a few minutes.' });
    hits[cip].push(Date.now());
    const body = await readBody(req);
    if (auth.required()) {
      const who = auth.fromReq(req);
      if (!who) return json(res, 401, { error: 'Please verify your phone number to continue.', needAuth: true });
      body.customer = Object.assign({}, body.customer, { phone: who.phone });
      if (!String(body.customer.name || '').trim() && who.customer && who.customer.name) body.customer.name = who.customer.name;
    }
    const built = buildDraft(body, req);
    if (built.error) return json(res, 400, { error: built.error });
    const draft = built.draft;
    if (pp.configured()) {
      const preview = pp.buildOrder(Object.assign({ id: "checkout-validation" }, draft));
      if (preview.error || preview.skip) return json(res, 503, { error: "Online ordering is being connected to the restaurant. No payment has been started. Please try again shortly." });
      const posTotal = Number(preview.payload.orderinfo.OrderInfo.Order.details.total);
      if (!Number.isFinite(posTotal) || Math.abs(posTotal - draft.total) > 0.01) return json(res, 409, { error: "The restaurant prices are being updated. No payment has been started. Please try again shortly." });
      draft.posMenuReceivedAt = pp.status().menuReceivedAt;
    }
    if (!auth.required()) auth.capture(draft.customer.phone, draft.customer.name);
    for (const k of Object.keys(db.pending)) if (Date.now() - db.pending[k].createdAt > 6 * 3600 * 1000) delete db.pending[k];
    const orderId = 'XTO' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
    if (cashfree.configured) {
      const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0];
      const origin = proto + '://' + req.headers.host;
      let r, j;
      try {
        r = await cfFetch('/orders', { method: 'POST', body: JSON.stringify({
          order_id: orderId, order_amount: Number(draft.total.toFixed(2)), order_currency: 'INR',
          customer_details: { customer_id: 'cust_' + draft.customer.phone, customer_phone: draft.customer.phone, customer_name: draft.customer.name },
          order_meta: { return_url: origin + '/pay/return?order_id={order_id}&src=' + draft.source.channel, notify_url: origin + '/api/cashfree/webhook' },
          order_note: ('XTO ' + draft.mode + ' ' + draft.outlet).slice(0, 190)
        }) });
        j = await r.json();
      } catch (e) { return json(res, 502, { error: 'Could not reach the payment gateway. Try again.' }); }
      if (!r.ok || !j.payment_session_id) return json(res, 502, { error: 'Payment could not be started. Try again.', detail: j && j.message });
      db.pending[orderId] = { draft, createdAt: Date.now() };
      saveDb();
      return json(res, 200, { orderId, provider: 'cashfree', env: cashfree.env, paymentSessionId: j.payment_session_id, amount: draft.total });
    }
    if (ALLOW_MOCK_PAY) {
      db.pending[orderId] = { draft, createdAt: Date.now() };
      saveDb();
      return json(res, 200, { orderId, provider: 'mock', amount: draft.total });
    }
    return json(res, 503, { error: 'Online payment is being set up. Please order at the counter for now.' });
  }
  if (p === '/api/checkout/mock-pay' && method === 'POST') {
    if (!ALLOW_MOCK_PAY || cashfree.configured) return json(res, 404, { error: 'Not found' });
    const body = await readBody(req);
    if (db.pending[body.orderId]) db.pending[body.orderId].mockPaid = true;
    return json(res, 200, { ok: true });
  }
  if (p === '/api/checkout/confirm' && method === 'POST') {
    const body = await readBody(req);
    const out = await settlePending(String(body.orderId || ''));
    if (out.order) {
      const access = readAccess(req, "xto_orders");
      const owned = access && Array.isArray(access.orders) ? access.orders : [];
      setAccess(req, res, "xto_orders", { orders: Array.from(new Set(owned.concat(out.order.payment.gatewayOrderId))).slice(-20) }, 30 * 24 * 3600);
      return json(res, 200, { ok: true, order: publicOrder(out.order) });
    }
    if (out.pending) return json(res, 202, { pending: true, status: out.status || 'PENDING' });
    return json(res, out.status || 400, { error: out.error || 'Could not confirm payment' });
  }
  if (p === '/api/cashfree/webhook' && method === 'POST') {
    const raw = await readRaw(req);
    const ts = String(req.headers['x-webhook-timestamp'] || ''), sig = String(req.headers['x-webhook-signature'] || '');
    if (!cashfree.configured) return json(res, 200, { ok: true });
    const expected = crypto.createHmac('sha256', cashfree.secret).update(ts + raw).digest('base64');
    if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return json(res, 401, { error: 'Bad signature' });
    let ev = {}; try { ev = JSON.parse(raw); } catch (e) {}
    const oid = ev && ev.data && ev.data.order && ev.data.order.order_id;
    if (oid && /PAYMENT_SUCCESS/.test(String(ev.type || ''))) {
      const settled = await settlePending(String(oid));
      if (settled.error || settled.pending) return json(res, settled.error ? 503 : 409, { error: "Payment settlement requires retry" });
    }
    return json(res, 200, { ok: true });
  }
  if (p === '/api/orders' && method === 'POST') return json(res, 410, { error: 'Please refresh the page and checkout again.' });

  if (p.startsWith('/api/orders/') && method === 'GET') {
    const id = p.split('/')[3];
    const order = db.orders.find((o) => o.id.toUpperCase() === String(id).toUpperCase());
    if (!order) return json(res, 404, { error: 'Order not found' });
    if (!canReadOrder(req, order)) return json(res, 401, { error: "Use the browser that placed this order or verify your phone number." });
    return json(res, 200, { order: publicOrder(order) });
  }
  if (p === '/api/orders' && method === 'GET') {
    const list = db.orders.filter((order) => canReadOrder(req, order)).map(publicOrder);
    return json(res, 200, { orders: list });
  }

  // ---- admin API (PIN protected) --------------------------------------------
  const pin = req.headers['x-admin-pin'];
  const adminOk = pin && pin === String(config.adminPin);
  if (p.startsWith('/api/admin')) {
    if (process.env.NODE_ENV === "production" && ["/api/admin/petpooja/sandbox-raw", "/api/admin/petpooja/sandbox-order"].includes(p)) return json(res, 404, { error: "Sandbox order tools are disabled in production" });
    // brute-force guard: 8 wrong PINs per IP per 10 minutes, then 429
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    const now = Date.now();
    const fails = (global.__pinFails = global.__pinFails || {});
    fails[ip] = (fails[ip] || []).filter((t) => now - t < 600000);
    if (fails[ip].length >= 8) return json(res, 429, { error: 'Too many attempts. Try again in 10 minutes.' });
    if (p === '/api/admin/login' && method === 'POST') {
      const body = await readBody(req);
      if (String(body.pin) === String(config.adminPin)) {
        setAccess(req, res, "xto_admin", { version: crypto.createHmac("sha256", accessSecret).update(String(config.adminPin)).digest("hex") }, 12 * 3600);
        return json(res, 200, { ok: true });
      }
      fails[ip].push(now);
      return json(res, 401, { error: 'Wrong PIN' });
    }
    if (!adminOk) { fails[ip].push(now); return json(res, 401, { error: 'Unauthorized' }); }

    if (p === '/api/admin/orders' && method === 'GET') {
      const list = db.orders.map(adminOrder);
      return json(res, 200, { orders: list, riders: db.riders });
    }
    if (p === '/api/admin/stats' && method === 'GET') {
      const todays = db.orders.filter((o) => isToday(o.createdAt) && o.status !== 'CANCELLED' && !o.test);
      const revenue = todays.filter((o) => o.payment.status === 'paid').reduce((s, o) => s + o.total, 0);
      const open = db.orders.filter((o) => !['SERVED', 'DELIVERED', 'CANCELLED'].includes(o.status));
      const counters = {};
      for (const o of todays) for (const it of o.items) counters[it.name] = (counters[it.name] || 0) + it.qty;
      const top = Object.entries(counters).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, qty]) => ({ name, qty }));
      return json(res, 200, {
        ordersToday: todays.length, revenue, avgOrder: todays.length ? Math.round(revenue / todays.length) : 0,
        openOrders: open.length, topItems: top
      });
    }
    let m;
    if ((m = p.match(/^\/api\/admin\/orders\/([^/]+)\/status$/)) && method === 'POST') {
      const order = db.orders.find((o) => o.id === m[1]);
      if (!order) return json(res, 404, { error: 'Order not found' });
      const body = await readBody(req);
      const next = body.status;
      const flow = order.mode === 'delivery' ? DELIVERY_FLOW : STATUS_FLOW;
      const idx = flow.indexOf(next);
      const curIdx = flow.indexOf(order.status);
      const legacyDone = next === 'DELIVERED' && order.status === 'READY' && order.mode !== 'delivery'; // accept the old label as SERVED
      const valid = next === 'CANCELLED' || legacyDone || (idx > -1 && (idx === curIdx + 1 || idx === curIdx));
      if (!valid) return json(res, 400, { error: 'Bad status transition' });
      if (next === 'CANCELLED' && order.status !== 'CANCELLED') pp.cancelOnPos(order, body.reason).catch(() => {});
      order.status = next;
      if (body.rider !== undefined) order.rider = body.rider || order.rider;
      order.history.push({ status: next, at: new Date().toISOString() });
      saveDb();
      broadcast('order:update', adminOrder(order));
      const pushLine = {
        ACCEPTED: 'XTO Pizza accepted your order ' + order.id + '. The kitchen is firing it up!',
        READY: order.mode === 'dinein' ? 'Order ' + order.id + ' is plating up for your table!' : 'Order ' + order.id + ' is ready at the counter. Show your order ID!',
        SERVED: 'Order ' + order.id + ' served. Enjoy your meal! Rate us on Google.',
        OUT_FOR_DELIVERY: 'Order ' + order.id + ' is out for delivery. Your rider is on the way!',
        DELIVERED: 'Order ' + order.id + ' delivered. Enjoy! Rate us on Google.'
      }[next];
      if (pushLine && db.pushSubs.some((x) => x.phone === order.customer.phone)) {
        pushTarget(order.customer.phone, { title: 'XTO Pizza', body: pushLine, url: '/track?order=' + order.id }).catch(() => {});
      }
      return json(res, 200, { ok: true, order: adminOrder(order) });
    }
    if ((m = p.match(/^\/api\/admin\/orders\/([^/]+)\/rider$/)) && method === 'POST') {
      const order = db.orders.find((o) => o.id === m[1]);
      if (!order) return json(res, 404, { error: 'Order not found' });
      const body = await readBody(req);
      order.rider = body.rider || null;
      saveDb();
      broadcast('order:update', adminOrder(order));
      return json(res, 200, { ok: true });
    }
    if ((m = p.match(/^\/api\/admin\/menu\/([^/]+)\/availability$/)) && method === 'POST') {
      const body = await readBody(req);
      const id = m[1];
      db.unavailable = db.unavailable.filter((x) => x !== id);
      if (body.available === false) db.unavailable.push(id);
      saveDb();
      pp.syncStock(id, body.available !== false).catch(() => {});
      broadcast('menu:update', { id, available: body.available !== false });
      return json(res, 200, { ok: true });
    }
    if (p === '/api/admin/enquiries' && method === 'GET') {
      return json(res, 200, { enquiries: db.enquiries });
    }
    if ((m = p.match(/^\/api\/admin\/enquiries\/([^/]+)\/status$/)) && method === 'POST') {
      const row = db.enquiries.find((e) => e.id === m[1]);
      if (!row) return json(res, 404, { error: 'Enquiry not found' });
      const body = await readBody(req);
      if (!['NEW', 'CONTACTED', 'CLOSED'].includes(body.status)) return json(res, 400, { error: 'Bad status' });
      row.status = body.status;
      saveDb();
      return json(res, 200, { ok: true, enquiry: row });
    }
    if (p === '/api/admin/menu' && method === 'GET') {
      return json(res, 200, { items: menu.items.map((i) => Object.assign({}, i, { available: isAvailable(i.id) })) });
    }
    if (p === '/api/admin/riders' && method === 'GET') {
      return json(res, 200, { riders: db.riders, pos: riderState(), sim: Object.keys(db.sim || {}) });
    }
    if (p === '/api/admin/riders' && method === 'POST') {
      const body = await readBody(req);
      const phone = String(body.phone || '').replace(/\D/g, '').slice(-10);
      if (!body.name || body.name.trim().length < 2) return json(res, 400, { error: 'Rider name required' });
      if (!/^[6-9]\d{9}$/.test(phone)) return json(res, 400, { error: 'Valid 10-digit phone required' });
      if (db.riders.some((r) => r.phone === phone)) return json(res, 400, { error: 'This phone is already a rider' });
      db.riderSeq = (db.riderSeq || 0) + 1;
      const rider = { id: 'R-' + (100 + db.riderSeq), name: String(body.name).trim(), phone, vehicle: String(body.vehicle || 'Bike').trim(), active: true };
      db.riders.push(rider);
      const home = RIDER_HOME[body.home] || RIDER_HOME.shivane;
      setRiderPos(rider.id, home[0] + (Math.random() - 0.5) * 0.004, home[1] + (Math.random() - 0.5) * 0.004);
      saveDb();
      return json(res, 201, { ok: true, rider });
    }
    if ((m = p.match(/^\/api\/admin\/riders\/([^/]+)\/state$/)) && method === 'POST') {
      const rider = db.riders.find((r) => r.id === m[1]);
      if (!rider) return json(res, 404, { error: 'Rider not found' });
      const body = await readBody(req);
      if (body.active !== undefined) rider.active = !!body.active;
      if (body.simulate !== undefined) {
        if (body.simulate) {
          // demo walk: drift from current position toward a random nearby customer point
          const pos = riderState()[rider.id] || { lat: RIDER_HOME.shivane[0], lng: RIDER_HOME.shivane[1] };
          db.sim = db.sim || {};
          db.sim[rider.id] = { from: [pos.lat, pos.lng], to: [pos.lat + (Math.random() - 0.5) * 0.02, pos.lng + (Math.random() - 0.5) * 0.02] };
        } else delete (db.sim || {})[rider.id];
      }
      saveDb();
      return json(res, 200, { ok: true, rider });
    }
    if (p === '/api/admin/settings' && method === 'GET') return json(res, 200, { settings: db.settings, payments: paymentsInfo() });
    if (p === '/api/admin/settings' && method === 'POST') {
      const body = await readBody(req);
      db.settings = sanitizeSettings(body);
      saveDb();
      broadcast('settings:update', db.settings);
      return json(res, 200, { ok: true, settings: db.settings });
    }
    if (p === '/api/admin/test-order' && method === 'POST') {
      // staff test order: appears on the board like a real one, no charge, never sent to Petpooja, excluded from revenue
      const body = await readBody(req);
      const outletId = outlets.find((o) => o.id === body.outlet && outletOpen(o.id)) ? body.outlet : (outlets.find((o) => outletOpen(o.id)) || outlets[0]).id;
      const mode = ['dinein', 'takeaway', 'delivery'].includes(body.mode) ? body.mode : 'takeaway';
      const cheap = menu.items.filter((i) => isAvailable(i.id)).sort((a, b) => a.price - b.price)[0];
      const priced = priceOrder([{ id: cheap.id, qty: 1 }]);
      db.orderSeq += 1;
      const order = {
        id: 'XT-' + db.orderSeq, createdAt: new Date().toISOString(), status: 'PLACED', test: true,
        mode, outlet: outletId, customer: { name: 'TEST ORDER (staff)', phone: '9999999999', tableNumber: mode === 'dinein' ? '1' : '' },
        items: priced.items, itemTotal: priced.itemTotal, deliveryFee: 0, coupon: null, total: priced.itemTotal,
        address: mode === 'delivery' ? { line: 'TEST address, do not deliver', landmark: '', lat: (RIDER_HOME[outletId] || [0, 0])[0], lng: (RIDER_HOME[outletId] || [0, 0])[1], distanceKm: 0 } : null,
        payment: { method: 'test', status: 'paid', paymentId: 'TEST-' + Date.now(), gatewayOrderId: 'TEST' + Date.now() },
        source: { channel: 'website', platform: 'web', label: 'TEST order created from the admin panel' }, rider: null,
        etaMin: 15, history: [{ status: 'PLACED', at: new Date().toISOString() }]
      };
      db.orders.unshift(order);
      saveDb();
      broadcast('order:new', adminOrder(order));
      return json(res, 200, { ok: true, order: adminOrder(order) });
    }
    // Petpooja sandbox test, raw mode: order items straight from Petpooja's pushed menu by name
    if (p === '/api/admin/petpooja/sandbox-raw' && method === 'POST') {
      const body = await readBody(req);
      const lines = [];
      for (const spec of (body.lines || [])) { const l = pp.rawLine(spec); if (!l) return json(res, 400, { error: 'Not in Petpooja menu: ' + JSON.stringify(spec) }); lines.push(l); }
      if (!lines.length) return json(res, 400, { error: 'lines[] required' });
      const itemTotal = lines.reduce((t, l) => t + l.price * l.qty, 0);
      const mode = ['dinein', 'takeaway', 'delivery'].includes(body.mode) ? body.mode : 'takeaway';
      const disc = Math.min(Number(body.discount) || 0, itemTotal - 1);
      db.orderSeq += 1;
      const order = {
        id: 'XT-' + db.orderSeq, createdAt: new Date().toISOString(), status: 'PLACED', test: true, ppForce: true,
        mode, outlet: body.outlet || 'nanded', customer: { name: 'Sandbox Test', phone: String(body.phone || '9307512816'), tableNumber: mode === 'dinein' ? '1' : '' },
        items: lines, itemTotal, deliveryFee: 0, coupon: disc ? { code: 'SANDBOX', discount: disc } : null, total: itemTotal - disc,
        address: mode === 'delivery' ? { line: 'Sandbox test address, Nanded City, Pune', landmark: '', lat: 18.4505, lng: 73.7993, distanceKm: 1 } : null,
        payment: { method: 'sandbox-test', status: 'paid', paymentId: 'SBX-' + Date.now(), gatewayOrderId: 'SBX' + Date.now() },
        source: { channel: 'website', platform: 'web', label: 'Petpooja sandbox test order' }, rider: null, etaMin: 15, history: [{ status: 'PLACED', at: new Date().toISOString() }]
      };
      db.orders.unshift(order);
      saveDb();
      await pp.pushOrder(order);
      return json(res, 200, { ok: true, orderId: order.id, total: order.total, items: lines.map((l) => l.name + (l.addonNames.length ? ' + ' + l.addonNames.join(', ') : '')), pos: order.pos || null });
    }
    // Petpooja sandbox test: builds one of the 5 required test cases (or custom items), pushes it to the POS sandbox, returns the result
    if (p === '/api/admin/petpooja/sandbox-order' && method === 'POST') {
      const body = await readBody(req);
      const pick = (g, size) => menu.items.find((i) => i.groupName === g && i.size === size && isAvailable(i.id));
      const simple = menu.items.find((i) => i.name === 'Garlic Bread' && isAvailable(i.id)) || menu.items.find((i) => !i.size && isAvailable(i.id) && i.cat !== 'beverage');
      const sc = Number(body.scenario) || 0;
      let lines = body.items, discount = Number(body.discount) || 0;
      const marg = (size) => pick('Margherita', size);
      if (!lines) {
        if (sc === 1) lines = [{ id: simple.id, qty: 1 }];
        else if (sc === 2) lines = [{ id: marg('regular').id, qty: 1, addons: ['extra-cheese'] }];
        else if (sc === 3) lines = [{ id: marg('medium').id, qty: 1 }];
        else if (sc === 4) { lines = [{ id: simple.id, qty: 2 }]; discount = discount || 20; }
        else if (sc === 5) lines = [{ id: marg('large').id, qty: 1, addons: ['extra-cheese', 'extra-topping'] }];
        else return json(res, 400, { error: 'Give scenario 1-5 or items[]' });
      }
      const priced = priceOrder(lines);
      if (priced.error) return json(res, 400, { error: priced.error });
      const mode = ['dinein', 'takeaway', 'delivery'].includes(body.mode) ? body.mode : 'takeaway';
      const outletId = body.outlet || 'nanded';
      const disc = Math.min(discount, priced.itemTotal - 1);
      db.orderSeq += 1;
      const order = {
        id: 'XT-' + db.orderSeq, createdAt: new Date().toISOString(), status: 'PLACED', test: true, ppForce: true,
        mode, outlet: outletId, customer: { name: 'Sandbox Test', phone: String(body.phone || '9307512816'), tableNumber: mode === 'dinein' ? '1' : '' },
        items: priced.items, itemTotal: priced.itemTotal, deliveryFee: 0, coupon: disc ? { code: 'SANDBOX', discount: disc } : null, total: priced.itemTotal - disc,
        address: mode === 'delivery' ? { line: 'Sandbox test address, Nanded City, Pune', landmark: '', lat: 18.4505, lng: 73.7993, distanceKm: 1 } : null,
        payment: { method: 'sandbox-test', status: 'paid', paymentId: 'SBX-' + Date.now(), gatewayOrderId: 'SBX' + Date.now() },
        source: { channel: 'website', platform: 'web', label: 'Petpooja sandbox test order' }, rider: null, etaMin: 15, history: [{ status: 'PLACED', at: new Date().toISOString() }]
      };
      db.orders.unshift(order);
      saveDb();
      await pp.pushOrder(order);
      return json(res, 200, { ok: true, orderId: order.id, total: order.total, items: order.items.map((i) => i.name), pos: order.pos || null, payload: body.debug ? (pp.buildOrder(order).payload || null) : undefined });
    }
    if ((m = p.match(/^\/api\/admin\/orders\/([^/]+)\/pos-retry$/)) && method === 'POST') {
      const order = db.orders.find((o) => o.id === m[1]);
      if (!order) return json(res, 404, { error: 'Order not found' });
      await pp.pushOrder(order);
      return json(res, 200, { ok: true, pos: order.pos || null });
    }
    if (p === '/api/admin/offers' && method === 'GET') return json(res, 200, { offers: db.offers || [] });
    if (p === '/api/admin/offers' && method === 'POST') {
      const body = await readBody(req);
      const code = String(body.code || '').trim().toUpperCase();
      if (code.length < 3) return json(res, 400, { error: 'Code needs 3+ characters' });
      if (!['percent', 'flat'].includes(body.type)) return json(res, 400, { error: 'Type must be percent or flat' });
      const value = Math.round(Number(body.value));
      if (!(value > 0)) return json(res, 400, { error: 'Value must be positive' });
      if (body.type === 'percent' && value > 90) return json(res, 400, { error: 'Percent off capped at 90' });
      if (db.offers.some((o) => o.code === code)) return json(res, 400, { error: 'Code already exists' });
      const offer = { code, type: body.type, value, minOrder: Math.max(0, Math.round(Number(body.minOrder) || 0)), label: String(body.label || '').trim(), active: true, at: new Date().toISOString() };
      db.offers.push(offer);
      saveDb();
      broadcast('offers:update', { offers: db.offers.filter((o) => o.active !== false) });
      return json(res, 201, { ok: true, offer });
    }
    if ((m = p.match(/^\/api\/admin\/offers\/([^/]+)\/state$/)) && method === 'POST') {
      const offer = db.offers.find((o) => o.code === m[1]);
      if (!offer) return json(res, 404, { error: 'Offer not found' });
      const body = await readBody(req);
      if (body.active !== undefined) offer.active = !!body.active;
      saveDb();
      broadcast('offers:update', { offers: db.offers.filter((o) => o.active !== false) });
      return json(res, 200, { ok: true, offer });
    }
    if (p === '/api/admin/notify' && method === 'POST') {
      const body = await readBody(req);
      const title = String(body.title || '').trim();
      const text = String(body.body || '').trim();
      if (!title || !text) return json(res, 400, { error: 'Title and body required' });
      const phone = String(body.phone || '').replace(/\D/g, '').slice(-10) || null;
      const payload = { title, body: text, url: body.url || '/' };
      const results = await pushTarget(phone, payload);
      const sent = results.filter((r) => r === 200 || r === 201).length;
      return json(res, 200, { ok: true, sent, targets: results.length, detail: results });
    }
    if (p === '/api/admin/menu' && method === 'POST') {
      const body = await readBody(req);
      const name = String(body.name || '').trim();
      const cat = menu.categories.find((c) => c.id === body.cat);
      const price = Math.round(Number(body.price));
      if (name.length < 2) return json(res, 400, { error: 'Item name required' });
      if (!cat) return json(res, 400, { error: 'Pick a category' });
      if (!(price > 0)) return json(res, 400, { error: 'Price must be positive' });
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + (menu.items.length + 1);
      let img = body.img || 'pizza-cheese';
      if (body.imageData && /^data:image\/(png|jpe?g|webp);base64,/.test(body.imageData)) {
        const ext = body.imageData.startsWith('data:image/png') ? 'png' : (body.imageData.startsWith('data:image/webp') ? 'webp' : 'jpg');
        const file = 'upload-' + slug + '.' + ext;
        fs.writeFileSync(path.join(PUBLIC, 'images', file), Buffer.from(body.imageData.split(',')[1], 'base64'));
        img = file.replace(/\.(jpg|jpeg|png|webp)$/, '');
      }
      const item = { id: slug, cat: cat.id, name, desc: String(body.desc || '').trim() || 'Freshly made at XTO', price, img, tags: ['new'] };
      menu.items.unshift(item);
      writeJSON(path.join(DATA, 'menu.json'), menu);
      broadcast('menu:update', { id: item.id, available: true, newItem: item });
      return json(res, 201, { ok: true, item });
    }
    if ((m = p.match(/^\/api\/admin\/menu\/([^/]+)$/)) && method === 'DELETE') {
      const idx = menu.items.findIndex((i) => i.id === m[1]);
      if (idx === -1) return json(res, 404, { error: 'Item not found' });
      const [gone] = menu.items.splice(idx, 1);
      db.unavailable = db.unavailable.filter((x) => x !== gone.id);
      saveDb();
      writeJSON(path.join(DATA, 'menu.json'), menu);
      broadcast('menu:update', { removed: gone.id });
      return json(res, 200, { ok: true, removed: gone.id });
    }
    if ((m = p.match(/^\/api\/admin\/menu\/([^/]+)$/)) && method === 'POST') {
      const item = menu.items.find((i) => i.id === m[1]);
      if (!item) return json(res, 404, { error: 'Item not found' });
      const body = await readBody(req);
      if (body.price !== undefined) { const pr = Math.round(Number(body.price)); if (!(pr > 0)) return json(res, 400, { error: 'Price must be positive' }); item.price = pr; }
      if (body.name !== undefined && String(body.name).trim().length >= 2) item.name = String(body.name).trim();
      if (body.desc !== undefined) item.desc = String(body.desc).trim();
      if (body.cat !== undefined && menu.categories.some((c) => c.id === body.cat)) item.cat = body.cat;
      writeJSON(path.join(DATA, 'menu.json'), menu);
      broadcast('menu:update', { id: item.id, available: isAvailable(item.id) });
      return json(res, 200, { ok: true, item });
    }
    if (p === '/api/admin/notify-stats' && method === 'GET') {
      const subs = db.pushSubs || [];
      return json(res, 200, { count: subs.length, withPhone: subs.filter((x) => x.phone).length });
    }
    if (p === '/api/admin/customers' && method === 'GET') {
      const list = Object.values(db.customers || {}).sort((x, y) => String(y.lastSeen || y.lastLogin || '').localeCompare(String(x.lastSeen || x.lastLogin || '')));
      return json(res, 200, { customers: list });
    }
    if (p === '/api/admin/integrations' && method === 'GET') {
      return json(res, 200, {
        razorpay: { live: config.razorpay.live },
        payments: paymentsInfo(),
        petpooja: pp.status(),
        auth: auth.status()
      });
    }
  }

  json(res, 404, { error: 'No route' });
}

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch(() => {
    console.error("Request handler failed", req.method);
    if (!res.headersSent) json(res, 500, { error: "Request could not be completed. Please try again." });
    else res.end();
  });
});

server.listen(PORT, () => {
  pp.recoverPendingOrders().catch(() => console.error("POS recovery requires review"));
  console.log('');
  console.log('  XTO Pizza stack is up. Zero dependencies, pure Node.');
  console.log('  ------------------------------------------------------');
  console.log('  Website (customer):  http://localhost:' + PORT + '/');
  console.log('  Mobile app (PWA):    http://localhost:' + PORT + '/app');
  console.log('  Admin CES:           http://localhost:' + PORT + '/admin');
  console.log('  Payments:            ' + (cashfree.configured ? 'Cashfree (' + cashfree.env + ')' : ALLOW_MOCK_PAY ? 'MOCK (ALLOW_MOCK_PAY=1)' : 'CLOSED: set CASHFREE_APP_ID and CASHFREE_SECRET_KEY'));
  console.log('  Petpooja push:       ' + (pp.configured() ? 'ON (' + Object.keys(pp.cfg.outletMap).join(',') + ')' : 'OFF (set PP_SAVE_ORDER_URL, PP_APP_KEY, PP_APP_SECRET, PP_ACCESS_TOKEN)'));
  console.log('  ------------------------------------------------------');
});
