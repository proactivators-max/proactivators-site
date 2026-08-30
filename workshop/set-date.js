// Roll the workshop pages to the next date.
//
//   node workshop/set-date.js 2026-09-26
//
// The workshop runs the LAST Saturday of every month, so this is a monthly
// chore. The date lived in ~14 hand-maintained places across three files —
// visible copy, the meta description, the OG and Twitter cards, the
// Schema.org startDate/endDate that Google reads, the RSVP payload, and the
// confirmation message. Miss one and the page advertises an event that
// already happened while Google still lists the old one.
//
// This script changes all of them at once and REFUSES to write if any
// expected pattern is missing, so a silent partial update is impossible.
//
// (The Boardroom is the FIRST Saturday and lives in /boardroom — different
// event, different cadence. This script does not touch it.)
const fs = require('fs');
const path = require('path');

const ISO = process.argv[2];
if (!/^\d{4}-\d{2}-\d{2}$/.test(ISO || '')) {
  console.error('usage: node workshop/set-date.js YYYY-MM-DD   (e.g. 2026-09-26)');
  process.exit(1);
}
const [Y, M, D] = ISO.split('-').map(Number);
const dt = new Date(Date.UTC(Y, M - 1, D));
if (dt.getUTCDay() !== 6) {
  console.error('refusing: ' + ISO + ' is not a Saturday. The workshop is always a Saturday.');
  process.exit(1);
}

const MONTH_LONG = ['January','February','March','April','May','June','July',
                    'August','September','October','November','December'][M - 1];
// the short forms actually used in the copy: "Aug 29", "Sept 26"
const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul',
                     'Aug','Sept','Oct','Nov','Dec'][M - 1];

const ROOT = path.join(__dirname, '..');
const LIVE = path.join(ROOT, 'workshop/live/index.html');
const STAMPED = [path.join(ROOT, 'workshop/prepare/index.html'),
                 path.join(ROOT, 'workshop/feedback/index.html')];

// every place the date appears, as [regex, replacement]. Each MUST match.
const RULES = [
  [/Saturday (?:January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}/g,
   'Saturday ' + MONTH_LONG + ' ' + D],
  [/Saturday, (?:January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}/g,
   'Saturday, ' + MONTH_LONG + ' ' + D],
  [/Sat, (?:January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}/g,
   'Sat, ' + MONTH_LONG + ' ' + D],
  [/Sat, (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec) \d{1,2}/g,
   'Sat, ' + MONTH_SHORT + ' ' + D],
  [/Sat (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec) \d{1,2} \d{4}/g,
   'Sat ' + MONTH_SHORT + ' ' + D + ' ' + Y],
  [/Free, (?:Sat|Saturday) (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec) \d{1,2}/g,
   'Free, Sat ' + MONTH_SHORT + ' ' + D],
  [/"startDate": "\d{4}-\d{2}-\d{2}T/g, '"startDate": "' + ISO + 'T'],
  [/"endDate": "\d{4}-\d{2}-\d{2}T/g, '"endDate": "' + ISO + 'T'],
];

// the "Workshop:" stamp written onto every intake / feedback submission
const STAMP = /'Workshop': '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec) \d{1,2} \d{4}/g;
const STAMP_NEW = "'Workshop': '" + MONTH_SHORT + ' ' + D + ' ' + Y;

function apply(file, rules, required) {
  let s = fs.readFileSync(file, 'utf8');
  const before = s;
  const missed = [];
  for (const [re, to] of rules) {
    re.lastIndex = 0;
    if (!re.test(s)) { missed.push(String(re)); continue; }
    re.lastIndex = 0;
    s = s.replace(re, to);
  }
  if (required && missed.length) {
    console.error('REFUSING to write ' + path.basename(path.dirname(file)) + ' — these never matched:');
    missed.forEach(m => console.error('   ' + m));
    process.exit(1);
  }
  fs.writeFileSync(file, s);
  return before !== s;
}

apply(LIVE, RULES, true);
STAMPED.forEach(f => apply(f, [[STAMP, STAMP_NEW]], true));

/* ---------- guard: no trace of any OTHER date may survive ---------- */
// Strip HTML comments wholesale before checking. Comments carry ISO examples
// that are not the event date, and filtering only lines that START with "<!--"
// misses the continuation lines of a multi-line comment.
const check = fs.readFileSync(LIVE, 'utf8')
  .replace(/<!--[\s\S]*?-->/g, '')
  .split('\n').filter(l => !l.includes('validFrom'));
const strays = [];
const MONTHS = 'January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec';
check.forEach((l, i) => {
  const m = l.match(new RegExp('(?:' + MONTHS + ')\\s+\\d{1,2}', 'g')) || [];
  m.forEach(hit => {
    if (hit !== MONTH_LONG + ' ' + D && hit !== MONTH_SHORT + ' ' + D) strays.push('line ' + (i + 1) + ': ' + hit);
  });
  const iso = l.match(/\d{4}-\d{2}-\d{2}/g) || [];
  iso.forEach(hit => { if (hit !== ISO) strays.push('line ' + (i + 1) + ': ' + hit); });
});
if (strays.length) {
  console.error('\nWARNING — a different date still appears in /workshop/live:');
  strays.forEach(s => console.error('   ' + s));
  console.error('Fix by hand, or add a rule above.\n');
  process.exit(1);
}

console.log('workshop date set to ' + MONTH_LONG + ' ' + D + ', ' + Y + ' (Saturday)');
console.log('  updated: /workshop/live, /workshop/prepare, /workshop/feedback');
console.log('  Schema.org startDate/endDate now ' + ISO);
