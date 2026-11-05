'use strict';
/* Petpooja Online Ordering API v2.1.0 integration for XTO Pizza.
 *   - receives the pushed menu (Push Menu) and keeps Petpooja's item / variation / addon / tax ids
 *   - sends every paid order to the POS (Save Order), with retries
 *   - receives order status callbacks (accept, ready, dispatch, deliver, cancel)
 *   - cancels an order on the POS, and syncs sold-out toggles (item stock on/off)
 * Configure with env (see /opt/xto-pizza/petpooja.env on the server); with no env everything is skipped and logged.
 */
const path = require('path');

function norm(s) {
  s = String(s || '').toLowerCase().replace(/\[[o0]\]/g, ' ').replace(/\(.*?\)/g, ' ');
  s = s.replace(/[^a-z0-9 ]/g, ' ');
  for (const w of ['pizza', 'small', 'regular', 'medium', 'large', 'dip', 'ml', '300']) s = s.replace(new RegExp('\\b' + w + '\\b', 'g'), ' ');
  s = s.replace(/margherita|margherta/g, 'margarita').replace(/makhni/g, 'makhani').replace(/arabiatta/g, 'arabiata').replace(/\btost\b/g, 'toast').replace(/thumbsup|thmbs up/g, 'thums up');
  return s.replace(/\s+/g, ' ').trim();
}
function dice(a, b) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const bg = (s) => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const k = s.slice(i, i + 2); m.set(k, (m.get(k) || 0) + 1); } return m; };
  const A = bg(a), B = bg(b); let hit = 0;
  for (const [k, n] of A) hit += Math.min(n, B.get(k) || 0);
  return (2 * hit) / (a.length - 1 + b.length - 1);
}
const SIZE_WORDS = { six: ['small', '6 in', '6 inch', 'six'], regular: ['regular', '7 in', '7 inch', 'reg'], medium: ['medium', '9 in', '9 inch', 'med'], large: ['large', '11 in', '11 inch'], half: ['half'], full: ['full'] };
const r2 = (n) => (Math.round(n * 100) / 100).toFixed(2);
const ist = (d) => new Date(d.getTime() + 5.5 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19);

module.exports = function createPetpooja(ctx) {
  const { DATA, readJSON, writeJSON, db, saveDb, broadcast, menu, outlets, pushTarget } = ctx;
  const E = process.env;
  const cfg = {
    orderUrl: E.PP_SAVE_ORDER_URL || '', statusUrl: E.PP_UPDATE_STATUS_URL || '', stockUrl: E.PP_STOCK_URL || '',
    appKey: E.PP_APP_KEY || '', appSecret: E.PP_APP_SECRET || '', accessToken: E.PP_ACCESS_TOKEN || '',
    pushToken: E.PP_PUSH_TOKEN || '', callbackBase: E.PP_CALLBACK_BASE || 'https://xtopizza.in',
    outletMap: (() => { try { return JSON.parse(E.PETPOOJA_OUTLET_MAP || '{}'); } catch (e) { return {}; } })()
  };
  const logFile = path.join(DATA, 'petpooja-log.json');
  const menuFile = path.join(DATA, 'petpooja-menu.json');
  const configured = () => !!(cfg.orderUrl && cfg.appKey && cfg.appSecret && cfg.accessToken);
  function log(entry) {
    const l = readJSON(logFile, []);
    l.unshift(Object.assign({ at: new Date().toISOString() }, entry));
    writeJSON(logFile, l.slice(0, 300));
  }
  let pm = readJSON(menuFile, null);

  /* ---------------- Push Menu receiver ---------------- */
  function handleMenuPush(body) {
    try { writeJSON(path.join(DATA, 'petpooja-menu-raw.json'), body); } catch (e) {}
    const rest = (body.restaurants && body.restaurants[0]) || {};
    const items = (body.items || []).map((i) => ({
      itemid: String(i.itemid), itemname: i.itemname, itemallowvariation: String(i.itemallowvariation || '0'), item_categoryid: i.item_categoryid,
      item_ordertype: i.item_ordertype || '', price: i.price, active: i.active, in_stock: i.in_stock, item_tax: i.item_tax || '', tax_inclusive: ['true', '1'].includes(String(i.tax_inclusive).toLowerCase()),
      itemallowaddon: String(i.itemallowaddon || '0'), addon: i.addon || [], is_combo: i.is_combo || '0',
      variation: (i.variation || []).map((v) => ({ id: String(v.id), variationid: String(v.variationid), name: v.name, price: v.price, active: v.active, addon: v.addon || [] }))
    }));
    pm = { receivedAt: new Date().toISOString(), restaurantid: rest.restaurantid || '', items, taxes: body.taxes || [], addongroups: body.addongroups || [], categories: body.categories || [] };
    writeJSON(menuFile, pm);
    log({ type: 'menu', status: 'received', items: items.length, taxes: pm.taxes.length });
    return { success: '1', message: 'Menu items are successfully listed.' };
  }

  /* ---------------- our item -> Petpooja item / variation ---------------- */
  function findPp(it) {
    if (!pm || !pm.items.length) return null;
    const base = norm(it.groupName || it.name);
    let cands = pm.items.filter((x) => x.active !== '0' && norm(x.itemname) === base);
    if (!cands.length) cands = pm.items.filter((x) => x.active !== '0' && dice(norm(x.itemname), base) >= 0.85);
    if (!cands.length) return null;
    const words = SIZE_WORDS[it.size] || [];
    const varFor = (c) => (c.variation || []).find((v) => v.active !== '0' && words.some((w) => String(v.name).toLowerCase().includes(w)));
    let best = null, bestScore = -1;
    for (const c of cands) {
      const hasVar = c.itemallowvariation === '1' && c.variation.length;
      let score = 0, v = null;
      if (hasVar) { v = varFor(c); if (!v) continue; score = 3; }
      else if (words.some((w) => String(c.itemname).toLowerCase().includes(w))) score = 2;
      else score = 1;
      if (score > bestScore) { best = { item: c, variation: v }; bestScore = score; }
    }
    return best;
  }
  function addonFor(m, name) {
    const groupIds = new Set([...(m.item.addon || []), ...((m.variation && m.variation.addon) || [])].map((a) => String(a.addon_group_id)));
    const n = norm(name);
    for (const g of pm.addongroups || []) {
      if (groupIds.size && !groupIds.has(String(g.addongroupid))) continue;
      for (const a of g.addongroupitems || []) if (a.active !== '0' && norm(a.addonitem_name) === n) return { id: String(a.addonitemid), name: a.addonitem_name, group_name: g.addongroup_name, price: String(a.addonitem_price), group_id: parseInt(g.addongroupid, 10), quantity: '1' };
    }
    return null;
  }


  /* sandbox testing: order Petpooja's own items by name (their sandbox menu is not ours) */
  function rawFind(spec) {
    if (!pm) return null;
    const c = pm.items.find((x) => x.active !== '0' && String(x.itemname).trim().toLowerCase() === String(spec.item || '').trim().toLowerCase());
    if (!c) return null;
    if (!spec.variation) return { item: c, variation: null };
    const v = (c.variation || []).find((x) => String(x.name).trim().toLowerCase() === String(spec.variation).trim().toLowerCase());
    return v ? { item: c, variation: v } : null;
  }
  function rawLine(spec) {
    const m = rawFind(spec);
    if (!m) return null;
    const base = Number(m.variation ? m.variation.price : m.item.price) || 0;
    let unit = base; const names = [];
    for (const an of (spec.addons || [])) { const a = addonFor(m, an); if (a) { unit += Number(a.price) || 0; names.push(a.name); } }
    return { id: 'pp-' + (m.variation ? m.variation.id : m.item.itemid), name: m.item.itemname + (m.variation ? ' (' + m.variation.name + ')' : ''), price: unit, qty: Math.max(1, parseInt(spec.qty, 10) || 1), addons: [], addonNames: names, ppRaw: spec };
  }

  /* ---------------- Save Order ---------------- */
  function buildOrder(order) {
    const restID = cfg.outletMap[order.outlet];
    if (!restID) return { skip: 'Outlet not on Petpooja' };
    if (!pm) return { error: 'unmapped', reason: 'No menu received from Petpooja yet' };
    const typeId = order.mode === 'delivery' ? '1' : order.mode === 'takeaway' ? '2' : '3';
    const itemTotal = order.items.reduce((s, i) => s + i.price * i.qty, 0);
    const disc = order.coupon ? Math.min(order.coupon.discount, itemTotal) : 0;
    const warnings = [], lines = [], taxAgg = {};
    let discLeft = disc, taxTotal = 0, exclTax = 0, net = 0;
    for (let k = 0; k < order.items.length; k++) {
      const li = order.items[k];
      const mi = menu.items.find((i) => i.id === li.id);
      const m = li.ppRaw ? rawFind(li.ppRaw) : (mi && findPp(mi));
      if (!m) return { error: 'unmapped', reason: 'No Petpooja item for "' + li.name + '"' };
      if (m.item.item_ordertype && !m.item.item_ordertype.split(',').includes(typeId)) warnings.push(li.name + ' is not enabled for this order type in Petpooja');
      const lineTotal = li.price * li.qty;
      const share = k === order.items.length - 1 ? discLeft : Math.round((disc * lineTotal / itemTotal) * 100) / 100;
      discLeft = Math.round((discLeft - share) * 100) / 100;
      const after = lineTotal - share; net += after;
      const unitDisc = Math.round(share / li.qty * 100) / 100; // item_discount is per single unit, discount_total is the combined figure
      const taxes = String(m.item.item_tax || '').split(',').filter(Boolean).map((id) => (pm.taxes || []).find((t) => String(t.taxid) === id && (!t.tax_ordertype || String(t.tax_ordertype).split(',').includes(typeId)))).filter(Boolean);
      const rate = taxes.reduce((s, t) => s + Number(t.tax), 0);
      // tax is computed on the item value Petpooja holds for the item: exclusive items tax the value itself, inclusive items back it out
      const incl = m.item.tax_inclusive !== false;
      const base = incl ? after / (1 + rate / 100) : after;
      const item_tax = taxes.map((t) => {
        const amt = Math.round(base * Number(t.tax)) / 100; taxTotal += amt; if (!incl) exclTax += amt;
        taxAgg[t.taxid] = taxAgg[t.taxid] || { id: String(t.taxid), title: t.taxname, type: 'P', price: String(t.tax), tax: 0 };
        taxAgg[t.taxid].tax += amt;
        return { id: String(t.taxid), name: t.taxname, tax_percentage: String(t.tax), amount: r2(amt) };
      });
      const addons = [];
      for (const name of (li.addonNames || [])) { const a = addonFor(m, name); if (a) addons.push(a); else warnings.push('Add-on "' + name + '" not found in Petpooja for ' + li.name); }
      lines.push({
        id: m.variation ? m.variation.id : m.item.itemid, name: m.item.itemname.replace(/\s*\[[o0]\]\s*$/i, ''), tax_inclusive: incl, gst_liability: 'restaurant', item_tax,
        item_discount: r2(unitDisc), price: r2(li.price), final_price: r2(li.price - unitDisc), quantity: String(li.qty), description: '',
        variation_name: m.variation ? m.variation.name : '', variation_id: m.variation ? m.variation.variationid : '', AddonItem: { details: addons }
      });
    }
    const now = new Date();
    const dcharge = order.deliveryFee || 0;
    const total = net + exclTax + dcharge;
    const loc = order.address || {};
    const info = {
      OrderInfo: {
        Restaurant: { details: { res_name: 'XTO Pizza', address: 'Destination Centre, Shop F-65, Sinhagad Road, Nanded City, Pune 411068', contact_information: '7030000886', restID } },
        Customer: { details: { email: '', name: order.customer.name, address: order.mode === 'delivery' ? (loc.line + (loc.landmark ? ', ' + loc.landmark : '')) : (order.mode === 'dinein' ? 'Dine-in at XTO Pizza Nanded City' : 'Takeaway from XTO Pizza Nanded City'), phone: order.customer.phone, latitude: loc.lat !== undefined ? String(loc.lat) : '', longitude: loc.lng !== undefined ? String(loc.lng) : '' } },
        Order: { details: {
          orderID: order.id, preorder_date: ist(now).slice(0, 10), preorder_time: ist(now).slice(11), service_charge: '0', sc_tax_amount: '0',
          delivery_charges: r2(dcharge), dc_tax_percentage: '0', dc_tax_amount: '0', packing_charges: '0', pc_tax_amount: '0', pc_tax_percentage: '0',
          order_type: order.mode === 'delivery' ? 'H' : order.mode === 'takeaway' ? 'P' : 'D', advanced_order: 'N', payment_type: 'ONLINE',
          table_no: order.mode === 'dinein' ? String(order.customer.tableNumber || '') : '', no_of_persons: '0',
          discount_total: r2(disc), tax_total: r2(taxTotal), discount_type: 'F', total: r2(total),
          description: (order.source && order.source.label) || 'This purchase came from the website',
          created_on: ist(now), enable_delivery: order.mode === 'delivery' ? 1 : 0, min_prep_time: 20,
          callback_url: cfg.callbackBase + '/api/petpooja/callback?t=' + encodeURIComponent(cfg.pushToken)
        } },
        OrderItem: { details: lines },
        Tax: { details: Object.values(taxAgg).map((t) => ({ id: t.id, title: t.title, type: 'P', price: t.price, tax: r2(t.tax), restaurant_liable_amt: r2(t.tax) })) },
        Discount: { details: disc > 0 ? [{ id: '', title: 'Discount', type: 'F', price: r2(disc) }] : [] }
      },
      udid: '', device_type: 'Web'
    };
    return { restID, payload: { app_key: cfg.appKey, app_secret: cfg.appSecret, access_token: cfg.accessToken, orderinfo: info }, warnings };
  }

  async function post(url, body, ms = 15000) {
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), ms);
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ac.signal });
      let j = {}; try { j = await r.json(); } catch (e) {}
      return { ok: r.ok, status: r.status, json: j };
    } finally { clearTimeout(t); }
  }
  function setPos(order, patch) { order.pos = Object.assign(order.pos || {}, patch, { at: new Date().toISOString() }); saveDb(); broadcast('order:update', order); }

  async function pushOrder(order) {
    if (order.test && !order.ppForce) return;
    if (!configured()) { log({ order: order.id, status: 'skipped', reason: 'Petpooja not configured' }); return; }
    const built = buildOrder(order);
    if (built.skip) { log({ order: order.id, outlet: order.outlet, status: 'skipped', reason: built.skip }); setPos(order, { status: 'skipped', reason: built.skip }); return; }
    if (built.error) { log({ order: order.id, status: 'unmapped', reason: built.reason }); setPos(order, { status: 'unmapped', reason: built.reason }); return; }
    let lastErr = '';
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const r = await post(cfg.orderUrl, built.payload);
        if (r.ok && String(r.json.success) === '1') {
          log({ order: order.id, status: 'pushed', attempts: attempt, petpoojaOrderId: r.json.orderID, warnings: built.warnings });
          setPos(order, { status: 'pushed', petpoojaOrderId: r.json.orderID || '', attempts: attempt, reason: '', warnings: built.warnings });
          return;
        }
        lastErr = 'HTTP ' + r.status + ' ' + (r.json.message || '') + ' ' + JSON.stringify(r.json.validation_errors || '').slice(0, 300);
        if (r.status >= 400 && r.status < 500) break; // a rejected order will not succeed on retry
      } catch (e) { lastErr = String(e.message || e); }
      if (attempt < 3) await new Promise((res) => setTimeout(res, attempt * 2500));
    }
    log({ order: order.id, status: 'failed', reason: lastErr, attempts: 3 });
    setPos(order, { status: 'failed', reason: lastErr });
  }

  /* ---------------- Order callback (Petpooja -> us) ---------------- */
  const FLOW = ['PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED', 'SERVED'];
  const LINES = {
    ACCEPTED: (o) => 'XTO Pizza accepted your order ' + o.id + '. The kitchen is firing it up!',
    READY: (o) => o.mode === 'dinein' ? 'Order ' + o.id + ' is plating up for your table!' : 'Order ' + o.id + ' is ready.',
    OUT_FOR_DELIVERY: (o) => 'Order ' + o.id + ' is out for delivery. Your rider is on the way!',
    DELIVERED: (o) => 'Order ' + o.id + ' delivered. Enjoy!', SERVED: (o) => 'Order ' + o.id + ' served. Enjoy your meal!',
    CANCELLED: (o) => 'Sorry, order ' + o.id + ' was cancelled by the restaurant. Your refund will be processed.'
  };
  function handleCallback(body, token) {
    if (cfg.pushToken && token !== cfg.pushToken) return { code: 401, json: { success: '0', message: 'Unauthorized' } };
    const order = db.orders.find((o) => o.id === String(body.orderID));
    if (!order) { log({ type: 'callback', status: 'unknown-order', orderID: body.orderID }); return { code: 200, json: { success: '1', message: 'Order not found, ignored.' } }; }
    const st = String(body.status);
    let next = null;
    if (st === '-1') next = 'CANCELLED';
    else if (['1', '2', '3'].includes(st)) next = 'ACCEPTED';
    else if (st === '5') next = 'READY';
    else if (st === '4') next = order.mode === 'delivery' ? 'OUT_FOR_DELIVERY' : 'READY';
    else if (st === '10') next = order.mode === 'delivery' ? 'DELIVERED' : 'SERVED';
    if (!next) return { code: 200, json: { success: '1', message: 'Status ignored.' } };
    const cur = FLOW.indexOf(order.status);
    if (next !== 'CANCELLED' && (order.status === 'CANCELLED' || FLOW.indexOf(next) <= cur)) return { code: 200, json: { success: '1', message: 'No change.' } };
    order.status = next;
    order.history.push({ status: next, at: new Date().toISOString(), by: 'petpooja' });
    if (next === 'CANCELLED') { order.cancelReason = body.cancel_reason || ''; order.refundDue = order.payment && order.payment.status === 'paid' && order.payment.method !== 'test'; }
    if (body.rider_name) order.riderInfo = { name: body.rider_name, phone: body.rider_phone_number || '' };
    if (body.minimum_prep_time) order.etaMin = Number(body.minimum_prep_time) || order.etaMin;
    setPos(order, { posStatus: st });
    log({ order: order.id, type: 'callback', status: next, cancel_reason: body.cancel_reason || '' });
    if (LINES[next] && pushTarget) pushTarget(order.customer.phone, { title: 'XTO Pizza', body: LINES[next](order), url: '/track?order=' + order.id }).catch(() => {});
    return { code: 200, json: { success: '1', message: 'Order status updated.' } };
  }

  /* ---------------- cancel on POS, stock sync ---------------- */
  async function cancelOnPos(order, reason) {
    if (!configured() || !cfg.statusUrl || !order.pos || order.pos.status !== 'pushed') return null;
    try {
      const r = await post(cfg.statusUrl, { app_key: cfg.appKey, app_secret: cfg.appSecret, access_token: cfg.accessToken, restID: cfg.outletMap[order.outlet], orderID: '', clientorderID: order.id, cancelReason: reason || 'Cancelled by XTO admin', status: '-1' });
      log({ order: order.id, type: 'cancel', status: String(r.json.success) === '1' ? 'ok' : 'failed', message: r.json.message || '' });
      return r.json;
    } catch (e) { log({ order: order.id, type: 'cancel', status: 'failed', message: String(e.message || e) }); return null; }
  }
  async function syncStock(itemId, inStock) {
    if (!configured() || !cfg.stockUrl || !pm) return;
    const mi = menu.items.find((i) => i.id === itemId); const m = mi && findPp(mi);
    if (!m) return;
    const restID = Object.values(cfg.outletMap)[0];
    const body = { restID, type: 'item', inStock: !!inStock, itemID: [m.variation ? m.variation.id : m.item.itemid] };
    if (!inStock) { body.autoTurnOnTime = 'custom'; const d = new Date(Date.now() + 24 * 3600 * 1000); body.customTurnOnTime = ist(d).slice(0, 10) + ' 11:00'; }
    try { const r = await post(cfg.stockUrl, body); log({ type: 'stock', item: itemId, inStock: !!inStock, status: r.json.status || r.status }); } catch (e) { log({ type: 'stock', item: itemId, status: 'failed', message: String(e.message || e) }); }
  }

  /* ---------------- Petpooja -> us: item stock on/off, store status ---------------- */
  const restOutlet = (restID) => Object.keys(cfg.outletMap).find((o) => String(cfg.outletMap[o]) === String(restID));
  const authed = (token) => !cfg.pushToken || token === cfg.pushToken;
  function handleStock(body, token) {
    if (!authed(token)) return { code: 401, json: { code: 401, status: 'failed', message: 'Unauthorized' } };
    if (!restOutlet(body.restID)) return { code: 400, json: { code: 400, status: 'failed', message: 'Unknown restID' } };
    const ids = (Array.isArray(body.itemID) ? body.itemID : [body.itemID]).map(String);
    const inStock = body.inStock === true || body.inStock === 'true';
    if (String(body.type) !== 'item') { log({ type: 'stock-in', status: 'ignored', note: 'addon stock not synced' }); return { code: 200, json: { code: 200, status: 'success', message: 'Stock status updated successfully' } }; }
    let changed = 0;
    for (const mi of menu.items) {
      const m = findPp(mi);
      if (!m) continue;
      const hit = ids.includes(String(m.item.itemid)) || (m.variation && (ids.includes(String(m.variation.id)) || ids.includes(String(m.variation.variationid))));
      if (!hit) continue;
      db.unavailable = (db.unavailable || []).filter((x) => x !== mi.id);
      if (!inStock) db.unavailable.push(mi.id);
      broadcast('menu:update', { id: mi.id, available: inStock });
      changed++;
    }
    if (changed) saveDb();
    log({ type: 'stock-in', status: 'ok', inStock, ids: ids.length, changed });
    return { code: 200, json: { code: 200, status: 'success', message: 'Stock status updated successfully' } };
  }
  function handleStoreGet(body, token) {
    if (!authed(token)) return { code: 401, json: { http_code: 401, status: 'failed', message: 'Unauthorized' } };
    const o = restOutlet(body.restID);
    if (!o) return { code: 400, json: { http_code: 400, status: 'failed', message: 'Unknown restID' } };
    return { code: 200, json: { http_code: 200, status: 'success', store_status: ctx.storeOpen(o) ? '1' : '0', message: 'Store Delivery Status fetched successfully' } };
  }
  function handleStoreSet(body, token) {
    if (!authed(token)) return { code: 401, json: { http_code: 401, status: 'failed', message: 'Unauthorized' } };
    const o = restOutlet(body.restID);
    if (!o) return { code: 400, json: { http_code: 400, status: 'failed', message: 'Unknown restID' } };
    db.settings.posStoreOff = db.settings.posStoreOff || {};
    if (String(body.store_status) === '0') {
      const t = body.turn_on_time ? Date.parse(String(body.turn_on_time).replace(' ', 'T') + '+05:30') : NaN;
      db.settings.posStoreOff[o] = { until: isNaN(t) ? null : t, reason: body.reason || '' };
    } else delete db.settings.posStoreOff[o];
    saveDb(); broadcast('menu:update', { outlets: true });
    log({ type: 'store-status', outlet: o, store_status: String(body.store_status), reason: body.reason || '' });
    return { code: 200, json: { http_code: 200, status: 'success', message: 'Store Status updated successfully for store ' + body.restID } };
  }
  function status() {
    const l = readJSON(logFile, []);
    return {
      configured: configured(), outlets: Object.keys(cfg.outletMap), menuReceivedAt: pm ? pm.receivedAt : null, menuItems: pm ? pm.items.length : 0,
      last: l[0] || null, pushedToday: l.filter((x) => x.status === 'pushed' && x.at && x.at.slice(0, 10) === new Date().toISOString().slice(0, 10)).length,
      failures: l.filter((x) => x.status === 'failed' || x.status === 'unmapped').length
    };
  }
  return { cfg, configured, handleMenuPush, buildOrder, pushOrder, handleCallback, handleStock, handleStoreGet, rawLine, handleStoreSet, cancelOnPos, syncStock, status, log, findPp, hasMenu: () => !!pm };
};
