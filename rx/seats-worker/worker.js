// rx-seats: GET → { seats, sold, left, soldOut, session:{date,label,time,venue,room}, asOf }
// Never fakes a number: if GHL can't be read, `sold`/`left` are null and the page shows "40 seats" only.
const LOCATION = "WaGZVVD0QFf8Tv8eAINm";                // ProActivators (CRM) sub-account
const PRODUCTS = new Set([                              // both workshop products count as a seat
  "6a12083f32bdfd62070b5391",                           // Executive Mindset Workshop - Regular ($197)
  "6a1207db32bdfd6ec00b4c7b",                           // Executive Mindset Workshop - Early Bird ($147)
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

    // 60-second edge cache so a wall of scans doesn't hammer GHL
    const cache = caches.default;
    const key = new Request("https://rx-seats.cache/v1", { method: "GET" });
    const hit = await cache.match(key);
    if (hit) { const r = new Response(hit.body, hit); for (const [k, v] of Object.entries(cors)) r.headers.set(k, v); return r; }

    let session = null;
    try {
      const s = await (await fetch(SESSION_URL, { cf: { cacheTtl: 60 } })).json();
      const today = new Date().toISOString().slice(0, 10);
      session = (s.upcoming || []).find(u => u.date >= today) || null;
      var manual = s.manualSold || 0, seatsDefault = s.seats || 40;
    } catch (e) { /* session unreadable: still answer, with nothing to count against */ }

    let sold = null;
    if (session && env.GHL_TOKEN) {
      try {
        const since = new Date((session.salesOpen || "2026-01-01") + "T00:00:00Z").getTime();
        let count = 0, offset = 0, more = true;
        while (more && offset < 500) {
          const url = `https://services.leadconnectorhq.com/payments/orders?altId=${LOCATION}&altType=location&limit=100&offset=${offset}`;
          const j = await (await fetch(url, { headers: { Authorization: `Bearer ${env.GHL_TOKEN}`, Version: "2021-07-28" } })).json();
          const rows = j.data || [];
          for (const o of rows) {
            if (o.status !== "completed" || o.liveMode === false) continue;
            if (new Date(o.createdAt).getTime() < since) continue;
            for (const it of (o.items || [])) {
              const pid = it.product && it.product._id;
              if (PRODUCTS.has(pid)) count += Math.max(1, Number(it.qty || 1));
            }
          }
          offset += rows.length; more = rows.length === 100;
        }
        sold = count + (manual || 0);
      } catch (e) { sold = null; }
    }

    const seats = (session && session.seats) || seatsDefault || 40;
    const left = sold === null ? null : Math.max(0, seats - sold);
    const body = JSON.stringify({
      seats, sold, left, soldOut: left !== null && left <= 0,
      session: session ? { date: session.date, label: session.label, time: session.time, venue: session.venue, room: session.room || "" } : null,
      asOf: new Date().toISOString(),
    });
    const res = new Response(body, { status: 200, headers: cors });
    ctx.waitUntil(cache.put(key, new Response(body, { headers: { "Cache-Control": "public, max-age=60", "Content-Type": "application/json" } })));
    return res;
  },
};
