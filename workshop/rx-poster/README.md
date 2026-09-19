# Rx Your Life — the CrossFit-wall poster

Evergreen one-sheet for the Executive Mindset Workshop. One design; per gym only the corner changes
(gym name + logo) and the QR target (`proactivatorsclub.com/rx/<gym-slug>`), so every scan is attributed.

- `mockup.tpl.html` — the approved design (Gabriel, Sep 18–19 2026). `LOGO_URI` / `ART_URI` are inlined at build.
- `build-print.js` — builds a print page: **24×36 in trim + 0.125 in bleed** (24.25×36.25), type + QR vector,
  art = the 3375 px original of `og-image.jpg` (~140 dpi at 24 in — fine for a wall poster viewed at arm's length),
  logo = the 4500 px master. Then Chrome headless prints it to PDF.
- `gyms/<slug>.png` — each gym's logo (CrossFit MIA's pulled from crossfitmia.com, Sep 19 2026).

## New gym
```
node build-print.js <slug> "<Gym Name>" <gym-logo-b64-file>
chrome --headless=new --no-pdf-header-footer --virtual-time-budget=20000 --print-to-pdf=OUT.pdf file:///.../print-<slug>.html
```
Then decode the QR from a render before sending to print (jsqr) — a poster with a dead code is a dead poster.
Print spec to give the shop: 24×36, 0.125 bleed included, no crop marks needed, single page, CMYK conversion at their end, matte or satin.
