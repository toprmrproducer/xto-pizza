'use strict';
/* Phone sign-up with OTP for XTO Pizza (website, app and digital menu all check out through the same API).
 *   POST /api/auth/otp/send    { phone }              -> sends a 6-digit code by SMS
 *   POST /api/auth/otp/verify  { phone, code, name }  -> { token, customer }
 *   GET  /api/auth/me          (Authorization: Bearer <token>)
 * Provider: MSG91 (MSG91_AUTHKEY + MSG91_TEMPLATE_ID, optional MSG91_BASE). Codes are generated and checked by us, so the
 * provider only delivers the SMS and can be swapped in one function. With no provider configured, verification is OFF and
 * checkout behaves as before. OTP_DEV=1 returns the code in the response, for localhost testing only.
 */
const crypto = require('crypto');
const path = require('path');

module.exports = function createAuth(ctx) {
  const { DATA, readJSON, writeJSON, db, saveDb } = ctx;
  const E = process.env;
  const cfg = {
    authKey: E.MSG91_AUTHKEY || '', templateId: E.MSG91_TEMPLATE_ID || '',
    base: E.MSG91_BASE || 'https://control.msg91.com/api/v5', dev: E.OTP_DEV === '1', reviewPhone: E.REVIEW_PHONE || '', reviewCode: E.REVIEW_CODE || '', forceOff: E.XTO_REQUIRE_OTP === '0'
  };
  const providerReady = () => !!(cfg.authKey && cfg.templateId);
  const required = () => !cfg.forceOff && (providerReady() || cfg.dev);

  const secretFile = path.join(DATA, 'auth-secret.json');
  let secret = (readJSON(secretFile, null) || {}).s;
  if (!secret) { secret = crypto.randomBytes(32).toString('hex'); writeJSON(secretFile, { s: secret }); }
  db.customers = db.customers || {};

  const otps = new Map();       // phone -> { hash, exp, tries, sentAt }
  const hits = { phone: new Map(), ip: new Map() };
  let daySends = { day: '', n: 0 };
  const DAILY_CAP = Number(E.OTP_DAILY_CAP || 1500);

  const cleanPhone = (p) => String(p || '').replace(/\D/g, '').slice(-10);
  const validPhone = (p) => /^[6-9]\d{9}$/.test(p);
  const hashCode = (phone, code) => crypto.createHmac('sha256', secret).update(phone + ':' + code).digest('hex');
  function bump(map, key, windowMs, max) {
    const now = Date.now();
    const arr = (map.get(key) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) { map.set(key, arr); return false; }
    arr.push(now); map.set(key, arr); return true;
  }

  function signToken(phone) {
    const body = Buffer.from(JSON.stringify({ p: phone, exp: Date.now() + 30 * 24 * 3600 * 1000 })).toString('base64url');
    return body + '.' + crypto.createHmac('sha256', secret).update(body).digest('base64url');
  }
  function readToken(token) {
    const [body, sig] = String(token || '').split('.');
    if (!body || !sig) return null;
    const want = crypto.createHmac('sha256', secret).update(body).digest('base64url');
    const a = Buffer.from(sig), b = Buffer.from(want);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    try { const o = JSON.parse(Buffer.from(body, 'base64url').toString()); return o.exp > Date.now() && validPhone(o.p) ? o : null; } catch (e) { return null; }
  }
  function fromReq(req) {
    const h = String(req.headers.authorization || '');
    const t = h.startsWith('Bearer ') ? h.slice(7) : '';
    const o = readToken(t);
    return o ? { phone: o.p, customer: db.customers[o.p] || null } : null;
  }

  async function deliver(phone, code) {
    if (cfg.dev) return { ok: true, dev: true };
    const url = cfg.base + '/otp?template_id=' + encodeURIComponent(cfg.templateId) + '&mobile=91' + phone + '&authkey=' + encodeURIComponent(cfg.authKey) + '&otp=' + code + '&otp_expiry=10';
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const j = await r.json().catch(() => ({}));
      if (r.ok && String(j.type || '').toLowerCase() === 'success') return { ok: true };
      return { ok: false, detail: String(j.message || r.status).slice(0, 200) };
    } catch (e) { return { ok: false, detail: String(e.message || e).slice(0, 200) }; }
  }

  async function send(body, ip) {
    if (!required()) return { code: 503, json: { error: 'Phone verification is not set up yet.' } };
    const phone = cleanPhone(body.phone);
    if (!validPhone(phone)) return { code: 400, json: { error: 'Enter a valid 10-digit mobile number.' } };
    const prev = otps.get(phone);
    if (prev && Date.now() - prev.sentAt < 30000) return { code: 429, json: { error: 'Please wait 30 seconds before asking for another code.' } };
    if (!bump(hits.phone, phone, 3600000, 5) || !bump(hits.ip, ip, 3600000, 20)) return { code: 429, json: { error: 'Too many codes requested. Try again in an hour.' } };
    const day = new Date().toISOString().slice(0, 10);
    if (daySends.day !== day) daySends = { day, n: 0 };
    if (daySends.n >= DAILY_CAP) return { code: 503, json: { error: 'Verification is busy right now. Please try again later.' } };
    const isReview = cfg.reviewPhone && cfg.reviewCode && phone === cleanPhone(cfg.reviewPhone);
    const code = isReview ? String(cfg.reviewCode) : String(crypto.randomInt(100000, 1000000));
    const d = isReview ? { ok: true } : await deliver(phone, code);
    if (!d.ok) { console.error('otp send failed', d.detail); return { code: 502, json: { error: 'Could not send the code. Please try again.' } }; }
    daySends.n += 1;
    otps.set(phone, { hash: hashCode(phone, code), exp: Date.now() + 10 * 60000, tries: 0, sentAt: Date.now() });
    const out = { ok: true, resendIn: 30, isNew: !db.customers[phone] };
    if (d.dev) out.devOtp = code;
    return { code: 200, json: out };
  }

  function verify(body) {
    const phone = cleanPhone(body.phone);
    const rec = otps.get(phone);
    if (!rec || rec.exp < Date.now()) return { code: 400, json: { error: 'That code has expired. Ask for a new one.' } };
    if (rec.tries >= 5) { otps.delete(phone); return { code: 429, json: { error: 'Too many wrong tries. Ask for a new code.' } }; }
    rec.tries += 1;
    const a = Buffer.from(hashCode(phone, String(body.code || '').replace(/\D/g, '')));
    const b = Buffer.from(rec.hash);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { code: 400, json: { error: 'Wrong code. Check the SMS and try again.' } };
    otps.delete(phone);
    const name = String(body.name || '').trim().slice(0, 60);
    const now = new Date().toISOString();
    const c = db.customers[phone] || (db.customers[phone] = { phone, name: '', createdAt: now });
    if (name.length >= 2) c.name = name;
    c.lastLogin = now; c.verifiedAt = c.verifiedAt || now;
    saveDb();
    return { code: 200, json: { ok: true, token: signToken(phone), customer: { phone, name: c.name } } };
  }

  // no-SMS mode: remember the number and name a customer gives at checkout (unverified)
  function capture(phone, name) {
    phone = cleanPhone(phone); if (!validPhone(phone)) return;
    const now = new Date().toISOString();
    const c = db.customers[phone] || (db.customers[phone] = { phone, name: '', createdAt: now, verified: false });
    if (String(name || '').trim().length >= 2) c.name = String(name).trim().slice(0, 60);
    c.lastSeen = now; saveDb();
  }
  return { capture, required, providerReady, send, verify, fromReq, cleanPhone, status: () => ({ required: required(), provider: providerReady() ? 'msg91' : (cfg.dev ? 'dev' : 'none'), customers: Object.keys(db.customers).length }) };
};
