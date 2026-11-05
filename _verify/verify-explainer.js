// Explainer page self-check: 390px + desktop, every link, every image, and the content rules
// Era set (no prices, no tiers, no "men", exactly one CTA, noindex).
//
// Nov 5 2026 — THIS HARNESS USED TO ASSUME A SERVER IT NEVER STARTED. It spawned Chrome and
// navigated to 127.0.0.1:8099, and with nothing listening it asserted against an error page:
// 11 failures that read exactly like page defects, including "noindex present" FAIL on a page
// whose bytes plainly contain noindex. It failed the same way before and after a rebase, so a
// before/after comparison looked clean while both numbers were worthless. It now starts its
// own server on an EPHEMERAL port, and refuses to run if that server cannot serve the page.
// Era's ruling 3: starts its own server, or fails loudly.
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
/* _verify/ sits at the repo root, so the repo is one level up. Derived rather than
   hardcoded: the old absolute path carried the account name into a file that may be
   served. */
const REPO = path.resolve(__dirname, '..');

const ROOT = REPO;
/* port 0 = let the OS pick a free one. A fixed port is how a stale server from an earlier run
   silently answers for the tree you think you are testing. */
let HTTP_PORT = 0;
let SRC = null;
const OUT = ROOT + '/operating-system/_proofs';
fs.mkdirSync(OUT, { recursive: true });
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9680 + (process.pid % 150);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ex-'));
const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run',
  '--no-default-browser-check', '--hide-scrollbars', '--force-device-scale-factor=1',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const say = (ok, label, extra) => { if (!ok) fails++; console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label + (extra ? '   ' + extra : '')); };

/* Serve the repo ourselves, on a port the OS hands us. */
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

(async () => {
  /* FAIL LOUDLY, not into a green run: if the page cannot be served there is nothing to
     assert on, and every content check below would "fail" for a reason that has nothing to
     do with the page. */
  await new Promise((res, rej) => {
    server.on('error', rej);
    server.listen(0, '127.0.0.1', () => { HTTP_PORT = server.address().port; res(); });
  });
  SRC = `http://127.0.0.1:${HTTP_PORT}/operating-system/`;
  const probe = await fetch(SRC).then(r => r.text()).catch(e => { throw new Error('own server unreachable: ' + e.message); });
  if (!/<\/html>/i.test(probe) || probe.length < 2000) {
    console.error('REFUSING TO RUN: ' + SRC + ' served ' + probe.length +
      ' bytes and does not look like the page. Nothing below would mean anything.');
    try { server.close(); chrome.kill(); } catch (_) {}
    process.exit(2);
  }
  console.log('serving ' + ROOT + ' on :' + HTTP_PORT + '  (' + probe.length + ' bytes for /operating-system/)');

  let t = null;
  for (let i = 0; i < 90 && !t; i++) {
    await sleep(200);
    try { t = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find(x => x.type === 'page'); } catch (e) {}
  }
  if (!t) { console.error('REFUSING TO RUN: Chrome never exposed a debuggable page on ' + PORT);
            try { server.close(); chrome.kill(); } catch (_) {} process.exit(2); }
  const ws = new globalThis.WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const p = new Map(); const errors = [];
  ws.onmessage = e => { const m = JSON.parse(e.data);
    if (m.id && p.has(m.id)) { p.get(m.id)(m); p.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text); };
  await new Promise(r => { ws.onopen = r; });
  const send = (m, q = {}) => new Promise(res => { const i = ++id; p.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: q })); });
  const js = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true })).result?.result?.value;
  await send('Page.enable'); await send('Runtime.enable');

  for (const [w, tag] of [[390, 'phone'], [1280, 'desktop']]) {
    console.log('\n' + tag + ' (' + w + 'px)');
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: w < 720 });
    await send('Page.navigate', { url: SRC });
    await js('window.scrollTo(0, document.body.scrollHeight)'); await sleep(900); await js('window.scrollTo(0,0)');
    for (let i = 0; i < 50; i++) { await sleep(200); if (await js('document.fonts.status==="loaded" && [...document.images].every(i=>i.complete)')) break; }
    await sleep(400);

    const r = await js(`(() => {
      const d = document.documentElement, b = document.body, txt = b.innerText;
      const low = txt.toLowerCase();
      const links = [...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href'));
      return {
        overflow: Math.max(d.scrollWidth, b.scrollWidth) > d.clientWidth + 1,
        scrollW: Math.max(d.scrollWidth, b.scrollWidth), clientW: d.clientWidth,
        imgsOk: [...document.images].every(i => i.naturalWidth > 0),
        imgCount: document.images.length,
        links,
        ctas: [...document.querySelectorAll('a.btn')].length,
        noindex: (document.querySelector('meta[name=robots]')||{}).content || '',
        hasMen: /\\bmen\\b/i.test(txt),
        hasPrice: /\\$\\s?\\d|\\bper month\\b|\\bmonthly\\b|\\btier\\b|\\bpricing\\b/i.test(txt),
        hasStreakWord: /\\bstreaks?\\b/i.test(low),
        govern: low.includes('higher level does not always mean doing more'),
        sections: document.querySelectorAll('section.s').length,
        h2s: [...document.querySelectorAll('h2')].map(h => h.textContent.trim()),
      };
    })()`);

    say(!r.overflow, 'no horizontal overflow', r.overflow ? r.scrollW + '>' + r.clientW : '');
    say(r.imgsOk && r.imgCount >= 3, 'every image loads', r.imgCount + ' images');
    say(r.sections === 6, 'six sections in order', r.h2s.join(' / '));
    say(r.ctas === 1, 'exactly one CTA button', r.ctas + ' found');
    say(/noindex/.test(r.noindex), 'noindex present', r.noindex);
    say(!r.hasMen, 'no "men"');
    say(!r.hasPrice, 'no prices or tiers');
    say(r.govern, 'governing line present');
    // "streak" is allowed here ONLY as the thing being rejected
    // 'streak' is banned outright - Edi's rules check and the Command Center spec both say so.
    // An earlier draft of mine used it as a contrast; that was wrong.
    say(!r.hasStreakWord, 'the word "streak" does not appear');

    if (tag === 'phone') {
      const links = r.links;
      console.log('  links on the page:');
      for (const href of [...new Set(links)]) {
        let verdict;
        if (href.startsWith('http')) verdict = 'external';
        else if (href === '/') verdict = fs.existsSync(ROOT + '/index.html') ? 'resolves' : 'MISSING';
        else if (href.startsWith('/')) verdict = fs.existsSync(ROOT + href + '/index.html') || fs.existsSync(ROOT + href) ? 'resolves' : 'MISSING';
        else verdict = fs.existsSync(ROOT + '/operating-system/' + href) ? 'resolves' : 'MISSING';
        if (verdict === 'MISSING') fails++;
        console.log('    ' + (verdict === 'MISSING' ? 'FAIL ' : 'ok   ') + href.padEnd(22) + verdict);
      }
      const h = await js('document.documentElement.scrollHeight');
      const sh = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true,
        clip: { x: 0, y: 0, width: 390, height: Math.min(h, 12000), scale: 1 } });
      fs.writeFileSync(path.join(OUT, 'explainer-phone.png'), Buffer.from(sh.result.data, 'base64'));
      console.log('  wrote _proofs/explainer-phone.png  (page is ' + h + 'px tall)');
    }
  }

  if (errors.length) { console.log('\nCONSOLE ERRORS:'); errors.slice(0,4).forEach(e => console.log('  ' + e)); fails += errors.length; }
  console.log('\n' + (fails ? fails + ' FAILED' : 'all checks passed'));
  ws.close(); chrome.kill(); server.close();
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e.message); try { chrome.kill(); } catch (_) {} try { server.close(); } catch (_) {} process.exit(1); });
