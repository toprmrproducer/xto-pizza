#!/usr/bin/env python3
"""Build docs/menu-ai.html: the digital menu rendered with the AI-generated
food photos (from ~/Downloads/XTO Pizza - AI Menu Photos), falling back to the
current photos for dishes with no AI shot yet. Also copies matched AI files to
docs/images/ai/<item-id>.png.
Run after build-digital-menu.py:  python3 scripts/build-menu-ai.py
"""
import json, os, re, shutil, glob

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.expanduser('~/Downloads/XTO Pizza - AI Menu Photos (Upload to Drive)')
DOCS = os.path.join(ROOT, 'docs')
AI_DIR = os.path.join(DOCS, 'images', 'ai')
os.makedirs(AI_DIR, exist_ok=True)

menu = json.load(open(os.path.join(ROOT, 'data', 'menu.json')))

# index every AI png by normalized base name (strip (2)/(3)/(4) variations).
# the 99 "Check These Names" folder holds UNCONFIRMED guesses: never used.
def norm(s): return re.sub(r'[^a-z0-9]', '', s.lower())
def toks(s): return set(re.sub(r'[^a-z0-9 ]', ' ', s.lower()).split())
ai_files = {}
for p in glob.glob(os.path.join(SRC, '**', '*.png'), recursive=True):
    if '99 Check These Names' in p: continue
    base = os.path.splitext(os.path.basename(p))[0]
    base = re.sub(r'\s*\(\d+\)\s*$', '', base).strip()
    ai_files.setdefault(norm(base), (p, base))

def find_ai(item):
    n = norm(item['name'])
    if n in ai_files: return ai_files[n][0]
    best, best_score = None, 0.0
    it = toks(item['name'])
    for k, (p, base) in ai_files.items():
        at = toks(base)
        if not at or not it: continue
        score = len(it & at) / len(it | at)
        if score > best_score:
            best, best_score = p, score
    return best if best_score >= 0.5 else None

matched, fallback = [], []
for item in menu['items']:
    if item.get('imgLock'):  # dish has its own generated photo in public/images/ai
        item['_ai'] = 'images/' + item['img'] + '.jpg'
        src_own = os.path.join(ROOT, 'public', 'images', item['img'] + '.jpg')
        dst_own = os.path.join(DOCS, 'images', item['img'] + '.jpg')
        os.makedirs(os.path.dirname(dst_own), exist_ok=True)
        if os.path.exists(src_own): shutil.copy2(src_own, dst_own)
        matched.append(item['name'] + ' (own photo)')
        continue
    src = find_ai(item)
    dst = os.path.join(AI_DIR, item['id'] + '.png')  # converted to .jpg below
    if src:
        shutil.copy2(src, dst)
        item['_ai'] = 'images/ai/' + item['id'] + '.jpg'
        matched.append(item['name'])
    elif item['img'].startswith('ai/'):
        item['_ai'] = 'images/' + item['img'] + '.jpg'  # already an AI category placeholder
        matched.append(item['name'] + ' (placeholder)')
    else:
        item['_ai'] = 'images/' + item['img'] + '.jpg'
        fallback.append(item['name'])

# render from the white menu template (docs/index.html) with swapped sources + a switcher
html = open(os.path.join(DOCS, 'index.html')).read()
for item in menu['items']:
    html = html.replace(f'src="images/{item["img"]}.jpg"', f'src="{item["_ai"]}"')
html = html.replace('src="images/{i["img"]}.jpg"', 'src="{i["_ai"]}')  # template brace form if present
html = html.replace('<title>XTO Pizza | Digital Menu</title>', '<title>XTO Pizza | Digital Menu (AI Food Shots)</title>')
html = html.replace('<div class="tag">Digital Menu</div>', '<div class="tag">Digital Menu - AI Food Shots</div>')
html = html.replace('<a href="site.html">Ordering demo (website)</a>',
                    '<a href="index.html">Menu with official photos</a> &nbsp;&middot;&nbsp; <a href="site.html">Ordering demo (website)</a>')
open(os.path.join(DOCS, 'menu-ai.html'), 'w').write(html)

# link the AI menu from the official menu footer too
idx = os.path.join(DOCS, 'index.html')
s = open(idx).read()
if 'menu-ai.html' not in s:
    s = s.replace('<a href="site.html">Ordering demo (website)</a>',
                  '<a href="menu-ai.html">Menu with AI food shots</a> &nbsp;&middot;&nbsp; <a href="site.html">Ordering demo (website)</a>')
    open(idx, 'w').write(s)

# convert every copied png to a lean 800px jpg and drop the png
from PIL import Image as _Im
for item in menu['items']:
    p = os.path.join(AI_DIR, item['id'] + '.png')
    if os.path.exists(p):
        im = _Im.open(p).convert('RGB'); im.thumbnail((800, 800))
        im.save(os.path.join(AI_DIR, item['id'] + '.jpg'), quality=82, optimize=True)
        os.remove(p)

print(f'AI menu built: {len(matched)} dishes with AI photos, {len(fallback)} on fallback photos')
print('no AI shot yet:', ', '.join(fallback))
