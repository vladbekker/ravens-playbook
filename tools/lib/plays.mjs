// Readies designed plays for the book: the team's usual lineup, blue/green kept, only the throw dashed,
// any X moved off a route line so the card reads clearly, and 2 stopwatches unless the play says otherwise.
const LINEUP = { "1":[90,262], "2":[190,262], "C":[300,262], "3":[410,262], "4":[510,262], "QB":[300,335] };
const LABELS = ["1", "2", "C", "3", "4", "RB", "QB"];
const inX = v => Math.max(20, Math.min(580, Math.round(v))), inY = v => Math.max(30, Math.min(395, Math.round(v)));

function distToSegment(p, a, b){
  const dx = b[0] - a[0], dy = b[1] - a[1], len2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

export function prepPlay(p){
  const players = p.players.map(pl => {
    if (pl.t !== "O") return { t:"X", x:inX(pl.x), y:inY(pl.y) };
    const to = pl.l === "RB" ? [pl.x < 300 ? 245 : 355, 335] : LINEUP[pl.l] || [pl.x, pl.y];
    const dx = to[0] - pl.x, dy = to[1] - pl.y;   // a route moves with its player
    const o = { t:"O", l:pl.l, x:to[0], y:to[1], r:pl.r ? pl.r.map(q => [inX(q[0] + dx), inY(q[1] + dy)].concat(q[2] ? [1] : [])) : null };
    if (pl.hi) o.hi = true; else if (pl.gr) o.gr = true;
    if (pl.dash){ if (o.r && o.r.length > 1) o.r[o.r.length - 1][2] = 1; else o.dash = true; }   // a sprint then a throw: only the throw is dashed
    return o;
  });
  const lines = players.filter(o => o.t === "O" && o.r).flatMap(o => [[o.x, o.y]].concat(o.r).map((q, i, all) => i ? [all[i - 1], q] : null).filter(Boolean));
  for (const x of players.filter(o => o.t === "X"))
    for (let step = 0; step < 12 && lines.length && Math.min(...lines.map(([a, b]) => distToSegment([x.x, x.y], a, b))) < 22; step++) x.x += x.x < 300 ? 5 : -5;
  const problems = [];
  for (const l of LABELS) if (players.filter(o => o.l === l).length !== 1) problems.push(`needs exactly one "${l}"`);
  if (players.filter(o => o.t === "X").length !== 7) problems.push("needs 7 X's");
  if (p.time !== undefined && ![1, 2, 3].includes(p.time)) problems.push("time should be 1, 2 or 3 stopwatches");
  return { play:{ id:p.id, name:p.name, note:p.note || "", players, base:null, fav:!!p.fav, time:p.time || 2 }, problems };
}
