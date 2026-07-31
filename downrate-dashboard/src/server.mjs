import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { defaultPort, defaultDatabasePath, publicDir, publicIndexPath } from './config.mjs';
import { DatabaseSync } from 'node:sqlite';
import { ensureDashboardSchema } from './storage/repository.mjs';
import { parseWorkbook } from './import/parse-workbook.mjs';
import { createApiHandler } from './api/routes.mjs';

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

export function createServer({ port = defaultPort, databasePath: dbPath = defaultDatabasePath, database, parseWorkbook: workbookParser = parseWorkbook } = {}) {
  void port;
  const db = database ?? new DatabaseSync(dbPath);
  ensureDashboardSchema(db);
  const apiHandler = createApiHandler({ db, parseWorkbook: workbookParser });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');

    if (url.pathname.startsWith('/api/')) {
      const handled = await apiHandler(req, res, url);
      if (handled || res.writableEnded) return;
    }

    if (req.method === 'GET' && url.pathname === '/api/health') {
      sendJson(res, 200, { ok: true, service: 'downrate-dashboard' });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/') {
      servePublicIndex(res);
      return;
    }

    if (req.method === 'GET' && ['/styles.css', '/app.js'].includes(url.pathname)) {
      const assetPath = path.join(publicDir, url.pathname.slice(1));
      if (!fs.existsSync(assetPath)) {
        sendText(res, 404, 'Not Found');
        return;
      }
      const contentType = url.pathname.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8';
      sendText(res, 200, fs.readFileSync(assetPath, 'utf8'), contentType);
      return;
    }

    sendText(res, 404, 'Not Found');
  });
  server.on('close', () => {
    if (!database) db.close();
  });
  return server;
}

if (isMainModule(import.meta.url)) {
  const runtimePort = Number(process.env.DOWNRATE_PORT ?? defaultPort);
  const server = createServer({ port: runtimePort });

  server.listen(runtimePort, () => {
    console.log(`downrate-dashboard listening on http://127.0.0.1:${runtimePort}`);
  });
}
