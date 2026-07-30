export function ensureDashboardSchema(db) {
  db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS downrate_upload_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      committed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS downrate_row_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id INTEGER NOT NULL,
      batch_row_key TEXT NOT NULL UNIQUE,
      row_key TEXT,
      source_row_number INTEGER NOT NULL,
      year INTEGER,
      month INTEGER,
      operator_raw TEXT,
      operator_name TEXT,
      opinion TEXT,
      return_flag TEXT,
      record_date TEXT,
      row_hash TEXT NOT NULL,
      values_json TEXT NOT NULL,
      row_json TEXT NOT NULL,
      is_current INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (batch_id) REFERENCES downrate_upload_batches(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_downrate_row_versions_row_key
      ON downrate_row_versions(row_key);
    CREATE INDEX IF NOT EXISTS idx_downrate_row_versions_period
      ON downrate_row_versions(year, month);
    CREATE INDEX IF NOT EXISTS idx_downrate_row_versions_operator
      ON downrate_row_versions(operator_name);
    CREATE INDEX IF NOT EXISTS idx_downrate_row_versions_batch
      ON downrate_row_versions(batch_id);

    CREATE TABLE IF NOT EXISTS downrate_current_rows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      row_version_id INTEGER NOT NULL UNIQUE,
      batch_id INTEGER NOT NULL,
      row_key TEXT NOT NULL UNIQUE,
      source_row_number INTEGER NOT NULL,
      year INTEGER,
      month INTEGER,
      operator_raw TEXT,
      operator_name TEXT,
      opinion TEXT,
      return_flag TEXT,
      record_date TEXT,
      row_hash TEXT NOT NULL,
      values_json TEXT NOT NULL,
      row_json TEXT NOT NULL,
      is_current INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (row_version_id) REFERENCES downrate_row_versions(id) ON DELETE CASCADE,
      FOREIGN KEY (batch_id) REFERENCES downrate_upload_batches(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_downrate_current_rows_row_key
      ON downrate_current_rows(row_key);
    CREATE INDEX IF NOT EXISTS idx_downrate_current_rows_period
      ON downrate_current_rows(year, month);
    CREATE INDEX IF NOT EXISTS idx_downrate_current_rows_operator
      ON downrate_current_rows(operator_name);
    CREATE INDEX IF NOT EXISTS idx_downrate_current_rows_batch
      ON downrate_current_rows(batch_id);

    CREATE TABLE IF NOT EXISTS downrate_opinion_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      opinion TEXT NOT NULL UNIQUE,
      decision TEXT NOT NULL,
      basis TEXT NOT NULL DEFAULT '',
      version TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS downrate_formula_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      version TEXT NOT NULL UNIQUE,
      payload_json TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS downrate_calculation_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      year INTEGER NOT NULL,
      months_json TEXT NOT NULL,
      formula_version TEXT NOT NULL,
      rules_version TEXT NOT NULL,
      summary_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS downrate_calculation_rows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshot_id INTEGER NOT NULL,
      row_type TEXT NOT NULL,
      row_index INTEGER NOT NULL,
      row_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (snapshot_id) REFERENCES downrate_calculation_snapshots(id) ON DELETE CASCADE,
      UNIQUE (snapshot_id, row_type, row_index)
    );

    CREATE INDEX IF NOT EXISTS idx_downrate_calculation_rows_snapshot
      ON downrate_calculation_rows(snapshot_id);
  `);
}
