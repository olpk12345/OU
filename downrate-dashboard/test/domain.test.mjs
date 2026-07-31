import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { scoreRate, calculatePeriod, loadScorePolicy } from '../src/domain/calculation.mjs';
import { classifyOpinion, seedOpinionRules, loadOpinionRules } from '../src/domain/responsibility.mjs';

test('scoreRate follows all current boundary bands', () => {
  assert.equal(scoreRate(0), 100);
  assert.equal(scoreRate(0.009), 100);
  assert.equal(scoreRate(0.018), 90);
  assert.equal(scoreRate(0.03), 60);
  assert.equal(scoreRate(0.05), 1);
  assert.equal(scoreRate(0.050001), 0);
});

test('responsibility classification keeps confirmed exclusions and unresolved opinions separate', () => {
  assert.equal(classifyOpinion('下发修改，请补充材料再提交').decision, 'excluded');
  assert.equal(classifyOpinion('下发修改，请修改发票信息').decision, 'included');
  assert.equal(classifyOpinion('下发修改，重复投保').decision, 'excluded');
  assert.equal(classifyOpinion('下发修改，原因待核实').decision, 'pending');
});

test('calculation returns one database-roster row and excludes pending records', () => {
  const result = calculatePeriod({
    roster: ['张三', '李四'],
    denominators: new Map([['张三', 100], ['李四', 0]]),
    rows: [
      { operatorName: '张三', opinion: '下发修改，请修改发票信息' },
      { operatorName: '张三', opinion: '下发修改，原因待核实' },
      { operatorName: '外部姓名', opinion: '下发修改，请修改发票信息' },
    ],
  });
  assert.deepEqual(result.results, [
    { operatorName: '张三', includedCount: 1, denominator: 100, rate: 0.01, score: 98, candidateCount: 2, excludedCount: 0, pendingCount: 1 },
    { operatorName: '李四', includedCount: 0, denominator: 0, rate: null, score: null, candidateCount: 0, excludedCount: 0, pendingCount: 0 },
  ]);
  assert.equal(result.includedRows.length, 1);
  assert.equal(result.pendingOpinions.length, 1);
});

test('formula and confirmed opinion rules persist in the local database', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE downrate_formula_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version TEXT NOT NULL UNIQUE,
      payload_json TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE downrate_opinion_rules (
      opinion TEXT PRIMARY KEY,
      decision TEXT NOT NULL,
      basis TEXT NOT NULL,
      version TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  const policy = loadScorePolicy(db);
  assert.equal(policy.version, '2026-07-30');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM downrate_formula_versions').get().count, 1);
  seedOpinionRules(db, '1\t下发修改，请修改发票信息\tincluded\tconfirmed');
  assert.equal(loadOpinionRules(db).get('下发修改，请修改发票信息').decision, 'included');
  db.close();
});
