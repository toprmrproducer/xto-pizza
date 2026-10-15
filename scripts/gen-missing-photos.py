#!/usr/bin/env python3
"""Generate the menu photos that have no real shot yet (Replicate flux-1.1-pro, ~$0.04 each).
Output: public/images/ai/<slug>.jpg. Token read from ~/.codex/credentials/replicate.env.
Run: python3 scripts/gen-missing-photos.py [slug ...]   (no args = every missing slug)"""
import os, sys, json, subprocess, urllib.request, concurrent.futures as cf
from PIL import Image
import io

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public', 'images', 'ai')
TOKEN = [l.split('=', 1)[1].strip().strip('"') for l in open(os.path.expanduser('~/.codex/credentials/replicate.env'))
         if l.startswith('REPLICATE_API_TOKEN=')][0]

STYLE = ("professional restaurant food photography, 45 degree angle, warm cinematic golden lighting, rustic dark wood table, "
         "shallow depth of field, fresh and appetizing, photorealistic, no text, no logos, no brand names, no people, "
         "100 percent vegetarian")
PATTY = "a golden crispy breaded vegetable patty of potato, peas and carrots (clearly vegetarian, light golden color, not a meat patty)"
P = {
 'corn-and-cheese-pizza': "a whole freshly baked pizza loaded with golden sweet corn kernels, red onion rings and melted mozzarella, one slice lifted with a long stretchy cheese pull, on a round wooden board",
 'tandoori-paneer-burger': "a tall stacked vegetarian burger with a thick slab of tandoori-marinated paneer tikka (orange-red tandoori paneer cubes and a golden paneer slice, clearly vegetarian, no meat), red onion rings, lettuce, tomato and mint mayo in a toasted sesame bun, served with a little salad",
 'tandoori-pasta': "a rustic bowl of penne pasta in a creamy orange tandoori masala sauce with charred paneer tikka cubes, bell peppers, onions and fresh coriander",
 'magic-combo': "a combo meal on a wooden tray: two veg burgers each with "+PATTY+", one small 7 inch margherita pizza and a paper cone of golden french fries",
 'king-combo': "a combo meal on a wooden tray: one 7 inch loaded veg pizza, a plate of salsa nachos with melted cheese and jalapeno, and one tall glass of dark cola with ice",
 'combo-magambo': "a big combo feast: two veg burgers each with "+PATTY+", one 7 inch veg pizza, garlic bread slices, a basket of french fries and two tall glasses of cola with ice",
 'party-combo-1': "a party combo: a grilled veg sandwich cut in triangles, a regular veg pizza, a basket of french fries and two glasses of mango juice",
 'party-combo-2': "a party combo: two medium veg pizzas side by side and two tall colorful mocktails, one electric blue and one orange, on a wooden table",
 'strawberry-margherta': "a strawberry margarita style mocktail in a salt rimmed margarita glass, crushed ice, fresh strawberry slices and a lime wedge, non alcoholic, vivid red-pink color",
 'mango-mojito': "a tall glass of mango mojito mocktail with mango chunks, fresh mint leaves, lime wedges and crushed ice, bright golden orange color",
 'kiwi-crush': "a tall glass of kiwi crush, green kiwi slush with crushed ice and a fresh kiwi slice on the rim, bright lime green",
 'summer-cooler': "a tall glass of summer cooler mocktail, layered sunset orange and yellow citrus drink with orange slices, berries, mint and ice",
 'blue-lagoon': "a tall glass of blue lagoon mocktail, electric blue curacao-style drink with a lemon wheel, mint and crushed ice, no alcohol",
 'mojito': "a tall glass of classic virgin mojito, muddled mint leaves, lime wedges, crushed ice and sparkling soda, fresh and clear",
 'mango-shake': "a thick mango milkshake in a tall glass topped with whipped cream and mango cubes, golden yellow, with a striped straw",
 'banana-shake': "a thick banana milkshake in a tall glass with banana slices on top and a light chocolate drizzle, creamy off-white color, with a straw",
 'xto-special-shake': "a signature loaded chocolate caramel milkshake in a tall glass with whipped cream, brownie chunks, nuts, chocolate sauce and a cherry on top",
 'coke': "a tall glass of dark cola soda with ice cubes, fizzing bubbles and a lime wedge, condensation on the glass, plain glass with no label",
 'sprite': "a tall glass of clear lemon lime soda with ice cubes, lemon slices, mint and rising bubbles, condensation on the glass, no label",
 'thums-up': "a tall glass of strong dark cola with ice, a wedge of lemon and sharp fizz, condensation on the glass, no label",
 'diet-coke': "a slim tall glass of dark cola with ice and a lime slice, light fizz, condensation on the glass, no label",
}
want = sys.argv[1:] or list(P)

def gen(slug):
    dst = os.path.join(OUT, slug + '.jpg')
    body = json.dumps({"input": {"prompt": P[slug] + ", " + STYLE, "aspect_ratio": "1:1", "output_format": "webp",
                                  "output_quality": 90, "safety_tolerance": 2, "prompt_upsampling": False}})
    import time
    d = {}
    for attempt in range(6):   # low-credit accounts are rate limited: back off and retry
        r = subprocess.run(['curl', '-s', '-m', '120', '-X', 'POST',
                            'https://api.replicate.com/v1/models/black-forest-labs/flux-1.1-pro/predictions',
                            '-H', 'Authorization: Bearer ' + TOKEN, '-H', 'Content-Type: application/json',
                            '-H', 'Prefer: wait=60', '-d', body], capture_output=True, text=True)
        try: d = json.loads(r.stdout)
        except Exception: d = {}
        if 'urls' in d: break
        time.sleep(12 * (attempt + 1))
    if 'urls' not in d: return slug, 'FAILED ' + str(d)[:160]
    for _ in range(40):
        if d.get('status') in ('succeeded', 'failed', 'canceled'): break
        import time; time.sleep(3)
        d = json.loads(subprocess.run(['curl', '-s', '-H', 'Authorization: Bearer ' + TOKEN, d['urls']['get']],
                                      capture_output=True, text=True).stdout)
    if d.get('status') != 'succeeded': return slug, 'FAILED ' + str(d.get('error') or d.get('detail'))[:120]
    url = d['output'] if isinstance(d['output'], str) else d['output'][0]
    img = Image.open(io.BytesIO(urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'curl/8'}), timeout=60).read())).convert('RGB')
    img.thumbnail((1000, 1000)); img.save(dst, quality=84, optimize=True, progressive=True)
    return slug, 'ok %dKB' % (os.path.getsize(dst) // 1024)

with cf.ThreadPoolExecutor(1) as ex:
    for slug, msg in ex.map(gen, want): print(slug, msg, flush=True)
