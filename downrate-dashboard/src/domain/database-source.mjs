function extractOperatorName(value) {
  const match = String(value ?? '').trim().match(/([\u3400-\u9fff路]{2,12})$/u);
  return match?.[1] ?? '';
}

function selectFirstWorkloadBlock(rows) {
  const sorted = [...rows].sort((a, b) => a.rowNumber - b.rowNumber);
  if (!sorted.length) return [];
  const block = [sorted[0]];
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index].rowNumber !== sorted[index - 1].rowNumber + 1) break;
    block.push(sorted[index]);
  }
  return block;
}

function cellValue(cell) {
  return cell?.cached_value_text ?? cell?.value_text ?? '';
}

function integer(value) {
  const text = String(value ?? '').trim();
  return /^\d+$/.test(text) ? Number(text) : null;
}

export function loadWorkloads(db, { year, months, leaderNames = ['宋键', '梁欣宁'] } = {}) {
  const monthFilter = Array.isArray(months) && months.length ? months : null;
  const monthClause = monthFilter ? `AND report_month IN (${monthFilter.map(() => '?').join(',')})` : '';
  const workbooks = db.prepare(`
    SELECT id, report_year, report_month, filename
    FROM spreadsheet_workbooks
    WHERE report_year = ?
      AND document_type = 'piecework_payroll'
      ${monthClause}
    ORDER BY report_month, id
  `).all(year, ...(monthFilter ?? []));
  const leaderSet = new Set(leaderNames);
  return workbooks.map((workbook) => {
    const sheet = db.prepare(`
      SELECT id, sheet_name FROM spreadsheet_sheets
      WHERE workbook_id = ? AND sheet_index = 0
    `).get(workbook.id);
    if (!sheet) return { ...workbook, rows: [] };
    const cells = db.prepare(`
      SELECT row_number, column_number, value_text, cached_value_text
      FROM spreadsheet_cells
      WHERE sheet_id = ? AND column_number IN (1, 2, 7, 8)
      ORDER BY row_number, column_number
    `).all(sheet.id);
    const byRow = new Map();
    for (const cell of cells) {
      if (!byRow.has(cell.row_number)) byRow.set(cell.row_number, new Map());
      byRow.get(cell.row_number).set(cell.column_number, cell);
    }
    const candidates = [];
    for (const [rowNumber, columns] of byRow) {
      const sequence = integer(cellValue(columns.get(1)));
      const name = extractOperatorName(cellValue(columns.get(2))) || String(cellValue(columns.get(2))).trim();
      const policy = integer(cellValue(columns.get(7)));
      const endorsement = integer(cellValue(columns.get(8)));
      if (sequence !== null && name && policy !== null && endorsement !== null) {
        candidates.push({ rowNumber, sequence, name, policy, endorsement });
      }
    }
    const rows = selectFirstWorkloadBlock(candidates)
      .filter(row => !leaderSet.has(row.name));
    return {
      workbookId: workbook.id,
      year: Number(workbook.report_year),
      month: Number(workbook.report_month),
      filename: workbook.filename,
      sheetName: sheet.sheet_name,
      rows,
    };
  });
}

export function buildRoster(workloads) {
  return [...new Set(workloads.flatMap(month => month.rows.map(row => row.name)))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

export function buildDenominators(workloads) {
  const totals = new Map();
  for (const month of workloads) {
    for (const row of month.rows) {
      const current = totals.get(row.name) ?? 0;
      totals.set(row.name, current + row.policy + row.endorsement);
    }
  }
  return totals;
}
