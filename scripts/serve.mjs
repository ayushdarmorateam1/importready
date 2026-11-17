#!/usr/bin/env node
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';

// A development server for this demo only. It never accepts file uploads.
const root = fileURLToPath(new URL('../', import.meta.url));
const rawPort = process.env.PORT || '4173';
const port = Number(rawPort);
if (!/^\d+$/.test(rawPort) || !Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('PORT must be an integer between 1 and 65535.');
  process.exit(2);
}
const mime = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};
const server = createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'HEAD'].includes(req.method)) {
    res.writeHead(405, { Allow: 'GET, HEAD' }).end('Method not allowed');
    return;
  }
  try {
    let pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    if (pathname === '/') pathname = '/index.html';
    if (pathname.includes('\0') || pathname.includes('\\') || pathname.split('/').some(part => part.startsWith('.'))) {
      res.writeHead(404).end('Not found');
      return;
    }
    const allowed = pathname === '/index.html' || /^\/(web|src|examples)\//.test(pathname);
    const target = resolve(root, '.' + pathname);
    if (!allowed || !target.startsWith(root.endsWith(sep) ? root : root + sep) || !(await stat(target)).isFile()) {
      res.writeHead(404).end('Not found');
      return;
    }
    const content = await readFile(target);
    res.writeHead(200, { 'Content-Type': mime[extname(target)] || 'application/octet-stream', 'Content-Length': content.length });
    res.end(req.method === 'HEAD' ? undefined : content);
  } catch {
    res.writeHead(404).end('Not found');
  }
});
server.on('error', error => {
  console.error(`Cannot start ImportReady: ${error.code || error.message}`);
  process.exitCode = 2;
});
server.listen(port, '127.0.0.1', () => console.log(`ImportReady: http://127.0.0.1:${port}\nCSV data stays in your browser. Press Ctrl+C to stop.`));
