import path from 'node:path';
import { fileURLToPath } from 'node:url';

const srcDir = path.dirname(fileURLToPath(import.meta.url));

export const defaultPort = 54800;
export const defaultDatabasePath = path.resolve('local-db/work.db');
export const publicDir = path.join(srcDir, 'public');
export const publicIndexPath = path.join(publicDir, 'index.html');
