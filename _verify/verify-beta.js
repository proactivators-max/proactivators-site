// /beta — THE INSTALL SURFACE THIS REPO ACTUALLY SHIPS. Era's ruling 3, Nov 5 2026.
//
// WHY THIS FILE WAS REPLACED. The previous verify-beta read
// AIOS/web-and-funnels/beta-page/index.html — 18,166 bytes, no GA4 tag — and ran 56 checks
// against it. The page this repo deploys at /beta/ is 5,009 bytes, has the GA4 tag, and is a
// different thing entirely: a two-button chooser that delegates to /android and /iphone. It
// contains none of the four switches the old harness mutated (the APK URL, the TestFlight
// link, the Play link, the "Working today" sentence). So those 56 checks were real and proved
// nothing about what ships. The old file is kept beside this one as verify-beta-aios.js.
//
// WHAT CARRIES OVER IS THE INVARIANT, which was always the point of it:
//   "a path with nothing behind it NEVER draws a button, and the sentence agrees with the
//    buttons."
// On the shipped page the sentence is the .note line, and the buttons are /android and
// /iphone. That translates exactly, and it is what this file checks.
//
// NOT COVERED, DELIBERATELY: whether the TestFlight link and the APK URL are alive. Both are
// off-box, and this harness blocks everything that is not 127.0.0.1 — a suite that waits on
// the internet produces red that is indistinguishable from a finding. There is also a harder
// reason: a TestFlight public link DIES BEHIND AN HTTP 200, and the page never says whether
// it expired or was switched off. That is EX's call, not an inference this file may make.
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
/* _verify/ sits at the repo root, so the repo is one level up. Derived rather than
   hardcoded: the old absolute path carried the account name into a file that may be
   served. */
const REPO = path.resolve(__dirname, '..');

const ROOT = path.resolve(REPO);
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const CDP = 9770 + (process.pid % 150);     // not a fixed port: a stale listener answers silently
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0; const fails = [];
const ck = (ok, label, extra) => {
  if (ok) { pass++; console.log('  ok    ' + label + (extra ? '   ' + extra : '')); }
  else { fail++; fails.push(label); console.log('  FAIL  ' + label + (extra ? '   ' + extra : '')); }
};

const MIME = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
               '.svg': 'image/svg+xml', '.css': 'text/css', '.js': 'text/javascript',
               '.json': 'application/json; charset=utf-8', '.woff2': 'font/woff2' };

let seq = 0;
function rpc(ws, m, p, sid) {
  const id = ++seq;
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('timeout ' + m)), 30000);
    const on = e => { let x; try { x = JSON.parse(e.data); } catch (_) { return; }
      if (x.id !== id) return; clearTimeout(t); ws.removeEventListener('message', on);
      x.error ? rej(new Error(m + ': ' + x.error.message)) : res(x.result); };
    ws.addEventListener('message', on);
    ws.send(JSON.stringify(sid ? { id, method: m, params: p, sessionId: sid } : { id, method: m, params: p }));
  });
}

(async () => {
  const server = http.createServer((rq, rs) => {
    let p = decodeURIComponent(rq.url.split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    let f = path.resolve(ROOT, '.' + p);
    if (!fs.existsSync(f) && fs.existsSync(f + '/index.html')) f = f + '/index.html';
    if (f !== ROOT && !f.startsWith(ROOT + path.sep)) { rs.writeHead(403).end(); return; }
    fs.readFile(f, (e, b) => {
      if (e) { rs.writeHead(404).end(); return; }
      rs.writeHead(200, { 'content-type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream',
                          'cache-control': 'no-store' });
      rs.end(b);
    });
  });
  const HTTP_PORT = await new Promise((res, rej) => {
    server.on('error', rej);
    server.listen(0, '127.0.0.1', () => res(server.address().port));
  });
  const BASE = 'http://127.0.0.1:' + HTTP_PORT;

  /* fail loudly rather than assert against an error page */
  const probe = await fetch(BASE + '/beta/').then(r => r.text()).catch(() => '');
  if (!/<\/html>/i.test(probe) || probe.length < 1000) {
    console.error('REFUSING TO RUN: /beta/ served ' + probe.length + ' bytes. Nothing below would mean anything.');
    server.close(); process.exit(2);
  }
  console.log('serving ' + ROOT + ' on :' + HTTP_PORT + '   /beta/ is ' + probe.length + ' bytes\n');

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'beta-'));
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
    `--remote-debugging-port=${CDP}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  let bws = null;
  for (let i = 0; i < 120 && !bws; i++) { await sleep(250);
    try { bws = (await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json()).webSocketDebuggerUrl; } catch (e) {} }
  if (!bws) { chrome.kill(); server.close(); console.error('REFUSING TO RUN: Chrome never came up'); process.exit(2); }
  const ws = new WebSocket(bws);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = () => j(new Error('ws failed')); });
  const { browserContextId } = await rpc(ws, 'Target.createBrowserContext', { disposeOnDetach: false });

  async function read(p, w) {
    const { targetId } = await rpc(ws, 'Target.createTarget', { url: 'about:blank', browserContextId });
    const { sessionId } = await rpc(ws, 'Target.attachToTarget', { targetId, flatten: true });
    const S = (m, q) => rpc(ws, m, q, sessionId);
    ws.addEventListener('message', async ev => {
      let m; try { m = JSON.parse(ev.data); } catch (_) { return; }
      if (m.sessionId !== sessionId || m.method !== 'Fetch.requestPaused') return;
      const same = m.params.request.url.startsWith(BASE);
      try { same ? await S('Fetch.continueRequest', { requestId: m.params.requestId })
                 : await S('Fetch.failRequest', { requestId: m.params.requestId, errorReason: 'BlockedByClient' }); } catch (e) {}
    });
    await S('Page.enable'); await S('Runtime.enable'); await S('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
    await S('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: w < 700 });
    await S('Page.navigate', { url: BASE + p });
    for (let k = 0; k < 90; k++) { await sleep(150);
      const r = (await S('Runtime.evaluate', { returnByValue: true, expression:
        `document.readyState !== 'loading' && !!document.body && document.body.innerText.trim().length > 40` })).result.value;
      if (r) break; }
    const d = (await S('Runtime.evaluate', { returnByValue: true, expression:
      `(function(){
         function vis(e){ var r=e.getBoundingClientRect(); if(r.width<1||r.height<1) return false;
           var s=getComputedStyle(e); return s.display!=='none' && s.visibility!=='hidden'; }
         return { text:(document.body.innerText||'').replace(/\\s+/g,' ').trim(),
           buttons: [].slice.call(document.querySelectorAll('a[href]')).filter(vis)
                      .map(function(a){ return { t:(a.innerText||'').replace(/\\s+/g,' ').trim(), href:a.getAttribute('href') }; })
                      .filter(function(o){ return o.t.length>0; }),
           overflow: document.documentElement.scrollWidth > window.innerWidth + 1 };
       }())` })).result.value;
    await rpc(ws, 'Target.closeTarget', { targetId });
    return d;
  }

  /* does a local href have a real page behind it, in the repo, on disk? */
  const resolves = href => {
    if (!href.startsWith('/')) return null;
    const p = href.split('?')[0].split('#')[0];
    return fs.existsSync(path.join(ROOT, p)) || fs.existsSync(path.join(ROOT, p, 'index.html'))
        || fs.existsSync(path.join(ROOT, p + '.html'));
  };

  for (const w of [390, 1280]) {
    console.log('\n/beta/  @' + w + 'px');
    const d = await read('/beta/', w);
    ck(!d.overflow, 'no horizontal overflow');
    const local = d.buttons.filter(b => b.href.startsWith('/'));
    ck(local.length >= 2, 'the chooser draws its install buttons', local.map(b => b.t + '→' + b.href).join(' | '));

    /* THE INVARIANT: no button may point at a path with nothing behind it. */
    for (const b of local) ck(resolves(b.href) === true, 'button "' + b.t + '" leads somewhere real', b.href);

    /* THE SENTENCE AGREES WITH THE BUTTONS. The .note makes per-platform state claims; each
       must match what the page behind that button actually offers. */
    /* case-insensitive on purpose: innerText reflects CSS text-transform, and this line is
       rendered uppercase, so a case-sensitive extract came back empty and printed an empty
       quote in the failure message while the detection below worked fine. */
    const note = (d.text.match(/free[^]{0,160}/i) || [''])[0];
    const saysIphoneLive  = /iphone is live/i.test(d.text);
    const saysAndroidWip  = /android[^.]{0,40}(being refreshed|coming|not yet|refresh)/i.test(d.text);

    const android = fs.readFileSync(path.join(ROOT, 'android/index.html'), 'utf8');
    const iphone  = fs.readFileSync(path.join(ROOT, 'iphone/index.html'), 'utf8');
    const androidHasApk = /releases\.proactivatorsclub\.com\/[^"']+\.apk/.test(android);
    const androidSaysPermanent = /never expires/i.test(android);
    const iphoneHasTf = /testflight\.apple\.com\/join\//.test(iphone);

    ck(iphoneHasTf, '/iphone offers a TestFlight route at all');
    ck(androidHasApk, '/android offers an APK route at all');
    ck(!saysIphoneLive || iphoneHasTf,
       'the note claims iPhone is live AND /iphone offers a route', 'claim=' + saysIphoneLive + ' route=' + iphoneHasTf);
    /* the one that catches the drift: the note cannot call Android unfinished while the page
       behind the Android button says its link is permanent. */
    ck(!(saysAndroidWip && androidSaysPermanent),
       'the note does not call Android unfinished while /android says the link is permanent',
       saysAndroidWip && androidSaysPermanent
         ? 'note: "' + note.slice(0, 90) + '"  vs  /android: "This link never expires"'
         : '');
  }

  ws.close(); chrome.kill(); server.close();
  try { require('node:child_process').execSync('taskkill /F /T /PID ' + chrome.pid, { stdio: 'ignore' }); } catch (e) {}
  console.log('\n' + pass + ' checks passed, ' + fail + ' failed');
  if (fail) console.log('FAILED:\n' + fails.map(f => ' - ' + f).join('\n'));
  console.log('NOT COVERED: remote liveness of the TestFlight link and the APK URL — off-box, and a dead TestFlight link returns HTTP 200. EX owns that.');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('VERIFY FAILED: ' + e.message); process.exit(1); });
