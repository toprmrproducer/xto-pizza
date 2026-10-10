#!/usr/bin/env python3
"""Build the static digital menu (docs/index.html) from data/menu.json.
White editorial theme, responsive: 2 cols phone, 3 tablet, 4-5 desktop.
Run: python3 scripts/build-digital-menu.py
"""
import json, os, shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
menu = json.load(open(os.path.join(ROOT, 'data', 'menu.json')))

img_src = os.path.join(ROOT, 'public', 'images')
img_dst = os.path.join(ROOT, 'docs', 'images')
os.makedirs(img_dst, exist_ok=True)
for f in os.listdir(img_src):
    if f.startswith('upload-'): continue
    shutil.copy2(os.path.join(img_src, f), os.path.join(img_dst, f))

items, cats = menu['items'], menu['categories']
cards = []
for c in cats:
    cat_items = [i for i in items if i['cat'] == c['id']]
    if not cat_items: continue
    cards.append(f'<section id="cat-{c["id"]}"><h2>{c["name"]}</h2><p class="note">{c.get("note","")}</p><div class="grid">')
    for i in cat_items:
        cards.append(f'''<article class="card"><div class="imgwrap"><img src="images/{i["img"]}.jpg" alt="{i["name"]}" loading="lazy" onerror="this.parentNode.classList.add('noimg');this.remove()"><span class="veg"></span></div>
<div class="cb"><b>{i["name"]}</b><span>{i["desc"]}</span><em>&#8377;{i["price"]}</em></div></article>''')
    cards.append('</div></section>')

cats_html = ''.join(f'<a href="#cat-{c["id"]}">{c["name"]}</a>' for c in cats if any(i['cat'] == c['id'] for i in items))

html = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>XTO Pizza | Digital Menu</title>
<meta name="theme-color" content="#ffffff" />
<link rel="icon" href="images/icon-192.png" />
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--ink:#1a1a1a;--muted:#6b6b6b;--line:#e8e8e8;--orange:#f0731d;--red:#b3271e;--cream:#fff7ef}
html{scroll-behavior:smooth}
body{font-family:'Inter',-apple-system,'Segoe UI',sans-serif;background:#fff;color:var(--ink);-webkit-font-smoothing:antialiased}
#splash{position:fixed;inset:0;z-index:99;background:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;transition:opacity .45s ease}
#splash img{width:96px;height:96px;animation:pop .7s cubic-bezier(.2,1.4,.4,1) both}
#splash .w{font:800 32px Georgia,serif;letter-spacing:2px;animation:fade .8s .2s ease both}
#splash .w span{color:var(--orange)}
#splash .t{font-size:12px;letter-spacing:4px;text-transform:uppercase;color:#9a9a9a;animation:fade .8s .35s ease both}
#splash .bar{margin-top:10px;width:130px;height:3px;border-radius:99px;background:#eee;overflow:hidden}
#splash .bar span{display:block;height:100%;width:40%;border-radius:99px;background:var(--orange);animation:load 1.1s .15s ease-in-out both}
@keyframes pop{from{transform:scale(.4);opacity:0}to{transform:scale(1);opacity:1}}
@keyframes fade{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
@keyframes load{from{width:8%}to{width:100%}}
header{text-align:center;padding:34px 20px 20px;border-bottom:1px solid var(--line)}
header img{width:64px;height:64px;margin-bottom:10px}
header h1{font:800 34px Georgia,serif;letter-spacing:1px;color:var(--ink)}
header h1 span{color:var(--orange)}
header .tag{font-size:12px;letter-spacing:5px;text-transform:uppercase;color:var(--muted);margin-top:6px}
.modes{display:flex;gap:10px;justify-content:center;margin:18px 0 6px;flex-wrap:wrap}
.modes span{font:700 13px sans-serif;border:1.5px solid var(--line);background:var(--cream);color:var(--ink);border-radius:999px;padding:9px 18px}
.outlets{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px;max-width:1100px;margin:16px auto 0;padding:0 20px}
.outlets div{background:#fafafa;border:1px solid var(--line);border-radius:14px;padding:16px 18px;font-size:13.5px;line-height:1.7;text-align:left}
.outlets b{color:var(--ink);display:block;font-size:14px;margin-bottom:2px}
.outlets a{color:var(--orange);text-decoration:none;font-weight:800}
nav.cats{position:sticky;top:0;background:rgba(255,255,255,.97);backdrop-filter:blur(10px);display:flex;flex-wrap:wrap;justify-content:center;gap:10px;padding:14px 20px;border-bottom:1px solid var(--line);z-index:5}
@media (max-width:700px){nav.cats{flex-wrap:nowrap;justify-content:flex-start;overflow-x:auto}nav.cats::-webkit-scrollbar{display:none}}
nav.cats a{white-space:nowrap;color:var(--ink);text-decoration:none;font:700 14px sans-serif;background:#fff;border:1.5px solid var(--line);padding:10px 20px;border-radius:999px;transition:all .2s}
nav.cats a:hover,nav.cats a:active{border-color:var(--orange);color:var(--orange);background:var(--cream)}
main{max-width:1400px;margin:0 auto;padding:10px 24px 40px}
section h2{font:800 26px Georgia,serif;margin:34px 0 2px}
section .note{font-size:13.5px;color:var(--muted);margin-bottom:16px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:20px}
@media (min-width:1600px){.grid{grid-template-columns:repeat(5,1fr)}}
@media (max-width:1024px){.grid{grid-template-columns:repeat(3,1fr);gap:16px}}
@media (max-width:640px){.grid{grid-template-columns:repeat(2,1fr);gap:12px}
main{padding:10px 14px 30px}
section h2{font-size:22px}
.imgwrap{height:128px}
.cb{padding:10px 12px 12px}
.cb b{font-size:13.5px}
.cb span{font-size:11px}
.cb em{font-size:13.5px}
header h1{font-size:28px}
header img{width:54px;height:54px}
.outlets{padding:0 14px}}
.card{background:#fff;border:1px solid var(--line);border-radius:18px;overflow:hidden;transition:transform .2s ease,box-shadow .2s ease}
.card:hover{transform:translateY(-3px);box-shadow:0 14px 34px rgba(0,0,0,.09)}
.imgwrap{position:relative;height:160px;background:var(--cream)}
.imgwrap img{width:100%;height:100%;object-fit:cover;display:block}
.imgwrap.noimg{display:flex;align-items:center;justify-content:center;font:800 40px Georgia,serif;color:var(--orange)}
.veg{position:absolute;top:10px;right:10px;width:16px;height:16px;border:2px solid #1c7c31;border-radius:3px;background:#fff}
.veg:after{content:'';position:absolute;inset:3px;border-radius:50%;background:#1c7c31}
.cb{padding:14px 16px 16px;display:grid;gap:5px}
.cb b{font-size:15px;line-height:1.35}
.cb span{font-size:12.5px;color:var(--muted);line-height:1.55}
.cb em{font-style:normal;font-weight:800;color:var(--orange);font-size:15.5px;margin-top:2px}
footer{text-align:center;font-size:12px;color:var(--muted);padding:26px 20px 34px;line-height:1.9;border-top:1px solid var(--line)}
footer b{color:var(--ink)}
footer a{color:var(--orange);text-decoration:none;font-weight:700}
</style>
</head>
<body>
<div id="splash"><img src="images/mark.svg" alt="" /><div class="w">XTO <span>PIZZA</span></div><div class="t">Pune's Tastiest Pizza</div><div class="bar"><span></span></div></div>
<header>
  <img src="images/mark.svg" alt="XTO Pizza" />
  <h1>XTO <span>PIZZA</span></h1>
  <div class="tag">Digital Menu</div>
  <div class="modes"><span>&#127869; Dine-in</span><span>&#129379; Takeaway</span><span>&#128511; 100% Pure Veg</span></div>
</header>
<div class="outlets">
  <div><b>Shivane (Khadakwasla)</b>NDA Rd, near Add Mart, Shivane, Pune 411023<br><a href="tel:+917030000776">Call 70300 00776</a></div>
  <div><b>Nanded City</b>Destination Centre, F-65, Sinhagad Rd, Pune 411068<br><a href="tel:+917030000886">Call 70300 00886</a></div>
</div>
<nav class="cats">CATS</nav>
<main>
CARDS
</main>
<footer><b>XTO Pizza</b> - Ardur Foods Pvt. Ltd.<br>Dine-in and takeaway only. GST and packaging charges extra as applicable.<br><a href="site.html">Ordering demo (website)</a> &nbsp;&middot;&nbsp; <a href="app.html">App demo</a> &nbsp;&middot;&nbsp; <a href="qr.html">Table QR cards</a><br>Scan. Crave. Order at the counter or on the app.</footer>
<script>
setTimeout(function () { var s = document.getElementById('splash'); s.style.opacity = '0'; setTimeout(function () { s.remove(); }, 480); }, 1400);
</script>
</body>
</html>
"""
html = html.replace('CATS', cats_html).replace('CARDS', '\n'.join(cards))
out = os.path.join(ROOT, 'docs', 'index.html')
open(out, 'w').write(html)
print('built', out, len(html), 'chars,', len(items), 'items,', len(cats), 'categories')
