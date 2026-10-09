# XTO Pizza: complete ordering stack

Website + iOS/Android app + Central Administrative System (CES) + mock Razorpay payments, all in one local server. Zero npm dependencies, pure Node.js.

## Run it (one command)

```bash
bash run.sh
```

That starts everything on port 7788 and opens the website. If the port is taken: `PORT=8080 bash run.sh`.

| Surface | URL | What it is |
|---|---|---|
| Website | http://localhost:7788/ | Customer storefront: menu, cart, checkout, tracking |
| Mobile app | http://localhost:7788/app | The iOS + Android app (PWA). Installable from any phone browser |
| Admin CES | http://localhost:7788/admin | Central admin: live orders, dispatch, menu control. PIN **4321** |
| Health | http://localhost:7788/healthz | JSON heartbeat |

To demo on a real phone on the same Wi-Fi: `PORT=7788 node server.js`, then visit `http://<mac-ip>:7788/app` from the phone. iPhone Safari: Share > Add to Home Screen. Android Chrome: install prompt appears automatically. It launches fullscreen like a native app.

## The four things, mapped

1. **Website** (`/`): hero, full menu with real photos of the actual items, combos, both outlets, gallery, story. Cart + checkout + live order tracking.
2. **iOS app + Android app** (`/app`): one PWA codebase that installs on both platforms (manifest + service worker + app icons included). Bottom-tab native-feel shell: Home, Menu, Cart, Orders.
3. **Central Administrative System** (`/admin`): every order from the website and the apps lands here live (server-sent events, alert sound). Accept, start cooking, mark ready, dispatch with rider assignment, complete or cancel. Menu manager flips items sold out across all surfaces instantly. Today revenue, order count, average order value, top items.
4. **Payment integration**: mock Razorpay checkout (UPI/card/netbanking tabs, success state) wired end to end. Orders only get created after the payment captures, exactly like production.

## Going live with Razorpay later

The gateway seam is already in `server.js`. Set three things and restart, no code changes:

```bash
export RAZORPAY_LIVE=1
export RAZORPAY_KEY_ID=rzp_live_xxxx
export RAZORPAY_KEY_SECRET=xxxx
```

With those set, `/api/pay/intent` creates a real Razorpay order and the frontend receives the real key id. The one remaining production step is swapping the mock confirmation modal for Razorpay's hosted `checkout.js` script (drop-in, same intent response).

## Editing the menu, prices and outlets

- Menu items, prices, descriptions: `data/menu.json`
- Admin PIN: `data/config.json`
- Outlets, phones, hours: `outlets` array in `server.js`
- Orders, riders, sold-out flags: `data/db.json` (also editable: `riders` list for dispatch)

Changes to menu/outlets need a server restart. Orders and menu toggles via the admin are live.

## Architecture

```
run.sh              one command
server.js           Node http server: static + JSON API + SSE + payment engine
data/menu.json      76-item catalog (prices from their live Swiggy menu)
data/db.json        orders, riders, sold-out state (seeded with 4 demo orders)
data/config.json    admin PIN
public/index.html   website        public/css/site.css   public/js/site.js
public/app.html     PWA app        public/css/app.css    public/js/app.js
public/admin.html   CES console    public/css/admin.css  public/js/admin.js
public/images/      real photos cropped from the client's Justdial/Swiggy listings
public/manifest.webmanifest + sw.js + icons   PWA install layer
_raw/               original client screenshots (source material)
```

Status pipeline: PLACED -> ACCEPTED -> PREPARING -> READY -> OUT_FOR_DELIVERY (delivery only) -> DELIVERED. Pickup orders jump READY -> DELIVERED. Every transition is validated server-side and pushed to the admin over SSE; the customer's track view polls the same API.

Built from the client's real assets: menu board, Justdial photo gallery, Swiggy listing prices, Google Maps outlet data.
