#!/usr/bin/env python3
"""Builds public/blog/*.html, public/sitemap.xml, public/robots.txt. Facts only from menu.json and Google listings."""
import json, re, os, datetime
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = 'https://xtopizza.in'
TODAY = '2026-10-19'
tpl = open(os.path.join(ROOT, 'public/contact.html')).read()
HEAD = tpl.split('<body')[0]
HEAD = re.sub(r'<title>.*?</title>\s*<meta name="description"[^>]*/>', '@@META@@', HEAD, flags=re.S)
HEAD = re.sub(r'<link rel="canonical"[^>]*/>\s*', '', HEAD)
STYLE = '<style>.xdoc{max-width:820px;margin:0 auto}.xdoc h2{font-size:1.45rem;margin:34px 0 8px}.xdoc p,.xdoc li{color:#4a3c31;line-height:1.8;font-size:1.05rem}.xdoc ul{margin:8px 0 8px 22px}.xdoc .meta{color:var(--x-muted);font-size:.9rem}.xcta{display:inline-block;margin:10px 10px 0 0;padding:12px 22px;border-radius:999px;background:var(--x-red);color:#fff;font-weight:700;text-decoration:none}.xcta.alt{background:#fff;color:var(--x-red);border:2px solid var(--x-red)}.xcards{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));margin:18px 0}.xcards a{display:block;padding:20px;border:1px solid #eadfd3;border-radius:14px;text-decoration:none;color:inherit;background:#fff}.xcards b{display:block;font-size:1.1rem;margin-bottom:6px}</style>'

OUTLETS = '''<h2>Visit us</h2>
<ul>
<li><b>XTO Pizza Shivane (Khadakwasla):</b> NDA Rd, near Add Mart, Yashwant Nagar, Deshmukh Nagar, Shivane, Pune 411023. Call <a href="tel:+917030000776">+91 70300 00776</a>.</li>
<li><b>XTO Pizza Nanded City:</b> Survey No. 1,2, Destination Centre, Shop No. F-65, Sinhagad Road, Nanded City, Pune 411068. Call <a href="tel:+917030000886">+91 70300 00886</a>.</li>
</ul>
<p><a class="xcta" href="/#menu">See the full menu</a><a class="xcta alt" href="/contact">Outlet timings and directions</a></p>'''

POSTS = [
 dict(slug='best-pure-veg-pizza-in-pune', title='Best Pure Veg Pizza in Pune: XTO Pizza on Sinhagad Road',
  desc='Looking for the best pure veg pizza in Pune? XTO Pizza serves stone-baked veg pizzas from Rs 99 at Shivane (Khadakwasla) and Nanded City.',
  h1='Best pure veg pizza in Pune, from Rs 99', kicker='Pizza guide',
  body='''<p>Pune has no shortage of pizza places, but a fully vegetarian kitchen that does not charge a premium is harder to find. XTO Pizza is a pure veg pizzeria with two outlets on the Sinhagad Road side of the city: Shivane near Khadakwasla, and Nanded City. Between the two, Google shows 4.0 stars from more than 100 reviews.</p>
<h2>Why pure veg matters here</h2>
<p>Every pizza, burger, pasta and shake at XTO is vegetarian. There is no meat on the menu, so there is nothing to ask the staff about. For families and anyone who stays vegetarian, that makes ordering simple.</p>
<h2>What you can order, and what it costs</h2>
<p>Prices below are for the regular size on our live menu.</p>
<ul>
<li><b>Margherita:</b> Rs 99. Fresh tomato and cheddar. The honest test of any pizza place.</li>
<li><b>Paneer Makhani:</b> Rs 149. Paneer, onion, capsicum and paprika in a makhni sauce.</li>
<li><b>Dil Desi:</b> Rs 189. Capsicum, onion and tomato under a generous layer of cheese.</li>
<li><b>Farmer's Delight:</b> Rs 209. Mushroom, tomato, capsicum, onion and sweet corn.</li>
<li><b>Tandoori Paneer Tikka:</b> Rs 229. Paneer tikka, black olives, capsicum and fresh coriander.</li>
<li><b>Pesto Painting:</b> Rs 259. Paneer, jalapeno and basil pesto.</li>
</ul>
<p>If you want something other than pizza, the menu also has pasta (Arabiatta, Veg Alfredo, Tandoori), stacked burgers, wraps, loaded fries and thick shakes.</p>
<h2>How to pick</h2>
<p>First visit: start with the Margherita and one paneer pizza to share. If you like heat, go for Veggie Mexican with jalapeno. If you want something filling for the price, the combos start at Rs 159 and include a burger, fries and garlic bread.</p>
<h2>Dine in or take away</h2>
<p>Both outlets serve dine-in and takeaway. You can browse the menu and place an order from this website before you walk in.</p>
''' + OUTLETS),
 dict(slug='birthday-and-group-party-pizza-pune', title='Birthday and Group Party Pizza near Khadakwasla and Nanded City, Pune',
  desc='Planning a birthday or group get-together near Khadakwasla, Shivane or Nanded City? See how XTO Pizza handles group orders and party bookings.',
  h1='Birthday and group parties near Khadakwasla and Nanded City', kicker='Parties and groups',
  body='''<p>Finding a place for a birthday, a college get-together or a family dinner on the Sinhagad Road side of Pune usually comes down to three questions: will everyone find something to eat, will the bill stay sensible, and can you actually book it. XTO Pizza is a pure veg pizza cafe with outlets at Shivane (Khadakwasla) and Nanded City, and it works well for groups that want to share.</p>
<h2>Food that suits a mixed group</h2>
<p>Because the whole kitchen is vegetarian, nobody at the table has to be catered around. Pizzas, pasta, burgers, wraps, loaded fries and nachos are all on one menu, so a group of eight can split into pizza people, pasta people and burger people without anyone being left out.</p>
<h2>Party combos on the menu</h2>
<ul>
<li><b>Party Combo 1:</b> Rs 449. A grilled sandwich, a regular premium pizza and fries.</li>
<li><b>Party Combo 2:</b> Rs 899. Two medium pizzas with two coolers (Blue Lagoon or Summer Cooler).</li>
<li><b>Magic Combo:</b> Rs 289. Two veg burgers, a 7 inch Margherita and fries.</li>
</ul>
<p>For larger groups, order a mix of medium and large pizzas plus two or three sides to share, then add shakes. Thick shakes start at Rs 89 and the loaded XTO Special Shake is Rs 149.</p>
<h2>How to book</h2>
<p>For a birthday or any group booking, call the outlet you want to visit ahead of time so the team can plan seating. Tell them the number of people and the time. Table availability, decorations and any special arrangements are agreed directly with the outlet, so please confirm them on the call.</p>
<h2>Which outlet</h2>
<p>Choose Shivane if you are coming from Khadakwasla or NDA Road. Choose Nanded City if you are coming from Sinhagad Road or Nanded City itself.</p>
''' + OUTLETS),
 dict(slug='pizza-near-nda-khadakwasla-shivane', title='Pizza near NDA Road, Khadakwasla and Shivane, Pune',
  desc='Pizza, burgers, pasta and shakes near NDA Road, Khadakwasla and Shivane. XTO Pizza is a pure veg cafe next to Add Mart, rated 4.0 on Google.',
  h1='Pizza near NDA Road, Khadakwasla and Shivane', kicker='Local guide',
  body='''<p>If you live, study or work around NDA Road, Khadakwasla, Shivane or Yashwant Nagar, XTO Pizza is the pure veg pizza cafe near Add Mart on NDA Rd. It has a 4.0 rating on Google from 78 reviews and serves dine-in and takeaway.</p>
<h2>What people come for</h2>
<ul>
<li>Stone-baked veg pizzas, from a Rs 99 Margherita to a Rs 259 Pesto Painting.</li>
<li>Pasta in red, white and mixed sauces, with half portions from Rs 169.</li>
<li>Burgers from Rs 59 and wraps from Rs 139.</li>
<li>Thick shakes, coolers and cold coffee, from Rs 49.</li>
</ul>
<h2>Good for students and quick meals</h2>
<p>The menu has plenty under Rs 150: a Tomato and Cheese 6 inch pizza at Rs 59, a Veg Burger at Rs 59, a Veg Grilled Sandwich at Rs 89 and French Fries at Rs 89. The Combo Crush at Rs 159 gives you a burger, fries and garlic bread.</p>
<h2>Getting here</h2>
<p>The outlet is on NDA Rd, near Add Mart, in Yashwant Nagar, Deshmukh Nagar, Shivane. It is a short drive from Khadakwasla and the NDA gate. Open the Google Maps link on our <a href="/contact">contact page</a> for directions.</p>
<h2>Prefer Nanded City?</h2>
<p>Our second outlet is at Destination Centre, Shop No. F-65, Sinhagad Road, Nanded City. Same menu, same pure veg kitchen.</p>
''' + OUTLETS),
]

def page(meta, body_html, extra_head=''):
    return HEAD.replace('@@META@@', meta + extra_head) .replace('</head>', STYLE + '\n</head>') + '''<body class="x" data-page="blog">
<div id="xh-mount"></div>
<main>
''' + body_html + '''
</main>
<div id="xf-mount"><nav class="xlegal" aria-label="Legal" style="padding:18px 20px;text-align:center;font:600 15px/1.8 Inter,system-ui,sans-serif"><a href="/privacy">Privacy Policy</a> &middot; <a href="/terms">Terms and Conditions</a> &middot; <a href="/refund">Refund Policy</a> &middot; <a href="/delete-data">Delete my data</a> &middot; <a href="/contact">Contact</a></nav></div>
<script src="/js/layout.js"></script>
</body>
</html>
'''

def meta(title, desc, url, typ='article'):
    return ('<title>%s</title>\n<meta name="description" content="%s" />\n<link rel="canonical" href="%s" />\n'
            '<meta property="og:title" content="%s" />\n<meta property="og:description" content="%s" />\n<meta property="og:type" content="%s" />\n<meta property="og:url" content="%s" />\n<meta property="og:image" content="%s/images/icon-512.png" />') % (title, desc, url, title, desc, typ, url, SITE)

for p in POSTS:
    url = '%s/blog/%s' % (SITE, p['slug'])
    ld = {"@context": "https://schema.org", "@type": "Article", "headline": p['title'], "description": p['desc'], "datePublished": TODAY, "dateModified": TODAY,
          "mainEntityOfPage": url, "author": {"@type": "Organization", "name": "XTO Pizza"}, "publisher": {"@type": "Organization", "name": "XTO Pizza", "logo": {"@type": "ImageObject", "url": SITE + "/images/icon-512.png"}}}
    extra = '\n<script type="application/ld+json">%s</script>' % json.dumps(ld)
    b = '<section class="xpage-hero"><div class="xw"><div class="xeyebrow">%s</div><h1>%s</h1></div></section>\n<section class="xs"><div class="xw"><div class="xdoc">\n<p class="meta">Updated %s &middot; XTO Pizza, Pune</p>\n%s\n<p><a href="/blog">More from the XTO Pizza blog</a></p></div></div></section>' % (p['kicker'], p['h1'], '19 October 2026', p['body'])
    open(os.path.join(ROOT, 'public/blog/%s.html' % p['slug']), 'w').write(page(meta(p['title'], p['desc'], url), b, extra))

cards = ''.join('<a href="/blog/%s"><b>%s</b><span>%s</span></a>' % (p['slug'], p['h1'], p['desc']) for p in POSTS)
idx = '<section class="xpage-hero"><div class="xw"><div class="xeyebrow">Blog</div><h1>XTO Pizza guides for Pune</h1><p>Pure veg pizza, party ideas and local tips from Shivane (Khadakwasla) and Nanded City.</p></div></section>\n<section class="xs"><div class="xw"><div class="xdoc"><div class="xcards">%s</div></div></div></section>' % cards
open(os.path.join(ROOT, 'public/blog/index.html'), 'w').write(page(meta('Blog | XTO Pizza Pune', 'Pure veg pizza guides, party ideas and local tips from XTO Pizza in Shivane (Khadakwasla) and Nanded City, Pune.', SITE + '/blog', 'website'), idx))

urls = ['/', '/contact', '/franchise', '/careers', '/privacy', '/terms', '/refund', '/delete-data', '/blog'] + ['/blog/' + p['slug'] for p in POSTS]
sm = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + ''.join('  <url><loc>%s%s</loc><lastmod>%s</lastmod></url>\n' % (SITE, u, TODAY) for u in urls) + '</urlset>\n'
open(os.path.join(ROOT, 'public/sitemap.xml'), 'w').write(sm)
open(os.path.join(ROOT, 'public/robots.txt'), 'w').write('User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /rider\nDisallow: /api/\nDisallow: /app\nDisallow: /qr\n\nSitemap: %s/sitemap.xml\n' % SITE)
print('built', len(POSTS), 'posts')
