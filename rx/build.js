// Make /rx/<slug>/ for every gym in gyms.json — an identical copy of /rx/index.html.
// The page reads the slug from its own path, so nothing inside the file changes.
const fs = require('fs'), path = require('path');
const here = __dirname;
const gyms = JSON.parse(fs.readFileSync(path.join(here, 'gyms.json'), 'utf8'));
const page = fs.readFileSync(path.join(here, 'index.html'), 'utf8');
let n = 0;
for (const slug of Object.keys(gyms)) {
  if (slug.startsWith('_')) continue;
  if (!/^[a-z0-9-]{2,40}$/.test(slug)) throw new Error('bad slug: ' + slug);
  fs.mkdirSync(path.join(here, slug), { recursive: true });
  fs.writeFileSync(path.join(here, slug, 'index.html'), page);
  n++;
}
console.log(`rx: ${n} gym page(s) written`);
