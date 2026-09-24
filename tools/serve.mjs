/*
 * serve.mjs — the WORKSHOP for OpenSign, port 6102. A second server beside the
 * app's own (6100), serving small READ-ONLY benches out of tools/.
 *
 *   node tools/serve.mjs   ->  http://localhost:6102/                    (the launcher)
 *                              http://localhost:6102/workshop/bugs.html  (the tracker)
 *
 * Node stdlib only, so it needs no packages and no build. Same shape as
 * web-opumc's workshop, so moving between the two costs nothing.
 *
 * ⭐⭐ THE ROOT IS THE LAUNCHER, THE BENCHES LIVE AT /workshop/: the page whose
 * job is saying what is up must not itself need a path.
 *
 * ⛔⛔ THE BENCHES NEVER WRITE. There is no write path to grow one from: triage
 * is a judgment, and filing goes through Bob.
 *
 * ⭐ THE TRACKER IS READ OFF DISK ON EVERY REQUEST (/__bugs), and /__bugs-stamp
 * answers "has it changed?" in a few bytes so the page can offer a reload.
 *
 * PORT: 6102 — OpenSign's block is 6100 and 6101 is the optional hot-reload
 * server (../bob/ports.md). Both loopbacks, never the network.
 * CALLED BY: nobody; Bob starts it by hand.
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 6102;
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = HERE + sep;                                   /* tools/ */
const TRACKER = join(HERE, '..', 'docs', 'bugs.json');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2',
};

/* The corner bar on every bench: home to the launcher, and out to the app.
   Injected rather than written into each page, so a new bench gets it free.
   The app links open in a NEW TAB: a bench is kept open beside the work. */
const CORNER = 'color:#8093b8;text-decoration:none;font-size:12px;letter-spacing:2px;font-family:Orbitron,Verdana,sans-serif;border:1px solid #1c2748;border-radius:8px;padding:6px 10px;background:#04050ccc';
const BAR = '<div style="position:fixed;top:14px;left:16px;z-index:99;display:flex;gap:8px">'
  + `<a href="/" style="${CORNER}">&#8962; WORKSHOP</a>`
  + `<a href="http://localhost:6100/" target="_blank" rel="noreferrer" style="${CORNER}">KIOSK &#8599;</a>`
  + `<a href="http://localhost:6100/admin" target="_blank" rel="noreferrer" style="${CORNER}">ADMIN &#8599;</a>`
  + '</div>';

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  let path = decodeURIComponent(url.pathname);
  try {
    if (path === '/__bugs-stamp') {
      const st = await stat(TRACKER);
      res.writeHead(200, { 'Content-Type': TYPES['.json'], 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ m: st.mtimeMs, s: st.size }));
      return;
    }
    if (path === '/__bugs') {
      res.writeHead(200, { 'Content-Type': TYPES['.json'], 'Cache-Control': 'no-store' });
      res.end(await readFile(TRACKER, 'utf8'));
      return;
    }
    if (path.endsWith('/')) path += 'index.html';
    const full = join(ROOT, normalize(path).replace(/^(\.\.[/\\])+/, ''));
    if (!full.startsWith(ROOT)) { res.writeHead(403).end('Forbidden'); return; }
    let body = await readFile(full);
    const type = TYPES[extname(full).toLowerCase()] || 'application/octet-stream';
    if (type.startsWith('text/html') && path.startsWith('/workshop/')) {
      body = Buffer.from(body.toString('utf8').replace(/(<body[^>]*>)/i, `$1\n${BAR}`));
    }
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
  }
}

for (const host of ['127.0.0.1', '::1']) {
  const server = createServer(handle);
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use on ${host}. The workshop may already be running.`);
      process.exit(1);
    }
    if (err.code === 'EADDRNOTAVAIL' && host === '::1') return;
    throw err;
  });
  server.listen(PORT, host);
}
console.log(`OpenSign workshop — http://localhost:${PORT}/`);
