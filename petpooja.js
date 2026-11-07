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
  s = String(s || '').toLowerCase().replace(/\[[o0]\]/g, ' ');
  s = s.replace(/[^a-z0-9 ]/g, ' ');
  return s.replace(/\s+/g, ' ').trim();
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
  if (pm && !pm.menusharingcode) {
    const raw = readJSON(path.join(DATA, "petpooja-menu-raw.json"), null);
    const restaurant = raw && Array.isArray(raw.restaurants) && raw.restaurants.find((entry) => String(entry.restaurantid) === String(pm.restaurantid));
    if (restaurant && restaurant.details) pm.menusharingcode = String(restaurant.details.menusharingcode || "");
  }

  /* ---------------- Push Menu receiver ---------------- */
  function handleMenuPush(body) {
    if (!body || !Array.isArray(body.restaurants) || body.restaurants.length !== 1 || !Array.isArray(body.items) || !body.items.length || body.items.some((item) => !item || !item.itemid || typeof item.itemname !== "string" || (item.variation !== undefined && !Array.isArray(item.variation)))) {
      return { success: "0", http_code: 400, message: "Invalid menu payload. Existing menu retained." };
    }
    for (const key of ["taxes", "addongroups", "categories"]) {
      if (body[key] !== undefined && !Array.isArray(body[key])) return { success: "0", http_code: 400, message: "Invalid menu collections. Existing menu retained." };
    }
    const validLinks = (links) => links === undefined || (Array.isArray(links) && links.every((link) => link && link.addon_group_id !== undefined && ['addon_min_item', 'addon_max_item'].every((key) => link[key] === undefined || (Number.isInteger(Number(link[key])) && Number(link[key]) >= 0))));
    if (body.items.some((item) => !validLinks(item.addon) || !Number.isFinite(Number(item.price)) || Number(item.price) < 0 || (item.variation || []).some((variation) => !variation || !variation.id || !variation.variationid || typeof variation.name !== 'string' || !Number.isFinite(Number(variation.price)) || Number(variation.price) < 0 || !validLinks(variation.addon))) ||
        (body.addongroups || []).some((group) => !group || group.addongroupid === undefined || !Array.isArray(group.addongroupitems) || group.addongroupitems.some((addon) => !addon || addon.addonitemid === undefined || typeof addon.addonitem_name !== 'string' || !Number.isFinite(Number(addon.addonitem_price)) || Number(addon.addonitem_price) < 0)) ||
        (body.taxes || []).some((tax) => !tax || tax.taxid === undefined || !Number.isFinite(Number(tax.tax)) || Number(tax.tax) < 0) || (body.categories || []).some((category) => !category || typeof category !== 'object')) {
      return { success: '0', http_code: 400, message: 'Invalid nested menu collections. Existing menu retained.' };
    }
    const rest = body.restaurants[0];
    const menusharingcode = String(rest && rest.details && rest.details.menusharingcode || "");
    if (!rest || !rest.restaurantid || !Object.values(cfg.outletMap).map(String).includes(menusharingcode)) {
      return { success: "0", http_code: 422, message: "Menu restaurant is not configured for this integration. Existing menu retained." };
    }
    const items = (body.items || []).map((i) => ({
      itemid: String(i.itemid), itemname: i.itemname, itemallowvariation: String(i.itemallowvariation || '0'), item_categoryid: i.item_categoryid,
      item_ordertype: i.item_ordertype || '', price: i.price, active: i.active, in_stock: i.in_stock, item_tax: i.item_tax || '', tax_inclusive: ['true', '1'].includes(String(i.tax_inclusive).toLowerCase()),
      itemallowaddon: String(i.itemallowaddon || '0'), addon: i.addon || [], is_combo: i.is_combo || '0',
      variation: (i.variation || []).map((v) => ({ id: String(v.id), variationid: String(v.variationid), name: v.name, price: v.price, active: v.active, addon: v.addon || [] }))
    }));
    const nextMenu = { receivedAt: new Date().toISOString(), restaurantid: rest.restaurantid, menusharingcode, items, taxes: body.taxes || [], addongroups: body.addongroups || [], categories: body.categories || [] };
    writeJSON(path.join(DATA, "petpooja-menu-raw.json"), body);
    writeJSON(menuFile, nextMenu);
    pm = nextMenu;
    log({ type: 'menu', status: 'received', items: items.length, taxes: pm.taxes.length });
    return { success: '1', message: 'Menu items are successfully listed.' };
  }

  /* ---------------- our item -> Petpooja item / variation ---------------- */
  function findPp(it) {
    if (!pm || !pm.items.length) return null;
    const base = norm(it.groupName || it.name);
    const words = (SIZE_WORDS[it.size] || (it.size ? [it.size] : [])).map(norm);
    const matches = [];
    for (const item of pm.items) {
      if (String(item.active) === '0') continue;
      if (String(item.itemallowvariation) === '1') {
        if (norm(item.itemname) !== base || !words.length) continue;
        for (const variation of item.variation || []) if (String(variation.active) !== '0' && words.includes(norm(variation.name))) matches.push({ item, variation });
      } else {
        const names = words.length ? words.flatMap((size) => [base + ' ' + size, size + ' ' + base]) : [base];
        if (names.includes(norm(item.itemname))) matches.push({ item, variation: null });
      }
    }
    return matches.length === 1 ? matches[0] : null;
  }
  function addonLinks(m) {
    return m.variation ? m.variation.addon || [] : m.item.addon || [];
  }
  function addonFor(m, name) {
    const groupIds = new Set(addonLinks(m).map((a) => String(a.addon_group_id)));
    const n = norm(name);
    const matches = [];
    for (const g of pm.addongroups || []) {
      if (!groupIds.has(String(g.addongroupid)) || String(g.active) === '0') continue;
      for (const a of g.addongroupitems || []) if (String(a.active) !== '0' && norm(a.addonitem_name) === n && Number.isFinite(Number(a.addonitem_price)) && Number(a.addonitem_price) >= 0 && Number.isInteger(Number(g.addongroupid))) matches.push({ id: String(a.addonitemid), name: a.addonitem_name, group_name: g.addongroup_name, price: String(a.addonitem_price), group_id: Number(g.addongroupid), quantity: '1' });
    }
    return matches.length === 1 ? matches[0] : null;
  }
  function selectedAddons(m, names) {
    if (!Array.isArray(names)) return null;
    const addons = names.map((name) => addonFor(m, name));
    if (addons.some((addon) => !addon) || new Set(addons.map((addon) => addon.group_id + ':' + addon.id)).size !== addons.length) return null;
    for (const link of addonLinks(m)) {
      const count = addons.filter((addon) => String(addon.group_id) === String(link.addon_group_id)).length;
      if (count < Number(link.addon_min_item || 0) || (link.addon_max_item !== undefined && count > Number(link.addon_max_item))) return null;
    }
    return addons;
  }


  /* sandbox testing: order Petpooja's own items by name (their sandbox menu is not ours) */
  function rawFind(spec) {
    if (!pm) return null;
    const candidates = pm.items.filter((item) => String(item.active) !== '0' && norm(item.itemname) === norm(spec.item));
    if (candidates.length !== 1) return null;
    const c = candidates[0];
    if (!spec.variation) return String(c.itemallowvariation) === '1' ? null : { item: c, variation: null };
    const variations = (c.variation || []).filter((variation) => String(variation.active) !== '0' && norm(variation.name) === norm(spec.variation));
    return variations.length === 1 ? { item: c, variation: variations[0] } : null;
  }
  function rawLine(spec) {
    const m = rawFind(spec);
    if (!m) return null;
    const base = Number(m.variation ? m.variation.price : m.item.price) || 0;
    let unit = base; const names = [];
    const addons = selectedAddons(m, spec.addons || []);
    if (!addons) return null;
    for (const addon of addons) { unit += Number(addon.price); names.push(addon.name); }
    return { id: 'pp-' + (m.variation ? m.variation.id : m.item.itemid), name: m.item.itemname + (m.variation ? ' (' + m.variation.name + ')' : ''), price: unit, qty: Math.max(1, parseInt(spec.qty, 10) || 1), addons: [], addonNames: names, ppRaw: spec };
  }

  /* ---------------- Save Order ---------------- */
  function buildOrder(order) {
    const restID = cfg.outletMap[order.outlet];
    if (!restID) return { skip: 'Outlet not on Petpooja' };
    if (!pm) return { error: 'unmapped', reason: 'No menu received from Petpooja yet' };
    if (String(pm.menusharingcode || "") !== String(restID)) return { error: "unmapped", reason: "The received menu does not belong to this configured Petpooja outlet" };
    if (order.posMenuReceivedAt && order.posMenuReceivedAt !== pm.receivedAt) return { error: 'unmapped', reason: 'Petpooja menu changed since checkout; paid order requires reconciliation' };
    if (!Array.isArray(order.items) || !order.items.length || order.items.some((item) => !item || !Number.isFinite(item.price) || item.price < 0 || !Number.isInteger(item.qty) || item.qty < 1) || (order.coupon && (!Number.isFinite(order.coupon.discount) || order.coupon.discount < 0)) || (order.deliveryFee !== undefined && (!Number.isFinite(order.deliveryFee) || order.deliveryFee < 0))) return { error: 'unmapped', reason: 'Invalid order amounts or quantities' };
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
      if (String(m.item.in_stock) === "0") return { error: "unmapped", reason: li.name + " is out of stock in Petpooja" };
      if (m.item.item_ordertype && !String(m.item.item_ordertype).split(",").includes(typeId)) return { error: "unmapped", reason: li.name + " is not enabled for this order type in Petpooja" };
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
      const addons = selectedAddons(m, li.addonNames || []);
      if (!addons) return { error: 'unmapped', reason: 'Invalid or missing add-on mapping or limits for ' + li.name };
      const posBase = Number(m.variation ? m.variation.price : m.item.price);
      const posUnit = posBase + addons.reduce((sum, addon) => sum + Number(addon.price), 0);
      if (!Number.isFinite(posBase) || posBase < 0 || Math.round(posUnit * 100) !== Math.round(li.price * 100)) return { error: 'unmapped', reason: 'Petpooja price mismatch for ' + li.name };
      lines.push({
        id: m.variation ? m.variation.id : m.item.itemid, name: m.item.itemname.replace(/\s*\[[o0]\]\s*$/i, ''), tax_inclusive: incl, gst_liability: 'restaurant', item_tax,
        item_discount: r2(unitDisc), price: r2(li.price), final_price: r2(li.price - unitDisc), quantity: String(li.qty), description: '',
        variation_name: m.variation ? m.variation.name : '', variation_id: m.variation ? m.variation.variationid : '', AddonItem: { details: addons }
      });
    }
    const now = new Date();
    const dcharge = order.deliveryFee || 0;
    const total = net + exclTax + dcharge;
    if (order.total !== undefined && (!Number.isFinite(order.total) || Math.round(total * 100) !== Math.round(order.total * 100))) return { error: 'unmapped', reason: 'Petpooja total does not match the paid order total' };
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
    if (order.pos && ['processing', 'pushed', 'unknown', 'failed'].includes(order.pos.status)) return;
    if (!configured()) { log({ order: order.id, status: 'skipped', reason: 'Petpooja not configured' }); return; }
    setPos(order, { status: 'queued' });
    const built = buildOrder(order);
    if (built.skip) { log({ order: order.id, outlet: order.outlet, status: 'skipped', reason: built.skip }); setPos(order, { status: 'skipped', reason: built.skip }); return; }
    if (built.error) { log({ order: order.id, status: 'unmapped', reason: built.reason }); setPos(order, { status: 'unmapped', reason: built.reason }); return; }
    setPos(order, { status: 'processing', attempts: (order.pos.attempts || 0) + 1, restID: String(built.restID), retrySafe: false });
    const attempt = order.pos.attempts;
      try {
        const r = await post(cfg.orderUrl, built.payload);
        if (r.ok && String(r.json.success) === '1') {
          log({ order: order.id, status: 'pushed', attempts: attempt, petpoojaOrderId: r.json.orderID, warnings: built.warnings });
          setPos(order, { status: 'pushed', petpoojaOrderId: r.json.orderID || '', attempts: attempt, reason: '', warnings: built.warnings });
          return;
        }
        const reason = 'HTTP ' + r.status + ' ' + (r.json.message || '') + ' ' + JSON.stringify(r.json.validation_errors || '').slice(0, 300);
        const status = r.status >= 400 && r.status < 500 ? 'failed' : 'unknown';
        setPos(order, { status, reason, retrySafe: false });
        log({ order: order.id, status, reason, attempts: attempt });
      } catch (error) {
        const retrySafe = ['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'UND_ERR_CONNECT_TIMEOUT'].includes(error.cause && error.cause.code);
        const status = retrySafe ? 'failed' : 'unknown';
        setPos(order, { status, reason: 'POS transport outcome requires recovery', retrySafe });
        log({ order: order.id, status, attempts: attempt, retrySafe });
      }
  }
  async function recoverPendingOrders() {
    const results = [];
    for (const order of db.orders) {
      if (!order.payment || order.payment.status !== 'paid' || (order.test && !order.ppForce)) continue;
      if (!cfg.outletMap[order.outlet] || ['CANCELLED', 'DELIVERED', 'SERVED'].includes(order.status)) continue;
      if (!order.pos || order.pos.status === 'processing') {
        setPos(order, { status: 'unknown', reason: 'Interrupted POS submission; reconcile with Petpooja before retry', retrySafe: false });
      } else if (order.posMenuReceivedAt && (order.pos.status === 'queued' || (order.pos.status === 'failed' && order.pos.retrySafe))) {
        setPos(order, { status: 'queued' });
        await pushOrder(order);
      }
      results.push({ id: order.id, status: order.pos && order.pos.status });
    }
    return results;
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
    if (!authed(token)) return { code: 401, json: { success: '0', message: 'Unauthorized' } };
    if (!body || typeof body !== 'object') return { code: 400, json: { success: '0', message: 'Invalid callback' } };
    const order = db.orders.find((o) => o.id === String(body.orderID));
    if (!order) { log({ type: 'callback', status: 'unknown-order', orderID: body.orderID }); return { code: 200, json: { success: '1', message: 'Order not found, ignored.' } }; }
    if (!cfg.outletMap[order.outlet] || String(body.restID || '') !== String(cfg.outletMap[order.outlet])) return { code: 400, json: { success: '0', message: 'Callback outlet mismatch' } };
    const st = String(body.status);
    let next = null;
    if (st === '-1') next = 'CANCELLED';
    else if (['1', '2', '3'].includes(st)) next = 'ACCEPTED';
    else if (st === '5') next = 'READY';
    else if (st === '4') next = order.mode === 'delivery' ? 'OUT_FOR_DELIVERY' : 'READY';
    else if (st === '10') next = order.mode === 'delivery' ? 'DELIVERED' : 'SERVED';
    if (!next) return { code: 200, json: { success: '1', message: 'Status ignored.' } };
    const cur = FLOW.indexOf(order.status);
    if (next === order.status) {
      let changed = false;
      if (!order.riderInfo && typeof body.rider_name === 'string' && body.rider_name) { order.riderInfo = { name: body.rider_name, phone: typeof body.rider_phone_number === 'string' ? body.rider_phone_number : '' }; changed = true; }
      if (!order.etaMin && Number.isFinite(Number(body.minimum_prep_time)) && Number(body.minimum_prep_time) > 0) { order.etaMin = Number(body.minimum_prep_time); changed = true; }
      if (changed) setPos(order, { posStatus: st });
      return { code: 200, json: { success: '1', message: 'No status change.' } };
    }
    if (['CANCELLED', 'DELIVERED', 'SERVED'].includes(order.status) || (next !== 'CANCELLED' && FLOW.indexOf(next) <= cur)) return { code: 200, json: { success: '1', message: 'No change.' } };
    order.status = next;
    order.history = order.history || [];
    order.history.push({ status: next, at: new Date().toISOString(), by: 'petpooja' });
    if (next === 'CANCELLED') { order.cancelReason = body.cancel_reason || ''; order.refundDue = order.payment && order.payment.status === 'paid' && order.payment.method !== 'test'; }
    if (body.rider_name) order.riderInfo = { name: body.rider_name, phone: body.rider_phone_number || '' };
    if (Number.isFinite(Number(body.minimum_prep_time)) && Number(body.minimum_prep_time) > 0) order.etaMin = Number(body.minimum_prep_time);
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
  const authed = (token) => !!cfg.pushToken && token === cfg.pushToken;
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
      menuMatchesConfiguredOutlet: !!(pm && Object.values(cfg.outletMap).map(String).includes(String(pm.menusharingcode || ""))),
      last: l[0] || null, pushedToday: l.filter((x) => x.status === 'pushed' && x.at && x.at.slice(0, 10) === new Date().toISOString().slice(0, 10)).length,
      failures: l.filter((x) => ["failed", "unmapped", "unknown"].includes(x.status)).length
    };
  }
  return { cfg, configured, handleMenuPush, buildOrder, pushOrder, recoverPendingOrders, resumeQueued: recoverPendingOrders, handleCallback, handleStock, handleStoreGet, rawLine, handleStoreSet, cancelOnPos, syncStock, status, log, findPp, hasMenu: () => !!pm };
};
