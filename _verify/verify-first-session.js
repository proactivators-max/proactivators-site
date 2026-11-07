/* /first-session/ — the one-on-one intake. Guards the two halves separately, because they
   deploy separately and either one failing alone makes the form silently useless:

     PART A (no browser)  the REAL netlify/functions/inquire.js handler accepts
                          type:'coaching-intake'. If that key is missing the handler returns
                          400 "Invalid type" and the page shows "Did not go through" — a page
                          that looks perfect and cannot submit. GitHub Pages and the Netlify
                          form-backend are two deploys; this is the half that gets forgotten.
     PART B (browser)     the page itself: the six questions, the chips, GA4, 390px, the
                          submit payload, and the absence of every workshop-ism.

   NOTHING LEAVES THIS PROCESS AND NO CRM RECORD IS CREATED. Part A stubs globalThis.fetch
   before loading the handler; Part B stubs window.fetch in the page before submitting, and
   Chrome blocks everything that is not 127.0.0.1 on top of that.

   Exit 2 (void, NOT red) if it cannot serve the page or Chrome never comes up. */

const { spawn, execFileSync } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');

const REPO = path.resolve(__dirname, '..');
const ROOT = REPO;
const PAGE = '/first-session/';
const ID = 'G-CNQ4P8TJC6';

/* Part A replaces globalThis.fetch. Part B needs the real one to talk to Chrome's debug
   endpoint, so keep a handle BEFORE stubbing — forgetting this makes Part B hang forever. */
const realFetch = globalThis.fetch.bind(globalThis);

let pass = 0, fail = 0; const failed = [];
const ck = (ok, label, extra) => {
  if (ok) { pass++; console.log('  ok    ' + label + (extra !== undefined ? '   ' + extra : '')); }
  else { fail++; failed.push(label); console.log('  FAIL  ' + label + (extra !== undefined ? '   ' + extra : '')); }
};

/* ================= PART A — the backend half ================= */
process.env.GHL_API_KEY = 'PLACEHOLDER-NOT-A-KEY-STUBBED-FETCH';
const sent = [];
globalThis.fetch = async (url, opts = {}) => {
  sent.push({ url: String(url), body: opts.body ? JSON.parse(opts.body) : null });
  if (String(url).includes('/notes')) return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' };
  return { ok: true, status: 200, json: async () => ({ contact: { id: 'STUB_CONTACT_ID' } }),
           text: async () => JSON.stringify({ contact: { id: 'STUB_CONTACT_ID' } }) };
};
const { handler } = require(path.join(ROOT, 'netlify/functions/inquire.js'));

async function partA() {
  console.log('\n===== PART A — inquire.js accepts coaching-intake (stubbed, no CRM record) =====');
  sent.length = 0;
  /* The handler drops a wrong Origin behind a SILENT FAKE 200 {success:true}. Without the real
     Origin every negative assertion below would pass on a dead probe. */
  const res = await handler({
    httpMethod: 'POST',
    headers: { origin: 'https://proactivatorsclub.com' },
    body: JSON.stringify({
      type: 'coaching-intake', name: 'Proof Run', email: 'proof@example.com', phone: '3055550100',
      fields: {
        'Pillar drifting most': 'Finances',
        'THE ONE THING keeping them stuck': 'I start and stop.',
        'Sounds most like me (P-read)': 'B - grinding without a clear plan',
        'Already tried / why it stopped': 'An app. Quit in three weeks.',
        'Book / podcast': 'Read the book',
        'Anything else': '',
      },
    }),
  });

  /* VOID, not green: a dropped request makes every "no junk tag" check pass for free. */
  if (sent.length === 0) {
    console.error('REFUSING TO RUN: the handler made NO outbound call for coaching-intake. ' +
      'It was dropped (invalid type, origin, or a guard), so the checks below would pass for ' +
      'the wrong reason. Response: ' + JSON.stringify(res));
    process.exit(2);
  }

  const create = sent.find(s => !s.url.includes('/notes'));
  const note = sent.find(s => s.url.includes('/notes'));
  const tags = (create && create.body && create.body.tags) || [];
  const noteText = note && note.body ? String(note.body.body || '') : '';

  ck(res.statusCode === 200, 'the handler returns 200, not 400 "Invalid type"', 'status ' + res.statusCode);
  ck(tags.includes('coaching_intake'), 'tagged coaching_intake', JSON.stringify(tags));
  ck(tags.includes('website'), 'keeps the website tag');
  ck(!tags.some(t => t === undefined || t === null || t === '' || String(t) === 'undefined'),
    'no undefined or blank tag reached the CRM', JSON.stringify(tags));
  ck(!tags.some(t => /workshop|rx_|emw_|seat/i.test(String(t))),
    'NOT tagged as a workshop or an event', JSON.stringify(tags));
  ck(/ONE-ON-ONE/.test(noteText), 'the note heading says ONE-ON-ONE', (noteText.split('\n')[0] || '').slice(0, 60));
  ck(!/saturday|lunch|allerg|venue|seat/i.test(noteText), 'the note carries no event language');
  ck(/Already tried/i.test(noteText), 'the Revolving Door answer made it into the note');
  ck(/THE ONE THING/i.test(noteText), 'the one-thing answer made it into the note');
  ck(create.body.phone === '+13055550100', 'phone normalized to E.164', String(create.body.phone));
  ck(!/none|^$/i.test(String(create.body.phone)), 'phone is not a literal "none"');
}

/* ================= PART B — the page half ================= */
const MIME = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
               '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
               '.json': 'application/json; charset=utf-8', '.css': 'text/css',
               '.js': 'text/javascript', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
const server = http.createServer((rq, rs) => {
  let p = decodeURIComponent(rq.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.resolve(ROOT, '.' + p);
  if (f !== path.resolve(ROOT) && !f.startsWith(path.resolve(ROOT) + path.sep)) { rs.writeHead(403).end(); return; }
  fs.readFile(f, (e, b) => {
    if (e) { rs.writeHead(404).end(); return; }
    rs.writeHead(200, { 'content-type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream',
                        'cache-control': 'no-store' });
    rs.end(b);
  });
});
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const DPORT = 9760 + (process.pid % 150);
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  await partA();

  globalThis.fetch = realFetch;   /* Part A's stub must not reach Chrome's debug endpoint */

  await new Promise((res, rej) => { server.on('error', rej); server.listen(0, '127.0.0.1', () => res()); });
  const BASE = 'http://127.0.0.1:' + server.address().port;
  const SRC = BASE + PAGE;

  const probe = await realFetch(SRC).then(r => r.text()).catch(e => { throw new Error('own server unreachable: ' + e.message); });
  if (!/<\/html>/i.test(probe) || probe.length < 3000) {
    console.error('REFUSING TO RUN: ' + SRC + ' served ' + probe.length + ' bytes and is not the page.');
    try { server.close(); } catch (_) {} process.exit(2);
  }
  console.log('\n===== PART B — the page (' + probe.length + ' bytes) =====');

  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'fs1-'));
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run',
    '--no-default-browser-check', '--hide-scrollbars', '--force-device-scale-factor=1',
    '--remote-debugging-port=' + DPORT, '--user-data-dir=' + prof, 'about:blank'], { stdio: 'ignore' });
  const die = (code, m) => { console.error(m); try { server.close(); } catch (_) {} try { chrome.kill(); } catch (_) {} process.exit(code); };

  let target = null;
  for (let i = 0; i < 120 && !target; i++) {
    await sleep(200);
    try { target = (await (await realFetch('http://127.0.0.1:' + DPORT + '/json/list')).json()).find(x => x.type === 'page'); } catch (e) {}
  }
  if (!target) die(2, 'REFUSING TO RUN: Chrome never exposed a debuggable page on ' + DPORT);

  const ws = new globalThis.WebSocket(target.webSocketDebuggerUrl);
  let id = 0; const pend = new Map(); let offBox = 0;
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; }
    if (m.method === 'Fetch.requestPaused') {
      const u = m.params.request.url;
      const on = u.startsWith(BASE) || u.startsWith('http://127.0.0.1:') || u.startsWith('about:') || u.startsWith('data:');
      if (!on) { offBox++; send('Fetch.failRequest', { requestId: m.params.requestId, errorReason: 'BlockedByClient' }); }
      else send('Fetch.continueRequest', { requestId: m.params.requestId });
    }
  };
  await new Promise(r => { ws.onopen = r; });
  const js = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;
  await send('Page.enable'); await send('Runtime.enable');
  await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });

  for (const [w, tag] of [[390, 'phone'], [1280, 'desktop']]) {
    console.log('\n' + tag + ' (' + w + 'px)');
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: w < 720 });
    await send('Page.navigate', { url: SRC });
    for (let i = 0; i < 60; i++) { await sleep(100); if (await js("document.readyState !== 'loading' && !!document.getElementById('pf')")) break; }
    await sleep(150);

    const r = await js(`(() => {
      const t = document.body.innerText, low = t.toLowerCase();
      const d = document.documentElement, b = document.body;
      return {
        qs: [...document.querySelectorAll('.q-n')].map(e => e.textContent.trim()),
        overflow: Math.max(d.scrollWidth, b.scrollWidth) > d.clientWidth + 1,
        loaders: [...document.querySelectorAll('script[src*="googletagmanager"]')].length,
        cfg: [...(window.dataLayer||[])].map(a=>[...a]).filter(e=>e[0]==='config').length,
        noindex: (document.querySelector('meta[name=robots]')||{}).content || '',
        saturday: /saturday/i.test(t), lunch: /lunch/i.test(t), allerg: /allerg/i.test(t),
        yourSeat: /your seat/i.test(t), revolving: /what made it stop/i.test(t),
        oneThing: /keeping you stuck/i.test(t),
        doneHidden: getComputedStyle(document.getElementById('done')).display === 'none',
        formVisible: getComputedStyle(document.getElementById('pf')).display !== 'none',
        logoImg: !!document.querySelector('img.logo'),
        logoTyped: /PROACTIVATORS/.test(t),
        emailRequired: document.getElementById('em').required,
        hpEmpty: document.querySelector('[name=proactivators_hp_check]').value === '',
        title: document.title,
      };
    })()`);

    ck(r.qs.join(',') === '01,02,03,04,05,06,07', 'seven numbered blocks, six questions plus who', r.qs.join(','));
    ck(!r.overflow, 'no horizontal overflow');
    ck(r.loaders === 1 && r.cfg === 1, 'exactly one GA4 tag, firing once', 'loader=' + r.loaders + ' config=' + r.cfg);
    ck(/noindex/.test(r.noindex), 'noindex present', r.noindex);
    ck(!r.saturday, 'the word "Saturday" is gone');
    ck(!r.lunch && !r.allerg, 'no lunch or allergy question');
    ck(!r.yourSeat, 'nothing about "your seat"');
    ck(r.revolving, 'the Revolving Door question is there ("what made it stop")');
    ck(r.oneThing, 'the one-thing question survived verbatim');
    ck(r.doneHidden && r.formVisible, 'at rest: the form shows, the thank-you is hidden');
    ck(r.logoImg && !r.logoTyped, 'the wordmark is the IMAGE, never typed');
    ck(r.emailRequired, 'email is required');
    ck(r.hpEmpty, 'the honeypot starts empty (a probe must never type in it)');

    /* chips must be single-select */
    const chip = await js(`(() => {
      const g = document.querySelector('[data-group="q1"]');
      g.querySelectorAll('.chip')[0].click();
      g.querySelectorAll('.chip')[3].click();
      return { on: g.querySelectorAll('.chip.on').length, v: (g.querySelector('.chip.on')||{}).textContent };
    })()`);
    ck(chip.on === 1 && /Finances/.test(chip.v || ''), 'tapping a second pillar replaces the first', chip.on + ' on, "' + chip.v + '"');

    /* submit with window.fetch stubbed in the page: captures the payload, nothing leaves */
    const sub = await js(`(async () => {
      window.__sent = null;
      window.fetch = (u, o) => { window.__sent = { url: String(u), body: JSON.parse(o.body) };
                                 return Promise.resolve({ ok: true }); };
      document.getElementById('q2').value = 'I start and stop.';
      document.getElementById('q4').value = 'An app. Quit in three weeks.';
      document.getElementById('nm').value = 'Proof Run';
      document.getElementById('em').value = 'proof@example.com';
      document.getElementById('ph').value = '3055550100';
      document.getElementById('go').click();
      await new Promise(r => setTimeout(r, 300));
      const s = window.__sent;
      return s ? { url: s.url, type: s.body.type, keys: Object.keys(s.body.fields),
                   hp: s.body.hp, phone: s.body.phone, email: s.body.email,
                   doneShown: getComputedStyle(document.getElementById('done')).display !== 'none',
                   formHidden: getComputedStyle(document.getElementById('pf')).display === 'none' }
                 : null;
    })()`);

    ck(!!sub, 'the submit handler fired and built a payload');
    if (sub) {
      ck(sub.type === 'coaching-intake', 'posts type coaching-intake', sub.type);
      ck(/\/inquire$/.test(sub.url), 'posts to the inquire function', sub.url.replace(/^https?:\/\//, '').slice(0, 55));
      ck(sub.keys.length === 6, 'six answer fields in the payload', sub.keys.length + ': ' + sub.keys.join(' | '));
      ck(sub.keys.some(k => /Already tried/.test(k)), 'the Revolving Door answer is in the payload');
      ck(!sub.keys.some(k => /Workshop|Food|allerg/i.test(k)), 'no Workshop or Food field rides along', sub.keys.join(','));
      ck(sub.hp === '', 'the honeypot went out empty');
      ck(sub.doneShown && sub.formHidden, 'on success the thank-you replaces the form');
    }
  }

  ck(offBox > 0, 'hermetic: off-box requests were blocked', offBox + ' blocked');

  console.log('\n' + pass + ' checks passed, ' + fail + ' failed');
  if (fail) { console.log('FAILED:'); for (const f of failed) console.log(' - ' + f); }
  console.log('\nNO CRM RECORD WAS CREATED: Part A stubbed the handler\'s fetch, Part B stubbed the page\'s.');
  console.log('NOT COVERED: whether the Netlify function has actually been DEPLOYED with the new');
  console.log('  coaching-intake key. Part A proves the code in this repo accepts it; only a deploy');
  console.log('  makes the live endpoint accept it. Two deploys, and this is the one that gets missed.');

  try { server.close(); } catch (_) {}
  try { chrome.kill(); } catch (_) {}
  try { execFileSync('taskkill', ['/F', '/T', '/PID', String(chrome.pid)], { stdio: 'ignore' }); } catch (_) {}
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR: ' + e.stack); process.exit(2); });
