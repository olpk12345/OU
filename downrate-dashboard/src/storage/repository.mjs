import { createHash } from 'node:crypto';

import { ensureDashboardSchema as createDashboardSchema } from './schema.mjs';

export function ensureDashboardSchema(db) {
  createDashboardSchema(db);
}

function json(value) {
  return JSON.stringify(value ?? {});
}

function parseJson(value, fallback = {}) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function hashRow(row) {
  return createHash('sha256')
    .update(json(row.values))
    .digest('hex');
}

function normalizeRow(batchId, row) {
  const values = row.values ?? {};
  const policyNo = String(values.保单号 ?? '').trim();
  const proposalNo = String(values.投保单号 ?? '').trim();
  const rowKey = policyNo || proposalNo || null;
  const sourceRow = Number(row.sourceRow);
  return {
    batchId,
    batchRowKey: `${batchId}:${sourceRow}`,
    rowKey,
    sourceRow,
    year: row.year == null ? null : Number(row.year),
    month: row.month == null ? null : Number(row.month),
    operatorRaw: row.operatorRaw ?? String(values.出单员 ?? ''),
    operatorName: row.operatorName ?? '',
    opinion: row.opinion ?? String(values.退回审核意见 ?? ''),
    returnFlag: row.returnFlag ?? String(values.提核退回标志 ?? ''),
    recordDate: row.recordDate ?? String(values.出单时间 ?? ''),
    rowHash: hashRow(row),
    valuesJson: json(values),
    rowJson: json(row),
  };
}

function insertVersion(db, normalized, isCurrent) {
  const result = db.prepare(`
    INSERT INTO downrate_row_versions (
      batch_id, batch_row_key, row_key, source_row_number, year, month,
      operator_raw, operator_name, opinion, return_flag, record_date,
      row_hash, values_json, row_json, is_current
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    normalized.batchId,
    normalized.batchRowKey,
    normalized.rowKey,
    normalized.sourceRow,
    normalized.year,
    normalized.month,
    normalized.operatorRaw,
    normalized.operatorName,
    normalized.opinion,
    normalized.returnFlag,
    normalized.recordDate,
    normalized.rowHash,
    normalized.valuesJson,
    normalized.rowJson,
    isCurrent ? 1 : 0,
  );
  return Number(result.lastInsertRowid);
}

function insertCurrent(db, normalized, rowVersionId) {
  db.prepare(`
    INSERT INTO downrate_current_rows (
      row_version_id, batch_id, row_key, source_row_number, year, month,
      operator_raw, operator_name, opinion, return_flag, record_date,
      row_hash, values_json, row_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    rowVersionId,
    normalized.batchId,
    normalized.rowKey,
    normalized.sourceRow,
    normalized.year,
    normalized.month,
    normalized.operatorRaw,
    normalized.operatorName,
    normalized.opinion,
    normalized.returnFlag,
    normalized.recordDate,
    normalized.rowHash,
    normalized.valuesJson,
    normalized.rowJson,
  );
}

function updateCurrent(db, normalized, rowVersionId, currentId) {
  db.prepare(`
    UPDATE downrate_current_rows
    SET row_version_id = ?, batch_id = ?, source_row_number = ?, year = ?, month = ?,
        operator_raw = ?, operator_name = ?, opinion = ?, return_flag = ?, record_date = ?,
        row_hash = ?, values_json = ?, row_json = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    rowVersionId,
    normalized.batchId,
    normalized.sourceRow,
    normalized.year,
    normalized.month,
    normalized.operatorRaw,
    normalized.operatorName,
    normalized.opinion,
    normalized.returnFlag,
    normalized.recordDate,
    normalized.rowHash,
    normalized.valuesJson,
    normalized.rowJson,
    currentId,
  );
}

export function createUploadBatch(db, metadata = {}) {
  const result = db.prepare(`
    INSERT INTO downrate_upload_batches (filename, status, metadata_json)
    VALUES (?, 'pending', ?)
  `).run(metadata.filename ?? '未命名清单', json(metadata));
  return db.prepare('SELECT id, filename, status, metadata_json, created_at, committed_at FROM downrate_upload_batches WHERE id = ?')
    .get(Number(result.lastInsertRowid));
}

export function mergeParsedRows(db, batchId, rows) {
  db.exec('BEGIN');
  try {
    const counts = { inserted: 0, updated: 0, unchanged: 0, unkeyed: 0 };
    const findCurrent = db.prepare('SELECT * FROM downrate_current_rows WHERE row_key = ?');
    const findVersion = db.prepare('SELECT id, row_hash FROM downrate_row_versions WHERE row_key = ? AND is_current = 1');
    const closeVersion = db.prepare('UPDATE downrate_row_versions SET is_current = 0 WHERE id = ?');

    for (const row of rows) {
      const normalized = normalizeRow(batchId, row);
      if (!normalized.rowKey) {
        insertVersion(db, normalized, false);
        counts.unkeyed += 1;
        continue;
      }

      const current = findCurrent.get(normalized.rowKey);
      if (!current) {
        const versionId = insertVersion(db, normalized, true);
        insertCurrent(db, normalized, versionId);
        counts.inserted += 1;
        continue;
      }

      if (current.row_hash === normalized.rowHash) {
        counts.unchanged += 1;
        continue;
      }

      const oldVersion = findVersion.get(normalized.rowKey);
      if (oldVersion) closeVersion.run(oldVersion.id);
      const versionId = insertVersion(db, normalized, true);
      updateCurrent(db, normalized, versionId, current.id);
      counts.updated += 1;
    }

    db.prepare(`
      UPDATE downrate_upload_batches
      SET status = 'committed', committed_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(batchId);
    db.exec('COMMIT');
    return counts;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function listPeriods(db) {
  return db.prepare(`
    SELECT DISTINCT year, month
    FROM downrate_current_rows
    WHERE year IS NOT NULL AND month IS NOT NULL
    ORDER BY year, month
  `).all().map(row => ({ year: Number(row.year), month: Number(row.month) }));
}

export function listCurrentRows(db, { year, month } = {}) {
  const rows = db.prepare(`
    SELECT *
    FROM downrate_current_rows
    WHERE (? IS NULL OR year = ?) AND (? IS NULL OR month = ?)
    ORDER BY year, month, source_row_number, id
  `).all(year ?? null, year ?? null, month ?? null, month ?? null);
  return rows.map(row => ({
    id: row.id,
    rowVersionId: row.row_version_id,
    batchId: row.batch_id,
    rowKey: row.row_key,
    sourceRow: row.source_row_number,
    year: row.year,
    month: row.month,
    operatorRaw: row.operator_raw,
    operatorName: row.operator_name,
    opinion: row.opinion,
    returnFlag: row.return_flag,
    recordDate: row.record_date,
    rowHash: row.row_hash,
    values: parseJson(row.values_json),
    row: parseJson(row.row_json),
  }));
}

const SNAPSHOT_TYPES = ['results', 'monthly', 'includedRows', 'pendingOpinions', 'dataQuality'];

export function saveCalculationSnapshot(db, snapshot) {
  db.exec('BEGIN');
  try {
    const result = db.prepare(`
      INSERT INTO downrate_calculation_snapshots
        (year, months_json, formula_version, rules_version, summary_json)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      snapshot.year,
      json(snapshot.months ?? []),
      snapshot.formulaVersion ?? '',
      snapshot.rulesVersion ?? '',
      json(snapshot.summary ?? {}),
    );
    const snapshotId = Number(result.lastInsertRowid);
    const insertRow = db.prepare(`
      INSERT INTO downrate_calculation_rows (snapshot_id, row_type, row_index, row_json)
      VALUES (?, ?, ?, ?)
    `);
    for (const type of SNAPSHOT_TYPES) {
      for (const [rowIndex, row] of (snapshot[type] ?? []).entries()) {
        insertRow.run(snapshotId, type, rowIndex, json(row));
      }
    }
    db.exec('COMMIT');
    return snapshotId;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function loadCalculationSnapshot(db, snapshotId) {
  const snapshot = db.prepare('SELECT * FROM downrate_calculation_snapshots WHERE id = ?').get(snapshotId);
  if (!snapshot) return null;
  const rows = db.prepare(`
    SELECT row_type, row_index, row_json
    FROM downrate_calculation_rows
    WHERE snapshot_id = ?
    ORDER BY row_type, row_index
  `).all(snapshotId);
  const grouped = Object.fromEntries(SNAPSHOT_TYPES.map(type => [type, []]));
  for (const row of rows) grouped[row.row_type][row.row_index] = parseJson(row.row_json);
  return {
    id: snapshot.id,
    year: snapshot.year,
    months: parseJson(snapshot.months_json, []),
    formulaVersion: snapshot.formula_version,
    rulesVersion: snapshot.rules_version,
    summary: parseJson(snapshot.summary_json),
    ...grouped,
  };
}
