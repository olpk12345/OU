import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createUploadBatch, ensureDashboardSchema, listCurrentRows, listPeriods, mergeParsedRows } from '../storage/repository.mjs';
import { loadWorkloads, buildDenominators, buildRoster } from '../domain/database-source.mjs';
import { calculatePeriod, loadScorePolicy } from '../domain/calculation.mjs';
import { classifyOpinion, loadOpinionRules } from '../domain/responsibility.mjs';

const MAX_UPLOAD_MB = Number(process.env.DOWNRATE_MAX_UPLOAD_MB ?? 256);
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function bodyBuffer(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_UPLOAD_BYTES) {
      const error = new Error('upload too large');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function jsonBody(req) {
  const body = await bodyBuffer(req);
  try {
    return JSON.parse(body.toString('utf8') || '{}');
  } catch {
    const error = new Error('invalid json');
    error.statusCode = 400;
    throw error;
  }
}

function parseMonths(url) {
  const raw = url.searchParams.get('months');
  if (!raw) return null;
  const months = raw.split(',').map(Number);
  if (!months.length || months.some(month => !Number.isInteger(month) || month < 1 || month > 12)) return null;
  return months;
}

function batchPreview(db, rows) {
  const currentKeys = new Set(db.prepare('SELECT row_key FROM downrate_current_rows').all().map(row => row.row_key));
  const counts = { inserted: 0, updated: 0, unchanged: 0, unkeyed: 0 };
  for (const row of rows) {
    const key = String(row.rowKey ?? '').trim();
    if (!key) counts.unkeyed += 1;
    else if (!currentKeys.has(key)) counts.inserted += 1;
    else counts.updated += 1;
  }
  return counts;
}

function readBatch(db, id) {
  const batch = db.prepare('SELECT * FROM downrate_upload_batches WHERE id = ?').get(id);
  if (!batch) return null;
  return { ...batch, metadata: JSON.parse(batch.metadata_json || '{}') };
}

function overview(db, year, months) {
  const workloads = loadWorkloads(db, { year, months });
  const roster = buildRoster(workloads);
  const denominators = buildDenominators(workloads);
  const rows = listCurrentRows(db, { year, month: null })
    .filter(row => !months || months.includes(Number(row.month)));
  const calculation = calculatePeriod({ rows, roster, denominators, rules: loadOpinionRules(db), policy: loadScorePolicy(db) });
  const scores = calculation.results.map(row => row.score).filter(score => score != null);
  return {
    year,
    months: months ?? [...new Set(workloads.map(row => row.month))],
    summary: {
      operatorCount: calculation.results.length,
      averageScore: scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null,
      includedCount: calculation.includedRows.length,
      pendingCount: calculation.pendingOpinions.length,
    },
    results: calculation.results,
    includedRows: calculation.includedRows,
    pendingOpinions: calculation.pendingOpinions,
    dataQuality: rows.filter(row => !row.rowKey || !row.recordDate),
  };
}

export function createApiHandler({ db, parseWorkbook }) {
  ensureDashboardSchema(db);
  return async function handle(req, res, url) {
    try {
      if (req.method === 'POST' && url.pathname === '/api/uploads/preview') {
        const content = await bodyBuffer(req);
        const encodedFilename = req.headers['x-filename-base64'];
        const filename = encodedFilename
          ? Buffer.from(String(encodedFilename), 'base64').toString('utf8')
          : String(req.headers['x-filename'] || 'uploaded.xlsx');
        const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'downrate-dashboard-upload-'));
        const inputPath = path.join(tempRoot, filename.replace(/[\\/]/g, '_'));
        try {
          await fs.writeFile(inputPath, content);
          const parsed = await parseWorkbook(inputPath);
          const batch = createUploadBatch(db, {
            filename,
            periods: parsed.periods,
            parsedRows: parsed.rows,
            attachment: {
              content,
              filename,
              mimeType: req.headers['content-type'] || 'application/octet-stream',
              sourcePath: '',
              sha256: createHash('sha256').update(content).digest('hex'),
            },
          });
          return json(res, 200, { batchId: batch.id, filename, periods: parsed.periods, counts: batchPreview(db, parsed.rows) });
        } finally {
          await fs.rm(tempRoot, { recursive: true, force: true });
        }
      }

      const commitMatch = url.pathname.match(/^\/api\/uploads\/(\d+)\/commit$/);
      if (req.method === 'POST' && commitMatch) {
        const batch = readBatch(db, Number(commitMatch[1]));
        if (!batch) return json(res, 404, { error: 'batch_not_found' });
        if (batch.status !== 'pending') return json(res, 409, { error: 'batch_already_committed' });
        const counts = mergeParsedRows(db, batch.id, batch.metadata.parsedRows ?? []);
        return json(res, 200, { batchId: batch.id, counts, periods: listPeriods(db) });
      }

      if (req.method === 'GET' && url.pathname === '/api/periods') return json(res, 200, { periods: listPeriods(db) });

      if (req.method === 'GET' && url.pathname === '/api/overview') {
        const year = Number(url.searchParams.get('year'));
        const months = parseMonths(url);
        if (!Number.isInteger(year) || (url.searchParams.has('months') && !months)) return json(res, 400, { error: 'invalid_period' });
        return json(res, 200, overview(db, year, months));
      }

      if (req.method === 'GET' && url.pathname === '/api/pending-opinions') {
        const rows = listCurrentRows(db);
        const rules = loadOpinionRules(db);
        const groups = new Map();
        for (const row of rows) {
          if (classifyOpinion(row.opinion, rules).decision !== 'pending') continue;
          const group = groups.get(row.opinion) ?? { id: encodeURIComponent(row.opinion), opinion: row.opinion, count: 0, operators: new Set() };
          group.count += 1;
          group.operators.add(row.operatorName);
          groups.set(row.opinion, group);
        }
        return json(res, 200, { items: [...groups.values()].map(item => ({ ...item, operators: [...item.operators] })) });
      }

      const decisionMatch = url.pathname.match(/^\/api\/pending-opinions\/([^/]+)\/decision$/);
      if (req.method === 'POST' && decisionMatch) {
        const opinion = decodeURIComponent(decisionMatch[1]);
        const payload = await jsonBody(req);
        if (!['included', 'excluded'].includes(payload.decision)) return json(res, 400, { error: 'invalid_decision' });
        db.prepare(`
          INSERT INTO downrate_opinion_rules (opinion, decision, basis, version)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(opinion) DO UPDATE SET decision = excluded.decision, basis = excluded.basis, version = excluded.version, updated_at = CURRENT_TIMESTAMP
        `).run(opinion, payload.decision, String(payload.basis ?? ''), `confirmed-${new Date().toISOString()}`);
        return json(res, 200, { opinion, decision: payload.decision });
      }

      const operatorMatch = url.pathname.match(/^\/api\/operators\/([^/]+)$/);
      if (req.method === 'GET' && operatorMatch) {
        const name = decodeURIComponent(operatorMatch[1]);
        const year = Number(url.searchParams.get('year'));
        const months = parseMonths(url);
        if (!Number.isInteger(year) || (url.searchParams.has('months') && !months)) return json(res, 400, { error: 'invalid_period' });
        const workloads = loadWorkloads(db, { year, months });
        const roster = buildRoster(workloads);
        if (!roster.includes(name)) return json(res, 404, { error: 'operator_not_found' });
        const rows = listCurrentRows(db, { year }).filter(row => (!months || months.includes(Number(row.month))) && row.operatorName === name);
        const calculation = calculatePeriod({ rows, roster: [name], denominators: buildDenominators(workloads), rules: loadOpinionRules(db), policy: loadScorePolicy(db) });
        return json(res, 200, { result: calculation.results[0], includedRows: calculation.includedRows, auditRows: calculation.auditedRows });
      }

      if (req.method === 'GET' && url.pathname === '/api/history') {
        const snapshots = db.prepare('SELECT id, year, months_json, formula_version, rules_version, summary_json, created_at FROM downrate_calculation_snapshots ORDER BY id DESC').all();
        return json(res, 200, { items: snapshots.map(row => ({ ...row, months: JSON.parse(row.months_json), summary: JSON.parse(row.summary_json) })) });
      }
      return false;
    } catch (error) {
      return json(res, error.statusCode ?? 500, { error: error.code ?? 'request_failed', message: error.message });
    }
  };
}
