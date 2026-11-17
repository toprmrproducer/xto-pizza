'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const assert = require('assert/strict');
const { spawn } = require('child_process');

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xto-release-'));
  const repo = path.resolve(__dirname, '..');
  fs.mkdirSync(path.join(root, 'data'));
  for (const name of ['server.js', 'auth.js', 'petpooja.js']) fs.copyFileSync(path.join(repo, name), path.join(root, name));
  fs.symlinkSync(path.join(repo, 'public'), path.join(root, 'public'));
  const menu = { categories: [], items: [{ id: 'margarita-regular', name: 'Margarita (Regular)', groupName: 'Margarita', size: 'regular', price: 100 }], addons: [] };
  fs.writeFileSync(path.join(root, 'data/menu.json'), JSON.stringify(menu));
  fs.writeFileSync(path.join(root, 'data/config.json'), JSON.stringify({ adminPin: 'synthetic-admin' }));
  fs.writeFileSync(path.join(root, 'data/db.json'), JSON.stringify({ orders: [{ id: 'XT-SEED', createdAt: new Date().toISOString(), status: 'PLACED', mode: 'takeaway', outlet: 'nanded', customer: { name: 'Seed', phone: '9111111111' }, items: [], total: 105, payment: { method: 'cashfree', status: 'paid', paymentId: 'p', gatewayOrderId: 'seed-order' }, pos: { status: 'held' }, acceptBy: new Date(Date.now() - 60000).toISOString(), history: [{ status: 'PLACED', at: new Date().toISOString() }] }], orderSeq: 0, unavailable: [], offers: [], riders: [], pending: {} }));
  let creates = 0;
  let paid = false;
  let pushes = 0;
  const refunds = [];
  const gateway = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/orders' && req.method === 'POST') {
        creates++;
        res.end(JSON.stringify({ payment_session_id: 'synthetic-session', order_id: JSON.parse(raw).order_id }));
      } else if (req.url.endsWith('/refunds') && req.method === 'POST') {
        refunds.push(JSON.parse(raw)); res.end(JSON.stringify({ refund_status: 'PENDING' }));
      } else if (req.url.endsWith('/payments')) res.end(JSON.stringify([{ payment_status: 'SUCCESS', cf_payment_id: 'synthetic-payment' }]));
      else if (req.url.startsWith('/orders/')) res.end(JSON.stringify({ order_status: paid ? 'PAID' : 'ACTIVE', order_amount: 105 }));
      else if (req.url === '/save_order') { pushes++; res.end(JSON.stringify({ success: '1', orderID: 'synthetic-pos' })); }
      else { res.statusCode = 404; res.end('{}'); }
    });
  });
  await new Promise((resolve) => gateway.listen(0, '127.0.0.1', resolve));
  const gatewayBase = 'http://127.0.0.1:' + gateway.address().port;
  const reservation = http.createServer();
  await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const server = spawn(process.execPath, ['server.js'], {
    cwd: root, stdio: ['ignore', 'ignore', 'pipe'], env: {
      PATH: process.env.PATH, NODE_ENV: 'test', PORT: String(port), CASHFREE_APP_ID: 'synthetic', CASHFREE_SECRET_KEY: 'synthetic', CASHFREE_API_BASE: gatewayBase,
      PP_APP_KEY: 'synthetic', PP_APP_SECRET: 'synthetic', PP_ACCESS_TOKEN: 'synthetic', PP_PUSH_TOKEN: 'synthetic-receiver',
      PP_SAVE_ORDER_URL: gatewayBase + '/save_order', PETPOOJA_OUTLET_MAP: JSON.stringify({ nanded: 'production-code' })
    }
  });
  let errors = '';
  server.stderr.on('data', (chunk) => { errors += chunk; });
  const origin = 'http://127.0.0.1:' + port;
  const request = async (endpoint, body, headers = {}) => {
    const response = await fetch(origin + endpoint, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { code: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      try { await request('/healthz'); break; } catch (error) { await new Promise((resolve) => setTimeout(resolve, 30)); }
    }
    const cart = { mode: 'takeaway', outlet: 'nanded', customer: { name: 'Synthetic Customer', phone: '9000000000' }, items: [{ id: 'margarita-regular', qty: 1 }] };
    const token = { 'X-XTO-Token': 'synthetic-receiver' };
    assert.equal((await request('/api/checkout/start', cart)).code, 503);
    assert.equal(creates, 0);
    assert.equal((await request('/api/petpooja/pushmenu', {})).code, 401);
    assert.equal((await request('/api/petpooja/pushmenu', {}, token)).code, 400);
    const productionMenu = { restaurants: [{ restaurantid: 'production-restaurant', details: { menusharingcode: 'production-code' } }], items: [{ itemid: 'item-1', itemname: 'Margarita', price: 0, active: '1', in_stock: '1', item_ordertype: '1,2,3', tax_inclusive: 'false', item_tax: '333040,333041', itemallowvariation: '1', variation: [{ id: 'row-regular', variationid: 'variation-regular', name: 'Regular', price: 100, active: '1' }] }], taxes: [{ taxid: '333040', taxname: 'CGST', tax: '2.5', tax_ordertype: '1,2,3' }, { taxid: '333041', taxname: 'SGST', tax: '2.5', tax_ordertype: '1,2,3' }], addongroups: [], categories: [] };
    assert.equal((await request('/api/petpooja/pushmenu', productionMenu, token)).code, 200);
    const snapshot = fs.readFileSync(path.join(root, 'data/petpooja-menu.json'), 'utf8');
    assert.equal((await request('/api/petpooja/pushmenu', { ...productionMenu, restaurants: [{ restaurantid: 'sandbox', details: { menusharingcode: 'sandbox' } }] }, token)).code, 422);
    assert.equal(fs.readFileSync(path.join(root, 'data/petpooja-menu.json'), 'utf8'), snapshot);
    const start = await request('/api/checkout/start', cart);
    assert.equal(start.code, 200, JSON.stringify(start));
    assert.equal(creates, 1);
    assert.equal(start.data.amount, 105); // Rs 100 item + 5% GST, equal to the POS total
    assert.equal((await request('/api/checkout/confirm', { orderId: start.data.orderId })).code, 202);
    paid = true;
    const confirmations = await Promise.all([request('/api/checkout/confirm', { orderId: start.data.orderId }), request('/api/checkout/confirm', { orderId: start.data.orderId })]);
    assert.equal(confirmations[0].code, 200);
    assert.equal(confirmations[1].code, 200);
    assert.equal(confirmations[0].data.order.id, confirmations[1].data.order.id);
    const order = confirmations[0].data.order;
    const cookie = confirmations[0].cookie;
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal((await request('/api/orders/' + order.id)).code, 401);
    assert.equal((await request('/api/orders/' + order.id, undefined, { Cookie: cookie })).code, 200);
    assert.equal((await request('/api/orders?phone=9000000000')).data.orders.length, 0);
    assert.equal((await request('/api/orders?phone=9000000000', undefined, { Cookie: cookie })).data.orders.length, 1);
    assert.equal((await request('/api/events')).code, 401);
    const login = await request('/api/admin/login', { pin: 'synthetic-admin' });
    assert.equal(login.code, 200);
    assert.ok(login.cookie);
    const abort = new AbortController();
    const events = await fetch(origin + '/api/events', { headers: { Cookie: login.cookie }, signal: abort.signal });
    assert.equal(events.status, 200);
    abort.abort();
    assert.ok(JSON.parse(fs.readFileSync(path.join(root, 'data/db.json'))).orders.length >= 1);
    assert.equal(pushes, 0); // held: nothing reaches the POS (so nothing prints) before staff accept
    assert.equal((await request('/api/orders/' + order.id, undefined, { Cookie: cookie })).data.order.awaitingOutlet, true);
    assert.equal((await request('/api/admin/orders/' + order.id + '/status', { status: 'ACCEPTED' }, { 'x-admin-pin': 'synthetic-admin' })).code, 200);
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(pushes, 1);
    assert.equal((await request('/api/petpooja/callback', { orderID: order.id, restID: 'wrong-outlet', status: '10' }, token)).code, 400);
    assert.equal((await request('/api/petpooja/callback', { orderID: order.id, restID: 'production-code', status: '5' }, token)).code, 200);
    assert.equal((await request('/api/orders/' + order.id, undefined, { Cookie: cookie })).data.order.status, 'READY');
    // second order: staff reject, the customer is refunded in full automatically and nothing is pushed
    const start2 = await request('/api/checkout/start', cart);
    const conf2 = await request('/api/checkout/confirm', { orderId: start2.data.orderId });
    assert.equal(conf2.code, 200);
    const o2 = conf2.data.order;
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(pushes, 1);
    const rej = await request('/api/admin/orders/' + o2.id + '/status', { status: 'CANCELLED', reason: 'Item not available' }, { 'x-admin-pin': 'synthetic-admin' });
    assert.equal(rej.code, 200);
    assert.equal(rej.data.order.status, 'CANCELLED');
    assert.equal(rej.data.order.refund.status, 'done');
    assert.equal(refunds.length, 1);
    assert.equal(refunds[0].refund_amount, 105);
    assert.equal(pushes, 1);
    assert.equal((await request('/api/admin/orders/' + o2.id + '/status', { status: 'CANCELLED' }, { 'x-admin-pin': 'synthetic-admin' })).code, 200);
    assert.equal(refunds.length, 1); // idempotent: no double refund
    // delivery fee: Rs 50 below Rs 250 including GST, free at or above it
    const del = (qty) => ({ ...cart, mode: 'delivery', items: [{ id: 'margarita-regular', qty }], address: { line: 'Test address, Nanded City, Pune', landmark: '', lat: 18.4572, lng: 73.8029 } });
    assert.equal((await request('/api/checkout/start', del(2))).data.amount, 260); // 200 + 10 GST + 50 delivery
    assert.equal((await request('/api/checkout/start', del(3))).data.amount, 315); // 300 + 15 GST, delivery free
    // unanswered order past its window is auto-rejected and refunded by the sweeper
    await new Promise((resolve) => setTimeout(resolve, 21000));
    const seeded = await request('/api/admin/orders', undefined, { 'x-admin-pin': 'synthetic-admin' });
    const seed = seeded.data.orders.find((x) => x.id === 'XT-SEED');
    assert.equal(seed.status, 'CANCELLED');
    assert.equal(seed.refund.status, 'done');
    assert.equal(refunds.length, 2);
    console.log('PASS: 44 release assertions using isolated synthetic Cashfree/Petpooja servers; no live credentials or external calls.');
  } finally {
    server.kill('SIGTERM');
    if (server.exitCode === null && server.signalCode === null) await new Promise((resolve) => server.once('exit', resolve));
    gateway.closeAllConnections();
    await new Promise((resolve) => gateway.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
    if (errors) process.stderr.write(errors);
  }
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
