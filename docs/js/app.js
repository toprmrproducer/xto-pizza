/* XTO Pizza PWA app engine */
'use strict';

const $ = (s, el) => (el || document).querySelector(s);
const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
const INR = (n) => '\u20B9' + Number(n).toLocaleString('en-IN');
const CART_KEY = 'xto_cart_v1';
const PHONE_KEY = 'xto_phone';

const state = { menu: null, outlets: [], cat: 'all', cart: loadCart(), phone: localStorage.getItem(PHONE_KEY) || '', payCtx: null, coupon: null, offers: [], appMaps: {} };

function loadCart() { try { return JSON.parse(localStorage.getItem(CART_KEY)) || {}; } catch (e) { return {}; } }
function saveCart() { localStorage.setItem(CART_KEY, JSON.stringify(state.cart)); }
function cartCount() { return Object.values(state.cart).reduce((s, q) => s + q, 0); }
function cartLines() {
  return Object.entries(state.cart).map(([id, qty]) => {
    const item = state.menu.items.find((i) => i.id === id);
    return item ? { ...item, qty } : null;
  }).filter(Boolean);
}
function checkedMode() { return ($('input[name="mode"]:checked') || {}).value || 'delivery'; }
function modeDeliverySelected() { return checkedMode() === 'delivery'; }
function cartTotals() {
  const lines = cartLines();
  const itemTotal = lines.reduce((s, l) => s + l.price * l.qty, 0);
  const discount = state.coupon ? Math.min(state.coupon.discount, itemTotal) : 0;
  return { lines, itemTotal, deliveryFee: 0, discount, total: itemTotal - discount };
}
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('show'), 2200);
}

/* ---------------- boot ---------------- */
async function boot() {
  const [menuRes, outletsRes] = await Promise.all([fetch('/api/menu').then((r) => r.json()), fetch('/api/outlets').then((r) => r.json())]);
  state.menu = menuRes;
  state.outlets = outletsRes.outlets;
  renderQuick();
  renderBest();
  renderComboStrip();
  renderOutletCards();
  renderTabs();
  renderMenuList();
  renderAppPromos();
  renderAppOffers();
  bindUI();
  document.getElementById('couponApply')?.addEventListener('click', applyCouponFromField);
  document.getElementById('appLocateBtn')?.addEventListener('click', appLocate);
  document.getElementById('enableUpdatesBtn')?.addEventListener('click', onEnableUpdates);
  updateCartUI();
  if (state.phone) { $('#phoneInput').value = state.phone; loadOrders(); }
  registerSW();
  installHint();
}

function registerSW() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
}

function installHint() {
  let deferred = null;
  const isStandalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const dismissed = localStorage.getItem('xto_install_dismissed');
  if (isStandalone || dismissed) return;
  window.addEventListener('beforeinstallprompt', (e) => { deferred = e; });
  setTimeout(() => {
    if (isStandalone) return;
    $('#installText').innerHTML = isIOS
      ? 'On iPhone: tap the <b>Share</b> button in Safari, then choose <b>Add to Home Screen</b>. The XTO app installs like a native app.'
      : 'Open this page in Chrome and tap <b>Add to Home Screen</b> (or use the install icon in the address bar) to install the XTO app.';
    $('#installSheet').classList.add('show');
  }, 2500);
}

/* ---------------- home ---------------- */
const CAT_EMOJI = { pizza: '🍕', burgers: '🍔', sandwich: '🥪', pasta: '🍝', sides: '🍟', wraps: '🌯', combos: '🎯', beverages: '🍹', 'coffee-shakes': '🥤' };
function renderQuick() {
  $('#quickGrid').innerHTML = state.menu.categories.map((c) => `
    <button class="quick-cat" data-cat="${c.id}"><span class="qemoji">${CAT_EMOJI[c.id] || '🍽️'}</span>${c.name.split(' ')[0]}</button>`).join('');
  $$('#quickGrid .quick-cat').forEach((b) => b.addEventListener('click', () => {
    gotoView('menu');
    state.cat = b.dataset.cat;
    syncTabs();
    renderMenuList();
  }));
}
function renderBest() {
  const best = state.menu.items.filter((i) => (i.tags || []).includes('bestseller')).slice(0, 8);
  $('#bestRow').innerHTML = best.map((i) => `
    <div class="bcard">
      <img src="images/${i.img}.jpg" alt="" loading="lazy" onerror="this.src='images/pizza-closeup.jpg'" />
      <div><h4>${i.name}</h4><div class="bp"><b>${INR(i.price)}</b><button data-add="${i.id}">ADD</button></div></div>
    </div>`).join('');
  $$('#bestRow [data-add]').forEach((b) => b.addEventListener('click', () => addToCart(b.dataset.add)));
}
function renderComboStrip() {
  const combos = state.menu.items.filter((i) => i.cat === 'combos');
  $('#comboStrip').innerHTML = combos.map((c) => `
    <div class="cstrip-card">
      <img src="images/${c.img}.jpg" alt="" loading="lazy" />
      <div class="cstrip-info"><div><h4>${c.name}</h4></div><b>${INR(c.price)}</b></div>
    </div>`).join('');
  $$('.cstrip-card').forEach((el, idx) => el.addEventListener('click', () => { addToCart(combos[idx].id); }));
}
function renderOutletCards() {
  $('#outletCards').innerHTML = state.outlets.map((o) => `
    <div class="outlet-mini">
      <div><h4>${o.name.replace('XTO Pizza ', '')}</h4><p>${o.hours} &bull; ${o.phone}</p></div>
      <a href="${o.maps}" target="_blank" rel="noopener">Maps ↗</a>
    </div>`).join('');
}

/* ---------------- menu ---------------- */
function renderTabs() {
  $('#catTabs').innerHTML = `<button class="m-tab active" data-cat="all">All</button>` +
    state.menu.categories.map((c) => `<button class="m-tab" data-cat="${c.id}">${c.name}</button>`).join('');
  $$('#catTabs .m-tab').forEach((b) => b.addEventListener('click', () => {
    state.cat = b.dataset.cat;
    syncTabs();
    renderMenuList();
  }));
}
function syncTabs() {
  $$('#catTabs .m-tab').forEach((x) => x.classList.toggle('active', x.dataset.cat === state.cat));
}
function rowHTML(item) {
  const hue = [...item.id].reduce((s, c) => s + c.charCodeAt(0), 0) % 3;
  const grads = ['linear-gradient(135deg,#f0731d,#b3271e)', 'linear-gradient(135deg,#2f7d5b,#173f2e)', 'linear-gradient(135deg,#ffc53d,#f0731d)'];
  const media = item.img
    ? `<img src="images/${item.img}.jpg" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='grid'"><div class="r-fallback" style="display:none;background:${grads[hue]}">${item.name[0]}</div>`
    : `<div class="r-fallback" style="background:${grads[hue]}">${item.name[0]}</div>`;
  const tag = (item.tags || []).includes('bestseller') ? '<span class="tag-mini">Bestseller</span>' :
    (item.tags || []).includes('deal') ? '<span class="tag-mini" style="background:var(--red);color:#fff">Deal</span>' : '';
  const ctl = !item.available ? '<span class="soldout-tag">Sold out</span>'
    : state.cart[item.id]
      ? `<div class="r-stepper"><button data-dec="${item.id}">−</button><span>${state.cart[item.id]}</span><button data-inc="${item.id}">+</button></div>`
      : `<button class="r-add" data-add="${item.id}">ADD +</button>`;
  return `<div class="m-row" id="row-${item.id}">
    <div>
      <span class="veg-dot"></span><h4>${item.name}</h4>${tag}
      <div class="rd">${item.desc}</div>
      <div class="r-foot"><b>${INR(item.price)}</b>${ctl}</div>
    </div>
    <div class="r-img">${media}</div>
  </div>`;
}
function renderMenuList() {
  const q = ($('#menuSearch').value || '').toLowerCase().trim();
  const cats = state.cat === 'all' ? state.menu.categories : state.menu.categories.filter((c) => c.id === state.cat);
  let html = '';
  for (const cat of cats) {
    const items = state.menu.items.filter((i) => i.cat === cat.id && (!q || (i.name + ' ' + i.desc).toLowerCase().includes(q)));
    if (!items.length) continue;
    if (state.cat === 'all') html += `<div class="sec-label" style="padding-left:0">${cat.name}</div>`;
    html += items.map(rowHTML).join('');
  }
  $('#menuList').innerHTML = html || '<div class="empty-state"><b>Nothing found</b>Try "paneer", "fries" or "shake".</div>';
  bindRows();
}
function bindRows(root) {
  const scope = root || $('#menuList');
  $$('[data-add]', scope).forEach((b) => b.addEventListener('click', () => addToCart(b.dataset.add)));
  $$('[data-inc]', scope).forEach((b) => b.addEventListener('click', () => { state.cart[b.dataset.inc] = Math.min(20, (state.cart[b.dataset.inc] || 0) + 1); saveCart(); refreshRow(b.dataset.inc); updateCartUI(); }));
  $$('[data-dec]', scope).forEach((b) => b.addEventListener('click', () => {
    state.cart[b.dataset.dec] = (state.cart[b.dataset.dec] || 0) - 1;
    if (state.cart[b.dataset.dec] <= 0) delete state.cart[b.dataset.dec];
    saveCart(); refreshRow(b.dataset.dec); updateCartUI();
  }));
}
function refreshRow(id) {
  const item = state.menu.items.find((i) => i.id === id);
  const row = $('#row-' + id);
  if (row && item) {
    row.outerHTML = rowHTML(item);
    bindRows($('#row-' + id));
  }
}
function addToCart(id) {
  state.cart[id] = (state.cart[id] || 0) + 1;
  saveCart(); updateCartUI(); refreshRow(id);
  const item = state.menu.items.find((i) => i.id === id);
  toast(item.name + ' added');
}

/* ---------------- cart ---------------- */
function updateCartUI() {
  const n = cartCount();
  $('#cartCount').textContent = n;
  $('#tabBadge').textContent = n;
  const body = $('#cartBody');
  const { lines, itemTotal, deliveryFee, total } = cartTotals();
  if (!lines.length) {
    body.innerHTML = '<div class="empty-state"><b>Cart is empty</b>The oven is hot. Add something delicious.<button class="btn-primary" data-goto="menu">Browse Menu</button></div>';
    const b = $('[data-goto]', body);
    if (b) b.addEventListener('click', () => gotoView('menu'));
    return;
  }
  body.innerHTML = lines.map((l) => {
    const media = l.img ? `<img src="images/${l.img}.jpg" alt="" onerror="this.outerHTML='<div class=\\'r-fallback\\' style=\\'background:linear-gradient(135deg,#f0731d,#b3271e)\\'>${l.name[0]}</div>'" />` : `<div class="r-fallback" style="background:linear-gradient(135deg,#f0731d,#b3271e)">${l.name[0]}</div>`;
    return `<div class="cart-line">${media}
      <div><h4>${l.name}</h4><div class="clp">${INR(l.price)} each</div></div>
      <div class="cl-stepper"><button data-cdec="${l.id}">−</button><span>${l.qty}</span><button data-cinc="${l.id}">+</button></div>
    </div>`;
  }).join('') + `
    <div class="bill-card">
      <div class="bill-row"><span>Item total</span><span>${INR(itemTotal)}</span></div>
      <div class="bill-row"><span>Delivery fee</span><span>${deliveryFee === 0 ? 'FREE' : INR(deliveryFee)}</span></div>
      <div class="bill-row big"><span>To pay</span><span>${INR(total)}</span></div>
    </div>
    <button class="btn-primary block" id="ckOpenBtn">Checkout ${INR(total)}</button>`;
  $$('#cartBody [data-cinc]').forEach((b) => b.addEventListener('click', () => { state.cart[b.dataset.cinc]++; saveCart(); updateCartUI(); refreshRow(b.dataset.cinc); }));
  $$('#cartBody [data-cdec]').forEach((b) => b.addEventListener('click', () => {
    state.cart[b.dataset.cdec]--; if (state.cart[b.dataset.cdec] <= 0) delete state.cart[b.dataset.cdec];
    saveCart(); updateCartUI(); refreshRow(b.dataset.cdec);
  }));
  $('#ckOpenBtn').addEventListener('click', openCheckout);
}

/* ---------------- checkout + payment ---------------- */
function openCheckout() {
  $('#ckOutlet').innerHTML = state.outlets.map((o) => `<option value="${o.id}">${o.name}</option>`).join('');
  $('#tableField').style.display = checkedMode() === 'dinein' ? '' : 'none';
  if (state.phone) { $('#ckPhone').value = state.phone; }
  updateBill();
  $('#ckError').textContent = '';
  $('#checkoutSheet').classList.add('show');
}
function updateBill() {
  const { lines, itemTotal, deliveryFee, total } = cartTotals();
  if (!lines.length) return;
  $('#billBox').innerHTML = `
    <div class="bill-row"><span>Items (${lines.reduce((s, l) => s + l.qty, 0)})</span><span>${INR(itemTotal)}</span></div>
    <div class="bill-row"><span>Delivery</span><span>${deliveryFee === 0 ? 'FREE' : INR(deliveryFee)}</span></div>
    <div class="bill-row big"><span>To pay</span><span>${INR(total)}</span></div>`;
}

async function startPayment() {
  const errEl = $('#ckError');
  errEl.textContent = '';
  const name = $('#ckName').value.trim();
  const phone = $('#ckPhone').value.replace(/\D/g, '');
  const tableNumber = ($('#ckTable') ? $('#ckTable').value : '').trim();
  const mode = checkedMode();
  if (name.length < 2) { errEl.textContent = 'Please enter your name.'; return; }
  if (!/^[6-9]\d{9}$/.test(phone)) { errEl.textContent = 'Valid 10-digit mobile required.'; return; }
  if (mode === 'dinein' && !tableNumber) { errEl.textContent = 'Please enter your table number.'; return; }
  localStorage.setItem(PHONE_KEY, phone);
  state.phone = phone;
  const { total } = cartTotals();

  $('#payBtn').disabled = true;
  $('#payBtn').textContent = 'Opening checkout...';
  try {
    const intent = await fetch('/api/pay/intent', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: total * 100 })
    }).then((r) => r.json());
    state.payCtx = { intent, customer: { name, phone, tableNumber }, mode, outlet: $('#ckOutlet').value, total };
    $('#payBtn').disabled = false;
    $('#payBtn').textContent = 'Pay Securely';
    if (intent.live) { openRazorpayLiveCheckout(); return; }
    $('#rzpAmount').textContent = INR(total);
    $('#rzpDesc').textContent = (mode === 'dinein' ? 'Dine-in' : 'Takeaway') + ' \u2022 ' + $('#ckOutlet option:checked').textContent;
    $('#rzpPayLabel').textContent = 'Pay ' + INR(total);
    $('#rzpPayBtn').disabled = false;
    $('#rzpSuccess').classList.add('hidden');
    $('#checkoutSheet').classList.remove('show');
    $('#rzpModal').classList.add('show');
  } catch (e) {
    errEl.textContent = 'Could not start payment. Try again.';
  }
  $('#payBtn').disabled = false;
  $('#payBtn').textContent = 'Pay Securely';
}

async function placeOrderAfterPayment(ctx, payment) {
  const res = await fetch('/api/orders', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mode: ctx.mode, outlet: ctx.outlet, customer: ctx.customer,
      items: cartLines().map((l) => ({ id: l.id, qty: l.qty })),
      couponCode: state.coupon ? state.coupon.code : undefined,
      payment
    })
  }).then((r) => r.json());
  if (!res.ok) throw new Error(res.error || 'order failed');
  return res;
}

function openRazorpayLiveCheckout() {
  $('#checkoutSheet').classList.remove('show');
  const ctx = state.payCtx;
  const fail = (msg) => {
    toast(msg);
    openCheckout();
  };
  const launch = () => {
    const rzp = new Razorpay({
      key: ctx.intent.keyId,
      order_id: ctx.intent.gatewayOrderId,
      amount: ctx.intent.amount,
      currency: 'INR',
      name: 'XTO Pizza',
      description: (ctx.mode === 'dinein' ? 'Dine-in' : 'Takeaway') + ' \u2022 ' + ctx.outlet,
      prefill: { name: ctx.customer.name, contact: ctx.customer.phone },
      theme: { color: '#e8590c' },
      handler: async (resp) => {
        try {
          const cap = await fetch('/api/pay/capture', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(resp)
          }).then((r) => r.json());
          if (!cap.paid) throw new Error('verification failed');
          const res = await placeOrderAfterPayment(ctx, { status: 'paid', paymentId: cap.paymentId });
          $('#rzpPayId').textContent = 'Payment ID: ' + cap.paymentId;
          $('#rzpSuccess').classList.remove('hidden');
          setTimeout(() => {
            state.cart = {}; saveCart(); updateCartUI();
            $('#successOrderId').textContent = res.order.id;
            renderTimeline($('#trackBox'), res.order);
            $('#successSheet').classList.add('show');
            $('#successDone').textContent = 'Track My Order';
            loadOrders();
          }, 600);
        } catch (e) { fail('Payment could not be verified. Try again.'); }
      },
      modal: { ondismiss: () => fail('Payment cancelled. No money moved.') }
    });
    rzp.on('payment.failed', () => fail('Payment failed. No money moved.'));
    rzp.open();
  };
  if (window.Razorpay) return launch();
  const s = document.createElement('script');
  s.src = 'https://checkout.razorpay.com/v1/checkout.js';
  s.onload = launch;
  s.onerror = () => fail('Could not reach the payment gateway. Check the connection.');
  document.head.appendChild(s);
}

async function confirmPayment() {
  const btn = $('#rzpPayBtn');
  btn.disabled = true;
  btn.textContent = 'Processing...';
  await new Promise((r) => setTimeout(r, 1100));
  const ctx = state.payCtx;
  try {
    const cap = await fetch('/api/pay/capture', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gatewayOrderId: ctx.intent.gatewayOrderId })
    }).then((r) => r.json());
    if (!cap.paid) throw new Error('capture failed');
    const res = await placeOrderAfterPayment(ctx, { status: 'paid', paymentId: cap.paymentId });
    $('#rzpPayId').textContent = 'Payment ID: ' + cap.paymentId;
    $('#rzpSuccess').classList.remove('hidden');
    setTimeout(() => {
      $('#rzpModal').classList.remove('show');
      state.cart = {}; saveCart(); state.coupon = null; const cf = $('#ckCoupon'); if (cf) cf.value = ''; const cm = $('#couponMsg'); if (cm) cm.textContent = '';
      updateCartUI();
      lastAppOrder = res.order;
      $('#successOrderId').textContent = res.order.id;
      renderTimeline($('#trackBox'), res.order);
      $('#successSheet').classList.add('show');
      $('#successDone').textContent = 'Track My Order';
      loadOrders();
    }, 1200);
  } catch (e) {
    btn.disabled = false;
    btn.textContent = 'Retry Payment';
    toast('Payment failed. No money moved.');
  }
}

/* ---------------- orders ---------------- */
const STEPS = [
  ['PLACED', 'Order received'], ['ACCEPTED', 'Accepted'], ['PREPARING', 'Cooking'],
  ['READY', 'Ready'], ['SERVED', 'Served']
];
function statusLabel(s) {
  if (s === 'READY') return 'Ready for you';
  if (s === 'SERVED') return 'Served';
  if (s === 'DELIVERED') return 'Served';
  return s.replace(/_/g, ' ');
}
function renderTimeline(el, order) {
  if (!el) return;
  const cur = STEPS.findIndex((s) => s[0] === order.status);
  const steps = STEPS;
  const cancelled = order.status === 'CANCELLED';
  el.innerHTML = `<div class="tl">${steps.map((s) => {
    const idx = STEPS.indexOf(s);
    const done = !cancelled && idx <= cur;
    const current = !cancelled && idx === cur;
    return `<div class="tl-step ${done ? 'done' : ''} ${current ? 'current' : ''}">
      <div class="tl-dot">${done ? '✓' : ''}</div>
      <div><b>${s[1]}</b><span>${current ? 'Right now' : done ? 'Done' : 'Pending'}</span></div>
    </div>`;
  }).join('')}</div>`;
}
async function loadOrders() {
  const box = $('#ordersList');
  if (!state.phone) { box.innerHTML = ''; return; }
  const r = await fetch('/api/orders?phone=' + state.phone).then((x) => x.json()).catch(() => null);
  const orders = (r && r.orders) || [];
  if (!orders.length) {
    box.innerHTML = '<div class="empty-state"><b>No orders yet</b>Orders placed on this phone show up here, live.</div>';
    return;
  }
  box.innerHTML = orders.map((o) => `
    <div class="order-card">
      <div class="oc-top"><b>${o.id}</b><span class="status-chip st-${o.status}">${statusLabel(o.status)}</span></div>
      <div class="oc-items">${o.items.map((i) => i.qty + ' x ' + i.name).join(', ')}</div>
      <div class="oc-foot"><span>${o.mode === 'dinein' ? ('Dine-in' + (o.customer.tableNumber ? ' - T' + o.customer.tableNumber : '')) : 'Takeaway'} \u2022 ${o.outlet === 'shivane' ? 'Shivane' : 'Nanded City'}</span><span>${INR(o.total)}</span></div>
      ${o.status === 'OUT_FOR_DELIVERY' ? `<div class="rider-mount" data-rider="${o.id}"></div>` : ''}
    </div>`).join('');
  $$('#ordersList [data-rider]').forEach((m) => renderAppRiderMap(m, m.dataset.rider));
  // live refresh while an active order exists
  const active = orders.some((o) => !['DELIVERED', 'CANCELLED'].includes(o.status));
  clearTimeout(loadOrders._t);
  if (active && $('#view-orders').offsetParent !== null) loadOrders._t = setTimeout(loadOrders, 5000);
}

/* ---------------- views ---------------- */
function gotoView(name) {
  $$('.view').forEach((v) => v.classList.toggle('hidden', v.id !== 'view-' + name));
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === name));
  window.scrollTo({ top: 0 });
  if (name === 'orders') loadOrders();
}

/* ---------------- bind ---------------- */
function bindUI() {
  $$('.tab').forEach((t) => t.addEventListener('click', () => gotoView(t.dataset.view)));
  $('#heroOrder').addEventListener('click', () => gotoView('menu'));
  $('#cartBtn').addEventListener('click', () => gotoView('cart'));
  $('#menuSearch').addEventListener('input', renderMenuList);
  $('#payBtn').addEventListener('click', startPayment);
  $('#rzpPayBtn').addEventListener('click', confirmPayment);
  $('#ckClose').addEventListener('click', () => $('#checkoutSheet').classList.remove('show'));
  $('#phoneSave').addEventListener('click', () => {
    const p = $('#phoneInput').value.replace(/\D/g, '').slice(-10);
    if (!/^[6-9]\d{9}$/.test(p)) { toast('Enter a valid 10-digit mobile'); return; }
    state.phone = p;
    localStorage.setItem(PHONE_KEY, p);
    loadOrders();
    toast('Orders linked to ' + p);
  });
  $('#successDone').addEventListener('click', () => { $('#successSheet').classList.remove('show'); gotoView('orders'); });
  $('#installDismiss').addEventListener('click', () => {
    $('#installSheet').classList.remove('show');
    localStorage.setItem('xto_install_dismissed', '1');
  });
  $$('input[name="mode"]').forEach((r) => r.addEventListener('change', () => {
    $('#tableField').style.display = checkedMode() === 'dinein' ? '' : 'none';
    updateBill(); updateCartUI();
  }));
  $$('.rzp-tab').forEach((t) => t.addEventListener('click', () => {
    $$('.rzp-tab').forEach((x) => x.classList.toggle('active', x === t));
    $$('.rzp-pane').forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== t.dataset.tab));
  }));
  $$('.rzp-option').forEach((o) => o.addEventListener('click', () => {
    const pane = o.closest('.rzp-pane');
    $$('.rzp-option', pane).forEach((x) => x.classList.toggle('selected', x === o));
  }));
  $$('.sheet').forEach((sh) => sh.addEventListener('click', (e) => {
    if (e.target === sh && sh.id !== 'successSheet') sh.classList.remove('show');
  }));
  document.addEventListener('click', (e) => {
    const seeAll = e.target.closest('[data-goto]');
    if (seeAll) gotoView(seeAll.dataset.goto);
  });
}

boot();

/* ---------------- home: promo rail + offers ---------------- */
async function renderAppPromos() {
  const offers = await getOffers();
  const slides = offers.map((o, i) => `
    <div class="app-promo p${i % 3}">
      <div><b>${o.type === 'percent' ? o.value + '% OFF' : INR(o.value) + ' OFF'}</b><span>${o.label || 'Use code ' + o.code}</span></div>
      <code>${o.code}</code>
    </div>`).join('');
  $('#appPromos').innerHTML = slides || '';
  if (offers.length > 1) {
    let idx = 0;
    const cards = $$('#appPromos .app-promo');
    setInterval(() => {
      idx = (idx + 1) % cards.length;
      $('#appPromos').scrollTo({ left: idx * ($('#appPromos').clientWidth + 12), behavior: 'smooth' });
    }, 4000);
  }
}
async function renderAppOffers() {
  const offers = await getOffers();
  $('#appOffers').innerHTML = offers.map((o) => `
    <button class="offer-chip" data-code="${o.code}">
      <b>${o.type === 'percent' ? o.value + '% OFF' : INR(o.value) + ' OFF'}</b>
      <span>${o.code}${o.minOrder ? ' - above ' + INR(o.minOrder) : ''}</span>
    </button>`).join('');
  $$('#appOffers [data-code]').forEach((b) => b.addEventListener('click', () => {
    $('#ckCoupon').value = b.dataset.code;
    toast('Code ' + b.dataset.code + ' ready. Apply at checkout.');
  }));
}
async function getOffers() {
  if (state.offers.length) return state.offers;
  const r = await fetch('/api/offers').then((x) => x.json()).catch(() => ({ offers: [] }));
  state.offers = r.offers || [];
  return state.offers;
}

/* ---------------- coupon ---------------- */
async function applyCouponFromField() {
  const msg = $('#couponMsg');
  const code = $('#ckCoupon').value.trim().toUpperCase();
  msg.textContent = '';
  if (!code) { state.coupon = null; updateBill(); return; }
  const { itemTotal } = cartTotals();
  const r = await fetch('/api/coupon/validate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, itemTotal })
  }).then((x) => x.json()).catch(() => ({ error: 'Could not check the code' }));
  if (r.error) { state.coupon = null; msg.textContent = r.error; msg.className = 'coupon-msg bad'; updateBill(); return; }
  state.coupon = r;
  msg.textContent = r.code + ' applied. You save ' + INR(r.discount) + '.';
  msg.className = 'coupon-msg good';
  updateBill();
}

/* ---------------- store locator ---------------- */
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371, dLat = (lat2 - lat1) * Math.PI / 180, dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function outletCoords(o) {
  const map = { shivane: [18.4649, 73.8078], nanded: [18.4720, 73.8093] };
  return map[o.id] || map.shivane;
}
function appLocate() {
  const out = $('#appLocateResult');
  const demo = new URLSearchParams(location.search);
  const use = (lat, lng) => {
    const list = state.outlets.map((o) => {
      const c = outletCoords(o);
      return { ...o, dist: haversine(lat, lng, c[0], c[1]), coords: c };
    }).sort((a, b) => a.dist - b.dist);
    out.innerHTML = list.map((o, i) => `
      <div class="lc-row${i === 0 ? ' best' : ''}">
        <div><b>${o.name.replace('XTO Pizza ', '')}</b><span>${o.hours}</span></div>
        <div class="lc-side">${o.dist.toFixed(1)} km
          <a target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${o.coords[0]},${o.coords[1]}">Go</a>
        </div>
      </div>`).join('');
    toast('Nearest: ' + (list[0] ? list[0].name : 'see list'));
  };
  if (demo.get('demoLat')) return use(+demo.get('demoLat'), +demo.get('demoLng'));
  if (!navigator.geolocation) { out.innerHTML = '<div class="lc-row"><div><b>Location unavailable</b><span>Pick the outlet manually at checkout.</span></div></div>'; return; }
  out.innerHTML = '<div class="lc-row"><div><b>Finding you...</b></div></div>';
  navigator.geolocation.getCurrentPosition(
    (p) => use(p.coords.latitude, p.coords.longitude),
    () => { out.innerHTML = '<div class="lc-row"><div><b>Location off</b><span>Allow location, or pick the outlet manually at checkout.</span></div></div>'; },
    { timeout: 8000 }
  );
}

/* ---------------- live rider map in order tracking ---------------- */
let lastAppOrder = null;
function haversineApp(a, b, c, d) { return haversine(a, b, c, d); }
async function renderAppRiderMap(container, orderId) {
  const data = await fetch('/api/track/rider?order=' + encodeURIComponent(orderId)).then((r) => r.json()).catch(() => null);
  if (!data || !data.rider || !data.pos) return;
  const id = 'rmap-' + orderId;
  let map = state.appMaps[id];
  if (!map) {
    const holder = document.createElement('div');
    holder.className = 'rider-map';
    holder.id = id;
    container.appendChild(holder);
    map = L.map(id, { zoomControl: false, attributionControl: false });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
    L.marker(data.outletGeo).addTo(map);
    state.appMaps[id] = map;
  }
  setTimeout(() => map.invalidateSize(), 60);
  if (state.appMaps[id + '_r']) map.removeLayer(state.appMaps[id + '_r']);
  state.appMaps[id + '_r'] = L.marker([data.pos.lat, data.pos.lng]).addTo(map).bindPopup('<b>' + data.rider.name + '</b> is on the way');
  map.setView([data.pos.lat, data.pos.lng], 15);
  const cap = container.querySelector('.rider-cap') || (() => { const d = document.createElement('div'); d.className = 'rider-cap'; container.appendChild(d); return d; })();
  cap.textContent = data.rider.name + ' is riding to you';
}

/* ---------------- push subscribe ---------------- */
function urlB64ToUint8Array(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4).replace(/=/g, '');
  const base64 = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}
async function onEnableUpdates() {
  const btn = $('#enableUpdatesBtn');
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) { toast('Push not supported here. Try Chrome.'); return; }
  btn.disabled = true; btn.textContent = 'Turning on...';
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { btn.textContent = 'Blocked. Enable notifications for XTO in browser settings.'; return; }
    const reg = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    const key = await fetch('/api/push/key').then((r) => r.json());
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(key.key) });
    await fetch('/api/push/subscribe', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: (lastAppOrder && lastAppOrder.customer.phone) || state.phone, subscription: sub.toJSON() })
    });
    btn.textContent = 'Done! You will get live order updates.';
  } catch (e) {
    btn.disabled = false; btn.textContent = 'Get live status updates';
    toast('Could not enable: ' + (e.message || e));
  }
}
