import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { openDatabase } from './db.mjs';

const files = process.argv.slice(2).flat(Infinity).map(String).map(file => resolve(file));
if (files.length === 0) {
  console.error('Usage: node local-db/import-pptx.mjs <file1.pptx> <file2.pptx> ...');
  process.exit(1);
}

const db = openDatabase();
const insertRecord = db.prepare(`
  INSERT INTO records (category, title, data_json)
  VALUES ('presentation', ?, ?)
`);
const insertAttachment = db.prepare(`
  INSERT INTO attachments
    (record_id, filename, mime_type, source_path, size_bytes, sha256, content_blob)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);
const findHash = db.prepare('SELECT id FROM attachments WHERE sha256 = ?');

for (const file of files) {
  if (!existsSync(file)) {
    console.error(`Skipped missing file: ${file}`);
    continue;
  }
  const content = readFileSync(file);
  const sha256 = createHash('sha256').update(content).digest('hex');
  if (findHash.get(sha256)) {
    console.log(`Skipped duplicate: ${basename(file)}`);
    continue;
  }

  const filename = basename(file);
  const recordData = {
    filename,
    source_path: file,
    size_bytes: content.length,
    sha256,
    file_type: 'pptx',
  };
  const record = insertRecord.run(filename, JSON.stringify(recordData));
  insertAttachment.run(
    Number(record.lastInsertRowid),
    filename,
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    file,
    content.length,
    sha256,
    content,
  );
  console.log(`Imported: ${filename}`);
}

db.close();
