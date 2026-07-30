import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createServer } from '../src/server.mjs';

const requestJson = async (port, path) => {
  const response = await new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'GET'
      },
      resolve
    );

    req.on('error', reject);
    req.end();
  });

  const chunks = [];
  for await (const chunk of response) {
    chunks.push(chunk);
  }

  return {
    statusCode: response.statusCode,
    headers: response.headers,
    body: Buffer.concat(chunks).toString('utf8')
  };
};

test('GET /api/health returns the exact service contract', async () => {
  const server = createServer({ port: 0 });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  try {
    const { port } = server.address();
    const response = await requestJson(port, '/api/health');

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['content-type'], 'application/json; charset=utf-8');
    assert.deepEqual(JSON.parse(response.body), {
      ok: true,
      service: 'downrate-dashboard'
    });
  } finally {
    server.close();
    await once(server, 'close');
  }
});
