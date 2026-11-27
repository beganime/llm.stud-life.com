import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export type DemoModel = { id: string; displayName: string; providerLabel: string; modelId: string };

function parseDemoModels(raw: string): DemoModel[] {
  return raw.split(',').map((entry) => entry.trim()).filter(Boolean).map((entry) => {
    const [displayName, providerLabel, modelId] = entry.split('|').map((part) => (part || '').trim());
    return displayName && modelId ? { id: `demo:${modelId}`, displayName, providerLabel: providerLabel || 'Demo', modelId } : null;
  }).filter((model): model is DemoModel => Boolean(model));
}

export const config = {
  port: Number(process.env.PORT || 3001),
  origin: process.env.APP_ORIGIN || 'http://localhost:5173',
  databasePath: path.resolve(root, process.env.DATABASE_PATH || './data/llm-compare.sqlite'),
  encryptionKey: process.env.ENCRYPTION_KEY || 'development-only-key-change-before-production-32',
  requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS || 120_000),
  demoBaseUrl: process.env.DEMO_BASE_URL || '',
  demoApiKey: process.env.DEMO_API_KEY || '',
  demoModels: parseDemoModels(process.env.DEMO_MODELS || ''),
  root,
};
