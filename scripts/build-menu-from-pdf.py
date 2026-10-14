#!/usr/bin/env python3
"""Rebuild data/menu.json to EXACTLY match the official printed menu card
(Ver.17, 3 Mar 2026). Pizza sizes and pasta half/full become separate items
(the way Swiggy/Zomato and shop menus list them), using the card's own prices.
Old Swiggy-derived menu is backed up to data/menu.swiggy-backup.json.

Run:  python3 scripts/build-menu-from-pdf.py
"""
import json, os, re, shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PDF_IMG = os.path.expanduser('~/Downloads/XTO Menu Images From PDF')
AI_IMG = os.path.join(ROOT, 'docs', 'images', 'ai')
PUB_PDF = os.path.join(ROOT, 'public', 'images', 'pdfmenu')
PUB_AI = os.path.join(ROOT, 'public', 'images', 'ai')

os.makedirs(PUB_PDF, exist_ok=True)
os.makedirs(PUB_AI, exist_ok=True)

def slugify(s):
    s = s.replace('&', 'and').replace("'", "").replace('’', '')
    return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')

import re

# pull pdf crops and ai shots into public/images/pdfmenu with clean names

def img_for(*candidates):
    """first existing source: exact pdfmenu stem, then ai dir, then public root"""
    for c in candidates:
        stem = c
        for base in (PUB_PDF, PDF_IMG, AI_IMG, os.path.join(ROOT, 'public', 'images')):
            for ext in ('.jpg', '.png'):
                p = os.path.join(base, stem + ext)
                if os.path.exists(p):
                    out = stem + '.jpg'
                    dst = os.path.join(PUB_PDF, out)
                    if not os.path.exists(dst) or base == PDF_IMG:
                        shutil.copy2(p, dst)
                    return 'pdfmenu/' + stem  # no extension: site templates append .jpg
    return 'pdfmenu/margherita.jpg'  # safe fallback

# seed: make sure every needed source lands in pdfmenu
for f in os.listdir(PDF_IMG):
    if f.endswith('.jpg'):
        clean = slugify(f[:-4])
        shutil.copy2(os.path.join(PDF_IMG, f), os.path.join(PUB_PDF, clean + '.jpg'))

CATS = [
 ("magic-mania", "Magic Mania", '6-inch classics, 59 onwards'),
 ("premium", "Premium Pizzas", 'Regular / Medium / Large'),
 ("legend", "Legend Pizzas", 'Regular / Medium / Large'),
 ("gourmet", "Gourmet Selection", 'Regular / Medium / Large'),
 ("pasta", "Pasta Mania", 'Half / Full'),
 ("oven-bits", "The Oven Bits", 'Garlic bread, tosts and bruschetta bakes'),
 ("sandwich", "Sandwich", "From the chef's table"),
 ("burger", "Burger", 'Stacked, saucy, served hot'),
 ("light-bite", "Light Bite", 'Fries, nachos and crispy bites'),
 ("cheese-dip", "Cheese Dip", '30 each. Pure indulgence'),
 ("wrap", "Wrap", 'Rolled tight, dressed fresh'),
 ("salad", "Salad", 'Fresh and loaded'),
 ("combo", "Combo", 'Full meals, better prices'),
 ("cold-coffee", "Cold Coffee", 'Classic and thick'),
 ("mocktails", "Mocktails", '300ml refreshers'),
 ("shakes", "Shakes", 'Thick, cold, addictive. 300ml'),
 ("ice-tea", "Ice Tea", '300ml, brewed and iced'),
 ("soft-drinks", "Soft Drinks", '250ml, charged at MRP'),
]

def pizza(cat, name, desc, r, m, l, img):
    out = []
    for label, price in (("Regular", r), ("Medium", m), ("Large", l)):
        out.append({"id": slugify(name + " " + label), "cat": cat, "name": f"{name} ({label})",
                    "desc": desc, "price": price, "img": img, "tags": ["menu-card"]})
    return out

def duo(cat, name, desc, half, full, img):
    out = []
    for label, price in (("Half", half), ("Full", full)):
        out.append({"id": slugify(name + " " + label), "cat": cat, "name": f"{name} ({label})",
                    "desc": desc, "price": price, "img": img, "tags": ["menu-card"]})
    return out

def one(cat, name, desc, price, img):
    return {"id": slugify(name), "cat": cat, "name": name, "desc": desc, "price": price, "img": img, "tags": ["menu-card"]}

items = []
# Magic Mania (6 inches)
items += [one("magic-mania", "Tomato & Cheese (6 in)", "Classic cheese, oregano, fresh tomato sauce", 59, img_for("tomato-cheese"))]
items += [one("magic-mania", "Onion & Cheese (6 in)", "Caramelised onion, double cheese blend", 69, img_for("onion-cheese"))]
# Premium
items += pizza("premium", "Margherita", "Fresh tomato and cheddar cheese", 99, 199, 399, img_for("Margherita"))
items += pizza("premium", "Corn & Cheese", "Red onion, sweet corn and mozzarella cheese", 139, 299, 439, img_for("corn-cheese"))
items += pizza("premium", "Paneer Makhani", "Paneer, onion, capsicum, paprika and special makhni sauce", 149, 349, 459, img_for("Paneer Makhani"))
items += pizza("premium", "Dil Desi", "Capsicum, onion, tomato and delicious cheese", 189, 369, 449, img_for("Dil Desi"))
items += pizza("premium", "Farmer's Delight", "Farm fresh mushroom, tomato, capsicum, onion, sweet corn and delicious cheese", 209, 379, 489, img_for("Farmers Delight"))
# Legend
items += pizza("legend", "Tandoori Paneer Tikka", "Black olives, paneer tikka, capsicum, onion, fresh coriander leaves and delicious cheese", 229, 389, 509, img_for("Tandoori Paneer Tikka"))
items += pizza("legend", "Tangy Paneer Pizza", "Grilled paneer, bell pepper, onion, green capsicum, tomato, diced tomato salsa sauce and delicious cheese", 239, 379, 509, img_for("Tangy Paneer Pizza"))
# Gourmet Selection
items += pizza("gourmet", "Veggie Mexican", "Bell pepper, sweet corn, jalapeno, paprika, tomato, black olive and delicious cheese", 249, 399, 579, img_for("Veggie Mexican"))
items += pizza("gourmet", "Pesto Painting", "Loaded fresh paneer, bell pepper, well chopped jalapeno, basil, pesto sauce and delicious cheese", 259, 429, 599, img_for("Pesto Painting"))
items += pizza("gourmet", "Chef's Special Paneer Tikka", "IFP cheese blend, tandoori spread, bell pepper, black olives, chopped jalapeno, paprika, onion and paneer tikka and delicious cheese", 239, 429, 599, img_for("Chefs Special Paneer Tikka"))
# Pasta Mania
items += duo("pasta", "Arabiatta Pasta", "All-time favourite red arabiatta sauce with leeks, celery, olives, garlic and delicious cheese", 169, 269, img_for("Arabiatta Pasta"))
items += duo("pasta", "Veg Alfredo", "Cheesy white alfredo sauce with mushrooms, leeks, celery, onion, garlic, cream, cheddar cheese", 169, 269, img_for("Veg Alfredo"))
items += duo("pasta", "Tandoori Pasta", "Popular indo-western fusion dish combining traditional italian pasta with smoky, spicy indian tandoori flavours", 189, 289, img_for("Tandoori Pasta"))
items += [one("pasta", "Chef's Special Pasta", "Two sauce, red and white, basil, bell pepper, mushroom, zucchini and delicious cheese and cream", 299, img_for("chefs-special-pasta"))]
# The Oven Bits
items += [one("oven-bits", "Garlic Bread", "Ciabatta toasted with generous dose of roasted garlic, flavoured salted butter", 99, img_for("garlic-bread"))]
items += [one("oven-bits", "Cheese Chilli Tost", "Cheesy chilli toast, a signature snack", 149, img_for("cheese-chilli-tost"))]
items += [one("oven-bits", "Cheesy Garlic Bread", "Garlic bread topped with signature cheese, italian herbs and spices", 159, img_for("cheesy-garlic-bread"))]
# Sandwich
items += [one("sandwich", "Veg Grilled Sandwich", "Tomato, onion and capsicum", 89, img_for("veg-grilled-sandwich"))]
items += [one("sandwich", "Cheese Corn Sandwich", "Three types of cheese and american sweet corn", 139, img_for("cheese-corn-sandwich"))]
items += [one("sandwich", "Paneer Tikka Sandwich", "Paneer tikka, onion, capsicum and delicious cheese", 169, img_for("paneer-tikka-sandwich"))]
# Burger
items += [one("burger", "Veg Burger", "Classic veg patty, fresh veggies, house sauce", 59, img_for("burgers-shared"))]
items += [one("burger", "Crispy Veg Burger", "Crumb-fried patty, lettuce, house mayo, sesame bun", 99, img_for("crispy-veg-burger"))]
items += [one("burger", "Cheese Veg Burger", "Cheese slice, veg patty, mayo, fresh veggies", 119, img_for("burgers-shared"))]
items += [one("burger", "Double Cheese Veg Burger", "Double cheese slices, tangy sauce, crunchy patty", 139, img_for("double-cheese-veg-burger"))]
items += [one("burger", "Tandoori Paneer Burger", "Tandoori paneer patty, mint mayo, onions", 149, img_for("burgers-shared"))]
items += [one("burger", "Spicy Paneer Veg Burger", "Masala paneer patty, peri mayo, pickled onion", 149, img_for("spicy-paneer-veg-burger"))]
items += [one("burger", "Tower Veg Burger", "Triple-decker stack, cheese, patty, fresh veggies", 169, img_for("tower-veg-burger"))]
# Light Bite
items += [one("light-bite", "French Fries", "Golden, salted, dangerously crisp", 89, img_for("french-fries"))]
items += [one("light-bite", "Peri Peri Fries", "Tossed in fiery peri peri dust", 139, img_for("peri-peri-fries"))]
items += [one("light-bite", "Cheese Jalapeno French Fries", "Loaded cheese sauce, jalapeno kick", 169, img_for("cheese-jalapeno-fries"))]
items += [one("light-bite", "Salsa Nachos", "House salsa, cheese, crunchy tortillas", 159, img_for("nachos-shared"))]
items += [one("light-bite", "Creme Cheese Nachos", "Creme cheese, jalapenos, crunchy tortillas", 189, img_for("creme-cheese-nachos"))]
# Cheese Dip
items += [one("cheese-dip", "Cocktail Mayo Dip", "Cool, creamy, classic", 30, img_for("cocktail-mayo-dip"))]
items += [one("cheese-dip", "Cheese Jalapeno Dip", "Creamy dip with jalapeno heat", 30, img_for("cheese-jalapeno-dip"))]
items += [one("cheese-dip", "Peri Peri Dip", "Fiery peri peri folded into cheese", 30, img_for("peri-peri-dip"))]
# Wrap
items += [one("wrap", "Aloo Verona Wrap", "Spiced potato, mint mayo, crunch, rolled tight", 139, img_for("aloo-verona-wrap"))]
items += [one("wrap", "Paneer Fajita Wrap", "Fajita paneer, peppers, onion, chipotle mayo", 159, img_for("paneer-fajita-wrap"))]
items += [one("wrap", "Paneer Tikka Wrap", "Char-grilled paneer tikka, onion, mint chutney", 159, img_for("paneer-tikka-wrap"))]
# Salad
items += [one("salad", "Mexican Salad", "Kidney beans, sweet corn, tomato, lettuce, cucumber, dressing, salsa sauce", 289, img_for("mexican-salad"))]
# Combo
items += [one("combo", "Combo Crush", "1 veg burger, 1 french fries, 2 pcs garlic bread / any one 250ml (coke, thums up or sprite)", 159, img_for("combo-crush"))]
items += [one("combo", "Magic Combo", "2 veg burgers, 1 margherita pizza 7 inch, 1 french fries", 289, img_for("magic-combo"))]
items += [one("combo", "King Combo", "Any one 7 inch pizza (onion cheese, tomato cheese, margherita, sweet corn), 1 salsa nachos, any one 250ml drink", 329, img_for("king-combo"))]
items += [one("combo", "Combo Magambo", "2 veg burgers, any one 7 inch premium pizza, 2 pcs garlic bread or 1 french fries, any two 250ml drinks", 429, img_for("combo-magambo"))]
items += [one("combo", "Party Combo 1", "1 veg grilled sandwich, 1 premium pizza (regular), 1 french fries, 2 frooti", 449, img_for("party-combo-1"))]
items += [one("combo", "Party Combo 2", "2 medium pizzas (any), 2 blue lagoon / summer cooler", 899, img_for("party-combo-2"))]
# Cold Coffee
items += [one("cold-coffee", "Cold Coffee", "Smooth, frothy, timeless", 49, img_for("cold-coffee"))]
items += [one("cold-coffee", "Thick Cold Coffee", "Extra thick, extra cold", 89, img_for("thick-cold-coffee"))]
items += [one("cold-coffee", "Chocolate-y Iced Mocha", "Chocolate and coffee, iced and indulgent", 99, img_for("chocolatey-iced-mocha"))]
items += [one("cold-coffee", "Thick Cold Coffee with Chocolate Crush", "Thick cold coffee loaded with chocolate crush", 109, img_for("cold-coffee"))]
# Mocktails
items += [one("mocktails", "Strawberry Margherta", "Strawberry sparkle, 300ml", 79, img_for("mocktails-shared"))]
items += [one("mocktails", "Mango Mojito", "Mango, mint, lime, 300ml", 79, img_for("mocktails-shared"))]
items += [one("mocktails", "Kiwi Crush", "Real kiwi, crushed ice, 300ml", 79, img_for("mocktails-shared"))]
items += [one("mocktails", "Summer Cooler", "Seasonal fruits, sparkling, light, 300ml", 89, img_for("mocktails-shared"))]
items += [one("mocktails", "Blue Lagoon", "Electric blue citrus cooler, 300ml", 99, img_for("mocktails-shared"))]
items += [one("mocktails", "Mojito", "Mint, lime, soda, classic refresher, 300ml", 109, img_for("mocktails-shared"))]
# Shakes
items += [one("shakes", "Strawberry Shake", "Real strawberry, creamy, 300ml", 89, img_for("strawberry-shake"))]
items += [one("shakes", "Strawberry Kiwi Shake", "Strawberry meets kiwi tang, 300ml", 89, img_for("strawberry-kiwi-shake"))]
items += [one("shakes", "Mango Shake", "Alphonso mango blended thick, 300ml", 89, img_for("Shakes SHARED"))]
items += [one("shakes", "Banana Shake", "Creamy banana, 300ml", 89, img_for("Shakes SHARED"))]
items += [one("shakes", "Oreo Shake", "Cookies and cream, blended thick, 300ml", 99, img_for("oreo-shake"))]
items += [one("shakes", "Hazelnut Shake", "Roasted hazelnut, chocolate, crunch, 300ml", 129, img_for("hazelnut-shake"))]
items += [one("shakes", "Kitkat Shake", "Kitkat crunch in a thick shake, 300ml", 129, img_for("kitkat-shake"))]
items += [one("shakes", "XTO Special Shake", "Our signature loaded shake. Ask us why it is special", 149, img_for("Shakes SHARED"))]
# Ice Tea
items += [one("ice-tea", "Ice Tea", "Brewed, iced, 300ml", 49, img_for("ice-tea-shared"))]
items += [one("ice-tea", "Peach Ice Tea", "Peach notes over cold brew, 300ml", 69, img_for("ice-tea-shared"))]
# Soft Drinks (MRP)
items += [one("soft-drinks", "Coke", "250ml, charged at MRP", 40, img_for("soft-drinks-shared"))]
items += [one("soft-drinks", "Sprite", "250ml, charged at MRP", 40, img_for("soft-drinks-shared"))]
items += [one("soft-drinks", "Thums Up", "250ml, charged at MRP", 40, img_for("soft-drinks-shared"))]
items += [one("soft-drinks", "Diet Coke", "250ml, charged at MRP", 40, img_for("soft-drinks-shared"))]

# integrity
ids = [i["id"] for i in items]
assert len(ids) == len(set(ids)), "duplicate ids"
assert all(0 < i["price"] < 2000 for i in items)
blob = json.dumps(items, ensure_ascii=False)
assert "—" not in blob

# backup old, write new
old = os.path.join(ROOT, 'data', 'menu.json')
shutil.copy2(old, os.path.join(ROOT, 'data', 'menu.swiggy-backup.json'))
json.dump({"categories": [{"id": c[0], "name": c[1], "note": c[2]} for c in CATS],
           "items": items,
           "deliveryFee": 29, "freeDeliveryAbove": 499},
          open(old, 'w'), indent=2, ensure_ascii=False)
print(f"menu rebuilt from the official card: {len(items)} items, {len(CATS)} categories")
print("backup: data/menu.swiggy-backup.json")
