#!/usr/bin/env python3
"""Shrink the site photos. Hero/feature/interior shots: 900 px, menu photos: 640 px. Writes a smaller progressive JPEG in place
and a .webp sibling (the server hands out the .webp to browsers that accept it, same URL). Idempotent.
Run from the repo root: python3 scripts/optimize-images.py   (then deploy: deploy.sh copies public/images to the server volume)"""
import os
from PIL import Image
ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'public', 'images')
HERO = ('feature', 'hero', 'interior', 'board', 'closeup', 'pizza-cheese', 'splash')
before = after = webp_total = n = 0
for r, d, f in os.walk(ROOT):
    for x in f:
        if not x.lower().endswith(('.jpg', '.jpeg')): continue
        p = os.path.join(r, x); s0 = os.path.getsize(p)
        try:
            im = Image.open(p); im.load()
        except Exception: continue
        im = im.convert('RGB')
        big = any(k in x.lower() for k in HERO)
        im.thumbnail((900, 900) if big else (640, 640), Image.LANCZOS)
        tmp = p + '.tmp'; im.save(tmp, 'JPEG', quality=74 if big else 70, optimize=True, progressive=True)
        s1 = os.path.getsize(tmp)
        if s1 < s0: os.replace(tmp, p); after += s1
        else: os.remove(tmp); after += s0
        wp = os.path.splitext(p)[0] + '.webp'
        im.save(wp, 'WEBP', quality=72 if big else 68, method=6)
        webp_total += os.path.getsize(wp); before += s0; n += 1
print('images:', n, '| before MB:', round(before / 1e6, 1), '| jpg now MB:', round(after / 1e6, 1), '| webp MB:', round(webp_total / 1e6, 1))
