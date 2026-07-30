import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openDatabase } from './db.mjs';

const id = Number(process.argv[2]);
const output = resolve(process.argv[3] ?? 'exported.pptx');
if (!Number.isInteger(id)) {
  console.error('Usage: node local-db/export-attachment.mjs <attachment-id> [output.pptx]');
  process.exit(1);
}

const db = openDatabase();
const row = db.prepare('SELECT content_blob FROM attachments WHERE id = ?').get(id);
db.close();
if (!row) throw new Error(`Attachment not found: ${id}`);
writeFileSync(output, row.content_blob);
console.log(`Exported: ${output}`);
