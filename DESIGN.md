# XTO Pizza design system (v2, 15 Oct 2026)

Direction: warm editorial pizzeria. Light cream canvas, deep brand red header, generous food photography, one confident display face. Replaces the old dark "ember" theme. Reference for structure only: lapinozpizza.in (two-tier header with search and cart, offer cards, franchise page, rich footer). No competitor assets or copy.

## Tokens (public/css/home.css :root)
- Ink `#1b120c`, text on cream. Muted `#76675a`.
- Brand red `#b3271e` (header, primary actions), deep red `#8f1d16` (nav row, hover), brand orange `#f0731d` (accents, prices), gold `#ffc53d` (highlights on dark).
- Cream `#fff8ef` (page), paper `#fffdf9` (cards), line `#eadfce`, veg green `#1c7c31`.
- Radius: 12 card, 999 pills/buttons, 20 hero media. Shadow: `0 14px 40px -18px rgba(27,18,12,.35)`.
- Type: display Bricolage Grotesque 700/800 (headings, prices), body Inter 400-700. Scale: h1 clamp(2.4rem, 5.6vw, 4.4rem), h2 clamp(1.7rem, 3vw, 2.4rem), body 1rem, small .85rem.
- Spacing: 4 / 8 / 12 / 16 / 24 / 40 / 64 / 96. Container 1180px, 20px gutter on phones.

## Primitives
- Header: top bar (logo, search, Track, Cart) + nav row. Phones: nav row scrolls horizontally.
- Buttons: `.xbtn` primary (red), `.xbtn.alt` (orange), `.xbtn.ghost` (outline). States: hover lift, active press, focus ring 3px orange, disabled 50 percent.
- Menu card: photo 4:3, veg mark, name, 2-line description, size chips (Regular / Medium / Large with prices), price, ADD. Sold out state greyed.
- Option sheet: size radios, add-on checkboxes (price follows size), qty, running total.
- Offer card, category circle, outlet card, value tile, form field (label, input, error), enquiry success panel.

## Rules
- Pure veg only. Names exactly as the printed menu card. No invented claims or numbers.
- SVG icons, no emoji as icons. Animate transform/opacity only. Honour prefers-reduced-motion.
- Contrast: body text 4.5:1 minimum; white on `#b3271e` passes AA.
- Marquee must loop seamlessly at any viewport width (content repeated until it covers 2x the viewport).
