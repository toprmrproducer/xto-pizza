# XTO Pizza (repo notes for agents)

Zero-dependency Node stack: website, PWA app, admin (CES), rider page, QR cards. Pure veg outlet, names exactly as the printed menu card (Ver.17).

## Layout
- `server.js` API + static serving. `data/menu.json` catalog, `data/db.json` orders/enquiries (gitignored, live copy is on the VPS).
- `public/` storefront (`index.html`, `franchise|careers|contact.html`, `app.html`, `admin.html`), `public/css/home.css` = design tokens + storefront styles (see `DESIGN.md`), `public/js/{site,app,admin,layout,forms}.js`.
- `docs/` GitHub Pages: digital menu (`index.html`, built by `scripts/build-digital-menu.py`) and static demos (`site.html`, `app.html`, `franchise.html`..., built by `scripts/build-site-demo.py`). Rebuild both after any menu or UI change.
- `scripts/migrate-menu-groups.py` (idempotent size groups + add-ons + imgLock), `scripts/gen-missing-photos.py` (Replicate flux-1.1-pro, ~$0.04/photo, veg prompts only).

## Menu model
Each size is its own item (`dil-desi-medium`) with `group`, `groupName`, `size`, `sizeLabel`; clients group them into one card. Add-ons live in `menu.addons` with per-size prices; cart keys are `itemId|addon1,addon2`. Server re-prices everything (`priceOrder`). `imgLock: true` means the dish has its own photo in `public/images/ai/`.

## Deploy (live: https://xto.43.166.175.196.sslip.io)
1. `git push origin main` (Pages serves `docs/`).
2. Fetch live `/opt/xto-pizza/data/menu.json`, run the migration on it, rsync code to `/tmp/xto-src` as user `ubuntu` (key `~/.ssh/zeabur_voxalio`, root is refused), copy that menu.json to `/tmp/xto-src/data/menu.json`, then `sudo bash /tmp/xto-src/scripts/deploy.sh`. Never overwrite db.json or persist-images.
3. Verify with GET (the server answers GET only, HEAD returns 404).

## Rules
No chicken or meat anywhere, no emoji icons, no em dashes in copy, never claim numbers the client has not given. iOS app lives in `~/Code/xto-pizza-ios`.
