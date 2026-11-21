import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const config = {
  port: Number(process.env.PORT || 3001),
  origin: process.env.APP_ORIGIN || 'http://localhost:5173',
  databasePath: path.resolve(root, process.env.DATABASE_PATH || './data/llm-compare.sqlite'),
  encryptionKey: process.env.ENCRYPTION_KEY || 'development-only-key-change-before-production-32',
  requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS || 120_000),
  root,
};
