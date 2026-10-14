#!/usr/bin/env python3
"""Build the XTO menu pack: 75 premium-colorful NEW prompts, 1,000+ words each,
10 per file max. Word counts programmatically verified. Overwrites the 8 parts
in ~/Downloads and prompts/packs.
"""
import json, os, math, re

DL = os.path.expanduser('~/Downloads')
VAULT = '/Users/shreyasraj/Documents/2ndBrain/prompts/packs'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
menu = json.load(open(os.path.join(ROOT, 'data', 'menu.json')))

# ---------------- keyword enrichment bank ----------------
KW = [
 (['peri peri'], 'a rust-red dusting of peri peri seasoning clinging to every crisp edge', 'fiery rust reds and paprika oranges', 'fine peri peri flakes drifting mid-air around the item'),
 (['jalapeno'], 'bright jade-green jalapeno coins with glossy skins and visible seeds', 'jade greens against warm cream', 'thin jalapeno rings scattered like confetti'),
 (['cheese'], 'molten cheese in glossy ropes with a slow bubbling blister across the surface', 'butter-gold and cream tones', 'one cheese strand stretching between item and board'),
 (['corn'], 'plump golden-corn kernels bursting between strings of cheese', 'sunshine yellow and butter gold', 'a few scattered kernels rolling on the board'),
 (['paneer'], 'sauce-lacquered cubes of paneer with golden char edges and a soft milky center', 'tandoori reds over milky golds', 'char-edged paneer cubes glistening under the light'),
 (['mushroom'], 'butter-brushed mushrooms with deep bronze caps and juicy slice faces', 'earth bronzes and umami browns', 'a soft sheen of garlic butter sliding off the caps'),
 (['pineapple'], 'caramel-touched pineapple chunks juicy and bright', 'tropical golds', 'a glinting pineapple chunk catching a rim light'),
 (['oreo'], 'crushed dark cookies threaded through cream with visible cacao crumb', 'near-black cocoa against white cream', 'cookie crumb tumbling down a whipped peak'),
 (['kitkat'], 'crisp wafer fingers in red wrappers snapped and standing in cream', 'ruby red and wafer gold', 'a snapped wafer segment mid-crunch'),
 (['strawberry'], 'ripe strawberry halves with dewy cut faces and bright tips', 'ruby and rose reds', 'a strawberry slice sliding into the blend'),
 (['kiwi'], 'kiwi wheels with vivid green flesh and a ring of tiny black seeds', 'electric green', 'one kiwi wheel balanced at the rim'),
 (['hazelnut'], 'roasted hazelnuts with cracked shells beside a glossy caramel ribbon', 'amber and toffee browns', 'crushed praline crumbs catching the kicker light'),
 (['caramel'], 'a slow caramel ribbon folding into cream with amber translucence', 'burnt amber', 'a caramel thread catching light mid-drip'),
 (['banana'], 'creamy banana rounds with soft golden edges', 'pale gold and cream', 'a banana coin settling on the foam'),
 (['mocha','chocolate'], 'dark chocolate with a satin snap and a slow glossy melt', 'deep cocoa browns', 'a chocolate drizzle mid-pour'),
 (['brownie'], 'fudgy brownie cubes with a crackled top and dense crumb', 'dark fudge browns', 'a brownie corner sinking into the frappe'),
 (['mint','mojito'], 'fresh mint sprigs beaded with dew and bright lime wedges', 'spring greens and lime', 'mint leaves frozen mid-fall over ice'),
 (['lemon'], 'sun-bright lemon wheels with pith detail and juice beads', 'citrus yellow', 'a micro spray of citrus mist catching light'),
 (['peach'], 'blush peach slices with velvety skins and sunset gradients', 'coral and blush pink', 'a peach fan arranged at the glass rim'),
 (['blue lagoon','blue'], 'an electric-blue drink with glowing citrus depth', 'electric blue and cyan', 'ice shards refracting the blue like stained glass'),
 (['kiwi crush'], 'crushed kiwi pulp layered with sparkling soda', 'green and gold layers', 'rising bubbles in bright green swirls'),
 (['garlic'], 'golden garlic butter pooling in toasted crevices with flecks of parsley', 'golden toast browns', 'a brush of garlic butter leaving a wet sheen'),
 (['bruschetta'], 'rustic toasted bread with a crisp scaffold under a loaded topping', ' Tuscan golds', 'one bruschetta slice tilted to show its base'),
 (['nachos'], 'stone-ground tortilla chips in a colorful avalanche with pooled salsa', 'maize golds and salsa reds', 'a chip lifted with a loaded payload mid-air'),
 (['fries'], 'shatter-crisp fries with blistered skins and a fine salt shimmer', 'golden potato golds', 'a pinch of salt falling over the stack'),
 (['wrap'], 'a char-kissed tortilla rolled tight around a rainbow of fillings', 'warm tortilla cream with colorful inlays', 'the paper wrap peeling back in one curl'),
 (['salad'], 'crisp leaves with dew-mist and jewel-bright vegetable ribbons', 'vivid greens and confetti vegetables', 'dressing landing in a slow glossy ribbon'),
 (['coke','sprite','thums','diet'], 'the sealed branded can with ice-cold condensation and razor-sharp label art', 'brand true colors', 'condensation beads racing down the chilled can'),
 (['tea'], 'amber brew over crystal ice with a gradient from deep to pale', 'amber to straw gradient', 'tea cascading over ice in one bright pour'),
 (['coffee','macchiato','espresso'], 'a bold coffee gradient with thick crema and microfoam velvet', 'espresso browns and cream layers', 'espresso ribbons marbling into cold milk'),
 (['shake','frappe'], 'a thick shake standing in stiff glossy peaks above the rim', 'pastel creams true to its flavor', 'the swirl cresting in a slow curl'),
 (['burger'], 'a stacked burger with toasted bun gloss and layered color architecture', 'bun golds with garden greens', 'the top bun hovering a breath above the stack'),
 (['sandwich','panini'], 'pressed bread with caramelized grill lattice and a molten seam', 'grill-mark golds', 'steam escaping a fresh-cut corner'),
 (['pasta','penne','alfredo','pesto','rosette'], 'sauce-lacquered pasta with every strand or tube individually coated', 'sauce-true tones from crimson to cream', 'a fork twirl lifting one glossy ribbon'),
 (['pizza'], 'a hand-stretched base with a puffy leopard-spotted crust rim', 'sauce reds under cheese golds', 'one slice lifting into a long cheese pull'),
 (['dip'], 'a dense glossy dip holding stiff swirl peaks', 'ivory creams with flecked spice', 'a crisp dipper mid-plunge creating a small crest'),
 (['combo'], 'a tight cluster where every element reads instantly at thumbnail size', 'multi-color harmony', 'steam rising across the whole cluster at once'),
]
def enrich(item):
    t = (item['name'] + ' ' + item['desc']).lower()
    tex, col, mom = [], [], []
    for keys, a, b, c in KW:
        if any(k in t for k in keys):
            tex.append(a); col.append(b); mom.append(c)
    if not tex:
        tex = ['glossy fresh surfaces with appetizing texture detail']
        col = ['warm appetizing tones true to the dish']
        mom = ['a single appetizing motion moment']
    return tex, col, mom

# ---------------- category bases ----------------
BASE = {
 'pizza': dict(vessel='on a rustic wooden peel resting over a warm stone countertop', angle='a low 30-degree three-quarter angle that reads the toppings and the crust rim in one frame', moment='one hand-lifted slice stretching a long molten cheese pull, the base staying structurally crisp'),
 'burgers': dict(vessel='on a matte ceramic board with a swipe of house sauce', angle='an eye-level hero angle straight into the layered cross-section', moment='the top bun hovering a few millimeters above the stack with fresh steam in the gap'),
 'sandwich': dict(vessel='on a slate plate with a ramekin of coriander chutney', angle='a 40-degree angle across the diagonal cut', moment='steam curling out of the molten seam of a fresh-cut corner'),
 'pasta': dict(vessel='in a wide hand-thrown ceramic bowl on textured dark oak', angle='a 35-degree angle with the fork entering from the upper right', moment='a fork twirl lifting one glossy ribbon with a slow sauce drip'),
 'sides': dict(vessel='in a rustic bowl with a dip ramekin to the side', angle='a close low 25-degree angle for maximum texture crunch', moment='a cheese sauce pour or a pinch of seasoning falling mid-frame'),
 'wraps': dict(vessel='on a dark board with the paper wrap curling back', angle='a 40-degree angle straight into the diagonal cross-section', moment='a light sauce drip from the base while the paper peels'),
 'combos': dict(vessel='arranged as a tight hero cluster on a generous board', angle='a slightly elevated 20-degree angle that keeps every element readable', moment='steam rising across the entire cluster at once'),
 'beverages': dict(vessel='on a wet slate surface with a soft water reflection', angle='an eye-level angle into the glass with the garnish profiled against light', moment='a splash crown or rising bubbles frozen at the surface'),
 'coffee-shakes': dict(vessel='on a marble ledge with the straw entering from the right', angle='an eye-level angle into the swirl crest', moment='the swirl cresting in a slow curl with a sauce drip down the glass'),
}

# ---------------- rotating phrasing banks ----------------
LIGHT = [
 'Lighting is a masterclass in appetite: a large soft key from the left front wraps the food in warm 4800K glow, a gridded rim from behind right licks every glossed edge into a bright halo, a small silver reflector lifts shadow detail so nothing reads muddy, and one focused kicker scrapes across liquids and sauces to carve individual specular highlights. The mood is bright and generous, closer to a sunlit modern bistro than a dark den, with practical warmth in the frame keeping the food feeling served, hot and alive.',
 'The lighting setup screams premium menu hero: a big octabox key camera-left at warm 4700K for creamy soft falloff, a hard gridded strip behind for a crisp rim that separates every edge from the background, a subtle top feather for sheen on buns and crusts, and a white bounce opening the shadows just enough to keep all color saturated yet true. Highlights must stay alive on sauces and condensation while shadows retain full ingredient detail.',
 'Illumination is colorful editorial food advertising: a dominant warm key wrapping from the front left with gentle wraparound, a colored kicker from the rear right tuned to complement the dish palette, a low fill protecting texture in the shadows, and deliberate specular hits engineered on the wettest surfaces, cheese gloss, sauce films and condensation beads, so the whole frame radiates freshness and heat simultaneously.',
]
CAM = [
 'Camera and optics: shot as if on a full-frame body with a 100mm macro at f/4, focused precisely on the hero texture with depth of field deep enough to keep the whole item legible and just soft enough to melt the background into warm color. Square 1:1 composition, tack-sharp micro detail on crumbs, seeds and bubbles, zero distortion.',
 'Camera and optics: virtual 85mm prime at f/3.8 on a full-frame sensor, focus racked onto the front face of the hero item with a gentle falloff that still resolves every garnish behind it. Square 1:1 framing with meticulous edge discipline: nothing clipped, nothing floating, nothing accidental.',
 'Camera and optics: emulate a tilt-shift macro look, 90mm at f/5.6 for controlled sharpness across the whole subject plane, one-millimeter focus precision on the juiciest detail, background rendered as soft color fields that push the dish forward. Square 1:1 crop engineered for a menu grid.',
]
SET = [
 'The set is a premium colorful stage: a warm ivory plaster backdrop with soft gradient light, the surface a live-edge acacia board over ember-toned linen, and props chosen in saturated complementary colors, a glazed ceramic ramekin, a folded indigo napkin, scattered raw ingredients, so the frame pops while every gram of attention stays on the food.',
 'The environment reads as a modern colorful bistro counter: washed plaster in warm cream, a brushed brass rail catching light in the far bokeh, artisan ceramics and a small cutting board with raw ingredients arranged loosely around the hero, with two or three strong accent colors echoing the XTO palette of ember orange, deep red and golden yellow.',
 'The staging is a vivid premium table story: a textured ceramic surface in warm neutral, a color-blocked backdrop panel behind, fresh produce and hand-thrown small props dressing the frame in confident complementary color pairs, deliberately colorful but never louder than the dish itself.',
]
GRADE = [
 'Color and grade: this is a PREMIUM COLORFUL campaign image. Saturation is pushed to the delicious edge without any plastic look: reds of sauce read rich and cooked, golds of crust and butter glow warm, greens stay fresh and alive, every color looks edible and appetizing. Overall grade is clean and bright with protected highlights, gentle warm shadows and a subtle S-curve for pop. The image must look mouth-watering at thumbnail size and reward zoom with realistic micro-texture.',
 'Color and grade: vivid menu-hero color science. The dish palette is the star: build the surrounding colors to complement it, ember orange, deep red and golden yellow accents from the XTO brand world, but keep whites creamy rather than clinical and darks rich rather than crushed. Saturation high, realism higher: every surface must look like real cooked food, never candy, never CGI.',
 'Color and grade: bright, colorful and hunger-forward. White balance warm but clean, vibrancy lifted on the hero ingredients only, background colors rich but subordinate, and a final polish pass that keeps skin-safe warmth on breads and cheeses. The deliverable must feel like it was shot for a premium food brand that loves color: joyful, saturated, unmistakably edible.',
]
NEG = 'Absolute negatives, none of these may appear: text, letters, numbers, watermarks, logos, brand names, people, faces, hands, fingers, cutlery holding the food, plastic or fake CGI look, waxy sheen, oversmooth AI food, unappetizing gray tones, muddy shadows, burnt-black backgrounds, floating ingredient errors, duplicated items, warped perspective, clipped highlights, cartoon or illustration style, clip art, stock-photo watermark grids, messy unappetizing drips, raw meat, non-vegetarian ingredients, insects, dirt, blur on the hero subject, distorted hands anywhere in frame.'

PURPOSE = 'Premium colorful menu hero image for the XTO Pizza digital menu, website and app. Must look edible, vibrant and appetizing at thumbnail size, in the same visual family as every other image in this 75-shot campaign.'

def words(s): return len(s.split())

def build_prompt(item, tex, col, mom, base, idx):
    name = item['name']; desc = item['desc']
    texs = ', '.join(tex[:4]); cols = ', '.join(col[:3]); moms = mom[0]
    cat_word = item['cat'].replace('-', ' ')
    s = []
    s.append(f"Create a premium colorful advertising hero photograph of {name} from XTO Pizza, a pure vegetarian {cat_word} item described as: {desc}. This is a standalone new campaign image in a 75-shot menu series, and its single job is to make a hungry viewer order immediately: everything in the frame must look freshly made, genuinely edible and vividly appetizing, with the dish treated as the absolute hero of a premium colorful food brand that loves bold, joyful color.")
    s.append(f"Subject and food detail: render {name} with obsessive culinary accuracy. Every ingredient must be individually readable and real: {texs}. Surfaces carry true cooked texture, crisp edges with fine blistering, sauces with a wet glossy film, cheeses molten and pulling, greens dewy and alive, buns and breads with toasted warmth and visible crumb. Nothing looks styled-dead or artificial: the food reads as if the kitchen finished the plate ninety seconds before the shutter clicked.")
    s.append(f"Food styling and garnish: the plating is generous but disciplined, garnished with a small set of fresh complements true to this dish, such as {', '.join(mom[1:3]) if len(mom) > 2 else 'fresh herbs, a light seasoning dust and one sauce accent'}. Portion reads honest and satisfying for the price tier, garnish sits as color accents around the base rather than hiding the hero, and one small deliberate imperfection, a crumb, a drip, a scattered seed, keeps the realism premium rather than clinical.")
    s.append(f"Environment and set design: the hero sits {base['vessel']}. {SET[idx % 3]} The background stays a soft warm color field with enough interest to feel like a real place and enough restraint to keep all attention on the dish.")
    s.append(LIGHT[idx % 3])
    s.append(CAM[idx % 3])
    s.append(GRADE[idx % 3])
    s.append(f"Composition and framing: square 1:1, the dish filling roughly two thirds of the frame with confident negative space for the menu card layout, hero texture placed on the upper-left power line, garnish vectors leading the eye inward, base edges aligned to the frame grid, {base['angle']}. The image must survive being cropped to a circle for the category wheel and still read perfectly.")
    s.append(f"Ingredient fidelity checklist for {name}: before finalizing, confirm every element of the described dish is present and correctly rendered: {texs}. Each ingredient appears at true scale and true color, {cols}, nothing invented that the description does not mention, nothing missing that it does, absolutely pure vegetarian with no eggs, no meat traces and no non-veg garnishes anywhere in frame, and the total portion matches what a paying customer would receive at this price point so the photo builds trust as well as appetite.")
    s.append(f"Appetite psychology: engineer the frame around how hunger actually works. The eye must land on the wettest, warmest, most cooked-looking surface first, then travel outward through the garnish colors and settle on the wholesome base. Warmth cues, visible steam, gloss, fresh herbs and honest char, all push the same signal: this was made seconds ago by people who care. The viewer should feel a physical pull to reach into the frame, and the image should hold up under repeated viewing on a menu without ever revealing an unappetizing detail.")
    s.append(f"The decisive moment: capture {base['moment']}, with {moms} adding one micro-story of motion and freshness{' and ' + mom[1] if len(mom) > 1 else ''}. Steam, drips, pulls and pours must be physically believable, lit so they glow, and timed so they enhance appetite rather than mess.")
    s.append(f"Series consistency: this image belongs to a matched 75-shot campaign for the XTO Pizza menu. It shares one light family, one color philosophy and one camera voice with every other shot in the series, so the grid of menu cards reads as a single confident brand. Test the final image three ways: full square, circular crop for the category wheel, and 150-pixel thumbnail, in all three the dish must stay instantly recognizable and mouth-watering. If any crop fails, tighten the composition rather than shrinking the food.")
    s.append(f"Style anchors: ultra-real premium food advertising photography in the colorful modern bistro tradition, 8K micro-detail, physically accurate materials and light, appetizing above all. The viewer should be able to smell it through the screen. Output one single image, photorealistic, campaign-grade, consistent with the series.")
    s.append(NEG)
    return ' '.join(s)

def field300(item, tex, col, base, which):
    name = item['name']; desc = item['desc']
    if which == 'subject':
        return f"{name}: {desc}. Rendered as the hero of frame with every ingredient individually readable: {', '.join(tex[:4])}. Cooked textures real and appetizing, portion generous and honest, styled to look freshly finished by the kitchen with premium colorful edible appeal at first glance."
    if which == 'environment':
        return f"{base['vessel']}, within a premium colorful modern bistro set: warm ivory plaster backdrop, artisan ceramics, vivid complementary props echoing ember orange, deep red and golden yellow XTO brand accents, raw ingredients loosely dressing the frame, background a soft warm color field subordinate to the dish."
    if which == 'lighting':
        return f"Warm large softbox key from front left, gridded rim from rear right carving bright edges, low fill protecting shadow texture, focused kicker engineered on wet surfaces, sauces, cheese gloss and condensation. Bright sunlit-bistro mood, generous appetite-forward warmth across the whole frame, no dark moody den look, no harsh burnt shadows, everything glowing and edible."
    if which == 'camera':
        return "Full-frame virtual body with 90 to 100mm macro at f/4 to f/5.6, focus precision on the juiciest texture, controlled depth of field keeping the entire item legible while melting the background into warm color fields. Square 1:1 crop, zero geometric distortion, tack-sharp micro detail on every crumb, seed, bubble and garnish edge."
    if which == 'color_palette':
        return f"Dish-true colors lead: {', '.join(col[:3])}, framed by XTO brand accents of ember orange, deep red and golden yellow against warm cream neutrals. High but realistic saturation, clean warm white balance, protected highlights, rich uncrushed shadows, everything reads vivid, edible and pop at thumbnail size and at full zoom alike."
    if which == 'style':
        return "Ultra-real premium food advertising photography, colorful modern bistro campaign tradition, 8K micro-detail, physically accurate light and materials, appetizing and edible above all, consistent 75-shot series look for the XTO digital menu, website and app grid, photoreal campaign grade with no CGI or plastic sheen anywhere in the frame."
    if which == 'composition':
        return f"Square 1:1, dish fills two thirds of frame with menu-card negative space, hero texture on the upper-left power line, garnish vectors leading inward, {base['angle']}, must survive a circular crop for category wheels and a 150-pixel thumbnail test, nothing clipped, nothing accidental, every prop intentional."

packs = []
for idx, item in enumerate(menu['items']):
    tex, col, mom = enrich(item)
    base = BASE[item['cat']]
    p = build_prompt(item, tex, col, mom, base, idx)
    packs.append({
        'id': idx + 1,
        'item': item['name'],
        'category': item['cat'],
        'mode': 'new-concept',
        'attach_reference': '(optional style guide) ~/Downloads/XTO Menu Images From PDF/',
        'prompt': p,
        'subject': field300(item, tex, col, base, 'subject'),
        'environment': field300(item, tex, col, base, 'environment'),
        'lighting': field300(item, tex, col, base, 'lighting'),
        'camera': field300(item, tex, col, base, 'camera'),
        'color_palette': field300(item, tex, col, base, 'color_palette'),
        'style': field300(item, tex, col, base, 'style'),
        'composition': field300(item, tex, col, base, 'composition'),
        'aspect_ratio': '1:1',
        'purpose': PURPOSE,
        'negative_prompt': NEG,
        'save_as': '~/Code/xto-pizza/public/images/' + item['id'] + '.jpg'
    })

# verify before writing
wc = [words(p['prompt']) for p in packs]
assert len(packs) == 75
assert min(wc) >= 1000, f'min {min(wc)}'
for p in packs:
    for f in ('subject','environment','lighting','camera','color_palette','style','composition'):
        assert len(p[f]) >= 300, (p['item'], f, len(p[f]))
    assert len(p['negative_prompt']) > 400
blob = json.dumps(packs, ensure_ascii=False)
assert not any(c in blob for c in '—–')

meta = {
 'pack': 'XTO Pizza - Premium Colorful Menu Shots (one 1000+ word prompt per dish)',
 'version': 3, 'date': '2026-10-14',
 'art_direction': 'Premium colorful style. Every image looks edible, vivid and pop: bright warm bistro light, saturated but realistic color, XTO brand accents of ember orange, deep red and golden yellow. No dark moody plates.',
 'how_to_use': 'One prompt per menu item, 1,000+ words each, max 10 prompts per file across 8 numbered parts. Paste the whole prompt field (supporting fields are baked into it) into ChatGPT GPT-Image or Nano Banana, optionally attach the item photo from ~/Downloads/XTO Menu Images From PDF/ as a soft style guide. Export square 1:1, save with the save_as filename.',
 'after_generating': 'Drop files into public/images with the save_as names, then tell the agent to flip menu img fields to the new ids, run scripts/build-digital-menu.py and scripts/build-site-demo.py, and push.',
}
parts = math.ceil(75 / 10)
report = []
for pi in range(parts):
    chunk = packs[pi*10:(pi+1)*10]
    name = f'XTO Menu Item Shots - Part {pi+1} of {parts}.json'
    doc = dict(meta); doc['part'] = f'{pi+1} of {parts}'; doc['items_in_this_file'] = len(chunk); doc['prompts'] = chunk
    for d in (DL, VAULT):
        json.dump(doc, open(os.path.join(d, name), 'w'), indent=2, ensure_ascii=False)
    w = [words(c['prompt']) for c in chunk]
    report.append((name, len(chunk), min(w), max(w), round(sum(w)/len(w))))
print(f'VERIFIED: 75 prompts, min {min(wc)} words, avg {round(sum(wc)/75)}, max {max(wc)}')
for name, n, lo, hi, av in report:
    print(f'{name}: {n} prompts, words {lo}-{hi}, avg {av}')
json.dump(packs[0], open('/tmp/xto_example_prompt.json','w'), indent=2, ensure_ascii=False)
