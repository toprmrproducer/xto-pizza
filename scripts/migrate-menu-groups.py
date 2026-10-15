#!/usr/bin/env python3
"""Idempotent: turn the flat size-split menu (Dil Desi (Regular)/(Medium)/(Large)) into grouped items.
Adds group / groupName / size / sizeLabel to every item, the size add-ons from the card
(Dil Maange More), and points generated dishes at their own photo (imgLock).
Usage: python3 scripts/migrate-menu-groups.py [path/to/menu.json]   (default data/menu.json)"""
import json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'data', 'menu.json')
d = json.load(open(path))

SIZE = {'regular': 'regular', 'medium': 'medium', 'large': 'large', 'half': 'half', 'full': 'full', '6 in': 'six'}
LABEL = {'regular': 'Regular', 'medium': 'Medium', 'large': 'Large', 'half': 'Half', 'full': 'Full', 'six': '6 in'}
ORDER = ['six', 'regular', 'half', 'medium', 'full', 'large']

def slug(s): return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')

for i in d['items']:
    m = re.match(r'^(.*?)\s*\(([^)]+)\)\s*$', i['name'])
    if m and m.group(2).strip().lower() in SIZE:
        size = SIZE[m.group(2).strip().lower()]
        i['groupName'] = m.group(1).strip()
        i['group'] = slug(i['groupName'])
        i['size'] = size
        i['sizeLabel'] = LABEL[size]
    else:
        i.setdefault('groupName', i['name'])
        i['group'] = i.get('group') or i['id']
        i.pop('size', None); i.pop('sizeLabel', None)

# add-ons from the printed card: price depends on pizza size, only on Regular/Medium/Large pizzas
d['addons'] = [
    {'id': 'extra-topping', 'name': 'Extra topping', 'prices': {'regular': 30, 'medium': 40, 'large': 60}},
    {'id': 'extra-cheese', 'name': 'Extra cheese', 'prices': {'regular': 40, 'medium': 60, 'large': 80}},
    {'id': 'cheese-burst', 'name': 'Cheese burst', 'prices': {'regular': 40, 'medium': 70, 'large': 120}},
    {'id': 'thin-crust', 'name': 'Thin crust base', 'prices': {'regular': 20, 'medium': 30, 'large': 40}},
]

# dishes with their own generated photo (public/images/ai/<slug>.jpg); imgLock stops fuzzy re-matching
OWN = {
    'corn-and-cheese-regular': 'corn-and-cheese-pizza', 'corn-and-cheese-medium': 'corn-and-cheese-pizza',
    'corn-and-cheese-large': 'corn-and-cheese-pizza',
    'tandoori-paneer-burger': 'tandoori-paneer-burger',
    'tandoori-pasta-half': 'tandoori-pasta', 'tandoori-pasta-full': 'tandoori-pasta',
    'magic-combo': 'magic-combo', 'king-combo': 'king-combo', 'combo-magambo': 'combo-magambo',
    'party-combo-1': 'party-combo-1', 'party-combo-2': 'party-combo-2',
    'strawberry-margherta': 'strawberry-margherta', 'mango-mojito': 'mango-mojito', 'kiwi-crush': 'kiwi-crush',
    'summer-cooler': 'summer-cooler', 'blue-lagoon': 'blue-lagoon', 'mojito': 'mojito',
    'mango-shake': 'mango-shake', 'banana-shake': 'banana-shake', 'xto-special-shake': 'xto-special-shake',
    'coke': 'coke', 'sprite': 'sprite', 'thums-up': 'thums-up', 'diet-coke': 'diet-coke',
}
AI = os.path.join(ROOT, 'public', 'images', 'ai')
for i in d['items']:
    s = OWN.get(i['id'])
    if s and os.path.exists(os.path.join(AI, s + '.jpg')):
        i['img'] = 'ai/' + s
        i['imgLock'] = True

# keep each size group contiguous and ordered small to large
idx = {id(i): n for n, i in enumerate(d['items'])}
first = {}
for n, i in enumerate(d['items']): first.setdefault((i['cat'], i['group']), n)
d['items'].sort(key=lambda i: (first[(i['cat'], i['group'])], ORDER.index(i['size']) if i.get('size') in ORDER else 0, idx[id(i)]))
json.dump(d, open(path, 'w'), indent=2, ensure_ascii=False)
groups = {(i['cat'], i['group']) for i in d['items']}
print('items', len(d['items']), 'groups', len(groups), 'locked images', sum(1 for i in d['items'] if i.get('imgLock')))
