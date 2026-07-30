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
    }
  };
}

test('parseWorkbook keeps reordered headers, preserves all columns, and extracts the period from 出单时间', async () => {
  const fixture = createFixtureWorkbook();

  try {
    const result = await parseWorkbook(fixture.outputPath);

    assert.equal(result.sourceFile, fixture.outputPath);
    assert.deepEqual(result.headers, [
      '退回审核意见',
      '出单员',
      '保单号',
      '投保单号',
      '提核退回标志',
      '出单时间',
      '备注列'
    ]);
    assert.deepEqual(result.periods, [{ year: 2026, month: 2 }]);
    assert.deepEqual(result.errors, [
      {
        code: 'missing_date',
        sourceRow: 4,
        header: '出单时间',
        message: '第 4 行缺少有效的出单时间'
      }
    ]);

    assert.equal(result.rows.length, 3);
    assert.deepEqual(Object.keys(result.rows[0].values), result.headers);
    assert.deepEqual(result.rows[0].values, {
      '退回审核意见': '初审通过',
      '出单员': '12345张三',
      '保单号': 'P-001',
      '投保单号': 'TB-001',
      '提核退回标志': 'N',
      '出单时间': '2026-02-18T10:30:00',
      '备注列': '保留原始列A'
    });
    assert.deepEqual(result.rows[0], {
      sourceRow: 2,
      values: result.rows[0].values,
      operatorRaw: '12345张三',
      operatorName: '张三',
      opinion: '初审通过',
      returnFlag: 'N',
      recordDate: '2026-02-18',
      year: 2026,
      month: 2,
      rowKey: 'P-001',
      rowHash: result.rows[0].rowHash
    });
    assert.equal(typeof result.rows[0].rowHash, 'string');
    assert.equal(result.rows[0].rowHash.length > 0, true);

    assert.deepEqual(result.rows[1], {
      sourceRow: 3,
      values: result.rows[1].values,
      operatorRaw: '工号67890李四',
      operatorName: '李四',
      opinion: '',
      returnFlag: 'Y',
      recordDate: '2026-02-19',
      year: 2026,
      month: 2,
      rowKey: 'TB-ONLY-1',
      rowHash: result.rows[1].rowHash
    });
    assert.deepEqual(result.rows[2], {
      sourceRow: 4,
      values: result.rows[2].values,
      operatorRaw: '客户经理王五',
      operatorName: '王五',
      opinion: '待补充',
      returnFlag: 'N',
      recordDate: null,
      year: null,
      month: null,
      rowKey: 'P-002',
      rowHash: result.rows[2].rowHash
    });
  } finally {
    fixture.cleanup();
  }
});

test('parseWorkbook reports missing required headers as structured errors', async () => {
  const fixture = createFixtureWorkbook('missing-header');

  try {
    const result = await parseWorkbook(fixture.outputPath);

    assert.deepEqual(result.headers, [
      '退回审核意见',
      '出单员',
      '保单号',
      '投保单号',
      '提核退回标志',
      '备注列'
    ]);
    assert.deepEqual(result.rows, []);
    assert.deepEqual(result.periods, []);
    assert.deepEqual(result.errors, [
      {
        code: 'missing_headers',
        headers: ['出单时间'],
        message: '缺少必需表头: 出单时间'
      }
    ]);
  } finally {
    fixture.cleanup();
  }
});
