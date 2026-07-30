import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dbPath = join(dirname(fileURLToPath(import.meta.url)), 'work.db');

export function openDatabase() {
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  return db;
}

export function addRecord({ category, title, status = 'active', data = {} }) {
  const db = openDatabase();
  const result = db.prepare(`
    INSERT INTO records (category, title, status, data_json)
    VALUES (?, ?, ?, ?)
  `).run(category, title, status, JSON.stringify(data));
  db.prepare(`
    INSERT INTO change_log (record_id, operation, detail_json)
    VALUES (?, 'INSERT', ?)
  `).run(Number(result.lastInsertRowid), JSON.stringify({ category, title }));
  db.close();
  return Number(result.lastInsertRowid);
}

export function listRecords(category) {
  const db = openDatabase();
  const query = category
    ? db.prepare('SELECT * FROM records WHERE category = ? ORDER BY id DESC')
    : db.prepare('SELECT * FROM records ORDER BY id DESC');
  const rows = category ? query.all(category) : query.all();
  db.close();
  return rows.map(row => ({ ...row, data: JSON.parse(row.data_json) }));
}

export function updateRecord(id, changes) {
  const db = openDatabase();
  const current = db.prepare('SELECT * FROM records WHERE id = ?').get(id);
  if (!current) throw new Error(`Record not found: ${id}`);
  const next = {
    category: changes.category ?? current.category,
    title: changes.title ?? current.title,
    status: changes.status ?? current.status,
    data: changes.data ?? JSON.parse(current.data_json),
  };
  db.prepare(`
    UPDATE records
    SET category = ?, title = ?, status = ?, data_json = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(next.category, next.title, next.status, JSON.stringify(next.data), id);
  db.prepare(`
    INSERT INTO change_log (record_id, operation, detail_json)
    VALUES (?, 'UPDATE', ?)
  `).run(id, JSON.stringify(changes));
  db.close();
}
