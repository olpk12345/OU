from __future__ import annotations

import hashlib
import json
import sqlite3
import sys
import zipfile
from datetime import date, datetime
from pathlib import Path
from xml.etree import ElementTree

from docx import Document
from docx.oxml.ns import qn
from docx.table import Table
from docx.text.paragraph import Paragraph


DB_PATH = Path(__file__).with_name("work.db")
MIME_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


SCHEMA = """
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
"""


def iso_value(value: object) -> str | None:
    if value is None:
        return None
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return str(value)


def revision_counts(source: Path) -> tuple[int, int]:
    with zipfile.ZipFile(source) as archive:
        root = ElementTree.fromstring(archive.read("word/document.xml"))
    return len(root.findall(".//" + qn("w:ins"))), len(root.findall(".//" + qn("w:del")))


def extract_blocks(document: Document) -> tuple[list[dict[str, object]], int, int]:
    blocks: list[dict[str, object]] = []
    paragraph_count = 0
    table_count = 0
    block_index = 0

    for child in document.element.body.iterchildren():
        if child.tag == qn("w:p"):
            paragraph = Paragraph(child, document)
            text = paragraph.text.strip()
            paragraph_count += 1
            if text:
                blocks.append(
                    {
                        "block_index": block_index,
                        "block_type": "paragraph",
                        "text_content": text,
                        "style_name": paragraph.style.name if paragraph.style else None,
                        "table_index": None,
                        "row_index": None,
                    }
                )
                block_index += 1
        elif child.tag == qn("w:tbl"):
            table = Table(child, document)
            current_table_index = table_count
            table_count += 1
            for row_index, row in enumerate(table.rows):
                text = "\t".join(cell.text.strip() for cell in row.cells).strip()
                if text:
                    blocks.append(
                        {
                            "block_index": block_index,
                            "block_type": "table_row",
                            "text_content": text,
                            "style_name": None,
                            "table_index": current_table_index,
                            "row_index": row_index,
                        }
                    )
                    block_index += 1
    return blocks, paragraph_count, table_count


def import_document(connection: sqlite3.Connection, source: Path) -> str:
    content = source.read_bytes()
    sha256 = hashlib.sha256(content).hexdigest()
    if connection.execute("SELECT 1 FROM attachments WHERE sha256 = ?", (sha256,)).fetchone():
        return f"Skipped duplicate: {source.name}"

    document = Document(source)
    blocks, paragraph_count, table_count = extract_blocks(document)
    insertion_count, deletion_count = revision_counts(source)
    full_text = "\n".join(str(block["text_content"]) for block in blocks)
    properties = document.core_properties
    metadata = {
        "filename": source.name,
        "source_path": str(source),
        "size_bytes": len(content),
        "sha256": sha256,
        "file_type": "docx",
        "paragraph_count": paragraph_count,
        "table_count": table_count,
        "block_count": len(blocks),
        "tracked_insertion_count": insertion_count,
        "tracked_deletion_count": deletion_count,
    }

    with connection:
        record_cursor = connection.execute(
            "INSERT INTO records (category, title, data_json) VALUES (?, ?, ?)",
            ("document", source.name, json.dumps(metadata, ensure_ascii=False)),
        )
        record_id = record_cursor.lastrowid
        attachment_cursor = connection.execute(
            """
            INSERT INTO attachments
              (record_id, filename, mime_type, source_path, size_bytes, sha256, content_blob)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (record_id, source.name, MIME_TYPE, str(source), len(content), sha256, content),
        )
        attachment_id = attachment_cursor.lastrowid
        document_cursor = connection.execute(
            """
            INSERT INTO document_files
              (record_id, attachment_id, filename, title, author, created_at_source,
               modified_at_source, paragraph_count, table_count, block_count,
               tracked_insertion_count, tracked_deletion_count, full_text)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                record_id,
                attachment_id,
                source.name,
                properties.title,
                properties.author,
                iso_value(properties.created),
                iso_value(properties.modified),
                paragraph_count,
                table_count,
                len(blocks),
                insertion_count,
                deletion_count,
                full_text,
            ),
        )
        document_id = document_cursor.lastrowid
        connection.executemany(
            """
            INSERT INTO document_blocks
              (document_id, block_index, block_type, text_content, style_name,
               table_index, row_index)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    document_id,
                    block["block_index"],
                    block["block_type"],
                    block["text_content"],
                    block["style_name"],
                    block["table_index"],
                    block["row_index"],
                )
                for block in blocks
            ],
        )
        connection.execute(
            """
            INSERT INTO change_log (record_id, operation, detail_json)
            VALUES (?, 'INSERT', ?)
            """,
            (record_id, json.dumps({"kind": "docx_import", **metadata}, ensure_ascii=False)),
        )

    return (
        f"Imported: {source.name} | paragraphs={paragraph_count} "
        f"tables={table_count} blocks={len(blocks)} revisions={insertion_count + deletion_count}"
    )


def main() -> int:
    sources = [Path(argument).resolve() for argument in sys.argv[1:]]
    if not sources:
        print("Usage: import-docx.py <file1.docx> [file2.docx ...]", file=sys.stderr)
        return 1
    missing = [str(source) for source in sources if not source.is_file()]
    if missing:
        print("Missing files:", *missing, sep="\n", file=sys.stderr)
        return 2

    connection = sqlite3.connect(DB_PATH)
    connection.execute("PRAGMA foreign_keys = ON")
    connection.executescript(SCHEMA)
    try:
        for source in sources:
            print(import_document(connection, source))
    finally:
        connection.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
