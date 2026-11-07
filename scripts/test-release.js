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
  fs.writeFileSync(path.join(root, 'data/db.json'), JSON.stringify({ orders: [], orderSeq: 0, unavailable: [], offers: [], riders: [], pending: {} }));
  let creates = 0;
  let paid = false;
  let pushes = 0;
  const gateway = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/orders' && req.method === 'POST') {
        creates++;
        res.end(JSON.stringify({ payment_session_id: 'synthetic-session', order_id: JSON.parse(raw).order_id }));
      } else if (req.url.endsWith('/payments')) res.end(JSON.stringify([{ payment_status: 'SUCCESS', cf_payment_id: 'synthetic-payment' }]));
      else if (req.url.startsWith('/orders/')) res.end(JSON.stringify({ order_status: paid ? 'PAID' : 'ACTIVE', order_amount: 100 }));
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
    const productionMenu = { restaurants: [{ restaurantid: 'production-restaurant', details: { menusharingcode: 'production-code' } }], items: [{ itemid: 'item-1', itemname: 'Margarita', price: 0, active: '1', in_stock: '1', item_ordertype: '1,2,3', tax_inclusive: '1', itemallowvariation: '1', variation: [{ id: 'row-regular', variationid: 'variation-regular', name: 'Regular', price: 100, active: '1' }] }], taxes: [], addongroups: [], categories: [] };
    assert.equal((await request('/api/petpooja/pushmenu', productionMenu, token)).code, 200);
    const snapshot = fs.readFileSync(path.join(root, 'data/petpooja-menu.json'), 'utf8');
    assert.equal((await request('/api/petpooja/pushmenu', { ...productionMenu, restaurants: [{ restaurantid: 'sandbox', details: { menusharingcode: 'sandbox' } }] }, token)).code, 422);
    assert.equal(fs.readFileSync(path.join(root, 'data/petpooja-menu.json'), 'utf8'), snapshot);
    const start = await request('/api/checkout/start', cart);
    assert.equal(start.code, 200, JSON.stringify(start));
    assert.equal(creates, 1);
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
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'data/db.json'))).orders.length, 1);
    assert.equal(pushes, 1);
    assert.equal((await request('/api/petpooja/callback', { orderID: order.id, restID: 'wrong-outlet', status: '10' }, token)).code, 400);
    assert.equal((await request('/api/petpooja/callback', { orderID: order.id, restID: 'production-code', status: '5' }, token)).code, 200);
    assert.equal((await request('/api/orders/' + order.id, undefined, { Cookie: cookie })).data.order.status, 'READY');
    console.log('PASS: 26 release assertions using isolated synthetic Cashfree/Petpooja servers; no live credentials or external calls.');
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
