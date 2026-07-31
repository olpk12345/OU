import { classifyRows } from './responsibility.mjs';

export const CURRENT_SCORE_POLICY = {
  version: '2026-07-30',
  bands: [
    { until: 0.009, fromScore: 100, toScore: 100 },
    { until: 0.018, fromScore: 99, toScore: 90 },
    { until: 0.03, fromScore: 89, toScore: 60 },
    { until: 0.05, fromScore: 59, toScore: 1 },
    { until: Infinity, fromScore: 0, toScore: 0 },
  ],
};

export function loadScorePolicy(db) {
  const row = db.prepare(`
    SELECT version, payload_json
    FROM downrate_formula_versions
    WHERE is_active = 1
    ORDER BY id DESC
    LIMIT 1
  `).get();
  if (row) return { ...JSON.parse(row.payload_json), version: row.version };
  db.prepare(`
    INSERT INTO downrate_formula_versions (version, payload_json, is_active)
    VALUES (?, ?, 1)
  `).run(CURRENT_SCORE_POLICY.version, JSON.stringify(CURRENT_SCORE_POLICY));
  return CURRENT_SCORE_POLICY;
}

export function scoreRate(rate, policy = CURRENT_SCORE_POLICY) {
  if (rate == null || Number.isNaN(rate)) return null;
  let lower = 0;
  for (const band of policy.bands) {
    if (rate <= band.until) {
      if (band.fromScore === band.toScore) return band.fromScore;
      const previous = policy.bands[policy.bands.indexOf(band) - 1];
      const upperRate = band.until;
      const lowerRate = previous?.until ?? lower;
      const ratio = (rate - lowerRate) / (upperRate - lowerRate);
      return band.fromScore + ratio * (band.toScore - band.fromScore);
    }
    lower = band.until;
  }
  return 0;
}

export function calculatePeriod({ rows, roster, denominators, rules = new Map(), policy = CURRENT_SCORE_POLICY }) {
  const classified = classifyRows(rows, roster, rules);
  const results = roster.map(operatorName => {
    const personRows = classified.filter(row => row.operatorName === operatorName);
    const includedCount = personRows.filter(row => row.decision === 'included').length;
    const denominator = denominators.get(operatorName) ?? 0;
    const rate = denominator ? includedCount / denominator : null;
    return {
      operatorName,
      includedCount,
      denominator,
      rate,
      score: scoreRate(rate, policy),
      candidateCount: personRows.length,
      excludedCount: personRows.filter(row => row.decision === 'excluded').length,
      pendingCount: personRows.filter(row => row.decision === 'pending').length,
    };
  });
  return {
    results,
    includedRows: classified.filter(row => row.decision === 'included'),
    pendingOpinions: classified.filter(row => row.decision === 'pending'),
    auditedRows: classified,
  };
}
