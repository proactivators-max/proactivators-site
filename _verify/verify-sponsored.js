// /workshop/sponsored self-check. Served over HTTP so /rx/session.json and /logo.png resolve.
//
// The happy path is tested against a MOCKED endpoint, not the live one. A real submit would
// create a real contact in the live CRM, and test rows there cause real accounting problems —
// rx/session.json already carries a manualSold of -2 purely to cancel two earlier test orders.
// Mocking proves the exact payload EX will read without putting a fake person in the system.

const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
/* _verify/ sits at the repo root, so the repo is one level up. Derived rather than
   hardcoded: the old absolute path carried the account name into a file that may be
   served. */
const REPO = path.resolve(__dirname, '..');

const ROOT = REPO;

/* Era's ruling 3, Nov 5 2026: this suite reads N/0 for the state the page is actually in.
   It used to assume a dated session unconditionally, so on a tree where `upcoming` is empty
   it reported 5 failures -- "confirmation names the real date", "session date stamped",
   "the page states plainly that nothing is owed" -- against a page that was behaving
   correctly by taking the offer down. Those read exactly like defects. The state comes from
   the same file the page reads, so the suite and the page can never disagree about which
   world they are in. */
const _sj = JSON.parse(fs.readFileSync(ROOT + '/rx/session.json', 'utf8'));
const _today = new Date().toISOString().slice(0, 10);
const SESSION = (_sj.upcoming || []).filter(u => u.date >= _today)[0] || null;
const HAS_SESSION = !!SESSION;
console.log('state under test: ' + (HAS_SESSION
  ? 'A DATED SESSION (' + SESSION.label + ') -- the offer is open'
  : 'NO DATED SESSION -- the offer must be down, and there must be nothing to submit'));
const OUT  = ROOT + '/workshop/sponsored/_proofs';
fs.mkdirSync(OUT, { recursive: true });
const PORT_H = 8123;

const TYPES = { '.html':'text/html', '.json':'application/json', '.png':'image/png',
                '.jpg':'image/jpeg', '.svg':'image/svg+xml', '.js':'text/javascript', '.css':'text/css' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  // path.join returns backslashes on Windows while ROOT is written with forward slashes, so
  // both sides have to be resolved before the containment check — otherwise it rejects everything.
  const f = path.resolve(ROOT, '.' + p);
  if (!f.startsWith(path.resolve(ROOT)) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('404'); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}).listen(PORT_H);

const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9930 + (process.pid % 60);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'spon-'));
const chrome = spawn(CHROME, ['--headless=new','--disable-gpu','--no-first-run',
  '--no-default-browser-check','--hide-scrollbars',
  `--remote-debugging-port=${PORT}`,`--user-data-dir=${profile}`,'about:blank'], { stdio:'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const say = (ok, l, x) => { if (!ok) fails++; console.log('  ' + (ok ? 'ok  ' : 'FAIL') + '  ' + l + (x ? '   ' + x : '')); };

(async () => {
  /* REFUSE TO RUN rather than assert against an error page. This one listens at module level
     on a fixed port, so it has an extra failure mode the others do not: if something else is
     already on PORT_H, listen() throws asynchronously and the probe below would answer from
     A SERVER THAT IS NOT THIS ONE, serving a tree nobody chose. Checking that the page is
     the page catches both that and a plain failure to start. Exit 2 is "void", not "red". */
  {
    const _probe = await fetch(`http://127.0.0.1:${PORT_H}/workshop/sponsored/`).then(r => r.text()).catch(() => '');
    if (!/<\/html>/i.test(_probe) || !/sponsored/i.test(_probe) || _probe.length < 800) {
      console.error('REFUSING TO RUN: /workshop/sponsored/ on :' + PORT_H + ' served ' + _probe.length +
                    ' bytes and is not the page. Nothing below would mean anything.');
      try { server.close(); } catch (_) {}
      try { chrome.kill(); } catch (_) {}
      process.exit(2);
    }
  }

  let t = null;
  for (let i = 0; i < 90 && !t; i++) {
    await sleep(200);
    try { t = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find(x => x.type === 'page'); } catch (e) {}
  }
  const ws = new globalThis.WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const p = new Map(); const errors = [];
  ws.onmessage = e => { const m = JSON.parse(e.data);
    if (m.id && p.has(m.id)) { p.get(m.id)(m); p.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text); };
  await new Promise(r => { ws.onopen = r; });
  const send = (m, q = {}) => new Promise(res => { const i = ++id; p.set(i, res); ws.send(JSON.stringify({ id:i, method:m, params:q })); });
  // awaitPromise only for expressions that actually return one — CDP errors on the rest.
  const js = async (e, isAsync = false) => {
    const r = await send('Runtime.evaluate', { expression: e, awaitPromise: isAsync, returnByValue: true });
    if (r.error) throw new Error('CDP: ' + JSON.stringify(r.error) + '  <<' + e.slice(0, 90) + '>>');
    if (r.result?.exceptionDetails) throw new Error('PAGE THREW: ' +
      (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text) + '  <<' + e.slice(0, 90) + '>>');
    return r.result?.result?.value;
  };
  await send('Page.enable'); await send('Runtime.enable');

  const URL_ = `http://127.0.0.1:${PORT_H}/workshop/sponsored/`;
  const load = async (w, h) => {
    await send('Emulation.setDeviceMetricsOverride', { width:w, height:h, deviceScaleFactor:1, mobile:w<720 });
    await send('Page.navigate', { url: URL_ });
    let landed = false;
    for (let i=0;i<40;i++){ await sleep(200); if (await js(`!!document.getElementById("form")`)) { landed = true; break; } }
    if (!landed) {
      const where = await js(`JSON.stringify({url:location.href,ready:document.readyState,len:document.body?document.body.innerHTML.length:-1})`);
      throw new Error('navigation never landed on the page. ' + where);
    }
    // Fonts are a separate wait, and NOT a blocker: they come from Google and a headless box
    // may have no route to them. The layout checks still hold with a fallback face.
    for (let i=0;i<15;i++){ await sleep(200); if (await js(`document.fonts.status==="loaded"`)) break; }
    await sleep(500);
    // Capture every outgoing payload instead of letting it reach the live CRM.
    await js(`window.__sent=[]; window.fetch=function(u,o){ window.__sent.push({url:u,body:o&&o.body}); return Promise.resolve({ok:true,status:200,json:()=>Promise.resolve({})}); }; true`);
  };
  const shot = async (name, w) => {
    const h = await js('document.documentElement.scrollHeight');
    const s = await send('Page.captureScreenshot', { format:'png', captureBeyondViewport:true,
      clip:{ x:0, y:0, width:w, height:Math.min(h,4000), scale:1 } });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(s.result.data,'base64'));
  };

  for (const [w,h,tag] of [[390,844,'phone'],[1280,900,'desktop']]) {
    console.log('\n' + tag + ' (' + w + 'px)');
    await load(w,h);

    const base = await js(`(()=>{const d=document.documentElement,b=document.body;return{
      overflow: Math.max(d.scrollWidth,b.scrollWidth) > d.clientWidth+1,
      imgs: [...document.images].every(i=>i.naturalWidth>0),
      noindex: (document.querySelector('meta[name=robots]')||{}).content||'',
      txt: b.innerText,
      sessionShown: document.getElementById('nDate').textContent
    }})()`);
    say(!base.overflow, 'no horizontal overflow');
    say(base.imgs, 'logo loads (the real wordmark image)');
    say(/noindex/.test(base.noindex), 'noindex,nofollow');
    /* Test for a PRICE or a CHECKOUT, not for money-shaped words. The page legitimately says
       "paying for your seat", "nothing for you to pay" and "no card" — an earlier version of
       this check flagged all three, which is the same false-positive shape as the verifier
       that once asserted a banned word was present because my own draft quoted it. */
    say(!/\$\s?\d|\b197\b|\bcheckout\b|\bcredit\b|\bdeposit\b/i.test(base.txt),
        'no price and no checkout anywhere in the visible text');
    say(!/\b\d+\s*(seats?|spots?|places?)\b/i.test(base.txt), 'no hard-coded headcount');
    if (HAS_SESSION) {
      say(/no payment/i.test(base.txt) && /nothing for you to pay/i.test(base.txt),
          'the page states plainly that nothing is owed');
      say(/November 7|Saturday/i.test(base.sessionShown), 'date came from rx/session.json', JSON.stringify(base.sessionShown));
    } else {
      /* The offer is down, so the lines that live inside it are correctly absent. What has to
         be true instead is that the page says why, and claims nothing about a next date. */
      say(/nothing to claim yet/i.test(base.txt), 'the closed state says there is nothing to claim');
      say(/isn.t dated|is not dated/i.test(base.txt), 'it says the next workshop is not dated');
      say(/manager will have a code/i.test(base.txt), 'it says where a code will come from');
      say(!/seat is held|before the day/i.test(base.txt),
          'it does NOT promise a held seat or a day', JSON.stringify((base.txt.match(/.{0,50}(seat is held|before the day).{0,50}/i) || [''])[0]));
      say(!/\b(November|January|February|March|April|May|June|July|August|September|October|December)\s+\d/i.test(base.txt),
          'it names no date at all', JSON.stringify((base.txt.match(/.{0,40}(November|January|March|April|May|June|July|August|September|October|December)\s+\d.{0,40}/i) || [''])[0]));
    }
    say(!/streak/i.test(base.txt), 'no "streak"');
    say(!/\bmen\b/i.test(base.txt), 'no "men"');

    if (tag === 'phone') await shot('01-page-phone.png', w); else await shot('01-page-desktop.png', w);

    /* NO DATED SESSION: there is nothing to submit, and that is the assertion. Running the
       three submit cases here would be testing a form the page has deliberately taken away --
       which is how the old run produced a "confirmation names the real date" failure by
       forcing a hidden form and reading its untouched markup default. */
    if (!HAS_SESSION) {
      const closed = await js(`(()=>{
        const vis = e => { const r = e.getBoundingClientRect();
          return r.width > 1 && r.height > 1 && getComputedStyle(e).display !== 'none'; };
        const f = document.getElementById('form');
        return { formExists: !!f, formVisible: !!f && vis(f),
                 visibleInputs: [...document.querySelectorAll('form input')].filter(vis).length,
                 visibleSubmits: [...document.querySelectorAll('form button, form [type=submit]')].filter(vis).length,
                 offersVisible: [...document.querySelectorAll('.offer')].filter(vis).length };
      })()`);
      say(!closed.formVisible, 'the claim form is not offered', JSON.stringify(closed));
      say(closed.visibleInputs === 0, 'no field is reachable', 'visible inputs: ' + closed.visibleInputs);
      say(closed.visibleSubmits === 0, 'no submit control is reachable', 'visible submits: ' + closed.visibleSubmits);
      say(closed.offersVisible === 0, 'every .offer block is down', 'visible .offer: ' + closed.offersVisible);
      continue;
    }

    // ---- submit EMPTY ----
    const empty = await js(`(async()=>{
      document.getElementById('form').dispatchEvent(new Event('submit',{cancelable:true,bubbles:true}));
      await new Promise(r=>setTimeout(r,120));
      return { flagged:[...document.querySelectorAll('input.err')].map(i=>i.id),
               msg:document.getElementById('msg').textContent, sent:window.__sent.length };
    })()`, true);
    say(empty.flagged.length===4, 'empty submit flags all four fields', JSON.stringify(empty.flagged));
    say(empty.sent===0, 'empty submit sends NOTHING to the endpoint');
    if (tag==='phone') await shot('02-empty-phone.png', w);

    // ---- submit WRONG code, everything else valid ----
    await sleep(1500);   // let the 1.4s error highlight clear
    const wrong = await js(`(async()=>{
      document.getElementById('code').value='NOPE';
      document.getElementById('name').value='Maria Restrepo';
      document.getElementById('email').value='maria@example.com';
      document.getElementById('phone').value='3055550123';
      document.getElementById('form').dispatchEvent(new Event('submit',{cancelable:true,bubbles:true}));
      await new Promise(r=>setTimeout(r,120));
      return { flagged:[...document.querySelectorAll('input.err')].map(i=>i.id),
               msg:document.getElementById('msg').textContent, sent:window.__sent.length };
    })()`, true);
    say(wrong.flagged.length===1 && wrong.flagged[0]==='code', 'wrong code flags ONLY the code field', JSON.stringify(wrong.flagged));
    say(/code/i.test(wrong.msg) && /manager/i.test(wrong.msg), 'wrong code gets its own message', JSON.stringify(wrong.msg));
    say(wrong.sent===0, 'wrong code sends NOTHING');
    if (tag==='phone') await shot('03-wrong-code-phone.png', w);

    // ---- submit RIGHT (against the mock) ----
    await sleep(1500);
    const right = await js(`(async()=>{
      document.getElementById('code').value='greenst-nov7';   // lower case on purpose: must still pass
      document.getElementById('form').dispatchEvent(new Event('submit',{cancelable:true,bubbles:true}));
      await new Promise(r=>setTimeout(r,400));
      return { sent:window.__sent.length, payload:window.__sent[0]&&window.__sent[0].body,
               url:window.__sent[0]&&window.__sent[0].url,
               formHidden:document.getElementById('form').style.display==='none',
               done:document.getElementById('done').classList.contains('on'),
               doneText:document.getElementById('done').innerText };
    })()`, true);
    say(right.sent===1, 'valid submit sends exactly one request');
    say(right.formHidden && right.done, 'form is replaced by the confirmation');
    say(/held for/i.test(right.doneText), 'confirmation names the real date', JSON.stringify(right.doneText.replace(/\s+/g,' ').slice(0,110)));

    if (tag === 'phone') {
      await shot('04-success-phone.png', w);
      const pl = JSON.parse(right.payload);
      console.log('\n  THE PAYLOAD EX WILL READ:');
      console.log('  ' + JSON.stringify(pl, null, 2).split('\n').join('\n  '));
      say(pl.type==='emw-sponsored', 'type is emw-sponsored');
      say(pl.fields.sponsor==='Green Street Cafe', 'sponsor recorded');
      say(pl.fields.src==='green-street-cafe', 'src tag shape is valid (becomes src:green-street-cafe)');
      say(!!pl.name && !!pl.email && !!pl.phone, 'name, email and phone all captured');
      say(/^\d{4}-\d{2}-\d{2}$/.test(pl.fields.session), 'session date stamped', pl.fields.session);
      say(!('price' in pl) && !('amount' in pl), 'no price or amount in the payload');
      fs.writeFileSync(path.join(OUT,'payload-ex-will-read.json'), JSON.stringify(pl,null,2));
    } else {
      await shot('04-success-desktop.png', w);
    }
  }

  // The backend half must exist or every one of these is lost silently.
  const fn = fs.readFileSync(ROOT + '/netlify/functions/inquire.js','utf8');
  console.log('\nbackend');
  say(/'emw-sponsored':\s*'emw_sponsored'/.test(fn), "inquire.js registers type 'emw-sponsored'");
  say(/emw-sponsored.*SPONSORED SEAT/s.test(fn), 'inquire.js has a note heading for it');

  if (errors.length){ console.log('\nCONSOLE ERRORS:'); [...new Set(errors)].slice(0,4).forEach(e=>console.log('  '+e)); fails+=errors.length; }
  console.log('\n' + (fails ? fails+' FAILED' : 'all checks passed'));
  console.log('NOT COVERED: a real POST to the live function. Deliberate — see the header.');
  ws.close(); chrome.kill(); server.close();
  try { fs.rmSync(profile,{recursive:true,force:true}); } catch(e){}
  process.exit(fails?1:0);
})().catch(e => { console.error(e.message); try{chrome.kill();server.close();}catch(_){} process.exit(1); });
