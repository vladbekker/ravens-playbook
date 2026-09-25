// A tiny static file server on 127.0.0.1 (for play pictures). Returns { url, close }.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";

const TYPES = { ".html":"text/html; charset=utf-8", ".json":"application/json", ".png":"image/png" };
export function serve(dir){
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const file = join(dir, path.endsWith("/") ? path + "index.html" : path);
    try { const body = await readFile(file); res.writeHead(200, { "Content-Type":TYPES[extname(file)] || "application/octet-stream", "Cache-Control":"no-store" }); res.end(body); }
    catch { res.writeHead(404); res.end("not found"); }
  });
  return new Promise(ok => server.listen(0, "127.0.0.1", () => ok({ url:`http://127.0.0.1:${server.address().port}`, close:() => server.close() })));
}
