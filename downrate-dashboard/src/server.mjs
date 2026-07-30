import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { defaultPort, defaultDatabasePath, publicIndexPath } from './config.mjs';

export function isMainModule(metaUrl) {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }

  return path.resolve(fileURLToPath(metaUrl)) === path.resolve(entry);
}

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8'
  });
  res.end(JSON.stringify(body));
}

function sendText(res, statusCode, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(statusCode, { 'content-type': contentType });
  res.end(body);
}

function servePublicIndex(res) {
  if (!fs.existsSync(publicIndexPath)) {
    sendText(res, 404, 'Not Found');
    return;
  }

  const html = fs.readFileSync(publicIndexPath, 'utf8');
  sendText(res, 200, html, 'text/html; charset=utf-8');
}

export function createServer({ port = defaultPort, databasePath: dbPath = defaultDatabasePath } = {}) {
  void port;
  void dbPath;

  return http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');

    if (req.method === 'GET' && url.pathname === '/api/health') {
      sendJson(res, 200, { ok: true, service: 'downrate-dashboard' });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/') {
      servePublicIndex(res);
      return;
    }

    sendText(res, 404, 'Not Found');
  });
}

if (isMainModule(import.meta.url)) {
  const server = createServer();

  server.listen(defaultPort, () => {
    console.log(`downrate-dashboard listening on http://127.0.0.1:${defaultPort}`);
  });
}
