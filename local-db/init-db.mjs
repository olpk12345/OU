import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';

mkdirSync(new URL('.', import.meta.url), { recursive: true });
const db = new DatabaseSync(new URL('./work.db', import.meta.url));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    data_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_records_category ON records(category);
  CREATE INDEX IF NOT EXISTS idx_records_status ON records(status);

  CREATE TABLE IF NOT EXISTS change_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    record_id INTEGER,
    operation TEXT NOT NULL,
    changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    detail_json TEXT NOT NULL DEFAULT '{}'
  );

  CREATE TABLE IF NOT EXISTS attachments (
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

  CREATE INDEX IF NOT EXISTS idx_attachments_record_id ON attachments(record_id);

  CREATE TABLE IF NOT EXISTS spreadsheet_workbooks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    record_id INTEGER NOT NULL UNIQUE,
    attachment_id INTEGER NOT NULL UNIQUE,
    filename TEXT NOT NULL,
    report_year INTEGER,
    report_month INTEGER,
    document_type TEXT NOT NULL,
    sheet_count INTEGER NOT NULL,
    populated_cell_count INTEGER NOT NULL DEFAULT 0,
    formula_count INTEGER NOT NULL DEFAULT 0,
    imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (record_id) REFERENCES records(id) ON DELETE CASCADE,
    FOREIGN KEY (attachment_id) REFERENCES attachments(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_spreadsheet_workbooks_period
    ON spreadsheet_workbooks(report_year, report_month);
  CREATE INDEX IF NOT EXISTS idx_spreadsheet_workbooks_type
    ON spreadsheet_workbooks(document_type);

  CREATE TABLE IF NOT EXISTS spreadsheet_sheets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workbook_id INTEGER NOT NULL,
    sheet_index INTEGER NOT NULL,
    sheet_name TEXT NOT NULL,
    max_row INTEGER NOT NULL,
    max_column INTEGER NOT NULL,
    sheet_state TEXT NOT NULL,
    merged_ranges_json TEXT NOT NULL DEFAULT '[]',
    FOREIGN KEY (workbook_id) REFERENCES spreadsheet_workbooks(id) ON DELETE CASCADE,
    UNIQUE (workbook_id, sheet_index)
  );

  CREATE INDEX IF NOT EXISTS idx_spreadsheet_sheets_workbook
    ON spreadsheet_sheets(workbook_id);

  CREATE TABLE IF NOT EXISTS spreadsheet_cells (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sheet_id INTEGER NOT NULL,
    row_number INTEGER NOT NULL,
    column_number INTEGER NOT NULL,
    cell_address TEXT NOT NULL,
    value_type TEXT NOT NULL,
    value_text TEXT,
    formula_text TEXT,
    cached_value_text TEXT,
    number_format TEXT,
    FOREIGN KEY (sheet_id) REFERENCES spreadsheet_sheets(id) ON DELETE CASCADE,
    UNIQUE (sheet_id, row_number, column_number)
  );

  CREATE INDEX IF NOT EXISTS idx_spreadsheet_cells_sheet_position
    ON spreadsheet_cells(sheet_id, row_number, column_number);

  CREATE TABLE IF NOT EXISTS document_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    record_id INTEGER NOT NULL UNIQUE,
    attachment_id INTEGER NOT NULL UNIQUE,
    filename TEXT NOT NULL,
    title TEXT,
    author TEXT,
    created_at_source TEXT,
    modified_at_source TEXT,
    paragraph_count INTEGER NOT NULL DEFAULT 0,
    table_count INTEGER NOT NULL DEFAULT 0,
    block_count INTEGER NOT NULL DEFAULT 0,
    tracked_insertion_count INTEGER NOT NULL DEFAULT 0,
    tracked_deletion_count INTEGER NOT NULL DEFAULT 0,
    full_text TEXT NOT NULL DEFAULT '',
    imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (record_id) REFERENCES records(id) ON DELETE CASCADE,
    FOREIGN KEY (attachment_id) REFERENCES attachments(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS document_blocks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL,
    block_index INTEGER NOT NULL,
    block_type TEXT NOT NULL,
    text_content TEXT NOT NULL,
    style_name TEXT,
    table_index INTEGER,
    row_index INTEGER,
    FOREIGN KEY (document_id) REFERENCES document_files(id) ON DELETE CASCADE,
    UNIQUE (document_id, block_index)
  );

  CREATE INDEX IF NOT EXISTS idx_document_blocks_document
    ON document_blocks(document_id, block_index);
`);

console.log('Local database ready: local-db/work.db');
db.close();
