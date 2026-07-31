import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from '../src/server.mjs';

function createDatabase() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE records (id INTEGER PRIMARY KEY AUTOINCREMENT, category TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', data_json TEXT NOT NULL DEFAULT '{}');
    CREATE TABLE attachments (id INTEGER PRIMARY KEY AUTOINCREMENT, record_id INTEGER NOT NULL, filename TEXT NOT NULL, mime_type TEXT NOT NULL, source_path TEXT NOT NULL, size_bytes INTEGER NOT NULL, sha256 TEXT NOT NULL UNIQUE, content_blob BLOB NOT NULL);
  `);
  return db;
}

function request(port, method, pathname, body = Buffer.alloc(0), headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: pathname, method, headers: { 'content-length': body.length, ...headers } }, resolve);
    req.on('error', reject);
    req.end(body);
  });
}

async function readJson(response) {
  const chunks = [];
  for await (const chunk of response) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function parsedRow(opinion) {
  return {
    sourceRow: 2,
    values: { 保单号: 'P-001', 投保单号: '', 出单员: '10001张三', 退回审核意见: opinion, 提核退回标志: 'Y', 出单时间: '2026-01-15' },
    operatorRaw: '10001张三',
    operatorName: '张三',
    opinion,
    returnFlag: 'Y',
    recordDate: '2026-01-15',
    year: 2026,
    month: 1,
    rowKey: 'P-001',
    rowHash: `hash-${opinion}`,
  };
}

test('upload preview is isolated and commit merges cumulative rows', async () => {
  const db = createDatabase();
  const parser = async (_path) => ({ periods: [{ year: 2026, month: 1 }], rows: [parsedRow('下发修改，请修改发票信息')], errors: [] });
  const server = createServer({ database: db, parseWorkbook: parser });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;

  try {
    let response = await request(port, 'POST', '/api/uploads/preview', Buffer.from('fixture'), {
      'x-filename-base64': Buffer.from('2026年1月.xlsx', 'utf8').toString('base64'),
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    let payload = await readJson(response);
    assert.equal(response.statusCode, 200);
    assert.equal(payload.filename, '2026年1月.xlsx');
    assert.equal(payload.counts.inserted, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM downrate_current_rows').get().count, 0);

    response = await request(port, 'POST', `/api/uploads/${payload.batchId}/commit`);
    payload = await readJson(response);
    assert.equal(response.statusCode, 200);
    assert.equal(payload.counts.inserted, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM downrate_current_rows').get().count, 1);

    response = await request(port, 'GET', '/api/periods');
    payload = await readJson(response);
    assert.deepEqual(payload.periods, [{ year: 2026, month: 1 }]);
  } finally {
    server.close();
    await once(server, 'close');
    db.close();
  }
});
