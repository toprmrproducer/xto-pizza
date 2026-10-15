#!/usr/bin/env python3
"""Build the static digital menu (docs/index.html + docs/menu-ai.html) from data/menu.json.

v2 (15 Oct 2026): soft peach canvas, sidebar categories, white rounded cards with size pills,
modelled on the Pinterest reference Shreyas supplied. One card per dish (sizes are pills),
add-ons table from the printed card, no ordering (view-only, scan at table).
Photos come straight from public/images (AI shots, locked per dish via imgLock).
Run: python3 scripts/build-digital-menu.py
"""
import json, os, shutil, html

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
menu = json.load(open(os.path.join(ROOT, 'data', 'menu.json')))
SRC = os.path.join(ROOT, 'public', 'images')
DST = os.path.join(ROOT, 'docs', 'images')
LIVE = 'https://xto.43.166.175.196.sslip.io'

# ---- assets: base images + every photo the menu points at (keeps ai/ subfolder)
os.makedirs(DST, exist_ok=True)
for f in ('mark.svg', 'logo.svg', 'icon-192.png', 'icon-512.png', 'interior-1.jpg'):
    p = os.path.join(SRC, f)
    if os.path.exists(p): shutil.copy2(p, os.path.join(DST, f))
used = set(i['img'] for i in menu['items']) | {'ai/feature-veg-pull', 'ai/feature-feast-1', 'ai/feature-margherita-pull-1', 'ai/feature-feast-2', 'ai/feature-margherita-pull-2', 'ai/feature-feast-3', 'ai/feature-veg-pull-2', 'ai/feature-margherita-pull-3', 'ai/feature-margherita-pull-3'}
missing = []
for img in sorted(used):
    ok = False
    for ext in ('.jpg', '.png'):
        src = os.path.join(SRC, img + ext)
        if os.path.exists(src):
            dst = os.path.join(DST, img + ext)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copy2(src, dst); ok = True; break
    if not ok: missing.append(img)
if missing: print('WARNING missing photos:', missing)

SIZE_ORDER = ['six', 'regular', 'half', 'medium', 'full', 'large']
cats = menu['categories']
groups = {}
order = []
for i in menu['items']:
    k = (i['cat'], i.get('group') or i['id'])
    if k not in groups:
        groups[k] = []; order.append(k)
    groups[k].append(i)
for k in groups:
    groups[k].sort(key=lambda x: (SIZE_ORDER.index(x.get('size') or 'regular'), x['price']))

def esc(s): return html.escape(str(s), quote=True)

cards_by_cat = {}
for (cat, gk) in order:
    g = groups[(cat, gk)]
    first = g[0]
    name = first.get('groupName') or first['name']
    sizes = ''
    if len(g) > 1:
        sizes = '<div class="sz-l">Size</div><div class="szs">' + ''.join(
            f'<button type="button" class="sz{" on" if n == 0 else ""}" data-p="{x["price"]}">{esc(x.get("sizeLabel") or "")}<b>&#8377;{x["price"]}</b></button>'
            for n, x in enumerate(g)) + '</div>'
    elif first.get('sizeLabel'):
        sizes = f'<div class="sz-l">Size</div><div class="szs"><span class="sz on">{esc(first["sizeLabel"])}<b>&#8377;{first["price"]}</b></span></div>'
    cards_by_cat.setdefault(cat, []).append(f'''<article class="card" data-name="{esc((name + " " + (first.get("desc") or "")).lower())}">
  <div class="ph"><img src="images/{esc(first["img"])}.jpg" alt="{esc(name)}" loading="lazy" onerror="this.onerror=null;this.src='images/ai/feature-veg-pull.jpg'"><span class="vg" title="Pure veg"></span></div>
  <div class="cb">
    <div class="t"><h3>{esc(name)}</h3><span class="pr">{"from " if len(g) > 1 else ""}<b class="pv">&#8377;{g[0]["price"]}</b></span></div>
    <p>{esc(first.get("desc") or "")}</p>
    {sizes}
  </div>
</article>''')

count = len(order)
nav = ''.join(f'<a href="#cat-{c["id"]}" data-c="{c["id"]}"><span>{esc(c["name"])}</span><em>{len(cards_by_cat.get(c["id"], []))}</em></a>' for c in cats if cards_by_cat.get(c['id']))
pills = ''.join(f'<a href="#cat-{c["id"]}">{esc(c["name"])}</a>' for c in cats if cards_by_cat.get(c['id']))
sections = ''.join(
    f'<section id="cat-{c["id"]}"><div class="sh"><h2>{esc(c["name"])}</h2><p>{esc(c.get("note") or "")}</p></div><div class="grid">{"".join(cards_by_cat[c["id"]])}</div></section>'
    for c in cats if cards_by_cat.get(c['id']))

addons = menu.get('addons') or []
addon_rows = ''.join(
    f'<tr><th>{esc(a["name"])}</th><td>&#8377;{a["prices"]["regular"]}</td><td>&#8377;{a["prices"]["medium"]}</td><td>&#8377;{a["prices"]["large"]}</td></tr>' for a in addons)
addon_html = f'''<section id="cat-addons"><div class="sh"><h2>Dil Maange More</h2><p>Add-ons for Regular, Medium and Large pizzas</p></div>
<div class="addons"><table><thead><tr><th></th><th>Regular</th><th>Medium</th><th>Large</th></tr></thead><tbody>{addon_rows}</tbody></table></div></section>''' if addons else ''

PAGE = r'''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>XTO Pizza | Digital Menu</title>
<meta name="description" content="XTO Pizza digital menu: pure veg pizzas, pasta, burgers, wraps, combos and shakes. Shivane Khadakwasla and Nanded City, Pune." />
<meta name="theme-color" content="#ffefe0" />
<link rel="icon" href="images/icon-192.png" />
<link rel="preconnect" href="https://fonts.googleapis.com" /><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,800&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
<style>
:root{--ink:#2a1a10;--muted:#8a7667;--red:#b3271e;--orange:#f0731d;--peach:#ffefe0;--peach2:#ffe3cc;--card:#fff;--line:#f1dcc8;--veg:#1c7c31;--sh:0 10px 30px -16px rgba(120,60,20,.35);--disp:'Bricolage Grotesque','Inter',system-ui,sans-serif}
*{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth;scroll-padding-top:150px}
body{font-family:'Inter',system-ui,sans-serif;color:var(--ink);background:radial-gradient(1200px 600px at 100% -10%,#ffd9b8 0,transparent 60%),radial-gradient(900px 500px at -10% 30%,#ffe9d6 0,transparent 55%),var(--peach);min-height:100vh;-webkit-font-smoothing:antialiased}
a{color:inherit;text-decoration:none}
.top{position:sticky;top:0;z-index:30;background:rgba(255,239,224,.88);backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}
.top-in{max-width:1240px;margin:0 auto;padding:12px 20px;display:flex;align-items:center;gap:14px}
.brand{display:flex;align-items:center;gap:10px;flex:none}
.brand i{width:42px;height:42px;border-radius:12px;background:#fff;display:grid;place-items:center;box-shadow:var(--sh)}
.brand img{width:28px;height:28px}
.brand b{font:800 1.2rem var(--disp);letter-spacing:.02em;display:block;line-height:1}
.brand span{font-size:.64rem;letter-spacing:.28em;color:var(--red);font-weight:700}
.search{flex:1;max-width:560px;margin-left:auto;position:relative}
.search input{width:100%;padding:12px 16px 12px 44px;border:1px solid var(--line);border-radius:999px;background:#fff;font:500 .95rem 'Inter';color:var(--ink);box-shadow:var(--sh)}
.search svg{position:absolute;left:16px;top:50%;transform:translateY(-50%);color:var(--muted)}
.order{flex:none;background:var(--orange);color:#fff;padding:12px 20px;border-radius:999px;font:700 .9rem 'Inter';box-shadow:0 10px 24px -12px rgba(240,115,29,.8)}
.order:hover{background:#d95c10}
.pills{display:none;max-width:1240px;margin:0 auto;padding:0 20px 10px;gap:8px;overflow-x:auto;scrollbar-width:none}
.pills::-webkit-scrollbar{display:none}
.pills a{flex:none;background:#fff;border:1px solid var(--line);padding:8px 14px;border-radius:999px;font:600 .84rem 'Inter'}
.wrap{max-width:1240px;margin:0 auto;padding:26px 20px 60px;display:grid;grid-template-columns:230px 1fr;gap:30px;align-items:start}
.side{position:sticky;top:96px;background:rgba(255,255,255,.7);border:1px solid var(--line);border-radius:22px;padding:14px;box-shadow:var(--sh);max-height:calc(100vh - 120px);overflow:auto}
.side h4{font:700 .7rem 'Inter';letter-spacing:.16em;text-transform:uppercase;color:var(--muted);padding:6px 10px 10px}
.side a{display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border-radius:12px;font:600 .9rem 'Inter';color:var(--ink)}
.side a em{font-style:normal;font-size:.74rem;color:var(--muted);background:var(--peach);border-radius:999px;padding:2px 8px}
.side a:hover{background:var(--peach)}
.side a.on{background:var(--orange);color:#fff}
.side a.on em{background:rgba(255,255,255,.25);color:#fff}
.hero{background:linear-gradient(120deg,#fff 0,#fff7ef 100%);border:1px solid var(--line);border-radius:28px;padding:30px;display:grid;grid-template-columns:1.1fr 1fr;gap:26px;align-items:center;box-shadow:var(--sh);margin-bottom:26px}
.hero .k{font:700 .72rem 'Inter';letter-spacing:.18em;text-transform:uppercase;color:var(--red)}
.hero h1{font:800 clamp(2rem,4.4vw,3.2rem) var(--disp);line-height:1.04;margin:8px 0 10px;letter-spacing:-.02em}
.hero p{color:var(--muted);line-height:1.6;max-width:44ch}
.chips{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px}
.chips span{background:var(--peach);border:1px solid var(--line);padding:7px 12px;border-radius:999px;font:600 .8rem 'Inter'}
.chips .v{display:inline-flex;align-items:center;gap:7px}
.chips .v i{width:14px;height:14px;border:2px solid var(--veg);border-radius:3px;position:relative}
.chips .v i::after{content:'';position:absolute;inset:2px;border-radius:50%;background:var(--veg)}
.mosaic{display:grid;grid-template-columns:1.2fr 1fr;grid-template-rows:1fr 1fr;gap:10px;height:260px}
.mosaic img{width:100%;height:100%;object-fit:cover;border-radius:18px}
.mosaic img:first-child{grid-row:1/3}
section{margin-bottom:34px}
.sh{margin-bottom:14px}
.sh h2{font:800 1.7rem var(--disp);letter-spacing:-.02em}
.sh p{color:var(--muted);font-size:.9rem;margin-top:3px}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}
.card{background:var(--card);border-radius:22px;padding:10px;box-shadow:var(--sh);border:1px solid #fff;display:flex;flex-direction:column;transition:transform .18s}
.card:hover{transform:translateY(-3px)}
.ph{position:relative;aspect-ratio:4/3;border-radius:16px;overflow:hidden;background:var(--peach2)}
.ph img{width:100%;height:100%;object-fit:cover}
.vg{position:absolute;top:10px;left:10px;width:18px;height:18px;border:2px solid var(--veg);border-radius:4px;background:#fff}
.vg::after{content:'';position:absolute;inset:3px;border-radius:50%;background:var(--veg)}
.cb{padding:12px 8px 8px;display:flex;flex-direction:column;gap:8px;flex:1}
.t{display:flex;justify-content:space-between;align-items:baseline;gap:10px}
.t h3{font:700 1.08rem var(--disp);line-height:1.25}
.pr{font:600 .76rem 'Inter';color:var(--muted);white-space:nowrap}
.pr b{font:800 1.12rem var(--disp);color:var(--ink)}
.cb p{font-size:.82rem;color:var(--muted);line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.sz-l{font:700 .74rem 'Inter';color:var(--ink);margin-top:2px}
.szs{display:flex;gap:7px;flex-wrap:wrap}
.sz{border:1.5px solid var(--line);background:#fff;border-radius:999px;padding:6px 13px;font:600 .8rem 'Inter';cursor:pointer;color:var(--ink);display:inline-flex;gap:7px;align-items:center}
.sz b{font-weight:700;color:var(--muted);font-size:.76rem}
.sz.on{background:var(--peach2);border-color:var(--orange)}
.sz.on b{color:var(--red)}
.addons{background:#fff;border-radius:22px;padding:8px 18px;box-shadow:var(--sh);overflow:auto}
.addons table{width:100%;border-collapse:collapse}
.addons th,.addons td{padding:14px 10px;text-align:left;border-bottom:1px solid var(--line);font:600 .92rem 'Inter'}
.addons thead th{color:var(--muted);font-size:.74rem;letter-spacing:.12em;text-transform:uppercase}
.addons tr:last-child th,.addons tr:last-child td{border-bottom:0}
.none{display:none}
.empty{text-align:center;color:var(--muted);padding:40px 0}
footer{max-width:1240px;margin:0 auto;padding:0 20px 50px}
.f{background:var(--ink);color:rgba(255,255,255,.8);border-radius:26px;padding:28px;display:grid;grid-template-columns:1.2fr 1fr 1fr;gap:24px;font-size:.9rem;line-height:1.7}
.f h4{color:#fff;font:700 1rem var(--disp);margin-bottom:6px}
.f a{color:#ffc53d;font-weight:600}
.legal{text-align:center;color:var(--muted);font-size:.78rem;margin-top:16px}
@media(max-width:1020px){.grid{grid-template-columns:repeat(2,1fr)}}
@media(max-width:860px){.wrap{grid-template-columns:1fr;padding-top:16px}.side{display:none}.pills{display:flex}.hero{grid-template-columns:1fr;padding:22px}.mosaic{height:200px}.f{grid-template-columns:1fr}.brand span{display:none}html{scroll-padding-top:128px}}
@media(max-width:520px){.grid{grid-template-columns:1fr}.order{padding:10px 14px}.search input{padding-left:40px}}
</style>
</head>
<body>
<header class="top">
  <div class="top-in">
    <a class="brand" href="./"><i><img src="images/mark.svg" alt="" /></i><div><b>XTO PIZZA</b><span>DIGITAL MENU</span></div></a>
    <label class="search"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg><input id="q" type="search" placeholder="Search the menu" aria-label="Search the menu" autocomplete="off"></label>
    <a class="order" href="__LIVE__/" target="_blank" rel="noopener">Order online</a>
  </div>
  <nav class="pills" aria-label="Categories">__PILLS__</nav>
</header>
<div class="wrap">
  <aside class="side" aria-label="Menu sections"><h4>Menu</h4>__NAV__<a href="#cat-addons"><span>Add-ons</span><em>4</em></a></aside>
  <main>
    <div class="hero">
      <div>
        <div class="k">Pure veg &bull; Dine-in &bull; Takeaway</div>
        <h1>Our menu, fresh from the oven.</h1>
        <p>__COUNT__ dishes across pizzas, pasta, burgers, wraps, combos and shakes. Pick a size, tell the counter, and we bake it to order.</p>
        <div class="chips"><span class="v"><i></i>100% pure veg</span><span>Shivane Khadakwasla</span><span>Nanded City</span></div>
      </div>
      <div class="mosaic"><img src="images/ai/feature-veg-pull.jpg" alt="XTO veggie pizza cheese pull"><img src="images/ai/feature-feast-1.jpg" alt="Veg burgers, fries and pizza"><img src="images/ai/feature-margherita-pull-1.jpg" alt="Margherita pizza slice"></div>
    </div>
    <div id="results">__SECTIONS__</div>
    __ADDONS__
    <div class="empty none" id="none">Nothing matches that search. Try "paneer" or "shake".</div>
  </main>
</div>
<footer>
  <div class="f">
    <div><h4>XTO PIZZA</h4>Pune's pure veg pizzeria.<br>Dine-in and takeaway. GST and packaging charges extra.<br><a href="__LIVE__/" target="_blank" rel="noopener">Order online</a> &middot; <a href="__LIVE__/app" target="_blank" rel="noopener">Get the app</a> &middot; <a href="__LIVE__/franchise" target="_blank" rel="noopener">Franchise</a></div>
    <div><h4>Shivane (Khadakwasla)</h4>NDA Rd, near Add Mart, Shivane, Pune 411023<br>11 am - 10:30 pm<br><a href="tel:+917030000776">+91 70300 00776</a></div>
    <div><h4>Nanded City</h4>Destination Centre, F-65, Sinhagad Rd, Pune 411068<br>11 am - 11 pm<br><a href="tel:+917030000886">+91 70300 00886</a></div>
  </div>
  <div class="legal">Ardur Foods Pvt. Ltd. &middot; ordernow@xtopizza.com &middot; Prices in INR</div>
</footer>
<script>
(function(){
  // size pills update the card price
  document.querySelectorAll('.szs').forEach(function(box){
    box.addEventListener('click',function(e){
      var b=e.target.closest('button.sz'); if(!b) return;
      box.querySelectorAll('.sz').forEach(function(x){x.classList.toggle('on',x===b)});
      var pv=box.closest('.card').querySelector('.pv'); if(pv) pv.innerHTML='&#8377;'+b.dataset.p;
      var pr=box.closest('.card').querySelector('.pr'); if(pr && pr.firstChild && pr.firstChild.nodeType===3) pr.firstChild.nodeValue='';
    });
  });
  // search
  var q=document.getElementById('q'), none=document.getElementById('none');
  q.addEventListener('input',function(){
    var v=q.value.trim().toLowerCase(), shown=0;
    document.querySelectorAll('.card').forEach(function(c){ var m=!v||c.dataset.name.indexOf(v)>-1; c.classList.toggle('none',!m); if(m) shown++; });
    document.querySelectorAll('#results section').forEach(function(s){ s.classList.toggle('none',!s.querySelector('.card:not(.none)')); });
    var ad=document.getElementById('cat-addons'); if(ad) ad.classList.toggle('none',!!v);
    none.classList.toggle('none',shown>0);
  });
  // scroll spy for the sidebar
  var links=[].slice.call(document.querySelectorAll('.side a'));
  var secs=links.map(function(a){return document.querySelector(a.getAttribute('href'))}).filter(Boolean);
  function spy(){var y=window.scrollY+170,cur=null;secs.forEach(function(s){if(s.offsetTop<=y)cur=s.id});links.forEach(function(a){a.classList.toggle('on',a.getAttribute('href')==='#'+cur)})}
  window.addEventListener('scroll',spy,{passive:true});spy();
})();
</script>
</body>
</html>
'''
out = (PAGE.replace('__PILLS__', pills).replace('__NAV__', nav).replace('__SECTIONS__', sections)
       .replace('__ADDONS__', addon_html).replace('__COUNT__', str(count)).replace('__LIVE__', LIVE))
open(os.path.join(ROOT, 'docs', 'index.html'), 'w').write(out)
# the old "AI shots" menu link keeps working: same page
open(os.path.join(ROOT, 'docs', 'menu-ai.html'), 'w').write(out)
print(f'built docs/index.html: {count} dishes, {len(order)} cards, {len(cats)} categories, {len(out)} chars')
