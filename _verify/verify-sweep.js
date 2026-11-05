/* COVERAGE FOR THE THREE PAGES THE POSTPONED SUITE NEVER LOOKED AT.
   /rx/ and /workshop/ were verified 132/132 while /rx/crossfit-mia/ -- a byte copy of the
   OLD /rx/index.html -- still said "One Saturday a month at FIU" in two meta descriptions
   and "FIU · Graham Center · 10 AM – 3 PM" in its markup. The suite was not wrong; it was
   pointed at two files out of six. This covers the rest.

   SW_TREE picks the tree. Run it against `git archive HEAD` and it MUST fail: these are
   negative assertions, and a negative assertion nobody has watched fail is not a check. */
const http = require('node:http'), { spawn } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
/* _verify/ sits at the repo root, so the repo is one level up. Derived rather than
   hardcoded: the old absolute path carried the account name into a file that may be
   served. */
const REPO = path.resolve(__dirname, '..');

const TREE = process.env.SW_TREE || REPO;
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = Number(process.env.SW_PORT || 14901), HTTP = Number(process.env.SW_HTTP || 11901);
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0; const fails = [];
const ck = (n, c, d) => {
  if (c) { pass++; console.log('  ok   ' + n); }
  else { fail++; fails.push(n); console.log('  FAIL ' + n + (d !== undefined ? '\n         got: ' + String(d).slice(0, 260) : '')); }
};

/* Written with String.raw: a backslash that goes through a shell arrives halved, and a dead
   \b once made an assertion permanently green on this very project. */
const BANNED = [
  new RegExp(String.raw`\bFIU\b`, 'i'),
  new RegExp(String.raw`Graham\s+Center`, 'i'),
  new RegExp(String.raw`\$\s?197`, 'i'),
  new RegExp(String.raw`seats?\s+limited`, 'i'),
  new RegExp(String.raw`\bnov(?:\.|ember)?\s*\.?\s*7(?:th)?\b`, 'i'),
  new RegExp(String.raw`10\s*AM\s*(?:-|\u2013|&ndash;)\s*3\s*PM`, 'i'),
];

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

const T = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
            '.json': 'application/json; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript' };

(async () => {
  const ROOT = path.resolve(TREE);
  console.log('tree under test: ' + ROOT + '\n');

  const srv = http.createServer((rq, rs) => {
    let p = decodeURIComponent(rq.url.split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
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
    const _probe = await fetch('http://127.0.0.1:' + HTTP + '/rx/thanks/').then(r => r.text()).catch(() => '');
    if (!/<\/html>/i.test(_probe) || _probe.length < 800) {
      console.error('REFUSING TO RUN: /rx/thanks/ served ' + _probe.length + ' bytes and is not the page. Nothing below would mean anything.');
      try { srv.close(); } catch (_) {}
      process.exit(2);
    }
  }

  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-'));
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

  async function probe(url, w, h, mobile, marker) {
    const { targetId } = await rpc(ws, 'Target.createTarget', { url: 'about:blank', browserContextId });
    const { sessionId } = await rpc(ws, 'Target.attachToTarget', { targetId, flatten: true });
    const S = (m, q) => rpc(ws, m, q, sessionId);
    ws.addEventListener('message', async ev => {
      let m; try { m = JSON.parse(ev.data); } catch (_) { return; }
      if (m.sessionId !== sessionId || m.method !== 'Fetch.requestPaused') return;
      /* Nothing off-box. A Google Font deciding whether an assertion passes is how a suite
         becomes flaky, and flaky red is indistinguishable from a finding. */
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
    for (let k = 0; k < 90 && !ready; k++) {
      await sleep(150);
      ready = (await S('Runtime.evaluate', { returnByValue: true, expression:
        `document.readyState !== 'loading' && !!document.body && new RegExp(${JSON.stringify(marker)}).test(document.body.innerText)` })).result.value;
    }
    const d = (await S('Runtime.evaluate', { returnByValue: true, expression:
      `(function(){
         function vis(e){ if(!e) return false; var r=e.getBoundingClientRect();
           if(r.width<1||r.height<1) return false; var s=getComputedStyle(e);
           return s.display!=='none' && s.visibility!=='hidden'; }
         return {
           ready: document.readyState,
           text: (document.body.innerText||'').replace(/\\s+/g,' ').trim(),
           metas: [].slice.call(document.querySelectorAll('meta[name],meta[property]'))
                    .map(function(m){ return (m.getAttribute('name')||m.getAttribute('property')) + '=' + (m.getAttribute('content')||''); }),
           /* comments and <script> stripped: my own notes mention the venue, and a note is
              not a claim -- leaving them in makes every grep cry wolf. */
           dom: document.documentElement.outerHTML
                  .replace(/<!--[\\s\\S]*?-->/g,'')
                  .replace(/<script[\\s\\S]*?<\\/script>/gi,''),
           /* Any visible control that mentions money or a seat, WITH its href. The filter
              stays broad on purpose -- a new price must trip it -- and the one legitimate
              exception (the $14.99 book on Amazon, which is a different product and stays
              live) is subtracted below by checking its href, not by loosening this. */
           money: [].slice.call(document.querySelectorAll('a,button')).filter(vis)
                    .map(function(b){ return { t: (b.innerText||'').replace(/\\s+/g,' ').trim(),
                                               href: b.getAttribute('href') || '' }; })
                    .filter(function(o){ return /\\$|save my seat|reserve my seat|checkout|pay\\b/i.test(o.t); })
         };
       }())` })).result.value;
    await rpc(ws, 'Target.closeTarget', { targetId });
    return d;
  }

  const B = `http://127.0.0.1:${HTTP}`;
  /* marker = a string the page only shows once its script has run, so a half-rendered page
     cannot be read as a clean pass. */
  const PAGES = [
    { url: B + '/rx/crossfit-mia/', label: '/rx/<gym>/', marker: 'Next date coming',
      must: [/Next date coming/i, /CrossFit MIA/i, /Tell me the next date/i] },
    { url: B + '/rx/thanks/',       label: '/rx/thanks/', marker: 'Next date coming',
      must: [/Next date coming/i] },
    { url: B + '/start/',           label: '/start/',     marker: 'next date is being set',
      must: [/next date is being set/i] },
  ];

  for (const pg of PAGES) {
    for (const [w, h, m] of [[390, 844, true], [1440, 900, false]]) {
      const L = pg.label + ' @' + w;
      console.log('\n===== ' + L + ' =====');
      const d = await probe(pg.url, w, h, m, pg.marker);
      ck(L + ' — the page rendered its no-date state', new RegExp(pg.marker, 'i').test(d.text),
         d.ready + ' :: ' + d.text.slice(0, 160));
      for (const re of pg.must) ck(L + ' — says ' + re, re.test(d.text), d.text.slice(0, 200));
      for (const re of BANNED) {
        ck(L + ' — body does not say ' + re, !re.test(d.text),
           (d.text.match(new RegExp('.{0,60}' + re.source + '.{0,60}', 'i')) || [''])[0]);
        ck(L + ' — DOM (comments+scripts stripped) does not say ' + re, !re.test(d.dom),
           (d.dom.match(new RegExp('.{0,70}' + re.source + '.{0,70}', 'i')) || [''])[0]);
        const bad = d.metas.filter(x => re.test(x));
        ck(L + ' — no meta says ' + re, bad.length === 0, JSON.stringify(bad));
      }
      /* The book is a separate product at a separate price on a separate storefront; taking
         the workshop off sale says nothing about it. It is allowed ONLY when its href really
         is Amazon, so this exception cannot be used to smuggle a workshop CTA past the check. */
      const isBook = o => /amazon\.com/i.test(o.href) && /14\.99/.test(o.t) && !/197|147|seat/i.test(o.t);
      const book = d.money.filter(isBook), workshopMoney = d.money.filter(o => !isBook(o));
      ck(L + ' — no visible control takes money for the workshop',
         workshopMoney.length === 0, JSON.stringify(workshopMoney));
      ck(L + ' — the only priced control left is the Amazon book, and its href proves it',
         book.every(o => /amazon\.com/i.test(o.href)), JSON.stringify(book));
      if (book.length) console.log('  -- allowed (different product): ' + book.map(o => o.t).join(' | '));
    }
  }

  /* The served bytes, which every check above runs too late to see. */
  for (const pg of PAGES) {
    const raw = await (await fetch(pg.url)).text();
    const wire = raw.replace(/<!--[\s\S]*?-->/g, '').replace(/<script[\s\S]*?<\/script>/gi, '');
    console.log('\n===== NO-JS ' + pg.label + ' (' + wire.length + ' chars on the wire) =====');
    ck('NO-JS ' + pg.label + ' — the fetch returned the page', /<\/html>/i.test(raw), raw.slice(0, 120));
    for (const re of BANNED) {
      ck('NO-JS ' + pg.label + ' — served markup does not say ' + re, !re.test(wire),
         (wire.match(new RegExp('.{0,70}' + re.source + '.{0,70}', 'i')) || [''])[0]);
    }
  }

  ws.close(); srv.close();
  try { require('node:child_process').execSync('taskkill /F /T /PID ' + ch.pid, { stdio: 'ignore' }); }
  catch (e) { try { ch.kill(); } catch (_) {} }

  console.log('\n' + pass + ' checks passed, ' + fail + ' failed');
  if (fail) console.log('FAILED:\n' + fails.map(f => ' - ' + f).join('\n'));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('VERIFY FAILED: ' + e.message); process.exit(1); });
