import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  ensureDashboardSchema,
  createUploadBatch,
  mergeParsedRows,
  listPeriods,
  listCurrentRows,
  saveCalculationSnapshot,
  loadCalculationSnapshot
} from '../src/storage/repository.mjs';

function createTempDatabase() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'downrate-dashboard-storage-'));
  const dbPath = path.join(tempRoot, 'work.db');
  const db = new DatabaseSync(dbPath);

  db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      data_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      record_id INTEGER NOT NULL,
      filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      source_path TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      sha256 TEXT NOT NULL UNIQUE,
      content_blob BLOB NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (record_id) REFERENCES records(id) ON DELETE CASCADE
    );
  `);

  return {
    db,
    dbPath,
    cleanup() {
      db.close();
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  };
}

function makeRow({
  sourceRow,
  policyNo,
  proposalNo,
  operatorRaw = '10001张三',
  operatorName = '张三',
  opinion = '资料齐全',
  returnFlag = '否',
  recordDate = '2026-01-15',
  year = 2026,
  month = 1,
  extra = {}
}) {
  return {
    sourceRow,
    values: {
      保单号: policyNo ?? '',
      投保单号: proposalNo ?? '',
      出单员: operatorRaw,
      退回审核意见: opinion,
      提核退回标志: returnFlag,
      出单时间: recordDate,
      ...extra
    },
    operatorRaw,
    operatorName,
    opinion,
    returnFlag,
    recordDate,
    year,
    month
  };
}

test('ensureDashboardSchema is idempotent and creates Task 2 tables', () => {
  const fixture = createTempDatabase();

  try {
    ensureDashboardSchema(fixture.db);
    ensureDashboardSchema(fixture.db);

    const tables = fixture.db.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table' AND name LIKE 'downrate_%'
      ORDER BY name
    `).all().map(row => row.name);

    assert.deepEqual(tables, [
      'downrate_calculation_rows',
      'downrate_calculation_snapshots',
      'downrate_current_rows',
      'downrate_formula_versions',
      'downrate_opinion_rules',
      'downrate_row_versions',
      'downrate_upload_batches'
    ]);
  } finally {
    fixture.cleanup();
  }
});

test('createUploadBatch stores and reuses original workbook attachments', () => {
  const fixture = createTempDatabase();

  try {
    ensureDashboardSchema(fixture.db);
    const content = Buffer.from('same workbook content');
    const attachment = {
      content,
      filename: '2026-01.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      sourcePath: 'C:/input/2026-01.xlsx'
    };
    const first = createUploadBatch(fixture.db, { filename: attachment.filename, attachment });
    const second = createUploadBatch(fixture.db, { filename: 'copy.xlsx', attachment: { ...attachment, filename: 'copy.xlsx' } });

    assert.deepEqual(first, { id: 1, status: 'pending' });
    assert.deepEqual(second, { id: 2, status: 'pending' });
    assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM records').get().count, 1);
    assert.equal(fixture.db.prepare('SELECT COUNT(*) AS count FROM attachments').get().count, 1);
    assert.deepEqual(
      fixture.db.prepare('SELECT record_id, attachment_id FROM downrate_upload_batches ORDER BY id').all().map(row => ({ ...row })),
      [{ record_id: 1, attachment_id: 1 }, { record_id: 1, attachment_id: 1 }],
    );
  } finally {
    fixture.cleanup();
  }
});

test('mergeParsedRows keeps one current keyed row, versions updates, fallback keys, and separate unkeyed exceptions', () => {
  const fixture = createTempDatabase();

  try {
    ensureDashboardSchema(fixture.db);

    const batch1 = createUploadBatch(fixture.db, { filename: '2026-01-a.xlsx' });
    const merge1 = mergeParsedRows(fixture.db, batch1.id, [
      makeRow({
        sourceRow: 2,
        policyNo: ' P-001 ',
        proposalNo: 'TB-001',
        opinion: '首次导入'
      })
    ]);

    assert.deepEqual(merge1, { inserted: 1, updated: 0, unchanged: 0, unkeyed: 0 });

    const batch2 = createUploadBatch(fixture.db, { filename: '2026-01-b.xlsx' });
    const merge2 = mergeParsedRows(fixture.db, batch2.id, [
      makeRow({
        sourceRow: 2,
        policyNo: 'P-001',
        proposalNo: 'TB-001',
        opinion: '内容已变更'
      })
    ]);

    assert.deepEqual(merge2, { inserted: 0, updated: 1, unchanged: 0, unkeyed: 0 });

    assert.equal(
      fixture.db.prepare('SELECT COUNT(*) AS count FROM downrate_current_rows').get().count,
      1
    );
    assert.equal(
      fixture.db.prepare(`
        SELECT COUNT(*) AS count
        FROM downrate_row_versions
        WHERE row_key = 'P-001'
      `).get().count,
      2
    );

    const currentRows = listCurrentRows(fixture.db, { year: 2026, month: 1 });
    assert.equal(currentRows.length, 1);
    assert.equal(currentRows[0].rowKey, 'P-001');
    assert.equal(currentRows[0].opinion, '内容已变更');
    assert.equal(currentRows[0].values.保单号, 'P-001');
    assert.deepEqual(listPeriods(fixture.db), [{ year: 2026, month: 1 }]);

    const batch3 = createUploadBatch(fixture.db, { filename: '2026-01-c.xlsx' });
    const merge3 = mergeParsedRows(fixture.db, batch3.id, [
      makeRow({
        sourceRow: 2,
        policyNo: 'P-001',
        proposalNo: 'TB-001',
        opinion: '内容已变更'
      })
    ]);

    assert.deepEqual(merge3, { inserted: 0, updated: 0, unchanged: 1, unkeyed: 0 });
    assert.equal(
      fixture.db.prepare(`
        SELECT COUNT(*) AS count
        FROM downrate_row_versions
        WHERE row_key = 'P-001'
      `).get().count,
      2
    );

    const batch4 = createUploadBatch(fixture.db, { filename: '2026-02.xlsx' });
    const fallbackMerge = mergeParsedRows(fixture.db, batch4.id, [
      makeRow({
        sourceRow: 8,
        policyNo: '   ',
        proposalNo: ' TB-ONLY-1 ',
        opinion: '投保单号兜底',
        month: 2,
        recordDate: '2026-02-10'
      })
    ]);

    assert.deepEqual(fallbackMerge, { inserted: 1, updated: 0, unchanged: 0, unkeyed: 0 });

    const fallbackRow = fixture.db.prepare(`
      SELECT row_key, operator_name, opinion
      FROM downrate_current_rows
      WHERE row_key = 'TB-ONLY-1'
    `).get();

    assert.deepEqual({ ...fallbackRow }, {
      row_key: 'TB-ONLY-1',
      operator_name: '张三',
      opinion: '投保单号兜底'
    });

    const batch5 = createUploadBatch(fixture.db, { filename: '2026-03.xlsx' });
    const unkeyedMerge = mergeParsedRows(fixture.db, batch5.id, [
      makeRow({
        sourceRow: 10,
        policyNo: '',
        proposalNo: '',
        opinion: '缺少单号A',
        month: 3,
        recordDate: '2026-03-11'
      }),
      makeRow({
        sourceRow: 11,
        policyNo: '   ',
        proposalNo: '   ',
        opinion: '缺少单号B',
        month: 3,
        recordDate: '2026-03-12'
      })
    ]);

    assert.deepEqual(unkeyedMerge, { inserted: 0, updated: 0, unchanged: 0, unkeyed: 2 });

    const unkeyedRows = fixture.db.prepare(`
      SELECT batch_row_key, opinion
      FROM downrate_row_versions
      WHERE row_key IS NULL
      ORDER BY source_row_number
    `).all().map(row => ({ ...row }));

    assert.deepEqual(unkeyedRows, [
      { batch_row_key: `${batch5.id}:10`, opinion: '缺少单号A' },
      { batch_row_key: `${batch5.id}:11`, opinion: '缺少单号B' }
    ]);
  } finally {
    fixture.cleanup();
  }
});

test('saveCalculationSnapshot stores immutable snapshot rows and loadCalculationSnapshot reconstructs them', () => {
  const fixture = createTempDatabase();

  try {
    ensureDashboardSchema(fixture.db);

    const snapshotId = saveCalculationSnapshot(fixture.db, {
      year: 2026,
      months: [1, 2],
      formulaVersion: 'policy-2026-07-30',
      rulesVersion: 'rules-2026-07-30',
      summary: { totalOperators: 2, averageScore: 95.5 },
      results: [
        { operatorName: '张三', score: 99, rate: 0.01 },
        { operatorName: '李四', score: 92, rate: 0.015 }
      ],
      monthly: [{ year: 2026, month: 1, score: 98 }],
      includedRows: [{ rowKey: 'P-001' }],
      pendingOpinions: [{ opinion: '待确认意见' }],
      dataQuality: [{ issue: '缺少单号' }]
    });

    const loaded = loadCalculationSnapshot(fixture.db, snapshotId);

    assert.equal(loaded.id, snapshotId);
    assert.deepEqual(loaded.months, [1, 2]);
    assert.deepEqual(loaded.summary, { totalOperators: 2, averageScore: 95.5 });
    assert.deepEqual(loaded.results, [
      { operatorName: '张三', score: 99, rate: 0.01 },
      { operatorName: '李四', score: 92, rate: 0.015 }
    ]);
    assert.deepEqual(loaded.pendingOpinions, [{ opinion: '待确认意见' }]);
  } finally {
    fixture.cleanup();
  }
});
