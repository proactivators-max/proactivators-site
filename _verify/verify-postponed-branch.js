/* THE QUESTION: Era asked me to hand-build a "postponed" state onto /rx and /workshop.
   But both LIVE pages are already driven entirely by /rx/session.json and already carry a
   `nodate` -> waitlist state with no hardcoded date anywhere. So the real question is not
   "can I build it" — it is "does emptying `upcoming` ALREADY produce the state Era described?"

   This serves the EXACT origin/main tree (git archive, untouched) with one data change —
   `upcoming: []` — and reads what a stranger actually sees. If the page already says the
   true thing, the correct change is one line of data, not a rewrite of two files that five
   held commits also rewrite.

   Hermetic: nothing off-box (the rx-seats worker is blocked on purpose — the real page must
   not depend on it to tell the truth). Waits on readyState + a rendered marker, never a sleep.
   Per-run ports, because a fixed-port EADDRINUSE reads exactly like a failed assertion. */
const http = require('node:http'), { spawn } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
/* _verify/ sits at the repo root, so the repo is one level up. Derived rather than
   hardcoded: the old absolute path carried the account name into a file that may be
   served. */
const REPO = path.resolve(__dirname, '..');

const TREE = REPO;
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = Number(process.env.VP_PORT || 12401), HTTP = Number(process.env.VP_HTTP || 9801);
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
    const t = setTimeout(() => rej(new Error('timeout ' + m)), 25000);
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

/* The strings that must NOT survive a postponement. Built with String.raw and asserted
   present below, because a backslash that passes through a shell arrives halved and a
   regex that matches nothing passes forever. */
const BANNED = [
  new RegExp(String.raw`November\s+7`, 'i'),
  new RegExp(String.raw`\bNov\.?\s+7\b`, 'i'),
  new RegExp(String.raw`2026-11-07`, 'i'),
  new RegExp(String.raw`\bSave My Seat\b`, 'i'),
  new RegExp(String.raw`\bReserve my seat\b`, 'i'),
  new RegExp(String.raw`\$\s?197`, 'i'),
  new RegExp(String.raw`\bSecure checkout\b`, 'i'),
  new RegExp(String.raw`\bseats? left\b`, 'i'),
  new RegExp(String.raw`\bsold\b`, 'i'),
  /* Missed on the first pass and found only by the NO-JS sweep: /rx renders a static strip
     reading "Lunch + snacks / Workbook / Seats limited / Closes when full" in EVERY state.
     A scarcity claim with nothing on sale, and the body sweep had no pattern for it because
     I had only thought of "seats left" and "sold". */
  new RegExp(String.raw`seats? limited`, 'i'),
  new RegExp(String.raw`limited capacity`, 'i'),
  /* The venue. My first pass missed this entirely: /rx's nodate branch wrote
     "FIU - Miami - One Saturday a month" into the page and the suite had nothing to say,
     because I had only thought to hunt for the DATE. With no date set there is no room to
     name, so the city is the only honest answer. */
  new RegExp(String.raw`\bFIU\b`, 'i'),
  new RegExp(String.raw`Graham Center`, 'i'),
];
for (const rx of BANNED) if (!/[A-Za-z0-9$]/.test(rx.source)) throw new Error('banned pattern arrived empty: ' + rx.source);

(async () => {
  const T = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
              '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
              '.json': 'application/json; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript' };
  const ROOT = path.resolve(TREE);

  /* The ONE change under test: upcoming emptied. Everything else is origin/main verbatim. */
  const SESSION = JSON.parse(fs.readFileSync(ROOT + '/rx/session.json', 'utf8'));
  const postponed = JSON.parse(JSON.stringify(SESSION));
  postponed.upcoming = [];

  let sessionHits = 0, workerBlocked = 0;
  const srv = http.createServer((rq, rs) => {
    let p = decodeURIComponent(rq.url.split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    if (p === '/rx/session.json') {
      sessionHits++;
      rs.writeHead(200, { 'content-type': T['.json'], 'cache-control': 'no-store' });
      rs.end(JSON.stringify(postponed));
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

  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'vp-'));
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

  async function render(url, width, height, mobile) {
    const { targetId } = await rpc(ws, 'Target.createTarget', { url: 'about:blank', browserContextId });
    const { sessionId } = await rpc(ws, 'Target.attachToTarget', { targetId, flatten: true });
    const S = (m, q) => rpc(ws, m, q, sessionId);

    ws.addEventListener('message', async ev => {
      let m; try { m = JSON.parse(ev.data); } catch (_) { return; }
      if (m.sessionId !== sessionId || m.method !== 'Fetch.requestPaused') return;
      const same = m.params.request.url.startsWith(`http://127.0.0.1:${HTTP}`);
      if (!same) workerBlocked++;
      try {
        same ? await S('Fetch.continueRequest', { requestId: m.params.requestId })
             : await S('Fetch.failRequest', { requestId: m.params.requestId, errorReason: 'BlockedByClient' });
      } catch (e) {}
    });

    await S('Page.enable'); await S('Runtime.enable'); await S('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
    await S('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
    await S('Page.navigate', { url });

    /* wait on the state having actually been applied, not on a clock */
    let ready = false;
    for (let w = 0; w < 80 && !ready; w++) {
      await sleep(150);
      ready = (await S('Runtime.evaluate', { returnByValue: true, expression:
        `document.readyState !== 'loading' && !!document.body && document.body.innerText.trim().length > 200` })).result.value;
    }

    const d = (await S('Runtime.evaluate', { awaitPromise: true, returnByValue: true, expression:
      `(async function(){
         function vis(e){ if(!e) return false; var r=e.getBoundingClientRect();
           if(r.width<1||r.height<1) return false; var s=getComputedStyle(e);
           return s.display!=='none' && s.visibility!=='hidden' && s.opacity!=='0'; }
         var imgs=[].slice.call(document.images);
         imgs.forEach(function(i){ if(i.loading==='lazy') i.loading='eager'; });
         var decoded=0, undecoded=[];
         for (var i=0;i<imgs.length;i++){
           try { await imgs[i].decode(); decoded++; } catch(e){ undecoded.push(imgs[i].currentSrc||imgs[i].src); }
         }
         var all=[].slice.call(document.querySelectorAll('a,button,input[type=submit]'));
         return {
           ready: document.readyState,
           title: document.title,
           desc: (document.querySelector('meta[name=description]')||{}).content||'',
           ogdesc: (document.querySelector('meta[property="og:description"]')||{}).content||'',
           text: (document.body.innerText||'').replace(/\\s+/g,' ').trim(),
           visibleControls: all.filter(vis).map(function(b){ return ((b.innerText||b.value||'')+'').replace(/\\s+/g,' ').trim(); }).filter(Boolean),
           hiddenControls: all.filter(function(b){ return !vis(b); }).map(function(b){ return ((b.innerText||b.value||'')+'').replace(/\\s+/g,' ').trim(); }).filter(Boolean),
           hrefs: [].slice.call(document.querySelectorAll('a[href]')).map(function(a){ return a.getAttribute('href'); }),
         /* Era's catch: a body-innerText sweep cannot see the head. These tags are crawled
            and cached and follow no page state, so they have to be true in BOTH states. */
         metas: [].slice.call(document.querySelectorAll('meta[name],meta[property]'))
                  .map(function(m){ return (m.getAttribute('name')||m.getAttribute('property')) + '=' + (m.getAttribute('content')||''); }),
         /* Static markup innerText never reaches -- alt text, aria-label, title, a hidden
            div. HTML comments and <script> blocks are stripped first, because both carry
            pre-existing developer notes that legitimately name the old venue and would make
            this sweep cry wolf forever. */
         markup: document.documentElement.outerHTML
                   .replace(/<!--[\\s\\S]*?-->/g, '')
                   .replace(/<script[\\s\\S]*?<\\/script>/gi, ''),
           formFields: [].slice.call(document.querySelectorAll('form input,form select,form textarea')).filter(vis).length,
           imgTotal: imgs.length, imgDecoded: decoded, undecoded: undecoded
         };
       }())` })).result.value;

    await rpc(ws, 'Target.closeTarget', { targetId });
    return d;
  }

  const base = `http://127.0.0.1:${HTTP}`;
  const views = [
    ['/rx/',        390, 844,  true ],
    ['/rx/',        1440, 900, false],
    ['/workshop/',  390, 844,  true ],
    ['/workshop/',  1440, 900, false],
  ];

  const dumps = {};
  for (const [p, w, h, m] of views) {
    const label = p + (m ? ' @390' : ' @1440');
    console.log('\n===== ' + label + ' =====');
    const d = await render(base + p, w, h, m);
    dumps[label] = d;

    ck(label + ' — rendered', d.ready !== 'loading' && d.text.length > 200, d.ready + ' len=' + d.text.length);
    ck(label + ' — every image decoded', d.imgTotal === d.imgDecoded, d.imgDecoded + '/' + d.imgTotal + ' undecoded=' + JSON.stringify(d.undecoded));

    for (const rx of BANNED) {
      const hit = d.text.match(rx);
      ck(label + ' — nothing on screen says /' + rx.source + '/', !hit, hit && hit[0]);
    }
    const payish = d.visibleControls.filter(c => /pay|checkout|\$|reserve|save my seat|buy/i.test(c));
    ck(label + ' — no visible control takes money', payish.length === 0, JSON.stringify(payish));
    ck(label + ' — the free form is still usable', d.formFields > 0 || d.visibleControls.some(c => /next date|notify|waitlist|list/i.test(c)),
       'fields=' + d.formFields + ' controls=' + JSON.stringify(d.visibleControls));
    /* THE HEAD. Every meta tag, not just description and og:description -- /workshop also
       carries twitter:description, which the first version of this suite never looked at.
       A cached tag that still says "at FIU - seats limited - Reserve your seat" is a lie
       served to every crawler regardless of what the page body does. */
    const METABAN = [
      new RegExp(String.raw`\bFIU\b`, 'i'),
      new RegExp(String.raw`Graham Center`, 'i'),
      new RegExp(String.raw`\$\s?197`, 'i'),
      new RegExp(String.raw`\breserve\b`, 'i'),
      new RegExp(String.raw`seats? limited`, 'i'),
      new RegExp(String.raw`\bsave my seat\b`, 'i'),
      new RegExp(String.raw`November\s+7`, 'i'),
      new RegExp(String.raw`\bNov\.?\s+7\b`, 'i'),
      new RegExp(String.raw`limited capacity`, 'i'),
    ];
    for (const rx of METABAN) {
      const hits = d.metas.filter(m => rx.test(m));
      ck(label + ' — no meta tag says /' + rx.source + '/', hits.length === 0, JSON.stringify(hits));
    }
    ck(label + ' — the head was actually read (metas found)', d.metas.length >= 4, 'n=' + d.metas.length);

    /* static markup innerText cannot reach: alt, aria-label, title, hidden nodes */
    for (const rx of [new RegExp(String.raw`\bFIU\b`, 'i'), new RegExp(String.raw`Graham Center`, 'i')]) {
      const m = d.markup.match(rx);
      ck(label + ' — no static markup names the venue /' + rx.source + '/', !m, m && m[0]);
    }

    console.log('  -- visible controls: ' + JSON.stringify(d.visibleControls));
    console.log('  -- innerText (first 700): ' + d.text.slice(0, 700));
  }

  /* WHAT A JS-LESS CRAWLER SEES. Everything above is measured after the script has run, so
     it says nothing about the markup served on the wire. /workshop's fact cells were
     hardcoded to "FIU - Graham Center", "10 AM - 3 PM", "$197" and "Seats limited" -- served
     to anything that does not execute JS, and rendered to a human if the script ever fails.
     Fetched over HTTP, not read off disk, because the served bytes are the question.
     Comments and <script> blocks are stripped: both legitimately carry developer notes
     naming the old venue, including the ones explaining these very defaults. */
  for (const p of ['/rx/', '/workshop/']) {
    const raw = await (await fetch(`http://127.0.0.1:${HTTP}${p}`)).text();
    const served = raw.replace(/<!--[\s\S]*?-->/g, '').replace(/<script[\s\S]*?<\/script>/gi, '');
    for (const rx of [/\bFIU\b/i, /Graham Center/i, /\$\s?197/i, /seats? limited/i,
                      /November\s+7/i, /\bSave My Seat\b/i]) {
      const m = served.match(rx);
      ck('NO-JS ' + p + ' — the served markup does not say /' + rx.source + '/', !m, m && m[0]);
    }
    ck('NO-JS ' + p + ' — the fetch actually returned the page', /<\/html>/i.test(raw), raw.length);
  }

  ck('the page actually read session.json (so the state came from data, not luck)', sessionHits >= 2, 'hits=' + sessionHits);
  ck('the off-box seat worker was blocked, and the page still told the truth', workerBlocked > 0, 'blocked=' + workerBlocked);

  fs.writeFileSync(__dirname + '/postponed-dump.json', JSON.stringify(dumps, null, 1));

  ws.close(); srv.close();
  try { require('node:child_process').execSync('taskkill /F /T /PID ' + ch.pid, { stdio: 'ignore' }); }
  catch (e) { try { ch.kill(); } catch (_) {} }

  console.log('\n' + pass + ' checks passed, ' + fail + ' failed');
  if (fail) console.log('FAILED:\n' + fails.map(f => ' - ' + f).join('\n'));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('VERIFY FAILED: ' + e.message); process.exit(1); });
