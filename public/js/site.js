/* XTO Pizza site engine: menu, cart, mock Razorpay checkout, order tracking */
'use strict';

const $ = (s, el) => (el || document).querySelector(s);
const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
const INR = (n) => '\u20B9' + Number(n).toLocaleString('en-IN');
const CART_KEY = 'xto_cart_v1';

const state = { menu: null, outlets: [], cat: 'all', cart: loadCart(), payCtx: null, coupon: null, map: null, riderMap: null, promoTimer: null, promoIdx: 0, offers: [] };

function loadCart() { try { return JSON.parse(localStorage.getItem(CART_KEY)) || {}; } catch (e) { return {}; } }
function saveCart() { localStorage.setItem(CART_KEY, JSON.stringify(state.cart)); }
function cartCount() { return Object.values(state.cart).reduce((s, q) => s + q, 0); }
function cartLines() {
  return Object.entries(state.cart).map(([id, qty]) => {
    const item = state.menu.items.find((i) => i.id === id);
    return item ? { ...item, qty } : null;
  }).filter(Boolean);
}
function cartTotals() {
  const lines = cartLines();
  const itemTotal = lines.reduce((s, l) => s + l.price * l.qty, 0);
  const discount = state.coupon ? Math.min(state.coupon.discount, itemTotal) : 0;
  return { lines, itemTotal, deliveryFee: 0, discount, total: itemTotal - discount };
}
function checkedMode() { return ($('input[name="mode"]:checked') || {}).value || 'delivery'; }

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
  renderTabs();
  renderMenu();
  renderCombos();
  renderOutlets();
  renderFooterOutlets();
  renderCatCircles();
  renderBestsellers();
  renderPromos();
  renderCouponWall();
  initLocator();
  bindUI();
  document.getElementById('enableUpdatesBtn')?.addEventListener('click', onEnableUpdates);
  document.getElementById('couponApply')?.addEventListener('click', applyCouponFromField);
  document.getElementById('locateMe')?.addEventListener('click', locateMe);
  document.addEventListener('sse', () => {}); // no-op hook point
  updateCartUI();
  document.addEventListener('scroll', () => $('#nav').classList.toggle('scrolled', scrollY > 30), { passive: true });
  const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && e.target.classList.add('in')), { threshold: 0.12 });
  $$('.reveal').forEach((el) => io.observe(el));
  if (location.hash.startsWith('#order=')) { trackById(decodeURIComponent(location.hash.slice(7))); }
}

/* ---------------- menu ---------------- */
function renderTabs() {
  const tabs = [{ id: 'all', name: 'All' }, ...state.menu.categories];
  $('#catTabs').innerHTML = tabs.map((t) => `<button class="cat-tab${t.id === 'all' ? ' active' : ''}" data-cat="${t.id}">${t.name}</button>`).join('');
  $$('#catTabs .cat-tab').forEach((b) => b.addEventListener('click', () => {
    state.cat = b.dataset.cat;
    $$('#catTabs .cat-tab').forEach((x) => x.classList.toggle('active', x === b));
    renderMenu();
  }));
}

function cardHTML(item) {
  const qty = state.cart[item.id] || 0;
  const img = item.img ? `/images/${item.img}.jpg` : null;
  const hue = [...item.id].reduce((s, c) => s + c.charCodeAt(0), 0) % 3;
  const grads = ['linear-gradient(135deg,#f0731d,#b3271e)', 'linear-gradient(135deg,#2f7d5b,#173f2e)', 'linear-gradient(135deg,#ffc53d,#f0731d)'];
  const tag = (item.tags || []).includes('bestseller') ? '<span class="tag-chip">Bestseller</span>' :
    (item.tags || []).includes('deal') ? '<span class="tag-chip red">Combo Deal</span>' :
    (item.tags || []).includes('premium') ? '<span class="tag-chip">Premium</span>' : '';
  const media = img
    ? `<img src="${img}" alt="${item.name}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='grid'"><div class="card-fallback" style="display:none;background:${grads[hue]}">${item.name[0]}</div>`
    : `<div class="card-fallback" style="background:${grads[hue]}">${item.name[0]}</div>`;
  const stepper = `<div class="qty-stepper${qty ? ' show' : ''}" data-qty="${item.id}">
      <button data-dec="${item.id}" aria-label="Less">−</button><span class="qty-val">${qty || 1}</span><button data-inc="${item.id}" aria-label="More">+</button>
    </div>`;
  return `<article class="card" data-item="${item.id}">
    <div class="card-img">
      <span class="veg-badge" title="Pure veg"></span>${tag}${media}
      ${item.available ? '' : '<div class="sold-out">Sold out</div>'}
    </div>
    <div class="card-body">
      <div class="card-name">${item.name}</div>
      <div class="card-desc">${item.desc}</div>
      <div class="card-foot">
        <div class="price"><small>₹</small>${item.price}</div>
        ${item.available ? `<button class="add-btn${qty ? ' hidden' : ''}" data-add="${item.id}">ADD +</button>${stepper}` : ''}
      </div>
    </div>
  </article>`;
}

function renderMenu() {
  const q = ($('#menuSearch').value || '').toLowerCase().trim();
  const list = $('#menuList');
  const cats = state.cat === 'all' ? state.menu.categories : state.menu.categories.filter((c) => c.id === state.cat);
  let html = '';
  let shown = 0;
  for (const cat of cats) {
    const items = state.menu.items.filter((i) => i.cat === cat.id && (!q || (i.name + ' ' + i.desc).toLowerCase().includes(q)));
    if (!items.length) continue;
    shown += items.length;
    html += `<div class="cat-block" id="cat-${cat.id}">
      <h3 style="font-family:Sora;font-size:1.15rem;margin:26px 0 4px">${cat.name}</h3>
      <div class="cat-note">${cat.note || ''}</div>
      <div class="menu-grid">${items.map(cardHTML).join('')}</div>
    </div>`;
  }
  list.innerHTML = html || '<div class="empty-note">Nothing matches that search. Try "paneer" or "shake".</div>';
  bindCardButtons(list);
}

function bindCardButtons(root) {
  $$('[data-add]', root).forEach((b) => b.addEventListener('click', () => {
    const id = b.dataset.add;
    state.cart[id] = 1;
    saveCart(); updateCartUI();
    const card = b.closest('.card');
    b.classList.add('hidden');
    $('.qty-stepper', card).classList.add('show');
    toast($('.card-name', card).textContent + ' added to cart');
  }));
  $$('[data-inc]', root).forEach((b) => b.addEventListener('click', () => {
    const id = b.dataset.inc;
    state.cart[id] = Math.min(20, (state.cart[id] || 0) + 1);
    saveCart(); syncSteppers(id); updateCartUI();
  }));
  $$('[data-dec]', root).forEach((b) => b.addEventListener('click', () => {
    const id = b.dataset.dec;
    state.cart[id] = (state.cart[id] || 0) - 1;
    if (state.cart[id] <= 0) delete state.cart[id];
    saveCart(); syncSteppers(id); updateCartUI();
  }));
}
function syncSteppers(id) {
  const card = $(`[data-item="${id}"]`);
  if (!card) return;
  const q = state.cart[id] || 0;
  $('.qty-val', card).textContent = q || 1;
  $('.qty-stepper', card).classList.toggle('show', q > 0);
  $('.add-btn', card).classList.toggle('hidden', q > 0);
}

/* ---------------- combos & outlets ---------------- */
function renderCombos() {
  const combos = state.menu.items.filter((i) => i.cat === 'combos');
  $('#comboGrid').innerHTML = combos.map((c) => `
    <div class="combo-card">
      <img src="/images/${c.img}.jpg" alt="${c.name}" loading="lazy" onerror="this.remove()" />
      <div class="combo-shade"></div>
      <span class="deal-flag">COMBO</span>
      <div class="combo-info">
        <div><h3>${c.name}</h3><p>${c.desc}</p></div>
        <div class="combo-price"><b>${INR(c.price)}</b><button class="add-btn" style="background:var(--gold);border-color:var(--gold);color:var(--ink)" data-add-combo="${c.id}">ADD +</button></div>
      </div>
    </div>`).join('');
  $$('[data-add-combo]').forEach((b) => b.addEventListener('click', () => {
    state.cart[b.dataset.addCombo] = (state.cart[b.dataset.addCombo] || 0) + 1;
    saveCart(); updateCartUI(); toast('Combo added to cart'); syncSteppers(b.dataset.addCombo);
  }));
}
function renderOutlets() {
  $('#outletGrid').innerHTML = state.outlets.map((o) => `
    <div class="outlet-card reveal in">
      <div class="outlet-top">
        <h3>${o.name}</h3>
        <span class="rating-pill">★ 4.0 Google</span>
      </div>
      <div class="outlet-rows">
        <div class="outlet-row"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg><span>${o.address}</span></div>
        <div class="outlet-row"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.58 2.81.7A2 2 0 0 1 22 16.92z"/></svg><span>${o.phone}</span></div>
        <div class="outlet-row"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg><span>${o.hours}</span></div>
      </div>
      <div class="outlet-actions">
        <a class="btn-out" href="${o.maps}" target="_blank" rel="noopener">📍 Google Maps</a>
        <a class="btn-out" href="tel:${o.phone.replace(/\s/g, '')}">Call Outlet</a>
        <button class="btn-out" data-pickup="${o.id}">Order Pickup Here</button>
      </div>
    </div>`).join('');
  $$('[data-pickup]').forEach((b) => b.addEventListener('click', () => {
    const r = $(`#ckOutlet option[value="${b.dataset.pickup}"]`);
    if (r) r.selected = true;
    $('input[name="mode"][value="pickup"]').checked = true;
    updateBill();
    openCart();
    toast('Pickup at ' + b.dataset.pickup + ' selected. Add items and checkout.');
  }));
}
function renderFooterOutlets() {
  $('#footerOutlets').insertAdjacentHTML('beforeend', state.outlets.map((o) =>
    `<a href="${o.maps}" target="_blank" rel="noopener">${o.name.replace('XTO Pizza ', '')}</a>`).join(''));
}

/* ---------------- cart ---------------- */
function updateCartUI() {
  const n = cartCount();
  $('#cartCount').textContent = n;
  const box = $('#cartItems');
  const { lines, itemTotal, deliveryFee, total } = cartTotals();
  if (!lines.length) {
    box.innerHTML = '<div class="cart-empty"><b>Your cart is empty</b>The oven is hot. Add something delicious.</div>';
    $('#cartFoot').innerHTML = '';
    return;
  }
  box.innerHTML = lines.map((l) => {
    const media = l.img ? `<img src="/images/${l.img}.jpg" alt="" onerror="this.outerHTML='<div class=cl-fallback style=background:linear-gradient(135deg,#f0731d,#b3271e)></div>'" />` : '<div class="cl-fallback" style="background:linear-gradient(135deg,#f0731d,#b3271e)"></div>';
    return `<div class="cart-line">
      ${media}
      <div><h4>${l.name}</h4><div class="cl-price">${INR(l.price)} each</div></div>
      <div class="cl-stepper">
        <button data-cdec="${l.id}">−</button><span class="cl-qty">${l.qty}</span><button data-cinc="${l.id}">+</button>
      </div>
    </div>`;
  }).join('');
  $$('[data-cinc]', box).forEach((b) => b.addEventListener('click', () => { state.cart[b.dataset.cinc]++; saveCart(); updateCartUI(); syncSteppers(b.dataset.cinc); }));
  $$('[data-cdec]', box).forEach((b) => b.addEventListener('click', () => {
    state.cart[b.dataset.cdec]--; if (state.cart[b.dataset.cdec] <= 0) delete state.cart[b.dataset.cdec];
    saveCart(); updateCartUI(); syncSteppers(b.dataset.cdec);
  }));
  const remaining = state.menu.freeDeliveryAbove - itemTotal;
  $('#cartFoot').innerHTML = `
    <div class="cart-row"><span>Item total</span><span>${INR(itemTotal)}</span></div>
    <div class="cart-row total"><span>To pay</span><span>${INR(total)}</span></div>
    ${modeDeliverySelected() && remaining > 0 ? `<div class="free-del-note">Add ${INR(remaining)} more for free delivery</div>` : ''}
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
      items: cartLines().map((l) => ({ id: l.id, qty: l.qty })),
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
  ['PLACED', 'Order received', '🔥'],
  ['ACCEPTED', 'Accepted by kitchen', '👨‍🍳'],
  ['PREPARING', 'Cooking now', '🍕'],
  ['READY', 'Ready', '🛍️'],
  ['SERVED', 'Served. Enjoy!', '✅']
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
  $('#cartClose').addEventListener('click', closeCart);
  $('#scrim').addEventListener('click', closeCart);
  $('#payBtn').addEventListener('click', startPayment);
  $('#rzpPayBtn').addEventListener('click', confirmPayment);
  $('#trackGo').addEventListener('click', trackGo);
  $('#trackLink').addEventListener('click', (e) => { e.preventDefault(); openModal('trackModal'); });
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

/* ---------------- homepage: promos, categories, bestsellers, coupons ---------------- */
async function renderPromos() {
  const res = await fetch('/api/offers').then((r) => r.json()).catch(() => ({ offers: [] }));
  state.offers = res.offers || [];
  const slides = state.offers.map((o, i) => ({
    kicker: i === 0 ? 'Limited time' : 'Offer live now',
    title: o.type === 'percent' ? o.value + '% OFF' : INR(o.value) + ' OFF',
    sub: o.label || ('Use code ' + o.code),
    code: o.code,
    cls: ['p-orange', 'p-red', 'p-gold'][i % 3]
  }));
  if (!slides.length) return;
  const el = $('#promoCarousel');
  el.innerHTML = slides.map((sl, i) => `
    <div class="promo-slide ${sl.cls}${i === 0 ? ' active' : ''}">
      <div class="promo-copy">
        <div class="promo-kicker">${sl.kicker}</div>
        <div class="promo-title">${sl.title}</div>
        <div class="promo-sub">${sl.sub}</div>
        <button class="promo-code" data-code="${sl.code}">Use code ${sl.code} <span class="promo-arrow">&rarr;</span></button>
      </div>
      <div class="promo-art"><img src="/images/pizza-closeup.jpg" alt="" loading="lazy" /></div>
    </div>`).join('');
  $('#promoDots').innerHTML = slides.map((_, i) => `<button data-dot="${i}" class="${i === 0 ? 'on' : ''}"></button>`).join('');
  const show = (i) => {
    state.promoIdx = i % slides.length;
    $$('.promo-slide', el).forEach((sl, k) => sl.classList.toggle('active', k === state.promoIdx));
    $$('#promoDots button').forEach((d, k) => d.classList.toggle('on', k === state.promoIdx));
  };
  clearInterval(state.promoTimer);
  state.promoTimer = setInterval(() => show(state.promoIdx + 1), 4200);
  $$('#promoDots button').forEach((d) => d.addEventListener('click', () => { show(+d.dataset.dot); clearInterval(state.promoTimer); state.promoTimer = setInterval(() => show(state.promoIdx + 1), 4200); }));
  $$('[data-code]', el).forEach((b) => b.addEventListener('click', () => { copyCode(b.dataset.code); }));
}
function copyCode(code) {
  navigator.clipboard?.writeText(code).catch(() => {});
  $('#ckCoupon').value = code;
  state.pendingCode = code;
  toast('Code ' + code + ' copied. Apply it at checkout.');
  document.getElementById('menu').scrollIntoView({ behavior: 'smooth' });
}
async function renderCouponWall() {
  if (!state.offers.length) {
    const res = await fetch('/api/offers').then((r) => r.json()).catch(() => ({ offers: [] }));
    state.offers = res.offers || [];
  }
  $('#couponWall').innerHTML = state.offers.map((o, i) => `
    <div class="coupon-card c${i % 3}">
      <div class="coupon-cut top"></div>
      <div class="coupon-value">${o.type === 'percent' ? o.value + '%' : INR(o.value)}</div>
      <div class="coupon-label">${o.label || 'On your next order'}</div>
      <div class="coupon-min">${o.minOrder ? 'Min order ' + INR(o.minOrder) : 'No minimum'}</div>
      <button class="coupon-code-btn" data-code="${o.code}">${o.code} <span>copy</span></button>
      <div class="coupon-cut bottom"></div>
    </div>`).join('') || '<div class="empty-note">New offers dropping soon. Stay hungry.</div>';
  $$('#couponWall [data-code]').forEach((b) => b.addEventListener('click', () => copyCode(b.dataset.code)));
}
function renderCatCircles() {
  $('#catCircles').innerHTML = state.menu.categories.map((c) => {
    const first = state.menu.items.find((i) => i.cat === c.id);
    return `<a class="cat-circle" href="#menu" data-jump-cat="${c.id}">
      <span class="cat-ring"><img src="/images/${first ? first.img : 'pizza-cheese'}.jpg" alt="${c.name}" loading="lazy" /></span>
      <span class="cat-name">${c.name}</span>
    </a>`;
  }).join('');
  $$('#catCircles [data-jump-cat]').forEach((a) => a.addEventListener('click', () => {
    const tab = $(`#catTabs [data-cat="${a.dataset.jumpCat}"]`);
    if (tab) tab.click();
  }));
}
function renderBestsellers() {
  const picks = ['farmers-delight', 'tandoori-paneer', 'double-cheese-burger', 'kitkat-shake', 'combo-delight', 'cheesy-garlic-bread']
    .map((id) => state.menu.items.find((i) => i.id === id)).filter(Boolean);
  const top = (picks.length ? picks : state.menu.items.slice(0, 6));
  $('#bestRow').innerHTML = top.map((i) => `
    <div class="best-card">
      <img src="/images/${i.img}.jpg" alt="${i.name}" loading="lazy" />
      <div class="best-body">
        <b>${i.name}</b>
        <span>${INR(i.price)}</span>
        <button class="btn btn-primary btn-sm" data-add="${i.id}">Add</button>
      </div>
    </div>`).join('');
  bindCardButtons($('#bestRow'));
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
  const map = { shivane: [18.4649, 73.8078], nanded: [18.4720, 73.8093] };
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
