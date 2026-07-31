import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const pythonBin = process.env.DOWNRATE_PYTHON ?? process.env.PYTHON_BIN ?? 'python';
const scriptPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../scripts/parse_workbook.py',
);

export async function parseWorkbook(inputPath) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'downrate-dashboard-parser-'));
  const outputPath = path.join(tempRoot, 'parsed.json');
  try {
    await execFileAsync(
      pythonBin,
      [scriptPath, path.resolve(inputPath), outputPath],
      { timeout: 120_000, maxBuffer: 16 * 1024 * 1024 },
    );
    const result = JSON.parse(await fs.readFile(outputPath, 'utf8'));
    if (Array.isArray(result.errors) && result.errors.length > 0) {
      const firstError = result.errors[0];
      const structuredError = new Error(firstError.message || 'Excel解析失败');
      structuredError.code = firstError.code;
      structuredError.filename = path.resolve(inputPath);
      structuredError.details = result.errors;
      throw structuredError;
    }
    return result;
  } catch (error) {
    if (error?.code && error?.details) {
      throw error;
    }
    const detail = error.stderr?.trim() || error.message;
    throw new Error(`Excel清单解析失败: ${detail}`, { cause: error });
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}
