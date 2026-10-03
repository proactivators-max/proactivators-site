// rx-seats: GET → { seats, sold, left, soldOut, session:{date,label,time,venue,room}, asOf }
// Never fakes a number: if GHL can't be read, `sold`/`left` are null and the page shows "40 seats" only.
const LOCATION = "WaGZVVD0QFf8Tv8eAINm";                // ProActivators (CRM) sub-account
// WHY LINKS AND NOT PRODUCT IDS:
// /payments/orders (the LIST endpoint) does NOT return line items. Its rows carry
// `onetimeProducts: 1` — a COUNT, not an id — so a filter on items[].product._id matched
// nothing and this worker reported "40 left" forever no matter how many seats sold. Only
// the single-order endpoint includes items, and fetching one request per order to find out
// is not worth it. `sourceId` (the payment link) is on every row and identifies the seat.
// ADDING A NEW WAY TO BUY? Add its payment-link id here or it will not count.
const LINKS = new Set([
  "6a120c64ee2395af2c17fec4",                           // Executive Mindset Workshop - Regular ($197)
  "6a120d623f4eb69bef72f827",                           // Executive Mindset Workshop - Early Bird ($147)
]);
const SESSION_URL = "https://proactivatorsclub.com/rx/session.json";
const ORIGINS = ["https://proactivatorsclub.com", "https://www.proactivatorsclub.com", "http://localhost:5178"];

export default {
  async fetch(req, env, ctx) {
    const origin = req.headers.get("Origin") || "";
    const cors = {
      "Access-Control-Allow-Origin": ORIGINS.includes(origin) ? origin : ORIGINS[0],
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Cache-Control": "public, max-age=30",
      "Content-Type": "application/json",
    };
    if (req.method === "OPTIONS") return new Response("", { status: 204, headers: cors });

    // ?debug=1 bypasses the cache too — otherwise the cached body, computed without
    // debug, is served straight back and the diagnostics never appear.
    const DEBUG = new URL(req.url).searchParams.get("debug") === "1";

    // 60-second edge cache so a wall of scans doesn't hammer GHL
    const cache = caches.default;
    const key = new Request("https://rx-seats.cache/v2", { method: "GET" });
    const hit = DEBUG ? null : await cache.match(key);
    if (hit) { const r = new Response(hit.body, hit); for (const [k, v] of Object.entries(cors)) r.headers.set(k, v); return r; }

    let session = null;
    try {
      const s = await (await fetch(SESSION_URL, { cf: { cacheTtl: 60 } })).json();
      const today = new Date().toISOString().slice(0, 10);
      session = (s.upcoming || []).find(u => u.date >= today) || null;
      var manual = s.manualSold || 0, seatsDefault = s.seats || 40;
    } catch (e) { /* session unreadable: still answer, with nothing to count against */ }

    // Counts and statuses only; no PII.
    const dbg = { rowsSeen: 0, statuses: {}, liveModes: {}, productIds: {}, keys: null, httpStatus: null };
    let sold = null, note = null;
    if (!session) note = "no upcoming session in session.json";
    else if (!env.GHL_TOKEN) note = "GHL_TOKEN is not set on this worker";
    else {
      try {
        const since = new Date((session.salesOpen || "2026-01-01") + "T00:00:00Z").getTime();
        let count = 0, offset = 0, more = true;
        while (more && offset < 500) {
          const url = `https://services.leadconnectorhq.com/payments/orders?altId=${LOCATION}&altType=location&limit=100&offset=${offset}`;
          const r = await fetch(url, { headers: { Authorization: `Bearer ${env.GHL_TOKEN}`, Version: "2021-07-28" } });
          // THE BUG THIS FIXES: a 401/403/5xx still returns JSON, just with no order list.
          // `j.data || []` read that as "zero orders sold" and the page confidently said
          // "40 left" while a seat had been sold. An unreadable API must produce null, not 0 —
          // that is the promise in the header comment, and it was not being kept.
          dbg.httpStatus = r.status;
          if (!r.ok) throw new Error("orders HTTP " + r.status);
          const j = await r.json();
          if (dbg.keys === null) dbg.keys = Object.keys(j || {});
          // GHL is not consistent across endpoints: some return {data:[...]}, others
          // {data:{data:[...]}} (its own transactions endpoint does the latter). Accept both,
          // and treat anything else as unreadable rather than as an empty list.
          const rows = Array.isArray(j.data) ? j.data
                     : (j.data && Array.isArray(j.data.data)) ? j.data.data
                     : null;
          if (rows === null) throw new Error("orders payload contained no array");
          dbg.rowsSeen += rows.length;
          for (const o of rows) {
            if (DEBUG) {
              if (!dbg.rowKeys) dbg.rowKeys = Object.keys(o);
              if (!dbg.itemShape) dbg.itemShape = {
                hasItems: Array.isArray(o.items), n: (o.items || []).length,
                itemKeys: (o.items && o.items[0]) ? Object.keys(o.items[0]) : null,
                productType: (o.items && o.items[0]) ? typeof o.items[0].product : null,
              };
              if (!dbg.sourceSample) dbg.sourceSample = o.source || null;
              // product IDs and link IDs are not PII; names/emails are, so they stay out.
              if ((dbg.rows = dbg.rows || []).length < 5) dbg.rows.push({
                totalProducts: o.totalProducts, sourceId: o.sourceId,
                counted: LINKS.has(o.sourceId) && new Date(o.createdAt).getTime() >= since,
                subtotal: o.subtotal, createdAt: o.createdAt,
              });
              if (!dbg.amountSample) dbg.amountSample = { amount: o.amount, summary: o.amountSummary || null };
              dbg.statuses[o.status] = (dbg.statuses[o.status] || 0) + 1;
              dbg.liveModes[String(o.liveMode)] = (dbg.liveModes[String(o.liveMode)] || 0) + 1;
              for (const it of (o.items || [])) {
                const p = it.product && it.product._id;
                if (p) dbg.productIds[p] = (dbg.productIds[p] || 0) + 1;   // always empty on the list endpoint
              }
            }
            if (o.status !== "completed" || o.liveMode === false) continue;
            if (new Date(o.createdAt).getTime() < since) continue;
            // A 100%-off comp has amount 0 but still occupies a chair, so count seats by
            // the link used, never by money received.
            if (LINKS.has(o.sourceId)) count += Math.max(1, Number(o.totalProducts || 1));
          }
          offset += rows.length; more = rows.length === 100;
        }
        sold = count + (manual || 0);
      } catch (e) { sold = null; note = "orders unreadable: " + e.message; }
    }

    const seats = (session && session.seats) || seatsDefault || 40;
    const left = sold === null ? null : Math.max(0, seats - sold);
    const body = JSON.stringify({
      seats, sold, left, soldOut: left !== null && left <= 0,
      // Only present when the count could not be read. If you ever see "40 seats" on the
      // page instead of "N left", curl this worker and read this field — it says why.
      ...(note ? { note } : {}),
      ...(DEBUG ? { debug: dbg } : {}),
      session: session ? { date: session.date, label: session.label, time: session.time, venue: session.venue, room: session.room || "" } : null,
      asOf: new Date().toISOString(),
    });
    const res = new Response(body, { status: 200, headers: cors });
    if (!DEBUG) ctx.waitUntil(cache.put(key, new Response(body, { headers: { "Cache-Control": "public, max-age=60", "Content-Type": "application/json" } })));
    return res;
  },
};
