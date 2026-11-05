/* The postponed suite is a wall of NEGATIVE assertions: "nothing says $197", "no control
   takes money". Those all pass on a page that failed to render at all — which is the exact
   way a negative check lies. And I just put code in the nodate branch that REMOVES a cell
   from the DOM, so the thing I have to prove is the opposite of what that suite proves:
   with a real date in session.json, the selling state must still be whole.

   If this suite goes green, the postponed suite's silence means something. If it goes red,
   the postponed 58/58 was measuring a broken page. */
const http = require('node:http'), { spawn } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
/* _verify/ sits at the repo root, so the repo is one level up. Derived rather than
   hardcoded: the old absolute path carried the account name into a file that may be
   served. */
const REPO = path.resolve(__dirname, '..');

const SITE = REPO;
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = Number(process.env.VS_PORT || 12701), HTTP = Number(process.env.VS_HTTP || 9981);
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0; const fails = [];
const ck = (n, c, d) => {
  if (c) { pass++; console.log('  ok   ' + n); }
  else { fail++; fails.push(n); console.log('  FAIL ' + n + (d !== undefined ? '\n         got: ' + String(d).slice(0, 300) : '')); }
};

let seq = 0;
function rpc(ws, m, p, sid) {
  const id = ++seq;
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('timeout ' + m)), 30000);
    const on = e => {
      let x; try { x = JSON.parse(e.data); } catch (_) { return; }
      if (x.id !== id) return;
      clearTimeout(t); ws.removeEventListener('message', on);
      x.error ? rej(new Error(m + ': ' + x.error.message)) : res(x.result);
    };
    ws.addEventListener('message', on);
    ws.send(JSON.stringify(sid ? { id, method: m, params: p, sessionId: sid } : { id, method: m, params: p }));
  });
}

(async () => {
  const T = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
              '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
              '.json': 'application/json; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript' };
  const ROOT = path.resolve(SITE);

  /* A FUTURE session, so the page must enter its selling state. Everything else is the
     branch verbatim -- this is the same file the postponed run used, with a date put back. */
  const base = JSON.parse(fs.readFileSync(ROOT + '/rx/session.json', 'utf8'));
  const selling = JSON.parse(JSON.stringify(base));

  /* VS_FROM_TEMPLATE=1 tests the path `_toRestore` actually describes: copy `template` into
     `upcoming`, set date and label, and nothing else. Now that venue/room/address/map are
     blank by design, this is what the NEXT session looks like before a venue is typed in --
     and it must still render without an empty cell, a bare separator or a dead map link. */
  const FULL = {
    date: '2027-03-06', label: 'Saturday, March 6', time: '10 AM \u2013 3 PM',
    venue: 'FIU \u00b7 Graham Center', room: 'Room GC 243', seats: 40,
    salesOpen: '2027-01-01', address: '10955 SW 15th Terrace, Miami, FL 33199',
    map: 'https://maps.google.com/?q=FIU', doors: '9:30 AM',
  };
  const FROM_TEMPLATE = Object.assign({}, base.template,
    { date: '2027-03-06', label: 'Saturday, March 6', salesOpen: '2027-01-01' });

  const fromTemplate = process.env.VS_FROM_TEMPLATE === '1';
  selling.upcoming = [fromTemplate ? FROM_TEMPLATE : FULL];
  console.log('session under test: ' + (fromTemplate ? 'COPIED FROM THE BLANK TEMPLATE' : 'a fully specified session'));

  const srv = http.createServer((rq, rs) => {
    let p = decodeURIComponent(rq.url.split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    if (p === '/rx/session.json') {
      rs.writeHead(200, { 'content-type': T['.json'], 'cache-control': 'no-store' });
      rs.end(JSON.stringify(selling));
      return;
    }
    const f = path.resolve(ROOT, '.' + p);
    if (f !== ROOT && !f.startsWith(ROOT + path.sep)) { rs.writeHead(403).end(); return; }
    fs.readFile(f, (e, b) => {
      if (e) { rs.writeHead(404).end(); return; }
      rs.writeHead(200, { 'content-type': T[path.extname(f).toLowerCase()] || 'application/octet-stream',
                          'cache-control': 'no-store' });
      rs.end(b);
    });
  });
  await new Promise(r => srv.listen(HTTP, '127.0.0.1', r));

  /* REFUSE TO RUN rather than assert against an error page. A harness that cannot serve the
     page under test produces failures that read exactly like page defects -- verify-explainer
     did that for weeks, reporting "noindex present" FAIL on a page whose bytes plainly
     contain noindex. Exit 2 is "this run is void", which is not the same as red. */
  {
    const _probe = await fetch('http://127.0.0.1:' + HTTP + '/workshop/').then(r => r.text()).catch(() => '');
    if (!/<\/html>/i.test(_probe) || _probe.length < 800) {
      console.error('REFUSING TO RUN: /workshop/ served ' + _probe.length + ' bytes and is not the page. Nothing below would mean anything.');
      try { srv.close(); } catch (_) {}
      process.exit(2);
    }
  }

  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-'));
  const ch = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${prof}`, 'about:blank'], { stdio: 'ignore' });

  let bws = null;
  for (let i = 0; i < 120 && !bws; i++) {
    await sleep(250);
    try { bws = (await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()).webSocketDebuggerUrl; } catch (e) {}
  }
  if (!bws) { ch.kill(); srv.close(); throw new Error('chrome never came up'); }

  const ws = new WebSocket(bws);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = () => j(new Error('ws failed')); });
  const { browserContextId } = await rpc(ws, 'Target.createBrowserContext', { disposeOnDetach: false });

  async function render(url, w, h, mobile) {
    const { targetId } = await rpc(ws, 'Target.createTarget', { url: 'about:blank', browserContextId });
    const { sessionId } = await rpc(ws, 'Target.attachToTarget', { targetId, flatten: true });
    const S = (m, q) => rpc(ws, m, q, sessionId);
    ws.addEventListener('message', async ev => {
      let m; try { m = JSON.parse(ev.data); } catch (_) { return; }
      if (m.sessionId !== sessionId || m.method !== 'Fetch.requestPaused') return;
      const same = m.params.request.url.startsWith(`http://127.0.0.1:${HTTP}`);
      try {
        same ? await S('Fetch.continueRequest', { requestId: m.params.requestId })
             : await S('Fetch.failRequest', { requestId: m.params.requestId, errorReason: 'BlockedByClient' });
      } catch (e) {}
    });
    await S('Page.enable'); await S('Runtime.enable'); await S('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
    await S('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
    await S('Page.navigate', { url });
    let ready = false;
    for (let k = 0; k < 80 && !ready; k++) {
      await sleep(150);
      ready = (await S('Runtime.evaluate', { returnByValue: true, expression:
        `document.readyState !== 'loading' && !!document.body && /March 6/.test(document.body.innerText)` })).result.value;
    }
    const d = (await S('Runtime.evaluate', { returnByValue: true, expression:
      `(function(){
         function vis(e){ if(!e) return false; var r=e.getBoundingClientRect();
           if(r.width<1||r.height<1) return false; var s=getComputedStyle(e);
           return s.display!=='none' && s.visibility!=='hidden'; }
         /* one fact cell, found by the label a reader sees */
         function cell(label){
           var f=[].slice.call(document.querySelectorAll('.facts .f')).filter(function(el){
             var k=el.querySelector('.k'); return k && k.textContent.trim().toLowerCase()===label.toLowerCase(); })[0];
           if(!f) return { v:'', s:'' };
           return { v:(f.querySelector('.v')||{textContent:''}).textContent.trim(),
                    s:(f.querySelector('.s')||{textContent:''}).textContent.trim() };
         }
         return { ready: document.readyState,
           text:(document.body.innerText||'').replace(/\\s+/g,' ').trim(),
           /* READ THE CELLS BY LABEL, NOT BY ID. 9f93853 rebuilt this grid from the one
              state table, and #nPrice/#nVenue/#nTime no longer exist anywhere -- markup or
              JS. Probing them returned empty strings and this suite reported 6 failures
              against a page that was rendering the venue, the time and $197 correctly: the
              harness was asserting the pre-rebase DOM. Labels are also the better anchor,
              because they are what a reader sees. */
           priceCellPresent: [].slice.call(document.querySelectorAll('.facts .f .k'))
                               .some(function(k){ return /^seat$/i.test(k.textContent.trim()); }),
           priceText: cell('Seat').v,
           venueText: cell('Where').v,
           timeText:  cell('Where').s,
           factCells: document.querySelectorAll('.facts .f').length,
           controls: [].slice.call(document.querySelectorAll('a,button')).filter(vis)
                       .map(function(b){ return (b.innerText||'').replace(/\\s+/g,' ').trim(); }).filter(Boolean) };
       }())` })).result.value;
    await rpc(ws, 'Target.closeTarget', { targetId });
    return d;
  }

  for (const [w, h, m] of [[390, 844, true], [1440, 900, false]]) {
    const label = '/workshop/ @' + w;
    console.log('\n===== ' + label + ' (a FUTURE date in session.json) =====');
    const d = await render(`http://127.0.0.1:${HTTP}/workshop/`, w, h, m);

    ck(label + ' — reached the selling state', /March 6/.test(d.text), d.ready + ' :: ' + d.text.slice(0, 120));
    ck(label + ' — the price cell SURVIVED (my nodate removal did not leak)', d.priceCellPresent === true, d.priceCellPresent);
    ck(label + ' — all four fact cells are present', d.factCells === 4, d.factCells);
    ck(label + ' — the price is back on screen', /\$\s?197/.test(d.priceText) || /\$\s?197/.test(d.text), d.priceText);
    if (fromTemplate) {
      /* No venue has been typed yet, so the city is the right answer -- and the cell must
         not be blank, and the time must not be a dangling separator. */
      ck(label + ' — with no venue typed, the city shows and the cell is not empty',
         d.venueText.trim() === 'Miami', JSON.stringify(d.venueText));
      ck(label + ' — the time has no dangling room separator',
         d.timeText.trim() === '10 AM – 3 PM', JSON.stringify(d.timeText));
      ck(label + ' — no dead directions link to a room nobody booked',
         !/10955|Graham|FIU/i.test(d.text), (d.text.match(/.{0,40}(10955|Graham|FIU).{0,40}/i) || [''])[0]);
    } else {
      ck(label + ' — the real venue is shown, not the undated placeholder',
         /Graham Center/.test(d.venueText) && d.venueText !== 'Miami', d.venueText);
      ck(label + ' — the real time is shown, not the undated placeholder',
         /* the placeholder is 'Five hours' now; checking for the old wording here would have
            left this half of the assertion permanently true and silently toothless */
         /10 AM/.test(d.timeText) && !/^Five hours$/.test(d.timeText.trim()), d.timeText);
    }
    ck(label + ' — a control that takes money is back',
       d.controls.some(c => /\$|save my seat|reserve/i.test(c)), JSON.stringify(d.controls));
    console.log('  -- controls: ' + JSON.stringify(d.controls));
    console.log('  -- facts: venue="' + d.venueText + '" time="' + d.timeText + '" price="' + d.priceText + '"');
  }

  ws.close(); srv.close();
  try { require('node:child_process').execSync('taskkill /F /T /PID ' + ch.pid, { stdio: 'ignore' }); }
  catch (e) { try { ch.kill(); } catch (_) {} }

  console.log('\n' + pass + ' checks passed, ' + fail + ' failed');
  if (fail) console.log('FAILED:\n' + fails.map(f => ' - ' + f).join('\n'));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('VERIFY FAILED: ' + e.message); process.exit(1); });
