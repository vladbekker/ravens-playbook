// Serves and saves the Ravens playbook for marlbororavens.com.
// Anyone can read it (the plays inside stay locked with the team PIN); only a coach can save:
// a coach PIN unlocks the staff key in the page, and the key's SHA-256 must match STAFF_KEY_HASH.
// Every save keeps the version it replaced, so the last 30 versions can always be brought back.
const ALLOWED = [/^https:\/\/(www\.)?marlbororavens\.com$/, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/];
const MAX_BYTES = 1900000;
let ready = false;

function cors(origin){
  if (!ALLOWED.some(r => r.test(origin || ""))) return {};
  return { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Max-Age": "86400", "Vary": "Origin" };
}
function reply(body, status, origin, raw){
  return new Response(raw ? body : JSON.stringify(body), { status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors(origin) } });
}
async function setup(env){
  if (ready) return;
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS playbook (id INTEGER PRIMARY KEY, data TEXT NOT NULL, rev TEXT NOT NULL, saved_at TEXT NOT NULL)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS history (id INTEGER PRIMARY KEY AUTOINCREMENT, rev TEXT NOT NULL, data TEXT NOT NULL, saved_at TEXT NOT NULL)")
  ]);
  ready = true;
}
async function current(env){
  const row = await env.DB.prepare("SELECT data, rev FROM playbook WHERE id = 1").first();
  if (row) return { data: row.data, rev: row.rev };
  const res = await fetch(`${env.SEED_URL}?t=${Date.now()}`);
  if (!res.ok) return null;
  const data = await res.text();
  let rev = null;
  try { rev = JSON.parse(data).rev || null; } catch {}
  return { data, rev };
}
async function sha256hex(s){
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, "0")).join("");
}

export default {
  async fetch(req, env){
    const url = new URL(req.url), origin = req.headers.get("Origin");
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
    await setup(env);

    if (url.pathname === "/playbook" && req.method === "GET"){
      const cur = await current(env);
      return cur ? reply(cur.data, 200, origin, true) : reply({ error: "missing" }, 404, origin);
    }

    if (url.pathname === "/save" && req.method === "POST"){
      let body;
      try { body = await req.json(); } catch { return reply({ error: "bad_request" }, 400, origin); }
      const { key, data, prevRev } = body || {};
      if (typeof key !== "string" || !data || typeof data !== "object" || typeof data.rev !== "string" || !data.rev)
        return reply({ error: "bad_request" }, 400, origin);
      if (!env.STAFF_KEY_HASH || await sha256hex(key) !== env.STAFF_KEY_HASH) return reply({ error: "not_coach" }, 403, origin);
      const text = JSON.stringify(data);
      if (text.length > MAX_BYTES) return reply({ error: "too_large" }, 413, origin);
      const cur = await current(env);
      if (cur && cur.rev && prevRev !== cur.rev) return reply({ error: "conflict", rev: cur.rev }, 409, origin);
      const now = new Date().toISOString();
      // keep the old version, then replace it only if nobody saved in between (compare-and-set on rev)
      const results = await env.DB.batch([
        env.DB.prepare("INSERT INTO history (rev, data, saved_at) SELECT rev, data, saved_at FROM playbook WHERE id = 1"),
        cur && cur.rev
          ? env.DB.prepare("INSERT INTO playbook (id, data, rev, saved_at) VALUES (1, ?1, ?2, ?3) ON CONFLICT(id) DO UPDATE SET data = ?1, rev = ?2, saved_at = ?3 WHERE playbook.rev = ?4").bind(text, data.rev, now, cur.rev)
          : env.DB.prepare("INSERT INTO playbook (id, data, rev, saved_at) VALUES (1, ?1, ?2, ?3) ON CONFLICT(id) DO UPDATE SET data = ?1, rev = ?2, saved_at = ?3").bind(text, data.rev, now),
        env.DB.prepare("DELETE FROM history WHERE id NOT IN (SELECT id FROM history ORDER BY id DESC LIMIT 30)")
      ]);
      if (!results[1].meta.changes) return reply({ error: "conflict" }, 409, origin);
      return reply({ ok: true, rev: data.rev }, 200, origin);
    }

    return reply({ error: "not_found" }, 404, origin);
  }
};
