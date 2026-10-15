/* XTO Pizza site engine: menu, cart, mock Razorpay checkout, order tracking */
'use strict';

const $ = (s, el) => (el || document).querySelector(s);
const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
const INR = (n) => '\u20B9' + Number(n).toLocaleString('en-IN');
const CART_KEY = 'xto_cart_v1';

const state = { menu: null, outlets: [], cat: 'all', cart: loadCart(), payCtx: null, coupon: null, map: null, riderMap: null, offers: [], sel: {} };
const SIZE_ORDER = ['six', 'regular', 'half', 'medium', 'full', 'large'];

function loadCart() { try { return JSON.parse(localStorage.getItem(CART_KEY)) || {}; } catch (e) { return {}; } }
function saveCart() { try { localStorage.setItem(CART_KEY, JSON.stringify(state.cart)); } catch (e) {} }
function cartCount() { return Object.values(state.cart).reduce((s, q) => s + q, 0); }
function lineKey(id, addons) { return addons && addons.length ? id + '|' + addons.slice().sort().join(',') : id; }
function itemById(id) { return state.menu.items.find((i) => i.id === id); }
function addonById(id) { return (state.menu.addons || []).find((a) => a.id === id); }
function cartLines() {
  return Object.entries(state.cart).map(([key, qty]) => {
    const [id, adds] = key.split('|');
    const item = itemById(id);
    if (!item) return null;
    const aids = adds ? adds.split(',') : [];
    let unit = item.price;
    const names = [];
    for (const aid of aids) {
      const ad = addonById(aid);
      if (!ad) continue;
      unit += (ad.prices && ad.prices[item.size]) || 0;
      names.push(ad.name);
    }
    return { ...item, key, qty, addons: aids, price: unit, name: names.length ? item.name + ' + ' + names.join(', ') : item.name };
  }).filter(Boolean);
}
function cartTotals() {
  const lines = cartLines();
  const itemTotal = lines.reduce((s, l) => s + l.price * l.qty, 0);
  const discount = state.coupon ? Math.min(state.coupon.discount, itemTotal) : 0;
  return { lines, itemTotal, deliveryFee: 0, discount, total: itemTotal - discount };
}
function checkedMode() { return ($('input[name="mode"]:checked') || {}).value || 'dinein'; }
function addLine(id, addons, qty) {
  const key = lineKey(id, addons || []);
  state.cart[key] = Math.min(20, (state.cart[key] || 0) + (qty || 1));
  saveCart(); updateCartUI();
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('show'), 2400);
}
function openModal(id) { $('#' + id).classList.add('show'); }
function closeModal(id) { $('#' + id).classList.remove('show'); }

/* ---------------- boot ---------------- */
async function boot() {
  const [menuRes, outletsRes] = await Promise.all([fetch('/api/menu').then((r) => r.json()), fetch('/api/outlets').then((r) => r.json())]);
  state.menu = menuRes;
  state.outlets = outletsRes.outlets;
  const qp = new URLSearchParams(location.search);
  if (qp.get('q')) $('#menuSearch').value = qp.get('q');
  renderTabs();
  renderMenu();
  renderCombos();
  renderCatCircles();
  renderBestsellers();
  renderOffers();
  initLocator();
  bindUI();
  bindDelegates();
  startMarquee();
  showOpenStatus();
  document.getElementById('enableUpdatesBtn')?.addEventListener('click', onEnableUpdates);
  document.getElementById('couponApply')?.addEventListener('click', applyCouponFromField);
  document.getElementById('locateMe')?.addEventListener('click', locateMe);
  updateCartUI();
  document.addEventListener('scroll', () => $('#nav') && $('#nav').classList.toggle('scrolled', scrollY > 30), { passive: true });
  if (location.hash.startsWith('#order=')) { trackById(decodeURIComponent(location.hash.slice(7))); }
  if (qp.get('cart')) openCart();
  if (qp.get('track')) openModal('trackModal');
}

/* seamless marquee: repeat the set until one half covers the viewport, then duplicate it for the -50% loop */
function startMarquee() {
  const t = $('#mqTrack');
  if (!t) return;
  const set = t.innerHTML;
  t.innerHTML = set;
  const w = Math.max(1, t.scrollWidth);
  const n = Math.max(1, Math.ceil(window.innerWidth / w));
  const half = set.repeat(n);
  t.innerHTML = half + half;
}
function showOpenStatus() {
  const el = $('#openNow');
  if (!el) return;
  const parse = (h) => {
    const m = String(h).match(/(\d{1,2}):(\d{2})\s*(am|pm)\s*-\s*(\d{1,2}):(\d{2})\s*(am|pm)/i);
    if (!m) return null;
    const to24 = (hh, mm, ap) => ((+hh % 12) + (ap.toLowerCase() === 'pm' ? 12 : 0)) * 60 + +mm;
    return { open: to24(m[1], m[2], m[3]), close: to24(m[4], m[5], m[6]), closeLabel: m[4] + ':' + m[5] + ' ' + m[6].toLowerCase() };
  };
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
  const now = +parts.find((p) => p.type === 'hour').value * 60 + +parts.find((p) => p.type === 'minute').value;
  const openOnes = state.outlets.map((o) => ({ o, h: parse(o.hours) })).filter((x) => x.h && now >= x.h.open && now < x.h.close);
  if (openOnes.length) {
    el.classList.add('on');
    el.querySelector('span').textContent = 'Open now at ' + openOnes.map((x) => x.o.name.replace('XTO Pizza ', '').replace(/ \(.*\)/, '')).join(' and ') + ' until ' + openOnes[0].h.closeLabel;
  } else {
    el.querySelector('span').textContent = 'Outlets are closed right now. Opening at 11:00 am.';
  }
}

/* ---------------- menu (grouped by size) ---------------- */
function groupItems(items) {
  const m = new Map();
  for (const i of items) {
    const k = i.cat + '|' + (i.group || i.id);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(i);
  }
  return Array.from(m.values()).map((g) => g.sort((a, b) =>
    SIZE_ORDER.indexOf(a.size || 'regular') - SIZE_ORDER.indexOf(b.size || 'regular') || a.price - b.price));
}
function groupKey(g) { return g[0].cat + '|' + (g[0].group || g[0].id); }
function selectedOf(g) {
  const id = state.sel[groupKey(g)];
  return g.find((i) => i.id === id && i.available) || g.find((i) => i.available) || g[0];
}
function addonsFor(item) { return (state.menu.addons || []).filter((a) => item.size && a.prices && a.prices[item.size]); }
function plainQty(id) { return state.cart[id] || 0; }

function renderTabs() {
  const tabs = [{ id: 'all', name: 'All' }, ...state.menu.categories];
  $('#catTabs').innerHTML = tabs.map((t) => `<button class="xpill${t.id === state.cat ? ' on' : ''}" data-cat="${t.id}">${t.name}</button>`).join('');
  $$('#catTabs .xpill').forEach((b) => b.addEventListener('click', () => {
    state.cat = b.dataset.cat;
    $$('#catTabs .xpill').forEach((x) => x.classList.toggle('on', x === b));
    renderMenu();
  }));
}

function cardHTML(g) {
  const sel = selectedOf(g);
  const key = groupKey(g);
  const name = g[0].groupName || g[0].name;
  const multi = g.length > 1;
  const chips = multi
    ? `<div class="xchips" role="radiogroup" aria-label="Size">${g.map((i) => `<button type="button" class="xchip${i.id === sel.id ? ' on' : ''}" data-chip="${i.id}" data-gk="${key}" role="radio" aria-checked="${i.id === sel.id}"${i.available ? '' : ' disabled'}>${i.sizeLabel}<small>${INR(i.price)}</small></button>`).join('')}</div>`
    : (sel.sizeLabel ? `<div class="xchips"><span class="xchip on" style="cursor:default">${sel.sizeLabel}<small>${INR(sel.price)}</small></span></div>` : '');
  const customisable = addonsFor(sel).length > 0;
  const qty = plainQty(sel.id);
  const action = !sel.available ? '' :
    (!customisable && qty
      ? `<div class="xqty"><button data-dec="${sel.id}" aria-label="Less">&minus;</button><span>${qty}</span><button data-inc="${sel.id}" aria-label="More">+</button></div>`
      : `<button class="xadd" data-add="${sel.id}" data-gk="${key}">${customisable ? 'ADD +' : 'ADD +'}</button>`);
  return `<article class="xcard" data-gk="${key}">
    <div class="xcard-img"><span class="xveg" title="Pure veg"></span>
      <img src="images/${sel.img}.jpg" alt="${name}" loading="lazy" onerror="this.onerror=null;this.src='images/pizza-cheese.jpg'">
      ${sel.available ? '' : '<div class="xsold">Sold out</div>'}
    </div>
    <div class="xcard-body">
      <div class="xcard-name">${name}</div>
      <div class="xcard-desc">${sel.desc || ''}</div>
      ${chips}
      <div class="xcard-foot"><div class="xprice"><small>&#8377;</small>${sel.price}</div>${action}</div>
    </div>
  </article>`;
}

function renderMenu() {
  const q = ($('#menuSearch').value || '').toLowerCase().trim();
  const list = $('#menuList');
  const cats = state.cat === 'all' ? state.menu.categories : state.menu.categories.filter((c) => c.id === state.cat);
  let html = '';
  for (const cat of cats) {
    const items = state.menu.items.filter((i) => i.cat === cat.id && (!q || ((i.groupName || i.name) + ' ' + i.desc).toLowerCase().includes(q)));
    if (!items.length) continue;
    html += `<div class="xcat-block" id="cat-${cat.id}">
      <h3>${cat.name}</h3><div class="note">${cat.note || ''}</div>
      <div class="xgrid">${groupItems(items).map(cardHTML).join('')}</div>
    </div>`;
  }
  list.innerHTML = html || '<div class="xempty">Nothing matches that search. Try "paneer" or "shake".</div>';
}
function refreshCard(gk) {
  const card = $(`.xcard[data-gk="${gk}"]`);
  if (!card) return;
  const items = state.menu.items.filter((i) => (i.cat + '|' + (i.group || i.id)) === gk);
  const tmp = document.createElement('div');
  tmp.innerHTML = cardHTML(groupItems(items)[0]);
  card.replaceWith(tmp.firstElementChild);
}

function bindDelegates() {
  document.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-chip]');
    if (chip) {
      state.sel[chip.dataset.gk] = chip.dataset.chip;
      refreshCard(chip.dataset.gk);
      return;
    }
    const add = e.target.closest('[data-add]');
    if (add) {
      const item = itemById(add.dataset.add);
      if (!item) return;
      if (addonsFor(item).length) {
        const items = state.menu.items.filter((i) => i.cat === item.cat && (i.group || i.id) === (item.group || item.id));
        openOptions(groupItems(items)[0], item.id);
      } else {
        addLine(item.id, [], 1);
        toast((item.groupName || item.name) + ' added to cart');
        const gk = item.cat + '|' + (item.group || item.id);
        refreshCard(gk);
      }
      return;
    }
    const inc = e.target.closest('[data-inc]');
    if (inc) { addLine(inc.dataset.inc, [], 1); refreshCard(itemById(inc.dataset.inc).cat + '|' + (itemById(inc.dataset.inc).group || inc.dataset.inc)); return; }
    const dec = e.target.closest('[data-dec]');
    if (dec) {
      const id = dec.dataset.dec;
      state.cart[id] = (state.cart[id] || 0) - 1;
      if (state.cart[id] <= 0) delete state.cart[id];
      saveCart(); updateCartUI();
      const it = itemById(id); if (it) refreshCard(it.cat + '|' + (it.group || id));
    }
  });
}

/* ---------------- option sheet ---------------- */
const opt = { g: null, id: null, addons: new Set(), qty: 1 };
function openOptions(g, id) {
  opt.g = g; opt.id = id; opt.addons = new Set(); opt.qty = 1;
  renderOptions();
  openModal('optModal');
}
function renderOptions() {
  const item = opt.g.find((i) => i.id === opt.id);
  $('#optName').textContent = item.groupName || item.name;
  $('#optDesc').textContent = item.desc || '';
  $('#optImg').src = 'images/' + item.img + '.jpg';
  const multi = opt.g.length > 1;
  $('#optSizeH').style.display = multi ? '' : 'none';
  $('#optSizes').innerHTML = multi ? opt.g.map((i) => `<label class="xopt-row"><span class="l"><input type="radio" name="optSize" value="${i.id}"${i.id === opt.id ? ' checked' : ''}${i.available ? '' : ' disabled'}>${i.sizeLabel}</span><span>${INR(i.price)}</span></label>`).join('') : '';
  const ads = addonsFor(item);
  $('#optAddH').style.display = ads.length ? '' : 'none';
  $('#optAddons').innerHTML = ads.map((a) => `<label class="xopt-row"><span class="l"><input type="checkbox" value="${a.id}"${opt.addons.has(a.id) ? ' checked' : ''}>${a.name}</span><span>+ ${INR(a.prices[item.size])}</span></label>`).join('');
  $('#optQty').textContent = opt.qty;
  const unit = item.price + ads.filter((a) => opt.addons.has(a.id)).reduce((s, a) => s + a.prices[item.size], 0);
  $('#optAdd').textContent = 'Add to cart \u2022 ' + INR(unit * opt.qty);
  $$('#optSizes input').forEach((r) => r.addEventListener('change', () => { opt.id = r.value; opt.addons = new Set(); renderOptions(); }));
  $$('#optAddons input').forEach((c) => c.addEventListener('change', () => { c.checked ? opt.addons.add(c.value) : opt.addons.delete(c.value); renderOptions(); }));
}
function bindOptions() {
  $('#optMinus').addEventListener('click', () => { opt.qty = Math.max(1, opt.qty - 1); renderOptions(); });
  $('#optPlus').addEventListener('click', () => { opt.qty = Math.min(20, opt.qty + 1); renderOptions(); });
  $('#optAdd').addEventListener('click', () => {
    const item = opt.g.find((i) => i.id === opt.id);
    addLine(item.id, Array.from(opt.addons), opt.qty);
    state.sel[item.cat + '|' + (item.group || item.id)] = item.id;
    refreshCard(item.cat + '|' + (item.group || item.id));
    closeModal('optModal');
    toast((item.groupName || item.name) + ' (' + (item.sizeLabel || 'one size') + ') added to cart');
  });
}

/* ---------------- combos ---------------- */
function renderCombos() {
  const combos = state.menu.items.filter((i) => i.cat === 'combo');
  $('#comboGrid').innerHTML = combos.map((c) => `
    <article class="xcombo">
      <img src="images/${c.img}.jpg" alt="${c.name}" loading="lazy" onerror="this.onerror=null;this.src='images/pizza-cheese.jpg'" />
      <div>
        <h3>${c.name}</h3><p>${c.desc}</p>
        <div class="foot"><span class="xprice"><small>&#8377;</small>${c.price}</span>${c.available ? `<button class="xbtn alt sm" data-add="${c.id}">Add</button>` : '<span>Sold out</span>'}</div>
      </div>
    </article>`).join('');
}

/* ---------------- cart ---------------- */
function updateCartUI() {
  const n = cartCount();
  $('#cartCount').textContent = n;
  const box = $('#cartItems');
  const { lines, itemTotal, total } = cartTotals();
  if (!lines.length) {
    box.innerHTML = '<div class="cart-empty"><b>Your cart is empty</b>The oven is hot. Add something delicious.</div>';
    $('#cartFoot').innerHTML = '';
    return;
  }
  box.innerHTML = lines.map((l) => `<div class="cart-line">
      <img src="images/${l.img}.jpg" alt="" onerror="this.onerror=null;this.src='images/pizza-cheese.jpg'" />
      <div><h4>${l.name}</h4><div class="cl-price">${INR(l.price)} each</div></div>
      <div class="cl-stepper">
        <button data-cdec="${l.key}" aria-label="Less">&minus;</button><span class="cl-qty">${l.qty}</span><button data-cinc="${l.key}" aria-label="More">+</button>
      </div>
    </div>`).join('');
  const refresh = (key) => { const it = itemById(key.split('|')[0]); if (it) refreshCard(it.cat + '|' + (it.group || it.id)); };
  $$('[data-cinc]', box).forEach((b) => b.addEventListener('click', () => { state.cart[b.dataset.cinc] = Math.min(20, state.cart[b.dataset.cinc] + 1); saveCart(); updateCartUI(); refresh(b.dataset.cinc); }));
  $$('[data-cdec]', box).forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.cdec; state.cart[k]--; if (state.cart[k] <= 0) delete state.cart[k];
    saveCart(); updateCartUI(); refresh(k);
  }));
  $('#cartFoot').innerHTML = `
    <div class="cart-row"><span>Item total</span><span>${INR(itemTotal)}</span></div>
    <div class="cart-row total"><span>To pay</span><span>${INR(total)}</span></div>
    <button class="btn btn-primary btn-block" id="checkoutBtn">Checkout ${INR(total)}</button>`;
  $('#checkoutBtn').addEventListener('click', openCheckout);
}
function modeDeliverySelected() { return checkedMode() === 'delivery'; }

function openCart() { $('#cartDrawer').classList.add('show'); $('#scrim').classList.add('show'); }
function closeCart() { $('#cartDrawer').classList.remove('show'); $('#scrim').classList.remove('show'); }

/* ---------------- checkout + mock razorpay ---------------- */
function updateBill() {
  const { lines, itemTotal, deliveryFee, total } = cartTotals();
  if (!lines.length) return;
  $('#billBox').innerHTML = `
    <div class="cart-row"><span>Items (${lines.reduce((s, l) => s + l.qty, 0)})</span><span>${INR(itemTotal)}</span></div>
    <div class="cart-row total"><span>To pay</span><span>${INR(total)}</span></div>`;
}
function openCheckout() {
  if (!cartCount()) return;
  closeCart();
  $('#tableField').style.display = checkedMode() === 'dinein' ? '' : 'none';
  $('#ckOutlet').innerHTML = state.outlets.map((o) => `<option value="${o.id}">${o.name}</option>`).join('');
  updateBill();
  $('#ckError').textContent = '';
  openModal('checkoutModal');
}

async function startPayment() {
  const errEl = $('#ckError');
  errEl.textContent = '';
  const name = $('#ckName').value.trim();
  const phone = $('#ckPhone').value.replace(/\D/g, '');
  const tableNumber = ($('#ckTable') ? $('#ckTable').value : '').trim();
  const mode = checkedMode();
  if (name.length < 2) { errEl.textContent = 'Please enter your name.'; return; }
  if (!/^[6-9]\d{9}$/.test(phone)) { errEl.textContent = 'Please enter a valid 10-digit mobile number.'; return; }
  if (mode === 'dinein' && !tableNumber) { errEl.textContent = 'Please enter your table number.'; return; }
  const { total } = cartTotals();

  $('#payBtn').disabled = true;
  $('#payBtn').textContent = 'Opening secure checkout...';
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
    $('#rzpModal').classList.add('show');
    closeModal('checkoutModal');
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
      items: cartLines().map((l) => ({ id: l.id, qty: l.qty, addons: l.addons })),
      couponCode: state.coupon ? state.coupon.code : undefined,
      payment
    })
  }).then((r) => r.json());
  if (!res.ok) throw new Error(res.error || 'order failed');
  return res;
}

function openRazorpayLiveCheckout() {
  closeModal('checkoutModal');
  const ctx = state.payCtx;
  const fail = (msg) => {
    $('#payBtn').disabled = false;
    $('#payBtn').innerHTML = '<span id="rzpPayLabel">Retry Payment</span>';
    openModal('checkoutModal');
    toast(msg);
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
          setTimeout(async () => {
            state.cart = {}; saveCart(); updateCartUI();
            $('#successOrderId').textContent = res.order.id;
            renderTimeline($('#trackBox'), res.order);
            renderRiderMap('trackBox', res.order.id);
            openModal('successModal');
            pollUntilClosed(res.order.id);
          }, 600);
        } catch (e) { fail('Payment could not be verified. Try again.'); }
      },
      modal: { ondismiss: () => fail('Payment cancelled. No money moved.') }
    });
    rzp.on('payment.failed', () => fail('Payment failed. No money moved. Try again.'));
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
  btn.innerHTML = 'Processing...';
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
    setTimeout(async () => {
      $('#rzpModal').classList.remove('show');
      state.cart = {}; saveCart(); state.coupon = null; $('#ckCoupon').value = ''; $('#couponMsg').textContent = '';
      updateCartUI();
      $('#successOrderId').textContent = res.order.id;
      lastSuccessOrder = res.order;
      renderTimeline($('#trackBox'), res.order);
      renderRiderMap('trackBox', res.order.id);
      openModal('successModal');
      // keep the success view fresh while it is open
      pollUntilClosed(res.order.id);
    }, 1300);
  } catch (e) {
    btn.disabled = false;
    btn.innerHTML = '<span id="rzpPayLabel">Retry Payment</span>';
    toast('Payment failed. No money moved. Try again.');
  }
}

/* ---------------- tracking ---------------- */
const STEPS = [
  ['PLACED', 'Order received', '1'],
  ['ACCEPTED', 'Accepted by kitchen', '2'],
  ['PREPARING', 'Cooking now', '3'],
  ['READY', 'Ready', '4'],
  ['SERVED', 'Served. Enjoy!', '5']
];
function renderTimeline(el, order) {
  if (!el) return;
  const cur = STEPS.findIndex((s) => s[0] === order.status);
  const steps = STEPS;
  const cancelled = order.status === 'CANCELLED';
  el.innerHTML = `
    <div class="tl">
      ${steps.map((s, i) => {
        const idx = STEPS.indexOf(s);
        const done = !cancelled && idx <= cur;
        const current = !cancelled && idx === cur;
        return `<div class="tl-step ${done ? 'done' : ''} ${current ? 'current' : ''}">
          <div class="tl-dot">${done ? '✓' : s[2]}</div>
          <div><b>${s[1]}</b><span>${current ? 'Happening right now' : done ? 'Done' : 'Pending'}</span></div>
        </div>`;
      }).join('')}
      ${cancelled ? '<div class="tl-step cancelled"><div class="tl-dot">✕</div><div><b>Order cancelled</b><span>Contact the outlet for help</span></div></div>' : ''}
    </div>
    <div class="cart-row total" style="padding-top:6px"><span>${order.id} \u2022 ${order.items.reduce((s, i) => s + i.qty, 0)} items</span><span>${INR(order.total)}</span></div>`;
}
let pollTimer = null;
function pollUntilClosed(orderId) {
  clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    if (!$('#successModal').classList.contains('show')) { clearInterval(pollTimer); return; }
    const r = await fetch('/api/orders/' + orderId).then((x) => x.json()).catch(() => null);
    if (r && r.order) { renderTimeline($('#trackBox'), r.order); renderRiderMap('trackBox', r.order.id); }
  }, 4000);
}
async function trackById(id) {
  const r = await fetch('/api/orders/' + encodeURIComponent(id)).then((x) => x.json()).catch(() => null);
  if (r && r.order) { renderTimeline($('#trackResult'), r.order); renderRiderMap('trackResult', r.order.id); pollUntilClosed(r.order.id); }
  else $('#trackResult').innerHTML = '<div class="empty-note">No order found for that ID.</div>';
}
async function trackGo() {
  const q = $('#trackQuery').value.trim();
  if (!q) return;
  $('#trackResult').innerHTML = '<div class="empty-note">Looking...</div>';
  if (/^xt-?\d+$/i.test(q)) return trackById(q.toUpperCase().startsWith('XT') ? q : 'XT-' + q);
  const phone = q.replace(/\D/g, '').slice(-10);
  const r = await fetch('/api/orders?phone=' + phone).then((x) => x.json()).catch(() => null);
  if (r && r.orders && r.orders.length) {
    const o = r.orders[0];
    renderTimeline($('#trackResult'), o);
    pollUntilClosed(o.id);
  } else $('#trackResult').innerHTML = '<div class="empty-note">No orders found for that number.</div>';
}

/* ---------------- ui bind ---------------- */
function bindUI() {
  $('#cartBtn').addEventListener('click', openCart);
  bindOptions();
  $('#cartClose').addEventListener('click', closeCart);
  $('#scrim').addEventListener('click', closeCart);
  $('#payBtn').addEventListener('click', startPayment);
  $('#rzpPayBtn').addEventListener('click', confirmPayment);
  $('#trackGo').addEventListener('click', trackGo);
  const tl = $('#trackLink'); if (tl) tl.addEventListener('click', (e) => { e.preventDefault(); openModal('trackModal'); });
  $('#menuSearch').addEventListener('input', () => renderMenu());
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
  document.addEventListener('click', (e) => {
    if (e.target.matches('[data-close]')) closeModal(e.target.dataset.close);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeCart(); $$('.modal.show').forEach((m) => m.classList.remove('show')); $('#rzpModal').classList.remove('show'); }
  });
  $$('.modal').forEach((m) => m.addEventListener('click', (e) => { if (e.target === m) m.classList.remove('show'); }));
}

boot();

/* ---------------- homepage: offers, categories, bestsellers ---------------- */
async function renderOffers() {
  const res = await fetch('/api/offers').then((r) => r.json()).catch(() => ({ offers: [] }));
  state.offers = res.offers || [];
  $('#offerRail').innerHTML = state.offers.map((o) => `
    <div class="xoffer">
      <div class="xoffer-ic"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 5 5 19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></svg></div>
      <div><b>${o.type === 'percent' ? o.value + '% off' : INR(o.value) + ' off'}</b>
      <span>${o.label || 'On your order'}${o.minOrder ? ' &bull; min order ' + INR(o.minOrder) : ''}</span>
      <button data-code="${o.code}" type="button">${o.code} &middot; copy</button></div>
    </div>`).join('') || '<div class="xempty">New offers dropping soon.</div>';
  $$('#offerRail [data-code]').forEach((b) => b.addEventListener('click', () => copyCode(b.dataset.code)));
}
function copyCode(code) {
  navigator.clipboard?.writeText(code).catch(() => {});
  $('#ckCoupon').value = code;
  toast('Code ' + code + ' copied. Apply it at checkout.');
  document.getElementById('menu').scrollIntoView({ behavior: 'smooth' });
}
function renderCatCircles() {
  $('#catCircles').innerHTML = state.menu.categories.map((c) => {
    const first = state.menu.items.find((i) => i.cat === c.id);
    return `<a class="xcat" href="#menu" data-jump-cat="${c.id}">
      <span class="ring"><img src="images/${first ? first.img : 'pizza-cheese'}.jpg" alt="" loading="lazy" /></span>
      <b>${c.name}</b>
    </a>`;
  }).join('');
  $$('#catCircles [data-jump-cat]').forEach((a) => a.addEventListener('click', () => {
    const tab = $(`#catTabs [data-cat="${a.dataset.jumpCat}"]`);
    if (tab) tab.click();
  }));
}
function renderBestsellers() {
  const want = ['farmers-delight-regular', 'tandoori-paneer-tikka-regular', 'double-cheese-veg-burger', 'kitkat-shake', 'combo-crush', 'cheesy-garlic-bread'];
  const picks = want.map((id) => itemById(id)).filter(Boolean);
  const top = picks.length ? picks : state.menu.items.slice(0, 6);
  $('#bestRow').innerHTML = top.map((i) => {
    const grp = state.menu.items.filter((x) => x.cat === i.cat && (x.group || x.id) === (i.group || i.id));
    const from = Math.min(...grp.map((x) => x.price));
    return `<div class="xbest-card">
      <img src="images/${i.img}.jpg" alt="${i.groupName || i.name}" loading="lazy" onerror="this.onerror=null;this.src='images/pizza-cheese.jpg'" />
      <div><b>${i.groupName || i.name}</b><span>${grp.length > 1 ? 'from ' : ''}${INR(from)}</span>
      <button class="xbtn sm" data-add="${i.id}" type="button">Add</button></div>
    </div>`;
  }).join('');
}

/* ---------------- coupon apply in checkout ---------------- */
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
  // outlets carry no coords in the API; fall back to the known Sinhagad Road pair
  const map = { shivane: [18.4637, 73.8090], nanded: [18.4572, 73.8029] };
  return map[o.id] || map.shivane;
}
function renderOutletList(me) {
  const list = state.outlets.map((o) => {
    const c = outletCoords(o);
    return { ...o, dist: me ? haversine(me[0], me[1], c[0], c[1]) : null, coords: c };
  }).sort((a, b) => (a.dist ?? 9e9) - (b.dist ?? 9e9));
  $('#outletGrid').innerHTML = list.map((o) => `
    <div class="outlet-card${me ? ' has-dist' : ''}">
      <div class="outlet-main">
        <b>${o.name}</b>
        <span>${o.address}</span>
        <span class="outlet-hours">${o.hours} &bull; ${o.phone}</span>
      </div>
      <div class="outlet-side">
        ${o.dist !== null ? `<span class="dist-chip">${o.dist.toFixed(1)} km away</span>` : ''}
        <div class="outlet-actions">
          <a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${o.coords[0]},${o.coords[1]}">Directions</a>
          <a class="btn btn-ghost btn-sm" href="tel:${o.phone.replace(/\s/g, '')}">Call</a>
        </div>
      </div>
    </div>`).join('');
  return list;
}
function initLocator() {
  renderOutletList(null);
  const c0 = outletCoords(state.outlets[0] || { id: 'shivane' });
  if (window.L) {
    state.map = L.map('locateMap', { scrollWheelZoom: false }).setView(c0, 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap', maxZoom: 19 }).addTo(state.map);
    state.outlets.forEach((o) => {
      const c = outletCoords(o);
      L.marker(c, { title: o.name }).addTo(state.map).bindPopup('<b>' + o.name + '</b><br>' + o.hours);
    });
  }
}
function locateMe() {
  const btn = $('#locateMe');
  const demo = new URLSearchParams(location.search);
  const fallback = () => {
    btn.disabled = false; btn.innerHTML = btn.innerHTML;
    toast('Location unavailable. Pick the nearest outlet instead.');
  };
  const use = (lat, lng) => {
    btn.disabled = false;
    const list = renderOutletList([lat, lng]);
    if (state.map) {
      state.map.setView([lat, lng], 14);
      if (state._meMarker) state.map.removeLayer(state._meMarker);
      state._meMarker = L.marker([lat, lng], { title: 'You' }).addTo(state.map)
        .bindPopup('You are here').openPopup();
      list.forEach((o) => {
        const line = L.polyline([[lat, lng], o.coords], { dashArray: '6 8', weight: 2, opacity: 0.5 }).addTo(state.map);
        line.bindTooltip(o.dist.toFixed(1) + ' km');
      });
    }
    toast('Nearest outlet: ' + (list[0] ? list[0].name : 'check the map'));
  };
  btn.disabled = true;
  if (demo.get('demoLat')) return use(+demo.get('demoLat'), +demo.get('demoLng'));
  if (!navigator.geolocation) return fallback();
  navigator.geolocation.getCurrentPosition(
    (p) => use(p.coords.latitude, p.coords.longitude),
    fallback, { enableHighAccuracy: false, timeout: 8000 }
  );
}

/* ---------------- live rider map in tracking ---------------- */
let lastSuccessOrder = null;
function ensureRiderMap(containerId) {
  if (!window.L) return null;
  let holder = $('#' + containerId + ' .rider-map');
  if (!holder) return null;
  if (!state.riderMap) state.riderMap = {};
  if (!state.riderMap[containerId]) state.riderMap[containerId] = L.map(holder, { zoomControl: false, attributionControl: false }).setView([18.468, 73.808], 14);
  return state.riderMap[containerId];
}
async function renderRiderMap(containerId, orderId) {
  const data = await fetch('/api/track/rider?order=' + encodeURIComponent(orderId)).then((r) => r.json()).catch(() => null);
  let holder = $('#' + containerId + ' .rider-map');
  if (!holder) {
    const wrap = document.createElement('div');
    wrap.className = 'rider-wrap';
    wrap.innerHTML = '<div class="rider-map"></div><div class="rider-cap">Finding your rider...</div>';
    $('#' + containerId).appendChild(wrap);
    holder = $('.rider-map', wrap);
  }
  if (!holder) return;
  if (!data || !data.rider || !data.pos) { holder.innerHTML = '<div class="rider-map-empty">Rider map appears when your order is out for delivery.</div>'; return; }
  holder.style.display = '';
  const map = ensureRiderMap(containerId);
  if (!map) return;
  setTimeout(() => map.invalidateSize(), 60);
  const layerKey = containerId + '_layers';
  (state[layerKey] || []).forEach((l) => map.removeLayer(l));
  state[layerKey] = [];
  const mk = (c, opts) => { const m = L.marker(c, opts).addTo(map); state[layerKey].push(m); return m; };
  mk(data.outletGeo, { title: 'Outlet' }).bindPopup('XTO Pizza outlet');
  const riderM = mk([data.pos.lat, data.pos.lng], { title: data.rider.name });
  riderM.bindPopup('<b>' + data.rider.name + '</b> is on the way' + (data.rider.phone ? '<br><a href="tel:' + data.rider.phone + '">Call rider</a>' : ''));
  map.setView([data.pos.lat, data.pos.lng], 15);
  const cap = $('#' + containerId + ' .rider-cap');
  if (cap) cap.textContent = data.rider.name + ' is riding to you' + (data.rider.phone ? ' - call ' + data.rider.phone : '');
  clearInterval(state['riderTimer_' + containerId]);
  state['riderTimer_' + containerId] = setInterval(() => { if (document.body.contains(holder)) renderRiderMap(containerId, orderId); else clearInterval(state['riderTimer_' + containerId]); }, 5000);
}

/* ---------------- push subscribe ---------------- */
function urlB64ToUint8Array(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4).replace(/=/g, '');
  const base64 = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}
async function onEnableUpdates() {
  const btn = $('#enableUpdatesBtn');
  const phone = (lastSuccessOrder && lastSuccessOrder.customer.phone) || $('#ckPhone').value.replace(/\D/g, '');
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) { toast('This browser does not support push. Try Chrome.'); return; }
  btn.disabled = true; btn.textContent = 'Turning on...';
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { btn.textContent = 'Notifications blocked in browser settings'; return; }
    const reg = await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
    const key = await fetch('/api/push/key').then((r) => r.json());
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(key.key) });
    const r = await fetch('/api/push/subscribe', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, subscription: sub.toJSON() })
    }).then((x) => x.json());
    btn.textContent = 'Done! Order updates will pop up here.';
    toast('Live updates on. Watch for the XTO bell.');
  } catch (e) {
    btn.disabled = false; btn.textContent = 'Get live status updates on this phone';
    toast('Could not turn on updates: ' + (e.message || e));
  }
}
