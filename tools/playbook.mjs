// Command-line tools for the Ravens playbook. Run with: npm run playbook -- <command>
// PINs come from the environment (TEAM_PIN, COACH_PIN) and are never written anywhere.
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, copyFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { lockBox, unlockBox, openStaffKey, staffKeyHash, newRev } from "./lib/box.mjs";
import { prepPlay } from "./lib/plays.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const LIVE = "https://marlbororavens.com";
const SITE = (process.env.PLAYBOOK_SITE || LIVE).replace(/\/$/, "");
const BACKUP = join(ROOT, "public", "playbook.json");

const HELP = `Ravens playbook tools   (npm run playbook -- <command>)

  list                        show every play in order (needs TEAM_PIN)
  backup                      copy the live playbook into public/playbook.json
  add <plays.json>            add the plays in a file, in the usual lineup (needs TEAM_PIN and COACH_PIN)
  rename <id> <new name>      rename one play (needs TEAM_PIN and COACH_PIN)
  time <play>=<1-3> ...       set the stopwatches on plays in one save: 1 = quick, 2 = normal, 3 = takes time
                              e.g. time "Stick=1" "Four Verticals=3" (needs TEAM_PIN and COACH_PIN)
  favorites <play> ...        star exactly these plays, e.g. for a game; the rest lose their star (needs TEAM_PIN and COACH_PIN)
  history                     list the saved versions the server keeps (the last 30)
  restore <rev>               bring back one of those versions (needs COACH_PIN)
  preview <plays.json> [dir]  draw the plays in a file as pictures, to check them before adding (default dir: previews)
  key-hash                    print the staff key hash, for local development in .dev.vars (needs COACH_PIN)

PINs come from the environment and are never saved, e.g.
  TEAM_PIN=... COACH_PIN=... npm run playbook -- add new-plays.json
PLAYBOOK_SITE points the tools at another copy of the site (default https://marlbororavens.com).`;

function need(name){
  const v = process.env[name];
  if (!v){ console.error(`Set ${name} first, e.g. ${name}=... npm run playbook -- ${process.argv[2]}`); process.exit(1); }
  return v;
}
async function fetchPlaybook(){
  const res = await fetch(`${SITE}/playbook`, { cache:"no-store" });
  if (!res.ok) throw new Error(`Couldn't load the playbook from ${SITE} (${res.status})`);
  return res.json();
}
async function openPlays(playbook, teamPin){
  const payload = await unlockBox(playbook.lock, teamPin);
  if (!payload || !Array.isArray(payload.plays)) throw new Error("TEAM_PIN doesn't open the playbook");
  return payload;
}
/* saves a new version through the playbook server, exactly like a coach's Save for the team */
async function save(next, prevRev, coachPin, current){
  const key = await openStaffKey(current, coachPin);
  if (!key) throw new Error("COACH_PIN doesn't open a coach box");
  const res = await fetch(`${SITE}/save`, { method:"POST", headers:{ "Content-Type":"application/json" }, body:JSON.stringify({ key, data:next, prevRev }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error === "conflict" ? "Someone saved in the meantime; run it again" : `Save failed: ${body.error || res.status}`);
  return body.rev;
}
async function relockAndSave(current, payload){
  const teamPin = need("TEAM_PIN"), coachPin = need("COACH_PIN");
  const next = { ...current, rev:newRev(), lock:await lockBox(payload, teamPin) };
  const rev = await save(next, current.rev, coachPin, current);
  await backup();
  return rev;
}
/* the backup copy only ever mirrors the live site, never a test copy */
async function backup(){
  if (SITE !== LIVE){ console.log(`(public/playbook.json left alone: this was ${SITE}, not the live site)`); return; }
  const playbook = await fetchPlaybook();
  writeFileSync(BACKUP, JSON.stringify(playbook));
  console.log(`public/playbook.json now matches the live playbook (version ${playbook.rev}). Commit it to keep the backup current.`);
}
function d1(sql){
  const out = execFileSync("npx", ["wrangler", "d1", "execute", "ravens-playbook", "--remote", "--json", "--command", sql], { cwd:ROOT, encoding:"utf8", maxBuffer:64 * 1024 * 1024, stdio:["ignore", "pipe", "pipe"] });
  return JSON.parse(out)[0].results;
}
/* a play by its id, or by its name in any capitals */
function findPlay(plays, key){
  const play = plays.find(p => p.id === key) || plays.find(p => p.name.toLowerCase() === key.toLowerCase());
  if (!play) throw new Error(`No play called "${key}". See: npm run playbook -- list`);
  return play;
}
function readPlaysFile(file){
  const list = JSON.parse(readFileSync(resolve(file), "utf8"));
  const plays = Array.isArray(list) ? list : list.plays;
  if (!Array.isArray(plays)) throw new Error(`${file} should hold a list of plays`);
  return plays.map(p => {
    const { play, problems } = prepPlay(p);
    if (problems.length) throw new Error(`${p.name || p.id}: ${problems.join(", ")}`);
    return play;
  });
}

const [cmd, ...rest] = process.argv.slice(2);
const commands = {
  async list(){
    const payload = await openPlays(await fetchPlaybook(), need("TEAM_PIN"));
    payload.plays.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).forEach((p, i) =>
      console.log(`${String(i + 1).padStart(2)}. ${p.fav ? "★" : " "} ${p.name}  (${p.id})${/^Your run/i.test(p.note || "") ? "  [run]" : ""}  ${"⏱".repeat(p.time || 0)}`));
  },
  backup,
  async add(file){
    if (!file) throw new Error("Which file? npm run playbook -- add new-plays.json");
    const current = await fetchPlaybook(), payload = await openPlays(current, need("TEAM_PIN"));
    const have = new Set(payload.plays.map(p => p.id)), fresh = readPlaysFile(file).filter(p => !have.has(p.id));
    if (!fresh.length){ console.log("Every play in that file is already in the playbook."); return; }
    let order = Math.max(0, ...payload.plays.map(p => typeof p.order === "number" ? p.order : 0));
    payload.plays.push(...fresh.map(p => ({ ...p, order:++order })));
    await relockAndSave(current, payload);
    console.log(`Added ${fresh.length}: ${fresh.map(p => p.name).join(", ")}`);
  },
  async rename(id, ...words){
    const name = words.join(" ").trim();
    if (!id || !name) throw new Error("Usage: npm run playbook -- rename <id> <new name>");
    const current = await fetchPlaybook(), payload = await openPlays(current, need("TEAM_PIN"));
    const play = payload.plays.find(p => p.id === id);
    if (!play) throw new Error(`No play with id "${id}". See: npm run playbook -- list`);
    const old = play.name; play.name = name.slice(0, 60);
    await relockAndSave(current, payload);
    console.log(`Renamed "${old}" to "${play.name}"`);
  },
  async time(...pairs){
    if (!pairs.length) throw new Error(`Usage: npm run playbook -- time "Stick=1" "Four Verticals=3"   (1 = quick, 2 = normal, 3 = takes time)`);
    const current = await fetchPlaybook(), payload = await openPlays(current, need("TEAM_PIN"));
    const changed = pairs.map(pair => {
      const m = /^(.+?)\s*=\s*([123])$/.exec(pair.trim());
      if (!m) throw new Error(`"${pair}" should look like "Stick=1"`);
      const play = findPlay(payload.plays, m[1].trim());
      play.time = +m[2];
      return play;
    });
    await relockAndSave(current, payload);
    changed.forEach(p => console.log(`${"⏱".repeat(p.time).padEnd(4)}${p.name}`));
  },
  async favorites(...names){
    if (!names.length) throw new Error(`Usage: npm run playbook -- favorites "Hot Potato" "Stick" ...   (stars exactly these plays; the rest lose their star)`);
    const current = await fetchPlaybook(), payload = await openPlays(current, need("TEAM_PIN"));
    const picked = names.map(n => findPlay(payload.plays, n.trim()));
    payload.plays.forEach(p => { p.fav = picked.includes(p); });
    await relockAndSave(current, payload);
    console.log(`Starred ${picked.length}: ${picked.map(p => p.name).join(", ")}`);
  },
  async history(){
    const rows = d1("SELECT rev, saved_at FROM history ORDER BY id DESC");
    const now = d1("SELECT rev, saved_at FROM playbook")[0];
    if (now) console.log(`now      ${now.rev}  saved ${now.saved_at}`);
    rows.forEach((r, i) => console.log(`${String(i + 1).padStart(2)} back  ${r.rev}  saved ${r.saved_at}`));
    console.log("Bring one back with: COACH_PIN=... npm run playbook -- restore <rev>");
  },
  async restore(rev){
    if (!/^[a-z0-9]{6,40}$/.test(rev || "")) throw new Error("Usage: npm run playbook -- restore <rev>   (see: npm run playbook -- history)");
    const row = d1(`SELECT data FROM history WHERE rev = '${rev}' ORDER BY id DESC LIMIT 1`)[0];
    if (!row) throw new Error(`The server doesn't keep version ${rev}`);
    const current = await fetchPlaybook(), old = JSON.parse(row.data);
    await save({ ...old, rev:newRev() }, current.rev, need("COACH_PIN"), current);
    await backup();
    console.log(`Version ${rev} is back.`);
  },
  async preview(file, dir = "previews"){
    if (!file) throw new Error("Which file? npm run playbook -- preview new-plays.json");
    const plays = readPlaysFile(file), out = resolve(dir), work = mkdtempSync(join(tmpdir(), "ravens-preview-")), pin = "picture1";
    mkdirSync(out, { recursive:true });
    copyFileSync(join(ROOT, "public", "index.html"), join(work, "index.html"));
    writeFileSync(join(work, "playbook.json"), JSON.stringify({ v:3, rev:"preview", lock:await lockBox({ plays }, pin), coaches:[] }));
    const { serve } = await import("./lib/serve.mjs"), { launch, wait } = await import("./lib/chrome.mjs");
    const server = await serve(work), page = await launch();
    try {
      await page.size(760, 1000);
      await page.go(`${server.url}/`);
      await page.waitFor(`!document.getElementById("gate").hidden`);
      await page.type("#gate-pin", pin); await page.click("#gate-go");
      await page.waitFor(`document.querySelectorAll("#plays > .play").length === ${plays.length}`);
      await wait(300);
      for (const [i, p] of plays.entries()){
        const f = join(out, `${String(i + 1).padStart(2, "0")}-${p.id}.png`);
        await page.shot(f, `#${p.id}`);
        console.log(f);
      }
    } finally { await page.close(); server.close(); rmSync(work, { recursive:true, force:true }); }
  },
  async "key-hash"(){
    const key = await openStaffKey(await fetchPlaybook(), need("COACH_PIN"));
    if (!key) throw new Error("COACH_PIN doesn't open a coach box");
    console.log(`STAFF_KEY_HASH="${staffKeyHash(key)}"`);
  }
};

if (!cmd || !commands[cmd]) console.log(HELP);
else commands[cmd](...rest).catch(e => { console.error(e.message); process.exit(1); });
