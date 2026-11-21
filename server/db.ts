import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.ts';

fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
export const db = new DatabaseSync(config.databasePath);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL, is_admin INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS model_configs (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    display_name TEXT NOT NULL, provider TEXT NOT NULL, model_id TEXT NOT NULL, base_url TEXT,
    encrypted_key TEXT NOT NULL, input_price REAL, output_price REAL,
    price_unit INTEGER NOT NULL DEFAULT 1000000, currency TEXT NOT NULL DEFAULT 'USD',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS chats (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS comparisons (
    id TEXT PRIMARY KEY, chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    prompt TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS results (
    id TEXT PRIMARY KEY, comparison_id TEXT NOT NULL REFERENCES comparisons(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    model_config_id TEXT, model_name TEXT NOT NULL, provider TEXT NOT NULL, model_id TEXT NOT NULL,
    input_price REAL, output_price REAL, price_unit INTEGER, currency TEXT,
    response TEXT NOT NULL, status TEXT NOT NULL, error TEXT,
    first_token_ms REAL, total_ms REAL, input_tokens INTEGER, output_tokens INTEGER,
    token_estimated INTEGER NOT NULL DEFAULT 0, cost REAL,
    liked INTEGER, rating INTEGER, is_winner INTEGER NOT NULL DEFAULT 0,
    ai_evaluation TEXT, created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_chats_user ON chats(user_id, updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_results_user ON results(user_id, created_at DESC);
`);

const userColumns = db.prepare('PRAGMA table_info(users)').all() as { name: string }[];
if (!userColumns.some((column) => column.name === 'is_admin')) {
  db.exec('ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0');
}
const modelColumns = db.prepare('PRAGMA table_info(model_configs)').all() as { name: string }[];
if (!modelColumns.some((column) => column.name === 'base_url')) {
  db.exec('ALTER TABLE model_configs ADD COLUMN base_url TEXT');
}

export const id = () => crypto.randomUUID();
export const now = () => new Date().toISOString();

export function rows<T>(statement: string, ...params: any[]): T[] {
  return db.prepare(statement).all(...params) as T[];
}
export function row<T>(statement: string, ...params: any[]): T | undefined {
  return db.prepare(statement).get(...params) as T | undefined;
}
