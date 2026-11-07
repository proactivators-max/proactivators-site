# _verify — the page checkers

**Which suite guards which page**, and all of them run the same way: `node _verify/<suite>.js` from the repo root, no server to start and no setup — each one serves this repo itself, drives its own headless Chrome, blocks every request that is not `127.0.0.1`, and **exits 2 with a message rather than asserting against a page it failed to serve**.

| suite | guards | the thing it refuses to let through |
|---|---|---|
| `verify-beta.js` | `/beta/`, `/android/`, `/iphone/` | a button pointing at a path with nothing behind it, and the note disagreeing with the page its button opens |
| `verify-explainer.js` | `/operating-system/` | missing sections, more than one CTA, a lost `noindex`, prices or tiers, the words "men" or "streak" |
| `verify-sponsored.js` | `/workshop/sponsored/` | a price or checkout anywhere; and with no dated session, any reachable form or any promise of a held seat |
| `verify-launch.js` | `/launch/` | the past book launch drifting back into the present tense |
| `verify-postponed-branch.js` | `/rx/`, `/workshop/` | a venue, a price, a scarcity claim or a dead date surviving into the no-date state — body, DOM, metas **and the bytes a JS-less crawler is served** |
| `verify-sweep.js` | `/rx/<gym>/`, `/rx/thanks/`, `/start/` | the same, on the three pages the postponed suite does not cover |
| `verify-selling-intact.js` | `/workshop/` **selling** | the negative suites passing over a page that simply failed to render. Set `VS_FROM_TEMPLATE=1` for a session copied from the blank template |
| `verify-payload-consumers.js` | `netlify/functions/inquire.js` | `session:"none"` or `venue:""` reaching the CRM as a tag, a blank line, or anything shaped like a date. Stubs `fetch`, so **no CRM record is created** |
| `verify-ga4.js` | **every tracked page** | a page shipping with no analytics tag, a page firing twice, or a second measurement property. Measures the rendered DOM and the request that leaves it, not the bytes |

## Four things that will bite you

**A suite that cannot serve its page must stop, not fail.** `verify-explainer` once reported 11 failures — including `noindex present` FAIL on a page whose bytes plainly contain `noindex` — because it navigated to a server nobody had started. It failed identically before and after a change, so a before/after comparison looked clean while both numbers were worthless. Every suite here now probes its own page first and exits 2 if it is not there. Exit 2 means *void*; it does not mean red.

**Check what file a suite actually reads.** `verify-beta` spent weeks testing an 18KB page in another folder while this repo ships a 5KB chooser. Its 56 checks were real and proved nothing. A suite named after a page is not evidence it tests that page.

**Probe by what a reader sees, not by element id.** `verify-selling-intact` reported 6 failures against a correct page because the grid had been rebuilt from a state table and `#nPrice`/`#nVenue`/`#nTime` no longer existed. It reads the cells by their visible label now.

**A sweep over `*/index.html` is not a sweep over the site.** `06e5491` set out to put the analytics tag on "every page" and tagged 30 — then missed `/launch/bestseller.html`, `/launch/invitation.html`, `/launch/review.html` and `/launch/success.html`, because `/launch/` is the one directory whose pages are not all named `index.html`. Those four were live and untracked for six months and nothing noticed, because the only evidence was an absence. Enumerate pages as `git ls-files '*.html'` — what Pages serves is what git tracks — and never as a directory shape.

## Before adding a file here

There is **no `.nojekyll` and no `_config.yml`** in this repo, so GitHub Pages runs Jekyll and the leading underscore should keep this directory out of the build — but nothing underscore-prefixed has ever been live here, so that is unverified against the real site. **Write every file in here as though it will be served.** No keys, no tokens, no real emails or phone numbers, and no absolute paths: the repo root is `path.resolve(__dirname, '..')`, and Chrome is `process.env.CHROME || '<default install path>'`. The earlier copies of these scripts each hardcoded a path containing the account name, which is exactly what that rule is for.
