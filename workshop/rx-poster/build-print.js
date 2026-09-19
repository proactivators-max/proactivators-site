// Build the print-ready poster page from the approved mock template.
// 24×36 in trim + 0.125 in bleed on every side (24.25×36.25 page). All type and the QR are vector;
// the art is the 3375 px original, the logo the 4500 px master. Per-gym: name, logo, QR target.
// usage: node build-print.js <gymSlug> "<Gym Name>" [gymLogoB64File]
const fs = require('fs');
const S = __dirname;
const [slug, gymName, gymLogoFile] = process.argv.slice(2);
if (!slug || !gymName) { console.error('usage: node build-print.js <slug> "<Gym Name>" [gymLogoB64File]'); process.exit(1); }

let t = fs.readFileSync(S + '/rx-poster.tpl.html', 'utf8');
const head = t.slice(0, t.indexOf('<style>'));
let css = t.slice(t.indexOf('<style>') + 7, t.indexOf('</style>'));
let poster = t.slice(t.indexOf('<div class="poster"'), t.indexOf('<div class="side">'));

// ── page geometry: 96 css px per inch. Poster 24in wide → the em base the mock used at 680px scales exactly.
const IN = 96, W = 24, H = 36, BLEED = 0.125;
const em = (W * IN) / 680 * 16;
css = css.replace(/\.poster\{[^}]*\}/, `.poster{width:${W}in;height:${H}in;background:#050505;color:var(--off);position:absolute;left:${BLEED}in;top:${BLEED}in;overflow:visible;font-size:${em.toFixed(4)}px}`);
css += `
@page{size:${(W + 2 * BLEED)}in ${(H + 2 * BLEED)}in;margin:0}
html,body{margin:0;padding:0;background:#050505;width:${(W + 2 * BLEED)}in;height:${(H + 2 * BLEED)}in;overflow:hidden}
.bleed{position:absolute;inset:0;background:#050505}
.poster>*{position:absolute}
.art{inset:0}
.qr .code{background:#fff}
/* the gym corner, with a real logo */
.gym .slot{border:0;width:auto;height:3.2em;padding:0;display:block}
.gym .slot img{height:100%;width:auto;display:block}
/* keep art/gradients inside the trim (bleed stays plain black — nothing critical lives there) */
.grain{display:none}
`;

// ── content swaps for this gym
poster = poster.replace(/id="poster"/, 'id="poster"')
  .replace('<div class="slot">gym<br>logo</div>', gymLogoFile ? `<div class="slot"><img src="${fs.readFileSync(gymLogoFile, 'utf8')}" alt="${gymName}"></div>` : '')
  .replace('[GYM NAME]', gymName);

const qrTarget = `https://proactivatorsclub.com/rx/${slug}`;
const page = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Rx Your Life — print — ${gymName}</title>
${head.replace('<title>Rx Your Life</title>', '')}
<style>${css}</style></head><body>
<div class="bleed"></div>
${poster}
<script>
new QRCode(document.getElementById('qr'),{text:${JSON.stringify(qrTarget)},width:2048,height:2048,correctLevel:QRCode.CorrectLevel.M,colorDark:'#050505',colorLight:'#ffffff'});
</script></body></html>`;

const out = page
  .split('LOGO_URI').join(fs.readFileSync(S + '/logo-print-b64.txt', 'utf8'))
  .split('ART_URI').join(fs.readFileSync(S + '/art-print-b64.txt', 'utf8'));
const file = `${S}/print-${slug}.html`;
fs.writeFileSync(file, out);
console.log('wrote', file, Math.round(out.length / 1024) + ' KB', '| QR →', qrTarget, '| em', em.toFixed(2) + 'px');
