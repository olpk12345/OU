const GENERIC = '下发修改，请补充材料再提交';

const operatorError = /录入|填写|选择|错误|发票|费率|保费|职业|条款|责任|特约|保额|险种|受益人|被保险人本人|年龄|资料不全/u;
const externalCause = /业务员|投保人|客户|核保|报价|方案|机构|重复投保|保障重叠|生效日期|剔除重复人员/u;

export function loadConfirmedRules(text) {
  const rules = new Map();
  for (const line of String(text ?? '').replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const parts = line.split('\t');
    if (parts.length < 3 || !parts[1] || !['included', 'excluded'].includes(parts[2])) continue;
    rules.set(parts[1], { decision: parts[2], basis: parts[3] ?? 'confirmed' });
  }
  return rules;
}

export function seedOpinionRules(db, text, version = 'confirmed-2026-07-30') {
  const rules = loadConfirmedRules(text);
  const insert = db.prepare(`
    INSERT INTO downrate_opinion_rules (opinion, decision, basis, version)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(opinion) DO UPDATE SET decision = excluded.decision, basis = excluded.basis, version = excluded.version, updated_at = CURRENT_TIMESTAMP
  `);
  for (const [opinion, rule] of rules) insert.run(opinion, rule.decision, rule.basis, version);
  return rules.size;
}

export function loadOpinionRules(db) {
  return new Map(db.prepare('SELECT opinion, decision, basis FROM downrate_opinion_rules').all()
    .map(row => [row.opinion, { decision: row.decision, basis: row.basis }]));
}

export function classifyOpinion(opinion, rules = new Map()) {
  const value = String(opinion ?? '').trim();
  if (!value) return { decision: 'excluded', basis: 'empty opinion' };
  if (rules.has(value)) return rules.get(value);
  if (value === GENERIC) return { decision: 'excluded', basis: 'generic material request' };
  if (value.includes('重复投保') || value.includes('保障重叠') || value.includes('调整生效日期') || value.includes('剔除重复人员')) {
    return { decision: 'excluded', basis: 'confirmed non-operator category' };
  }
  if (externalCause.test(value) && !operatorError.test(value)) return { decision: 'excluded', basis: 'external responsibility' };
  if (value.includes('下发修改') && operatorError.test(value)) return { decision: 'included', basis: 'operator operation error' };
  return { decision: 'pending', basis: 'unresolved responsibility' };
}

export function classifyRows(rows, roster, rules = new Map()) {
  const names = new Set(roster);
  return rows
    .filter(row => names.has(row.operatorName))
    .map(row => ({ ...row, ...classifyOpinion(row.opinion, rules) }));
}
