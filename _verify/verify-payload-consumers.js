/* EX's question, routed by Era: are `session: "none"` and `venue: ""` read as "no date / no
   venue" everywhere the payload is consumed, and does anything format "none" as a date?

   Reading the code answers it; RUNNING it proves it. This requires the REAL
   netlify/functions/inquire.js handler and stubs globalThis.fetch before loading it, so the
   genuine code path executes and captures what it WOULD have sent. NOTHING LEAVES THIS
   PROCESS and NO CRM RECORD IS CREATED -- the stub resolves locally and the captured requests
   are asserted here.

   GHL_API_KEY is set to an obvious placeholder purely so the handler gets past its own
   config guard. It is not a credential, it is never sent anywhere, and the stub would
   swallow it if it were. */
const path = require('node:path');
/* _verify/ sits at the repo root, so the repo is one level up. Derived rather than
   hardcoded: the old absolute path carried the account name into a file that may be
   served. */
const REPO = path.resolve(__dirname, '..');

const ROOT = REPO;
process.env.GHL_API_KEY = 'PLACEHOLDER-NOT-A-KEY-STUBBED-FETCH';

let pass = 0, fail = 0; const fails = [];
const ck = (ok, label, extra) => {
  if (ok) { pass++; console.log('  ok    ' + label + (extra !== undefined ? '   ' + extra : '')); }
  else { fail++; fails.push(label); console.log('  FAIL  ' + label + (extra !== undefined ? '   ' + extra : '')); }
};

/* capture every outbound call the handler tries to make */
const sent = [];
globalThis.fetch = async (url, opts = {}) => {
  sent.push({ url: String(url), body: opts.body ? JSON.parse(opts.body) : null });
  if (String(url).includes('/contacts/') && String(url).includes('/notes')) {
    return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' };
  }
  /* the contact-create call */
  return { ok: true, status: 200, json: async () => ({ contact: { id: 'STUB_CONTACT_ID' } }),
           text: async () => JSON.stringify({ contact: { id: 'STUB_CONTACT_ID' } }) };
};

const { handler } = require(path.join(ROOT, 'netlify/functions/inquire.js'));

/* The handler drops anything whose Origin is not proactivatorsclub.com -- and it answers that
   with a SILENT FAKE 200 {success:true}, deliberately, so bots cannot tell they were blocked.
   My first run of this file had no Origin header, so every request was dropped, every
   outbound list was empty, and all six NEGATIVE assertions passed on a probe that had done
   nothing. Only the positive checks and the control caught it. Hence both of the following:
   the real Origin, and a hard guard that refuses to let a dead run look like a clean one. */
async function post(type, fields) {
  sent.length = 0;
  const res = await handler({
    httpMethod: 'POST',
    headers: { origin: 'https://proactivatorsclub.com' },
    body: JSON.stringify({ type, name: 'Proof Run', email: 'proof@example.com', phone: '3055550100', fields }),
  });
  if (sent.length === 0) {
    throw new Error('the handler made NO outbound call for type "' + type + '" -- it was dropped ' +
      '(origin allowlist, invalid type, or a guard). Every negative assertion below would pass ' +
      'for the wrong reason, so this run is void rather than green. Response: ' + JSON.stringify(res));
  }
  const create = sent.find(s => !s.url.includes('/notes'));
  const note = sent.find(s => s.url.includes('/notes'));
  return { res, create, note, noteText: note && note.body ? String(note.body.body || '') : '' };
}

(async () => {
  /* ---------- the state the tree is actually in: no session ---------- */
  console.log('\n===== /rx and /workshop waitlist, no session  (session:"none") =====');
  for (const type of ['rx-waitlist', 'emw-waitlist']) {
    const r = await post(type, { gym: 'crossfit-mia', src: 'wall', session: 'none', page: '/rx/', state: 'nodate', last: '' });
    const tags = (r.create && r.create.body && r.create.body.tags) || [];
    console.log('  -- ' + type + ' tags: ' + JSON.stringify(tags));
    ck(!tags.some(t => /none/i.test(t)), type + ': no tag contains "none"', JSON.stringify(tags.filter(t => /none/i.test(t))));
    ck(!tags.some(t => /^session:/i.test(t)), type + ': session never becomes a tag');
    ck(!tags.some(t => /^venue:/i.test(t)), type + ': venue never becomes a tag');
    ck(tags.includes('gym:crossfit-mia') && tags.includes('src:wall'),
       type + ': the whitelisted attribution tags DO still come through', JSON.stringify(tags));
    ck(/\n\s*session: none/.test(r.noteText), type + ': the note records session as the literal word "none"');
    ck(!/\n\s*last:/.test(r.noteText), type + ': empty `last` is omitted from the note, not printed blank');
  }

  /* ---------- sponsored, which is the only producer of `venue` ---------- */
  console.log('\n===== /workshop/sponsored, no session  (session:"none", venue:"") =====');
  const s = await post('emw-sponsored', { sponsor: 'Green Street Cafe', src: 'green-street-cafe',
                                          session: 'none', venue: '', page: '/workshop/sponsored/' });
  const stags = (s.create && s.create.body && s.create.body.tags) || [];
  console.log('  -- tags: ' + JSON.stringify(stags));
  console.log('  -- note:\n' + s.noteText.split('\n').map(l => '       ' + l).join('\n'));
  ck(!stags.some(t => /none/i.test(t)), 'no tag contains "none"');
  ck(!stags.some(t => /^venue:/i.test(t)), 'venue never becomes a tag');
  ck(!/\n\s*venue:/.test(s.noteText), 'empty venue is OMITTED from the note, not printed as a blank line');
  ck(/\n\s*session: none/.test(s.noteText), 'session reads as the literal word "none", not a date');
  ck(stags.includes('emw_sponsored'), 'the type tag still lands -- the seat is still recorded', JSON.stringify(stags));

  /* ---------- nothing anywhere turns it into a date ---------- */
  console.log('\n===== does anything format it as a date? =====');
  const all = JSON.stringify(sent) + s.noteText;
  ck(!/1970-01-01|Invalid Date|NaN/.test(all),
     'no "Invalid Date", no NaN, no 1970 epoch anywhere in what would be sent',
     (all.match(/1970-01-01|Invalid Date|NaN/) || [''])[0]);
  /* the honest version of the same check: prove the value survives as the string it was */
  ck(/"session":"none"/.test(JSON.stringify(sent)) || /session: none/.test(s.noteText),
     'the value reaches the consumer still as the string "none"');

  /* ---------- the control: a DATED session must still carry its date ---------- */
  console.log('\n===== control: a dated session must still carry its date through =====');
  const d = await post('emw-sponsored', { sponsor: 'Green Street Cafe', src: 'green-street-cafe',
                                          session: '2027-03-06', venue: 'A Confirmed Room', page: '/workshop/sponsored/' });
  ck(/\n\s*session: 2027-03-06/.test(d.noteText), 'a real date still reaches the note intact');
  ck(/\n\s*venue: A Confirmed Room/.test(d.noteText), 'a real venue still reaches the note intact');
  ck(!((d.create.body.tags || []).some(t => /2027|confirmed-room/i.test(t))),
     'but neither is turned into a tag even when present', JSON.stringify(d.create.body.tags));

  console.log('\n' + pass + ' checks passed, ' + fail + ' failed');
  if (fail) console.log('FAILED:\n' + fails.map(f => ' - ' + f).join('\n'));
  console.log('NO CRM RECORD WAS CREATED: every outbound call was captured by a local stub.');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('VERIFY FAILED: ' + e.message); process.exit(1); });
