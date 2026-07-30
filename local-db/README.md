# Local Database

This is a local SQLite database for general business data. The database file is `work.db`.

## Initialize

From the project directory:

```powershell
node .\local-db\init-db.mjs
```

## Use from another Node.js script

```js
import { addRecord, listRecords, updateRecord } from './local-db/db.mjs';

const id = addRecord({
  category: 'customer',
  title: 'Example customer',
  data: { phone: '13800000000', source: 'manual' }
});

console.log(listRecords('customer'));
updateRecord(id, { status: 'archived' });
```

The `records` table is intentionally flexible: `category` identifies the data type and `data_json` stores fields that vary by type. The change log records inserts and updates.

## Import PPTX files

```powershell
node .\local-db\import-pptx.mjs "C:\path\report.pptx"
```

PPTX files are stored in the `attachments` table as BLOB data, together with the original filename, source path, file size and SHA-256 hash. Re-running the import for the same file skips duplicates.

Export an attachment with:

```powershell
node .\local-db\export-attachment.mjs 1 .\restored.pptx
```

## Import XLSX files

Use the PowerShell wrapper, which locates the available Python runtime:

```powershell
powershell -ExecutionPolicy Bypass -File .\local-db\import-xlsx.ps1 "C:\path\workbook.xlsx"
```

Each original workbook is stored as an attachment. Workbook metadata is stored in
`spreadsheet_workbooks`, sheet metadata in `spreadsheet_sheets`, and every non-empty
cell in `spreadsheet_cells`. Formula text and cached formula values are kept separately.

## Import DOCX files

```powershell
powershell -ExecutionPolicy Bypass -File .\local-db\import-docx.ps1 "C:\path\document.docx"
```

The original DOCX is stored as an attachment. Document metadata and full text are
stored in `document_files`; paragraphs and table rows are stored in `document_blocks`.

Back up the database by copying `work.db` and its `work.db-wal` file when present, or stop writes before copying. Do not place the database file in a public web directory.
