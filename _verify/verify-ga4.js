// GA4 coverage self-check — EVERY reachable page, measured in the RENDERED DOM.
//
// Why this exists. On Nov 2 the tag was on the homepage only, and /rx, /workshop and /launch
// recorded nothing all month. 06e5491 ("the tag on every page, not only the homepage") fixed
// 30 pages — and missed four, because it globbed the */index.html shape and /launch has four
// siblings that are not index.html: bestseller, invitation, review, success. Three more pages
// written after that sweep were born untagged. Seven pages, two different causes, one of them
// silent for six months. A file-level grep would have caught the bytes; nothing was watching.
//
// So this suite watches the only thing that actually bills: what the browser does.
//   * exactly ONE loader <script> in the DOM, exactly ONE gtag('config') on the wire
//   * the loader request is OBSERVED LEAVING THE PAGE — blocked at the edge, but attempted,
//     which is the difference between a live tag and eight lines inside an HTML comment
//   * the measurement ID is the real one, on every page, with no second property
//
// Hermetic: Fetch.enable blocks everything that is not 127.0.0.1, googletagmanager included.
// That is deliberate. The inline stub pushes 'js' and 'config' into dataLayer whether or not
// the loader ever resolves, so blocking it costs no signal and removes a CDN from the set of
// things that decide whether this suite passes.
//
// Exit 2 (void, NOT red) if it cannot serve the tree or Chrome never comes up.

const { spawn, execFileSync } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');

/* _verify/ sits at the repo root, so the repo is one level up. Derived, never hardcoded:
   an absolute path here would carry the account name into a directory that may be served. */
const REPO = path.resolve(__dirname, '..');
const ROOT = REPO;
const ID = 'G-CNQ4P8TJC6';
const LOADER = 'googletagmanager.com/gtag/js';

/* Not a page: 53 bytes, no <head>. It is the Search Console ownership token — a file Google
   fetches to prove the domain, not something a person reads. Tagging it would be meaningless
   and editing it risks the site's Search Console. Named here so its absence is a decision on
   the record rather than a gap somebody later "fixes". */
const NOT_A_PAGE = new Set(['google2e50e3cb7eb6a4da.html']);

const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9880 + (process.pid % 150);
const sleep = ms => new Promise(r => setTimeout(r, ms));

let fails = 0;
const say = (ok, label, extra) => { if (!ok) fails++; console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + label + (extra ? '   ' + extra : '')); };

const MIME = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
               '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
               '.json': 'application/json; charset=utf-8', '.css': 'text/css',
               '.js': 'text/javascript', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };

/* port 0 = the OS picks. A fixed port is how a stale server from an earlier run answers for
   a tree you are not testing. */
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

/* The page list is "what GitHub Pages serves", which is exactly "what git tracks" — not what
   happens to sit on disk. flyer-spread/ is 25 untracked vendor coverage reports plus print
   one-sheets; none of it deploys, and a filesystem walk would have swept all of it in. */
function trackedPages() {
  const out = execFileSync('git', ['ls-files', '*.html'], { cwd: REPO, encoding: 'utf8' });
  return out.split('\n').map(s => s.trim()).filter(Boolean).filter(r => !NOT_A_PAGE.has(r));
}

/* A page's URL is its path, with /index.html collapsed to the directory the way Pages serves it. */
const urlFor = rel => '/' + rel.replace(/(^|\/)index\.html$/, '$1');

(async () => {
  let pages;
  try { pages = trackedPages(); }
  catch (e) {
    console.error('REFUSING TO RUN: could not list tracked pages (' + e.message.trim() + ').');
    process.exit(2);
  }
  if (pages.length < 20) {
    console.error('REFUSING TO RUN: only ' + pages.length + ' tracked pages found. That is not this repo.');
    process.exit(2);
  }

  await new Promise((res, rej) => {
    server.on('error', rej);
    server.listen(0, '127.0.0.1', () => res());
  });
  const BASE = 'http://127.0.0.1:' + server.address().port;

  /* Serve-or-void. If the tree is not being served, every assertion below would fail for a
     reason that has nothing to do with any page. */
  const probe = await fetch(BASE + '/').then(r => r.text()).catch(e => { throw new Error('own server unreachable: ' + e.message); });
  if (!/<\/html>/i.test(probe) || probe.length < 2000) {
    console.error('REFUSING TO RUN: ' + BASE + '/ served ' + probe.length + ' bytes and does not look like the homepage.');
    try { server.close(); } catch (_) {}
    process.exit(2);
  }

  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'ga4-'));
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run',
    '--no-default-browser-check', '--hide-scrollbars',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + prof, 'about:blank'], { stdio: 'ignore' });

  const bail = (code, msg) => { console.error(msg); try { server.close(); } catch (_) {} try { chrome.kill(); } catch (_) {} process.exit(code); };

  let target = null;
  for (let i = 0; i < 120 && !target; i++) {
    await sleep(200);
    try { target = (await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json()).find(x => x.type === 'page'); } catch (e) {}
  }
  if (!target) bail(2, 'REFUSING TO RUN: Chrome never exposed a debuggable page on ' + PORT);

  const ws = new globalThis.WebSocket(target.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  let loaderAttempts = 0, offBoxBlocked = 0;
  const blockedHosts = new Set();

  /* send() is declared BEFORE the handler that calls it. Assigning onmessage first and
     declaring send below it reads fine and is a temporal-dead-zone trap: inserting a const
     above its own dependency is how all eight suites once reported 0/0. */
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });

  ws.onmessage = async e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Fetch.requestPaused') {
      const u = m.params.request.url;
      const onBox = u.startsWith(BASE) || u.startsWith('http://127.0.0.1:') || u.startsWith('about:') || u.startsWith('data:');
      if (u.includes(LOADER)) loaderAttempts++;
      if (!onBox) {
        offBoxBlocked++;
        try { blockedHosts.add(new URL(u).host); } catch (_) {}
        send('Fetch.failRequest', { requestId: m.params.requestId, errorReason: 'BlockedByClient' });
      } else {
        send('Fetch.continueRequest', { requestId: m.params.requestId });
      }
    }
  };
  await new Promise(r => { ws.onopen = r; });
  const js = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result?.result?.value;

  await send('Page.enable'); await send('Runtime.enable');
  await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });

  console.log('serving ' + ROOT + ' on ' + BASE);
  console.log(pages.length + ' tracked pages (excluding ' + [...NOT_A_PAGE].join(', ') + ')\n');

  const rows = [];
  for (const rel of pages) {
    const url = BASE + urlFor(rel);
    const before = loaderAttempts;
    await send('Page.navigate', { url });

    /* Wait on the document, never on a duration. 'interactive' is the right bar: every
       classic script has run by then, which is all the GA4 stub needs. 'complete' would
       wait on images and fonts that have nothing to do with the tag. */
    let ready = false;
    for (let i = 0; i < 60 && !ready; i++) {
      await sleep(100);
      ready = await js("document.readyState !== 'loading' && !!document.head");
    }
    if (!ready) { say(false, rel + ' — page never reached interactive'); rows.push({ rel, err: 'never ready' }); continue; }
    await sleep(120);   /* let the async loader request be issued */

    const r = await js(`(() => {
      const L = ${JSON.stringify(LOADER)};
      const loaders = [...document.querySelectorAll('script[src]')]
        .map(s => s.getAttribute('src')).filter(s => s && s.includes(L));
      const dl = (window.dataLayer || []);
      const entries = [...dl].map(a => { try { return [...a]; } catch (_) { return [String(a)]; } });
      const cfg = entries.filter(e => e[0] === 'config');
      return {
        loaders: loaders.length,
        loaderSrc: loaders[0] || '',
        hasGtagFn: typeof window.gtag === 'function',
        dlLen: entries.length,
        jsCalls: entries.filter(e => e[0] === 'js').length,
        cfgCalls: cfg.length,
        cfgIds: [...new Set(cfg.map(e => e[1]))],
        path: location.pathname,
        title: (document.title || '').slice(0, 60),
      };
    })()`);

    const attempted = loaderAttempts - before;
    rows.push({ rel, ...r, attempted });

    const ok = r && r.loaders === 1 && r.cfgCalls === 1 && r.jsCalls === 1
               && r.cfgIds.length === 1 && r.cfgIds[0] === ID && r.hasGtagFn && attempted >= 1;
    say(ok, urlFor(rel),
      'loader=' + (r ? r.loaders : '?') + ' js=' + (r ? r.jsCalls : '?') +
      ' config=' + (r ? r.cfgCalls : '?') + ' id=' + (r ? r.cfgIds.join('|') : '?') +
      ' requested=' + attempted);
  }

  /* ---- the cross-page facts, asserted once ---- */
  console.log('\nacross all ' + rows.length + ' pages');
  const good = rows.filter(r => !r.err);
  say(good.length === rows.length, 'every page rendered', good.length + '/' + rows.length);
  say(good.every(r => r.loaders === 1), 'exactly one loader script per page',
    'offenders: ' + (good.filter(r => r.loaders !== 1).map(r => r.rel + '=' + r.loaders).join(', ') || 'none'));
  say(good.every(r => r.cfgCalls === 1), 'exactly one config call per page',
    'offenders: ' + (good.filter(r => r.cfgCalls !== 1).map(r => r.rel + '=' + r.cfgCalls).join(', ') || 'none'));
  say(good.every(r => r.attempted >= 1), 'the loader request actually left every page (live tag, not commented out)',
    'silent: ' + (good.filter(r => r.attempted < 1).map(r => r.rel).join(', ') || 'none'));
  const ids = [...new Set(good.flatMap(r => r.cfgIds))];
  say(ids.length === 1 && ids[0] === ID, 'one measurement property, and it is the right one', ids.join(', ') || '(none)');

  /* The homepage is called out separately because it is the page that already had the tag,
     and "add it everywhere" is exactly the change that double-tags the one that had it. */
  const home = good.find(r => r.rel === 'index.html');
  say(!!home && home.cfgCalls === 1 && home.loaders === 1,
    'the homepage did NOT start firing twice', home ? 'loader=' + home.loaders + ' config=' + home.cfgCalls : 'homepage missing');

  /* /guest/ is a client-side redirect shim: a meta-refresh plus location.replace() to
     /podcast-guest/. It therefore fires its own config and then the destination fires again,
     so a visit to /guest/ is TWO pageviews in GA4. That is deliberate and worth keeping —
     it is the only way to see which of the two links is actually circulating — and it is
     asserted here so nobody later reads the 2 as a double-tag and "fixes" it. Anything OTHER
     than /guest/ requesting the loader twice is a real double-count and fails. */
  const twice = good.filter(r => r.attempted > 1).map(r => r.rel);
  say(twice.every(r => r === 'guest/index.html'),
    'only the /guest/ redirect shim requests the loader twice (it hands off to /podcast-guest/)',
    twice.length ? twice.join(', ') : 'no page requested it twice');

  say(offBoxBlocked > 0, 'hermetic: off-box requests were blocked, not fetched',
    offBoxBlocked + ' blocked across ' + blockedHosts.size + ' hosts');
  const sawLoaderHost = [...blockedHosts].some(h => h.includes('googletagmanager'));
  say(sawLoaderHost, 'googletagmanager was among them (so the tag is real and the block is real)',
    [...blockedHosts].slice(0, 6).join(', '));

  console.log('\n' + (fails ? fails + ' FAILURES' : 'all checks passed') +
    '   (' + good.length + ' pages, ' + loaderAttempts + ' loader requests observed)');

  try { server.close(); } catch (_) {}
  try { chrome.kill(); } catch (_) {}
  /* kill the renderer children too: ch.kill() only kills the launcher, and leftover Chromes
     starve later runs — the original source of this repo's flaky 24/24 -> 19/5 numbers. */
  try { execFileSync('taskkill', ['/F', '/T', '/PID', String(chrome.pid)], { stdio: 'ignore' }); } catch (_) {}
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR: ' + e.stack); process.exit(2); });
