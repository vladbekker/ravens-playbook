// A throwaway headless Chrome driven over the DevTools protocol (Node 22+ has WebSocket built in).
// Used by the tests and by `playbook preview`. Set CHROME to Chrome's path if it isn't found.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = process.env.CHROME || ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"]
  .find(p => { try { return statSync(p).isFile(); } catch { return false; } });
export const wait = ms => new Promise(r => setTimeout(r, ms));

export async function launch(){
  if (!CHROME) throw new Error("Chrome not found. Set CHROME to its path.");
  const profile = mkdtempSync(join(tmpdir(), "ravens-chrome-")), port = 9200 + Math.floor(Math.random() * 700);
  const proc = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio:"ignore" });
  let target;
  for (let i = 0; i < 80 && !target; i++){
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === "page"); } catch {}
    if (!target) await wait(250);
  }
  if (!target){ proc.kill(); throw new Error("headless Chrome did not start"); }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((ok, bad) => { ws.onopen = ok; ws.onerror = bad; });
  let seq = 0;
  const pending = new Map(), errors = [];
  ws.onmessage = m => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)){ pending.get(d.id)(d); pending.delete(d.id); }
    else if (d.method === "Runtime.exceptionThrown") errors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
  };
  const send = (method, params = {}) => new Promise(ok => { const i = ++seq; pending.set(i, ok); ws.send(JSON.stringify({ id:i, method, params })); });
  await send("Runtime.enable"); await send("Page.enable");
  const mouse = (type, x, y, down) => send("Input.dispatchMouseEvent", { type, x, y, button:"left", buttons:down ? 1 : 0, clickCount:1 });
  const page = {
    errors, send,
    async size(width, height){ await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor:1, mobile:false }); },
    async ev(expr){
      const r = (await send("Runtime.evaluate", { expression:expr, awaitPromise:true, returnByValue:true })).result;
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    },
    async go(url){ await send("Page.navigate", { url }); await wait(1200); },
    async waitFor(expr, ms = 12000){
      for (let t = 0; t < ms; t += 150){ try { if (await page.ev(expr)) return true; } catch {} await wait(150); }
      return false;
    },
    async type(sel, text){
      await page.ev(`(() => { const i = document.querySelector(${JSON.stringify(sel)}); i.value = ""; i.focus(); })()`);
      await send("Input.insertText", { text });
    },
    click: sel => page.ev(`document.querySelector(${JSON.stringify(sel)}).click()`),
    async point(sel, fx = 0.5, fy = 0.5){
      return page.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.scrollIntoView({ block:"center" });
        const r = e.getBoundingClientRect(); return { x:r.left + r.width * ${fx}, y:r.top + r.height * ${fy} }; })()`);
    },
    async tap(p){ await mouse("mousePressed", p.x, p.y, true); await mouse("mouseReleased", p.x, p.y, false); },
    async drag(sel, dx, dy = 0){
      const p = await page.point(sel); await wait(120);
      await mouse("mousePressed", p.x, p.y, true);
      for (let k = 1; k <= 6; k++) await mouse("mouseMoved", p.x + dx * k / 6, p.y + dy * k / 6, true);
      await mouse("mouseReleased", p.x + dx, p.y + dy, false); await wait(250);
    },
    async shot(file, sel){
      let clip;
      if (sel) clip = await page.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.scrollIntoView({ block:"center" });
        const r = e.getBoundingClientRect(); return { x:r.left + scrollX, y:r.top + scrollY, width:r.width, height:r.height, scale:1 }; })()`);
      const r = await send("Page.captureScreenshot", clip ? { format:"png", clip, captureBeyondViewport:false } : { format:"png" });   // capturing beyond the viewport drops the scrollbar, which reflows the page under the clip
      writeFileSync(file, Buffer.from(r.result.data, "base64"));
    },
    async close(){ try { ws.close(); } catch {} proc.kill(); await wait(300); rmSync(profile, { recursive:true, force:true }); }
  };
  return page;
}
