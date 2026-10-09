/* XTO Central Admin engine: live orders, dispatch, menu control */
'use strict';

const $ = (s, el) => (el || document).querySelector(s);
const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
const INR = (n) => '\u20B9' + Number(n).toLocaleString('en-IN');

const state = { pin: sessionStorage.getItem('xto_admin_pin') || '', orders: [], riders: [], stats: null, sse: null, known: new Set(), ready: false };

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('show'), 2200);
}
function beep() {
  if (!$('#soundToggle').checked) return;
  try {
    const ctx = state.audio || (state.audio = new (window.AudioContext || window.webkitAudioContext)());
    [0, 0.22, 0.44].forEach((t0) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.type = 'sine';
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.001, ctx.currentTime + t0);
      g.gain.exponentialRampToValueAtTime(0.28, ctx.currentTime + t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t0 + 0.2);
      o.start(ctx.currentTime + t0);
      o.stop(ctx.currentTime + t0 + 0.22);
    });
  } catch (e) {}
}
function timeAgo(iso) {
  if (typeof iso === 'string' && iso.startsWith('TODAY')) return iso.slice(6) + ' today';
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + ' min ago';
  const h = Math.floor(mins / 60);
  return h + 'h ' + (mins % 60) + 'm ago';
}
async function api(path, opts) {
  opts = opts || {};
  opts.headers = Object.assign({ 'Content-Type': 'application/json', 'x-admin-pin': state.pin }, opts.headers || {});
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { logout(); throw new Error('unauthorized'); }
  return data;
}

/* ---------------- PIN gate ---------------- */
let pinBuf = '';
function pressPin(d) {
  if (pinBuf.length >= 4) return;
  pinBuf += d;
  renderDots();
  if (pinBuf.length === 4) setTimeout(tryPin, 140);
}
function renderDots() {
  $$('#pinDots span').forEach((s, i) => s.classList.toggle('f', i < pinBuf.length));
}
async function tryPin() {
  const res = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: pinBuf }) });
  if (res.ok) {
    state.pin = pinBuf;
    sessionStorage.setItem('xto_admin_pin', pinBuf);
    $('#gate').classList.add('hidden');
    $('#shell').classList.remove('hidden');
    boot();
  } else {
    $('#gateErr').textContent = 'Wrong PIN. Try 4321 for the demo.';
    pinBuf = '';
    renderDots();
    setTimeout(() => ($('#gateErr').textContent = ''), 2200);
  }
}
function logout() {
  sessionStorage.removeItem('xto_admin_pin');
  location.reload();
}

/* ---------------- data ---------------- */
async function boot() {
  await Promise.all([refreshOrders(), refreshStats(), refreshIntegrations()]);
  connectSSE();
  state.ready = true;
}
async function refreshIntegrations() {
  try {
    const data = await api('/api/admin/integrations');
    const rzp = data.razorpay.live ? 'LIVE' : 'MOCK';
    const pp = data.petpooja.configured ? 'ON' : 'OFF';
    const bad = data.petpooja.failures > 0 ? ' bad' : '';
    const chip = document.getElementById('integrationChip');
    if (chip) chip.innerHTML = `<span class="pay-mode ${rzp === 'LIVE' ? 'ok' : ''}">Razorpay ${rzp}</span><span class="pay-mode ${pp === 'ON' ? 'ok' : ''}${bad}" title="${data.petpooja.last ? data.petpooja.last.status + ' ' + data.petpooja.last.at : 'not configured'}">Petpooja ${pp}</span>`;
  } catch (e) { /* status chips are cosmetic */ }
}
async function refreshOrders() {
  const data = await api('/api/admin/orders');
  const fresh = data.orders.filter((o) => !state.known.has(o.id + ':' + o.status));
  const brandNew = data.orders.filter((o) => o.status === 'PLACED' && !state.known.has(o.id + ':PLACED'));
  state.orders = data.orders;
  data.orders.forEach((o) => state.known.add(o.id + ':' + o.status));
  state.riders = data.riders;
  renderBoard();
  renderMenuMgr();
  if (state.ready && brandNew.length) { beep(); toast('New order ' + brandNew[0].id + ' just landed!'); }
}
async function refreshStats() {
  state.stats = await api('/api/admin/stats');
  renderStats();
}
function renderStats() {
  const s = state.stats || { revenue: 0, ordersToday: 0, avgOrder: 0, openOrders: 0 };
  $('#tbStats').innerHTML = `
    <div class="stat-chip gold"><small>Revenue today</small><b>${INR(s.revenue)}</b></div>
    <div class="stat-chip"><small>Orders today</small><b>${s.ordersToday}</b></div>
    <div class="stat-chip"><small>Avg order</small><b>${INR(s.avgOrder)}</b></div>
    <div class="stat-chip"><small>Open orders</small><b>${s.openOrders}</b></div>`;
}

/* ---------------- board ---------------- */
const COLS = [
  { id: 'new', label: 'New', statuses: ['PLACED'] },
  { id: 'prep', label: 'In Kitchen', statuses: ['ACCEPTED', 'PREPARING'] },
  { id: 'ready', label: 'Ready', statuses: ['READY'] }
];
function nextAction(o) {
  switch (o.status) {
    case 'PLACED': return { next: 'ACCEPTED', label: 'Accept Order', cls: '' };
    case 'ACCEPTED': return { next: 'PREPARING', label: 'Start Cooking', cls: '' };
    case 'PREPARING': return { next: 'READY', label: 'Mark Ready', cls: '' };
    case 'READY': return { next: 'SERVED', label: o.mode === 'dinein' ? 'Mark Served' : 'Handed Over', cls: 'done' };
    default: return null;
  }
}
function statusMini(s) {
  const map = { PLACED: 'NEW', ACCEPTED: 'ACCEPTED', PREPARING: 'COOKING', READY: 'READY', SERVED: 'DONE', DELIVERED: 'DONE', CANCELLED: 'CANCELLED' };
  return map[s] || s;
}
function cardHTML(o) {
  const act = nextAction(o);
  const outlet = o.outlet === 'shivane' ? 'Shivane' : 'Nanded City';
  const riderBox = ''; // sit-down and takeaway only: no dispatch leg
  return `<div class="ocard ${o.status === 'PLACED' ? 'fresh' : ''}" data-order="${o.id}">
    <div class="oc-top"><b>${o.id}</b><span class="oc-time">${timeAgo(o.createdAt)}</span></div>
    <div class="oc-cust">${o.customer.name} &bull; ${o.customer.phone}<a href="tel:${o.customer.phone}">call</a><br />
      <span style="color:var(--muted)">${o.mode === 'dinein' ? (o.customer.tableNumber ? 'Table ' + o.customer.tableNumber : 'Dine-in') : 'Takeaway at counter'}</span></div>
    <div class="oc-items">
      ${o.items.map((i) => `<div class="oi"><span>${i.qty} x ${i.name}</span><span>${INR(i.price * i.qty)}</span></div>`).join('')}
    </div>
    <div class="oc-meta">
      <span class="meta-chip mode">${o.mode === 'dinein' ? ('🍽 Dine-in' + (o.customer.tableNumber ? ' - T' + o.customer.tableNumber : '')) : '🥡 Takeaway'}</span>
      <span class="meta-chip">${outlet}</span>
      <span class="meta-chip paid">PAID ${INR(o.total)}</span>
    </div>
    ${riderBox}
    <div class="oc-actions">
      ${act ? `<button class="btn-adv ${act.cls}" data-advance="${o.id}" data-next="${act.next}">${act.label}</button>` : ''}
      <button class="btn-cancel" data-cancel="${o.id}">Cancel order</button>
    </div>
  </div>`;
}
function renderBoard() {
  const recentDone = state.orders.filter((o) => ['SERVED', 'DELIVERED', 'CANCELLED'].includes(o.status)).slice(0, 8);
  $('#board').innerHTML = COLS.map((c) => {
    const orders = state.orders.filter((o) => c.statuses.includes(o.status));
    return `<div class="col ${c.id}">
      <div class="col-head"><h3>${c.label}</h3><span class="col-count">${orders.length}</span></div>
      ${orders.length ? orders.map(cardHTML).join('') : '<div class="col-empty">Nothing here right now</div>'}
    </div>`;
  }).join('') + `
    <div class="col done-list">
      <div class="col-head"><h3>Completed &amp; History</h3><span class="col-count">${recentDone.length}</span></div>
      ${recentDone.length ? recentDone.map((o) => `
        <div class="done-strip">
          <b>${o.id}</b>
          <span class="ds-muted">${o.customer.name} &bull; ${statusMini(o.status)} &bull; ${timeAgo(o.createdAt)}</span>
          <span class="ds-total">${INR(o.total)}</span>
        </div>`).join('') : '<div class="col-empty">No completed orders yet</div>'}
    </div>`;
  bindBoard();
}
function bindBoard() {
  $$('[data-advance]').forEach((b) => b.addEventListener('click', async () => {
    const id = b.dataset.advance;
    const next = b.dataset.next;
    const o = state.orders.find((x) => x.id === id);
    const body = { status: next };
    await api(`/api/admin/orders/${id}/status`, { method: 'POST', body: JSON.stringify(body) });
    await refreshOrders(); refreshStats();
    toast(id + ': ' + statusMini(next));
  }));
  $$('[data-cancel]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Cancel ' + b.dataset.cancel + '?')) return;
    await api(`/api/admin/orders/${b.dataset.cancel}/status`, { method: 'POST', body: JSON.stringify({ status: 'CANCELLED' }) });
    await refreshOrders(); refreshStats();
    toast(b.dataset.cancel + ' cancelled');
  }));
  $$('[data-rider-set]').forEach((b) => b.addEventListener('click', async () => {
    const id = b.dataset.riderSet;
    const sel = $(`[data-rider-sel="${id}"]`);
    if (!sel.value) { toast('Pick a rider first'); return; }
    await api(`/api/admin/orders/${id}/rider`, { method: 'POST', body: JSON.stringify({ rider: sel.value }) });
    await refreshOrders();
    toast(sel.value + ' assigned to ' + id);
  }));
}

/* ---------------- menu manager ---------------- */
let menuItems = [];
let menuCategories = null;
async function renderMenuMgr() {
  if (!menuCategories) {
    const pub = await fetch('/api/menu').then((r) => r.json()).catch(() => null);
    menuCategories = (pub && pub.categories) || [];
  }
  if (menuCategories.length && $('#naCat') && !$('#naCat').options.length) {
    menuCategories.forEach((c) => { const o = document.createElement('option'); o.value = c.id; o.textContent = c.name; $('#naCat').appendChild(o); });
  }
  if (!$('#menuMgr').classList.contains('hidden') || !menuItems.length) {
    const data = await api('/api/admin/menu');
    menuItems = data.items;
    paintMenuMgr();
  }
}
function paintMenuMgr() {
  const q = ($('#mmSearch').value || '').toLowerCase();
  const items = menuItems.filter((i) => !q || i.name.toLowerCase().includes(q));
  $('#mmGrid').innerHTML = items.map((i) => `
    <div class="mm-card">
      ${i.img ? `<img src="/images/${i.img}.jpg" alt="" onerror="this.style.visibility='hidden'" />` : '<img alt="" />'}
      <div class="mmc-body"><h4>${i.name}</h4><p>${INR(i.price)} &bull; ${i.cat}</p></div>
      <div class="toggle ${i.available ? 'on' : ''}" data-toggle="${i.id}" title="Toggle availability"></div>
    </div>`).join('');
  $$('[data-toggle]').forEach((t) => t.addEventListener('click', async () => {
    const id = t.dataset.toggle;
    const item = menuItems.find((x) => x.id === id);
    const next = !item.available;
    await api(`/api/admin/menu/${id}/availability`, { method: 'POST', body: JSON.stringify({ available: next }) });
    item.available = next;
    paintMenuMgr();
    toast(item.name + (next ? ' is back on the menu' : ' marked sold out'));
  }));
}

/* ---------------- SSE live ---------------- */
function connectSSE() {
  if (state.sse) state.sse.close();
  const es = new EventSource('/api/events');
  state.sse = es;
  es.addEventListener('order:new', (e) => { const o = JSON.parse(e.data); beep(); toast('New order ' + o.id + ' from ' + o.customer.name + '!'); refreshOrders(); refreshStats(); });
  es.addEventListener('order:update', () => { refreshOrders(); refreshStats(); });
  es.addEventListener('menu:update', () => { menuItems = []; renderMenuMgr(); });
  es.addEventListener('rider:pos', (e) => { state.riderPos = JSON.parse(e.data); paintRidersOnMap(); paintRidersList(); });
  es.addEventListener('offers:update', () => { if (!$('#offersPane').classList.contains('hidden')) refreshOffers(); });
  es.onerror = () => $('#liveDot').textContent = 'RECONNECTING';
  es.onopen = () => $('#liveDot').textContent = 'LIVE';
}

/* ---------------- bind ---------------- */
$('#pinPad').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.classList.contains('pin-clear')) { pinBuf = ''; renderDots(); return; }
  if (b.classList.contains('pin-back')) { pinBuf = pinBuf.slice(0, -1); renderDots(); return; }
  pressPin(b.textContent.trim());
});
document.addEventListener('keydown', (e) => {
  if (!$('#gate').classList.contains('hidden')) {
    if (/^\d$/.test(e.key)) pressPin(e.key);
    if (e.key === 'Backspace') { pinBuf = pinBuf.slice(0, -1); renderDots(); }
  }
});
const PANES = { orders: 'board', menu: 'menuMgr', riders: 'ridersPane', offers: 'offersPane', notify: 'notifyPane' };
$$('.tab').forEach((t) => t.addEventListener('click', () => {
  $$('.tab').forEach((x) => x.classList.toggle('active', x === t));
  Object.entries(PANES).forEach(([k, id]) => $('#' + id).classList.toggle('hidden', k !== t.dataset.tab));
  if (t.dataset.tab === 'menu') renderMenuMgr();
  if (t.dataset.tab === 'riders') { initRidersPane(); refreshRiders(); }
  if (t.dataset.tab === 'offers') refreshOffers();
  if (t.dataset.tab === 'notify') refreshNotifyStats();
}));
$('#mmSearch').addEventListener('input', paintMenuMgr);

if (state.pin) {
  // restore session within the same tab
  fetch('/api/admin/stats', { headers: { 'x-admin-pin': state.pin } }).then((r) => {
    if (r.ok) { $('#gate').classList.add('hidden'); $('#shell').classList.remove('hidden'); boot(); }
    else sessionStorage.removeItem('xto_admin_pin');
  }).catch(() => {});
}

/* ---------------- riders pane ---------------- */
const RIDER_HOME_GEO = { shivane: [18.4649, 73.8078], nanded: [18.4720, 73.8093] };
let ridersMap = null, ridersLoaded = false;
function initRidersPane() {
  if (ridersMap || !window.L) return;
  ridersMap = L.map('ridersMap', { scrollWheelZoom: false }).setView(RIDER_HOME_GEO.shivane, 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap', maxZoom: 19 }).addTo(ridersMap);
  Object.entries(RIDER_HOME_GEO).forEach(([k, c]) => L.marker(c, { opacity: 0.7 }).addTo(ridersMap).bindPopup(k === 'shivane' ? 'Shivane outlet' : 'Nanded City outlet'));
}
async function refreshRiders() {
  const data = await api('/api/admin/riders');
  state.riders = data.riders;
  state.riderPos = data.pos;
  state.riderSim = data.sim || [];
  paintRidersOnMap();
  paintRidersList();
}
function paintRidersOnMap() {
  if (!ridersMap) return;
  (state._riderMarkers || []).forEach((mk) => ridersMap.removeLayer(mk));
  state._riderMarkers = [];
  const pos = state.riderPos || {};
  for (const r of state.riders || []) {
    if (!pos[r.id]) continue;
    const mk = L.circleMarker([pos[r.id].lat, pos[r.id].lng], {
      radius: 9, color: '#fff', weight: 2.5,
      fillColor: pos[r.id].orderId ? '#f0731d' : '#7ce38b', fillOpacity: 1
    }).addTo(ridersMap);
    const order = (state.orders || []).find((o) => o.id === pos[r.id].orderId);
    mk.bindPopup('<b>' + r.name + '</b> (' + (r.vehicle || 'Bike') + ')' +
      (order ? '<br>Order ' + order.id + ' - ' + order.customer.name + '<br>' + (order.customer.address || '') : '<br>Free, no order assigned'));
    state._riderMarkers.push(mk);
  }
}
function paintRidersList() {
  const pos = state.riderPos || {};
  const sim = state.riderSim || [];
  $('#ridersList').innerHTML = (state.riders || []).map((r) => {
    const p = pos[r.id];
    const order = p && p.orderId ? (state.orders || []).find((o) => o.id === p.orderId) : null;
    const when = p ? timeAgo(p.at) : 'never seen';
    return `<div class="rider-row${r.active ? '' : ' off'}">
      <div class="rr-main">
        <b>${r.name}</b><span>${r.vehicle || 'Bike'} - ${r.phone}</span>
        <span class="rr-live">${p ? (order ? 'On order ' + order.id + ' - ' + (order.customer.name || '') : 'Live, free') + ' - ' + when : 'No GPS yet'}</span>
      </div>
      <div class="rr-actions">
        <button class="rr-btn${sim.includes(r.id) ? ' on' : ''}" data-sim="${r.id}">${sim.includes(r.id) ? 'Stop sim' : 'Simulate'}</button>
        <button class="rr-btn danger" data-rider-off="${r.id}">${r.active ? 'Pause' : 'Activate'}</button>
      </div>
    </div>`;
  }).join('');
  $$('[data-sim]').forEach((b) => b.addEventListener('click', async () => {
    const id = b.dataset.sim;
    const on = sim.includes(id);
    await api(`/api/admin/riders/${id}/state`, { method: 'POST', body: JSON.stringify({ simulate: !on }) });
    toast(!on ? 'Demo walk started. Watch the map.' : 'Sim stopped.');
    refreshRiders();
  }));
  $$('[data-rider-off]').forEach((b) => b.addEventListener('click', async () => {
    const r = (state.riders || []).find((x) => x.id === b.dataset.riderOff);
    await api(`/api/admin/riders/${r.id}/state`, { method: 'POST', body: JSON.stringify({ active: !r.active }) });
    refreshRiders();
  }));
}
$('#rAdd')?.addEventListener('click', async () => {
  const r = await api('/api/admin/riders', { method: 'POST', body: JSON.stringify({ name: $('#rName').value, phone: $('#rPhone').value, home: $('#rHome').value }) }).catch((e) => ({ error: e.message }));
  if (r.error) return toast(r.error);
  $('#rName').value = ''; $('#rPhone').value = '';
  toast(r.rider.name + ' added to the roster.');
  refreshRiders();
});
setInterval(() => { if (!$('#ridersPane').classList.contains('hidden')) refreshRiders(); }, 10000);

/* ---------------- offers pane ---------------- */
async function refreshOffers() {
  const data = await api('/api/admin/offers');
  const subs = await api('/api/admin/notify-stats').catch(() => null);
  $('#offersList').innerHTML = (data.offers || []).map((o) => `
    <div class="offer-row${o.active === false ? ' off' : ''}">
      <div class="orr-main"><b>${o.code}</b><span>${o.type === 'percent' ? o.value + '% off' : INR(o.value) + ' off'}${o.minOrder ? ' above ' + INR(o.minOrder) : ''}</span></div>
      <div class="orr-label">${o.label || ''}</div>
      <button class="rr-btn${o.active === false ? '' : ' on'}" data-offer-toggle="${o.code}">${o.active === false ? 'Activate' : 'Running'}</button>
    </div>`).join('') || '<div class="empty-note">No offers yet. Create the first one above.</div>';
  $$('[data-offer-toggle]').forEach((b) => b.addEventListener('click', async () => {
    const code = b.dataset.offerToggle;
    const o = data.offers.find((x) => x.code === code);
    await api(`/api/admin/offers/${code}/state`, { method: 'POST', body: JSON.stringify({ active: o.active === false }) });
    toast('Offer ' + code + (o.active === false ? ' is live' : ' paused'));
    refreshOffers();
  }));
}
$('#ofSubmit')?.addEventListener('click', async () => {
  const r = await api('/api/admin/offers', { method: 'POST', body: JSON.stringify({
    code: $('#ofCode').value, type: $('#ofType').value, value: $('#ofValue').value, minOrder: $('#ofMin').value, label: $('#ofLabel').value
  }) }).catch((e) => ({ error: e.message }));
  if (r.error) { $('#ofMsg').textContent = r.error; $('#ofMsg').className = 'mm-msg bad'; return; }
  $('#ofMsg').textContent = r.offer.code + ' is live on the site and app.';
  $('#ofMsg').className = 'mm-msg good';
  ['ofCode', 'ofValue', 'ofMin', 'ofLabel'].forEach((id) => $('#' + id).value = '');
  refreshOffers();
});

/* ---------------- notify pane ---------------- */
async function refreshNotifyStats() {
  const s = await api('/api/admin/notify-stats').catch(() => null);
  $('#ntStats').textContent = s ? s.count + ' device(s) currently subscribed to push updates.' : '';
}
$('#ntSend')?.addEventListener('click', async () => {
  $('#ntMsg').textContent = 'Sending...';
  $('#ntMsg').className = 'mm-msg';
  const r = await api('/api/admin/notify', { method: 'POST', body: JSON.stringify({
    title: $('#ntTitle').value, body: $('#ntBody').value, phone: $('#ntPhone').value
  }) }).catch((e) => ({ error: e.message }));
  if (r.error) { $('#ntMsg').textContent = r.error; $('#ntMsg').className = 'mm-msg bad'; return; }
  $('#ntMsg').textContent = 'Delivered to ' + r.sent + ' of ' + r.targets + ' device(s).';
  $('#ntMsg').className = 'mm-msg good';
  refreshNotifyStats();
});

/* ---------------- menu add item ---------------- */
$('#naSubmit')?.addEventListener('click', async () => {
  $('#naMsg').textContent = 'Uploading...';
  $('#naMsg').className = 'mm-msg';
  let imageData = null;
  const fileInput = $('#naImage');
  if (fileInput.files && fileInput.files[0]) {
    imageData = await new Promise((done) => {
      const fr = new FileReader();
      fr.onload = () => done(fr.result);
      fr.readAsDataURL(fileInput.files[0]);
    });
  }
  const r = await api('/api/admin/menu', { method: 'POST', body: JSON.stringify({
    name: $('#naName').value, cat: $('#naCat').value, price: $('#naPrice').value, desc: $('#naDesc').value, imageData
  }) }).catch((e) => ({ error: e.message }));
  if (r.error) { $('#naMsg').textContent = r.error; $('#naMsg').className = 'mm-msg bad'; return; }
  $('#naMsg').textContent = r.item.name + ' is live on the menu at ' + INR(r.item.price) + '.';
  $('#naMsg').className = 'mm-msg good';
  ['naName', 'naPrice', 'naDesc'].forEach((id) => $('#' + id).value = '');
  fileInput.value = '';
  menuItems = [];
  renderMenuMgr();
});
