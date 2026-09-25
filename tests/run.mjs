// End-to-end tests. Runs the real Worker on this computer (wrangler dev, a throwaway local database) with
// made-up PINs and three sample plays, then uses the page in headless Chrome the way players and coaches do.
// Run with: npm test
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lockBox, newStaffKey, staffKeyHash } from "../tools/lib/box.mjs";
import { launch, wait } from "../tools/lib/chrome.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const TEAM = "135790", COACH = "coachtest1", COACH2 = "mikepin123", NEWTEAM = "246810";   // test PINs only
const plays = JSON.parse(readFileSync(join(ROOT, "tests/fixtures/plays.json"), "utf8"));
const N = plays.length;

/* ---------- a site with test data ---------- */
const work = mkdtempSync(join(tmpdir(), "ravens-test-")), site = join(work, "public"), state = join(work, "state");
mkdirSync(site);
copyFileSync(join(ROOT, "public/index.html"), join(site, "index.html"));
const staffKey = newStaffKey();
writeFileSync(join(site, "playbook.json"), JSON.stringify({ v:3, rev:"start", logo:null, title:null, edge:3,
  lock:await lockBox({ plays }, TEAM), staff:await lockBox({ teamPin:TEAM }, staffKey, 1000),
  coaches:[{ name:"Head coach", box:await lockBox({ k:staffKey }, COACH) }] }));
const port = 8790 + Math.floor(Math.random() * 100), BASE = `http://127.0.0.1:${port}`;
const server = spawn("npx", ["wrangler", "dev", "--port", String(port), "--ip", "127.0.0.1", "--assets", site, "--persist-to", state,
  "--var", `STAFF_KEY_HASH:${staffKeyHash(staffKey)}`, "--log-level", "warn"], { cwd:ROOT, detached:true, stdio:["ignore", "ignore", "pipe"] });
let serverLog = ""; server.stderr.on("data", d => { serverLog += d; });
let up = false;
for (let i = 0; i < 120 && !up; i++){ try { up = (await fetch(`${BASE}/`)).ok; } catch {} if (!up) await wait(500); }
let page, failed = 0;
const stop = async () => { if (page) await page.close(); try { process.kill(-server.pid); } catch {} rmSync(work, { recursive:true, force:true }); };
if (!up){ console.log("FAIL  the local playbook server didn't start\n" + serverLog.slice(-2000)); await stop(); process.exit(1); }

/* ---------- helpers ---------- */
const check = (name, ok, extra = "") => { if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`); };
page = await launch();
await page.size(1024, 1300);
await page.go(`${BASE}/`);
async function openAs(pin, { keep = false, hash = "" } = {}){
  if (!keep) await page.ev("localStorage.clear()");
  await page.go(`${BASE}/?t=${Date.now()}${hash}`);
  if (!pin) return;
  await page.waitFor(`!document.getElementById("gate").hidden`);
  await page.type("#gate-pin", pin); await page.click("#gate-go");
  await page.waitFor(`document.querySelectorAll("#plays > .play").length || document.getElementById("gate-err").textContent`);
  await wait(200);
}
const view = () => page.ev(`({ plays: document.querySelectorAll("#plays > .play").length, coach: !document.getElementById("settings-btn").hidden,
  gate: !document.getElementById("gate").hidden, err: document.getElementById("gate-err").textContent,
  stars: document.querySelectorAll(".star.on, .star-view:not([hidden])").length })`);
/* waits for a fresh "Saved" message, then clears it so the next save can't be fooled by an old one */
const saved = async () => {
  const ok = await page.waitFor(`(() => { const s = document.getElementById("status"); return !s.hidden && /Saved/.test(s.textContent); })()`, 15000);
  await page.ev(`(() => { const s = document.getElementById("status"); s.hidden = true; s.textContent = ""; })()`);
  return ok;
};
const firstId = () => page.ev(`document.querySelector("#plays > .play").id`);
const cx = (id, i = 0) => page.ev(`+document.querySelector("#${id} svg g.drag[data-i='${i}'] circle").getAttribute("cx")`);

/* ---------- players ---------- */
await openAs(TEAM);
let v = await view();
check("team PIN opens the players' view with every play", v.plays === N && !v.coach, JSON.stringify(v));
check("players get no coach tools", await page.ev(`!document.querySelectorAll("[id$='-base'], #plays .star").length && document.getElementById("add").hidden`));
check("old leftovers are gone (setup, Lock, GitHub key)", await page.ev(`!document.getElementById("setup-btn") && !document.getElementById("lock-btn") && !document.getElementById("token-new")`));
check("each card has the one-line legend", await page.ev(`["us", "them", "throw", "primary", "secondary"].every(w => [...document.querySelectorAll("#plays > .play:first-child svg g text")].some(t => t.textContent === w))`));
let id = await firstId(); const x0 = await cx(id);
await page.drag(`#${id} svg g.drag[data-i='0'] circle`, 60);
check("players can drag a piece", await cx(id) > x0 && await page.ev(`!document.getElementById("${id}-undo").hidden`));
await page.click(`#${id}-undo`); await wait(150);
check("Reset puts it back", await cx(id) === x0);
let id2 = await page.ev(`document.querySelector("#plays > .play:nth-child(2)").id`);
const noteBefore = await page.ev(`document.querySelector("#${id2} .note-view").textContent`), f0 = await cx(id2);
await page.click(`#${id2}-flip`); await wait(150);
check("Flip mirrors the play and swaps left/right in the note", await cx(id2) === 600 - f0 &&
  await page.ev(`document.querySelector("#${id2} .note-view").textContent`) !== noteBefore);
await page.click(`#${id2}-flip`); await wait(150);
const spot = await page.point(`#${id} .card`, 0.95, 0.5);
await page.tap(spot); await wait(80); await page.tap(spot); await wait(400);
check("double-tap shows a play full screen", await page.ev(`!document.getElementById("fullcard").hidden && !!document.querySelector("#fullcard-body .card")`));
await page.click("#fullcard-close"); await wait(200);
check("Close puts the card back", await page.ev(`document.getElementById("fullcard").hidden && !!document.querySelector("#${id} .card")`));
await page.ev(`document.querySelector("#plays > .play:nth-child(2)").scrollIntoView()`); await wait(500);
check("the play on screen is highlighted in the menu", await page.ev(`(() => { const on = [...document.querySelectorAll("#jump a.on")];
  return on.length === 1 && on[0].getAttribute("href") === "#" + document.querySelector("#plays > .play:nth-child(2)").id; })()`));
await page.size(420, 900); await wait(400);
check("the play menu stays one row and fades where there are more plays", await page.ev(`(() => { const j = document.getElementById("jump");
  j.scrollLeft = 0; j.dispatchEvent(new Event("scroll")); return j.getBoundingClientRect().height < 50 && j.classList.contains("more-right") && !j.classList.contains("more-left"); })()`));
await page.ev(`(() => { const j = document.getElementById("jump"); j.scrollLeft = j.scrollWidth; j.dispatchEvent(new Event("scroll")); })()`); await wait(150);
check("scrolled to the end, the fade moves to the other side", await page.ev(`(() => { const j = document.getElementById("jump"); return j.classList.contains("more-left") && !j.classList.contains("more-right"); })()`));
await page.size(1024, 1300); await wait(300);
check("on wider screens Show X's and Settings sit in the same rows as the plays", await page.ev(`(() => {
  const chips = [...document.querySelectorAll("#jump a")], tools = document.querySelector(".nav-tools").getBoundingClientRect(), last = chips[chips.length - 1].getBoundingClientRect();
  return Math.abs((tools.top + tools.bottom) / 2 - (last.top + last.bottom) / 2) < 8 && tools.left > last.right; })()`));
check("on wider screens every row of play buttons lines up on both edges, and the last row keeps its normal size", await page.ev(`(() => {
  const jump = document.getElementById("jump"), tools = document.querySelector(".nav-tools"), extra = [];
  for (let i = 0; i < 8; i++) for (const a of [...jump.querySelectorAll("a")].slice(0, 3)) extra.push(jump.appendChild(a.cloneNode(true)));
  try {
    const box = document.querySelector(".nav-in").getBoundingClientRect(), rows = [];
    for (const el of [...jump.querySelectorAll("a"), tools]){ const r = el.getBoundingClientRect(), mid = (r.top + r.bottom) / 2, row = rows.find(x => Math.abs(x.mid - mid) < 10); row ? row.els.push(el) : rows.push({ mid, els:[el] }); }
    const normal = a => { const r = document.createRange(); r.selectNodeContents(a); return r.getBoundingClientRect().width + 24; };
    return rows.length > 2 && rows.every(({ els }) => Math.abs(els[0].getBoundingClientRect().left - box.left) < 2 && Math.abs(els[els.length - 1].getBoundingClientRect().right - box.right) < 2
      && (!els.includes(tools) || els.every(el => el === tools || el.getBoundingClientRect().width - normal(el) < 3)));
  } finally { extra.forEach(a => a.remove()); } })()`));
v = (await openAs("000000"), await view());
check("a wrong PIN is turned away", v.plays === 0 && /didn't work/.test(v.err), v.err);

/* ---------- coaches ---------- */
v = (await openAs(COACH), await view());
check("coach PIN opens coach view", v.coach && v.plays === N, JSON.stringify(v));
id2 = await page.ev(`document.querySelector("#plays > .play:nth-child(2)").id`);
await page.click(`#${id2}-fav`); await page.click("#add"); await wait(300); await page.click("#save");
check("a coach saves with just the PIN", await saved());
v = (await openAs(null, { keep:true }), await page.waitFor(`document.querySelectorAll("#plays > .play").length`), await view());
check("after a reload the new play and the star are there (coach remembered)", v.coach && v.plays === N + 1 && v.stars === 1, JSON.stringify(v));
await page.click(`#${id2}-fav`); await page.click("#save");
check("a second save right away works too", await saved());
id = await firstId();
await page.tap(await page.point(`#${id} svg g.drag[data-i='0'] circle`)); await wait(250);
await page.click(`#${id}-gr`); await wait(150);
check("Green highlights a player", await page.ev(`document.querySelector("#${id} svg g.drag[data-i='0'] circle").getAttribute("stroke")`) === "#15943e");
await page.click("#save");
const greenSaved = await saved();
v = (await openAs(TEAM), await view());
const stroke = await page.ev(`document.querySelector("#${id} svg g.drag[data-i='0'] circle").getAttribute("stroke")`);
check("players see the saved changes at once", greenSaved && v.plays === N + 1 && v.stars === 0 && stroke === "#15943e", JSON.stringify({ ...v, greenSaved, stroke }));
await openAs(COACH); await page.click("#settings-btn");
await page.type("#coach-name", "Coach Mike"); await page.type("#coach-new", COACH2); await page.click("#coach-set");
await page.waitFor(`/is added/.test(document.getElementById("set-msg").textContent)`); await page.click("#save");
check("a coach adds another coach", await saved());
v = (await openAs(COACH2), await view());
check("the new coach's PIN opens coach view", v.coach, JSON.stringify(v));
await page.click(`#${await firstId()}-fav`); await page.click("#save");
check("the new coach can save", await saved());
await openAs(COACH); await page.click("#settings-btn");
await page.ev(`[...document.querySelectorAll("#coach-list button")].forEach(b => b.click())`); await wait(100);
await page.ev(`[...document.querySelectorAll("#coach-list button")].forEach(b => b.click())`); await wait(200); await page.click("#save"); await saved();
v = (await openAs(COACH2), await view());
check("a removed coach's PIN stops working", !v.coach && v.plays === 0, v.err);
await openAs(COACH); await page.click("#settings-btn"); await page.type("#pin-new", NEWTEAM); await page.click("#pin-set");
await page.waitFor(`/New team PIN/.test(document.getElementById("pin-state").textContent)`); await page.click("#save"); await saved();
v = (await openAs(NEWTEAM), await view());
check("a new team PIN works", v.plays === N + 1 && !v.coach, JSON.stringify(v));
v = (await openAs(TEAM), await view());
check("the old team PIN stops working", v.plays === 0);
v = (await openAs(COACH), await view());
check("coaches still get in after the team PIN changes", v.coach);
await openAs(NEWTEAM); v = (await openAs(null, { keep:true, hash:"#coach" }), await page.waitFor(`!document.getElementById("gate").hidden`), await view());
check("the #coach link asks for a PIN even when the team PIN is remembered", v.gate);

/* ---------- the server ---------- */
const current = await (await fetch(`${BASE}/playbook`)).json();
let r = await fetch(`${BASE}/save`, { method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify({ key:"not-the-key", data:{ ...current, rev:"x1" }, prevRev:current.rev }) });
check("the server refuses a save without the staff key", r.status === 403, String(r.status));
r = await fetch(`${BASE}/save`, { method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify({ key:staffKey, data:{ ...current, rev:"x2" }, prevRev:"an-old-version" }) });
check("the server refuses a save made on an old copy", r.status === 409, String(r.status));
const kept = JSON.parse(execFileSync("npx", ["wrangler", "d1", "execute", "ravens-playbook", "--local", "--persist-to", state, "--json", "--command", "SELECT count(*) AS n FROM history"], { cwd:ROOT, encoding:"utf8", stdio:["ignore", "pipe", "ignore"] }))[0].results[0].n;
check("the server keeps earlier versions", kept >= 5, `${kept} kept`);
check("no errors on the page", !page.errors.length, page.errors.join(" | "));

await stop();
console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
