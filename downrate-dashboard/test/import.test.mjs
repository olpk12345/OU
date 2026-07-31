import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { parseWorkbook } from '../src/import/parse-workbook.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureScript = path.join(__dirname, 'fixtures', 'create_fixture.py');
const pythonBin = process.env.DOWNRATE_PYTHON ?? process.env.PYTHON_BIN ?? 'python';

function createFixtureWorkbook(scenario = 'default') {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'downrate-dashboard-import-'));
  const outputPath = path.join(tempRoot, `${scenario}.xlsx`);
  execFileSync(pythonBin, [fixtureScript, outputPath, '--scenario', scenario], { stdio: 'pipe' });
  return {
    tempRoot,
    outputPath,
    cleanup() {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    },
  };
}

test('parseWorkbook preserves columns, extracts periods, and keeps unkeyed rows', async () => {
  const fixture = createFixtureWorkbook();

  try {
    const result = await parseWorkbook(fixture.outputPath);

    assert.equal(result.sourceFile, fixture.outputPath);
    assert.equal(result.headers.length, 7);
    assert.deepEqual(result.periods, [{ year: 2026, month: 2 }]);
    assert.deepEqual(result.errors, []);
    assert.equal(result.rows.length, 4);
    assert.deepEqual(Object.keys(result.rows[0].values), result.headers);
    assert.equal(result.rows[0].operatorName, '张三');
    assert.equal(result.rows[0].recordDate, '2026-02-18');
    assert.equal(result.rows[0].rowKey, 'P-001');
    assert.equal(result.rows[1].operatorName, '李四');
    assert.equal(result.rows[1].rowKey, 'TB-ONLY-1');
    assert.equal(result.rows[2].operatorName, '王五');
    assert.equal(result.rows[2].recordDate, '2026-02-20');
    assert.equal(result.rows[3].rowKey, '');
    assert.equal(typeof result.rows[0].rowHash, 'string');
    assert.ok(result.rows[0].rowHash.length > 0);
  } finally {
    fixture.cleanup();
  }
});

test('parseWorkbook throws structured errors for missing required headers', async () => {
  const fixture = createFixtureWorkbook('missing-header');

  try {
    await assert.rejects(
      () => parseWorkbook(fixture.outputPath),
      (error) => {
        assert.equal(error.code, 'missing_headers');
        assert.equal(error.filename, fixture.outputPath);
        assert.equal(error.details.length, 1);
        assert.equal(error.details[0].code, 'missing_headers');
        assert.equal(error.details[0].headers.length, 1);
        return true;
      },
    );
  } finally {
    fixture.cleanup();
  }
});
