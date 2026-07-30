CREATE SCHEMA IF NOT EXISTS app;

CREATE TABLE IF NOT EXISTS app.change_log (
    id BIGSERIAL PRIMARY KEY,
    table_name TEXT NOT NULL,
    row_id TEXT,
    operation TEXT NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
    changed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    changed_by TEXT
);
