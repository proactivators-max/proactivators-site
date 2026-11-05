/* /launch/ in its happened state, rendered from disk. The question is not "did my edits apply"
   — it is "does a stranger landing here today read a TRUE page". So this reads the rendered text
   and hunts for anything still phrased as a future: a control that invites a reservation, a
   capacity claim, a countdown. Hermetic: nothing off-box, wait on readyState, never on a sleep. */
const http = require('node:http'), { spawn } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
/* _verify/ sits at the repo root, so the repo is one level up. Derived rather than
   hardcoded: the old absolute path carried the account name into a file that may be
   served. */
const REPO = path.resolve(__dirname, '..');
const SITE = REPO;
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = Number(process.env.VL_PORT || 11001), HTTP = Number(process.env.VL_HTTP || 9501);
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const fails = [];
const ck = (n, c, d) => { if (c) { pass++; console.log('  ok   ' + n); }
  else { fail++; fails.push(n); console.log('  FAIL ' + n + (d !== undefined ? '   got: ' + String(d).slice(0, 240) : '')); } };

let seq = 0;
function rpc(ws, m, p, sid) { const id = ++seq;
  return new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout ' + m)), 25000);
    const on = e => { let x; try { x = JSON.parse(e.data); } catch (_) { return; }
      if (x.id !== id) return; clearTimeout(t); ws.removeEventListener('message', on);
      x.error ? rej(new Error(m + ': ' + x.error.message)) : res(x.result); };
    ws.addEventListener('message', on);
    ws.send(JSON.stringify(sid ? { id, method: m, params: p, sessionId: sid } : { id, method: m, params: p })); }); }

(async () => {
  const T = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
              '.json': 'application/json; charset=utf-8' };
  const ROOT = path.resolve(SITE);
  const srv = http.createServer((rq, rs) => { let p = decodeURIComponent(rq.url.split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    const f = path.resolve(ROOT, '.' + p);
    if (f !== ROOT && !f.startsWith(ROOT + path.sep)) { rs.writeHead(403).end(); return; }
    fs.readFile(f, (e, b) => { if (e) { rs.writeHead(404).end(); return; }
      rs.writeHead(200, { 'content-type': T[path.extname(f).toLowerCase()] || 'application/octet-stream',
                          'cache-control': 'no-store' }); rs.end(b); }); });
  await new Promise(r => srv.listen(HTTP, '127.0.0.1', r));

  /* REFUSE TO RUN rather than assert against an error page. A harness that cannot serve the
     page under test produces failures that read exactly like page defects -- verify-explainer
     did that for weeks, reporting "noindex present" FAIL on a page whose bytes plainly
     contain noindex. Exit 2 is "this run is void", which is not the same as red. */
  {
    const _probe = await fetch('http://127.0.0.1:' + HTTP + '/launch/').then(r => r.text()).catch(() => '');
    if (!/<\/html>/i.test(_probe) || _probe.length < 800) {
      console.error('REFUSING TO RUN: /launch/ served ' + _probe.length + ' bytes and is not the page. Nothing below would mean anything.');
      try { srv.close(); } catch (_) {}
      process.exit(2);
    }
  }
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'vl-'));
  const ch = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${prof}`, 'about:blank'], { stdio: 'ignore' });
  let bws = null;
  for (let i = 0; i < 120 && !bws; i++) { await sleep(250);
    try { bws = (await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()).webSocketDebuggerUrl; } catch (e) {} }
  if (!bws) { ch.kill(); srv.close(); throw new Error('chrome never came up'); }
  const ws = new WebSocket(bws);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = () => j(new Error('ws failed')); });
  const { browserContextId } = await rpc(ws, 'Target.createBrowserContext', { disposeOnDetach: false });
  const { targetId } = await rpc(ws, 'Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await rpc(ws, 'Target.attachToTarget', { targetId, flatten: true });
  const S = (m, q) => rpc(ws, m, q, sessionId);
  const leaked = [];
  ws.addEventListener('message', async ev => { let m; try { m = JSON.parse(ev.data); } catch (_) { return; }
    if (m.sessionId !== sessionId || m.method !== 'Fetch.requestPaused') return;
    const r = m.params.request;
    const same = r.url.startsWith(`http://127.0.0.1:${HTTP}`);
    if (!same && /\.netlify\/functions\//.test(r.url)) leaked.push(r.method + ' ' + r.url);
    try { same ? await S('Fetch.continueRequest', { requestId: m.params.requestId })
               : await S('Fetch.failRequest', { requestId: m.params.requestId, errorReason: 'BlockedByClient' }); } catch (e) {} });

  await S('Page.enable'); await S('Runtime.enable'); await S('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  await S('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await S('Page.navigate', { url: `http://127.0.0.1:${HTTP}/launch/` });
  let ready = false;
  for (let w = 0; w < 60 && !ready; w++) { await sleep(150);
    ready = (await S('Runtime.evaluate', { returnByValue: true, expression:
      `document.readyState!=='loading' && !!document.getElementById('rsvp-past')` })).result.value; }
  ck('the page reached a usable state', ready);
  await sleep(600);

  const d = (await S('Runtime.evaluate', { returnByValue: true, expression:
    `(function(){
       function vis(e){ if(!e) return false; var r=e.getBoundingClientRect();
         if(r.width<1||r.height<1) return false; var s=getComputedStyle(e);
         return s.display!=='none'&&s.visibility!=='hidden'; }
       var f=document.getElementById('rsvp-form');
       return { title:document.title,
         robots:(document.querySelector('meta[name=robots]')||{}).content||'',
         desc:(document.querySelector('meta[name=description]')||{}).content||'',
         ogdesc:(document.querySelector('meta[property="og:description"]')||{}).content||'',
         text:(document.body.innerText||'').replace(/\\s+/g,' ').trim(),
         formVisible: vis(f),
         fieldsVisible: f ? [].slice.call(f.querySelectorAll('input,select,textarea')).filter(vis).length : -1,
         pastVisible: vis(document.getElementById('rsvp-past')),
         countdown: (document.getElementById('countdown')||{}).innerText||'',
         buttons: [].slice.call(document.querySelectorAll('a,button')).filter(vis)
                    .map(function(b){ return (b.innerText||'').replace(/\\s+/g,' ').trim(); }).filter(Boolean),
         hrefs: [].slice.call(document.querySelectorAll('a[href]')).filter(vis)
                   .map(function(a){ return a.getAttribute('href'); }) };
     }())` })).result.value;

  const has = (h, n) => h.toLowerCase().includes(n.toLowerCase());

  ck('A noindex is set', /noindex/i.test(d.robots), d.robots);
  ck('A the title no longer sells an upcoming event',
     !/reserve|rsvp|free rsvp/i.test(d.title), d.title);
  ck('A the description is past tense and names no capacity',
     !/reserve|rsvp|limited capacity/i.test(d.desc), d.desc);
  ck('A the og:description likewise', !/reserve|rsvp|limited capacity/i.test(d.ogdesc), d.ogdesc);

  ck('B the RSVP form is not on screen', d.formVisible === false, String(d.formVisible));
  ck('B not one field can be filled', d.fieldsVisible === 0, String(d.fieldsVisible));
  ck('B the record of the night is what stands there instead', d.pastVisible === true);
  ck('B nothing on the page reached the rsvp endpoint', leaked.length === 0, JSON.stringify(leaked));

  ck('C the countdown states the night instead of counting to it',
     has(d.countdown, 'This happened') && !has(d.countdown, 'event is live'), d.countdown);
  ck('C no visible control invites a reservation',
     !d.buttons.some(b => /reserve|rsvp/i.test(b)), JSON.stringify(d.buttons.filter(b => /reserve|rsvp/i.test(b))));
  ck('C the page still points at the book', d.buttons.some(b => /get the book/i.test(b)), JSON.stringify(d.buttons));

  /* what Gabriel built has to still be here */
  ck('D the record of the night is still told',
     has(d.text, '100') && has(d.text, 'May 3'), d.text.slice(0, 160));
  ck('D the book section survived', has(d.text, 'Unleash the ProActivator'));
  ck('D the venue and the detail survived', has(d.text, 'Graham Center'));

  /* anything still phrased as a future, anywhere in the visible text */
  const FUTURE = [/\breserve your spot\b/i, /\brsvp required\b/i, /\blimited capacity\b/i,
                  /\bthe event is live\b/i, /\byou're invited\b/i, /\bspot confirmed instantly\b/i,
                  /\bwhat to expect\b/i, /\bdrops on a single day\b/i,
                  /\bremind me may 3\b/i, /available\s+may 3, 2026/i];
  const stillFuture = FUTURE.filter(rx => rx.test(d.text)).map(rx => (d.text.match(rx) || [''])[0]);
  ck('E no sentence on screen still promises a future', stillFuture.length === 0, JSON.stringify(stillFuture));

  /* The calendar button was the one dead control a visitor would really have pressed: it
     opened a Google Calendar template dated 20260503, and it still worked. No label check
     would ever have seen it — the label read fine. */
  const cal = d.hrefs.filter(h => /calendar.google.com/i.test(h));
  ck('F no control files a reminder into a week that is gone', cal.length === 0, JSON.stringify(cal));
  ck('F the availability block says the book is out now',
     /available\s+now/i.test(d.text), (d.text.match(/available[\s\S]{0,40}/i) || [''])[0]);

  ws.close(); srv.close();
  try { require('node:child_process').execSync('taskkill /F /T /PID ' + ch.pid, { stdio: 'ignore' }); }
  catch (e) { try { ch.kill(); } catch (_) {} }
  console.log('\n' + pass + ' checks passed, ' + fail + ' failed');
  if (fail) console.log('FAILED: ' + JSON.stringify(fails, null, 1));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('VERIFY FAILED: ' + e.message); process.exit(1); });
