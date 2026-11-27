import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
import express, { type NextFunction, type Request, type Response } from 'express';
import bcrypt from 'bcryptjs';
import { config } from './config.ts';
import { db, id, now, row, rows } from './db.ts';
import { decrypt, encrypt, hashToken, newToken } from './crypto.ts';
import { calculateCost, completeProvider, estimateTokens, streamProvider, timewebEndpoint, type Message, type Provider } from './providers.ts';

type User = { id: string; name: string; email: string; is_admin: number };
type AuthedRequest = Request & { user?: User };
type StoredModel = {
  id: string; user_id: string; display_name: string; provider: Provider; model_id: string; base_url: string | null; encrypted_key: string;
  input_price: number | null; output_price: number | null; price_unit: number; currency: string;
};

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));

function cookies(req: Request) {
  return Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map((part) => {
    const [key, ...rest] = part.trim().split('=');
    return [key, decodeURIComponent(rest.join('='))];
  }));
}

function auth(req: AuthedRequest, _res: Response, next: NextFunction) {
  const token = cookies(req).llmc_session;
  if (token) {
    req.user = row<User>(`SELECT u.id, u.name, u.email, u.is_admin FROM sessions s JOIN users u ON u.id=s.user_id
      WHERE s.token_hash=? AND s.expires_at > ?`, hashToken(token), now());
  }
  next();
}
app.use(auth);

function requireUser(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: 'Требуется вход в аккаунт' });
  next();
}

function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.user?.is_admin) return res.status(403).json({ error: 'Доступ только для администратора' });
  next();
}

const publicUser = (user: User) => ({ id: user.id, name: user.name, email: user.email, isAdmin: Boolean(user.is_admin) });
const safeModel = (model: StoredModel) => ({
  id: model.id, displayName: model.display_name, provider: model.provider, modelId: model.model_id, baseUrl: model.base_url,
  inputPrice: model.input_price, outputPrice: model.output_price, priceUnit: model.price_unit,
  currency: model.currency, maskedKey: '••••••••' + decrypt(model.encrypted_key, config.encryptionKey).slice(-4),
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.get('/api/auth/me', (req: AuthedRequest, res) => res.json({ user: req.user ? publicUser(req.user) : null }));

app.post('/api/auth/register', async (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (name.length < 2 || !email.includes('@') || password.length < 8) return res.status(400).json({ error: 'Проверьте имя, email и пароль (минимум 8 символов)' });
  if (row('SELECT id FROM users WHERE email=?', email)) return res.status(409).json({ error: 'Этот email уже зарегистрирован' });
  const user = { id: id(), name, email, is_admin: 0 };
  db.prepare('INSERT INTO users (id,name,email,password_hash,created_at) VALUES (?,?,?,?,?)').run(user.id, name, email, await bcrypt.hash(password, 12), now());
  setSession(req, res, user.id);
  res.status(201).json({ user });
});

app.post('/api/auth/login', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const found = row<User & { password_hash: string }>('SELECT id,name,email,password_hash,is_admin FROM users WHERE email=?', email);
  if (!found || !(await bcrypt.compare(String(req.body.password || ''), found.password_hash))) return res.status(401).json({ error: 'Неверный email или пароль' });
  setSession(req, res, found.id);
  res.json({ user: publicUser(found) });
});

app.post('/api/auth/logout', (req, res) => {
  const token = cookies(req).llmc_session;
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hashToken(token));
  res.clearCookie('llmc_session', { path: '/' });
  res.json({ ok: true });
});

function setSession(req: Request, res: Response, userId: string) {
  const token = newToken();
  const expires = new Date(Date.now() + 30 * 864e5);
  db.prepare('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)').run(hashToken(token), userId, expires.toISOString());
  res.cookie('llmc_session', token, { httpOnly: true, sameSite: 'lax', secure: req.secure, path: '/', expires });
}

app.get('/api/models', requireUser, (req: AuthedRequest, res) => {
  res.json(rows<StoredModel>('SELECT * FROM model_configs WHERE user_id=? ORDER BY created_at', req.user!.id).map(safeModel));
});

app.post('/api/models', requireUser, (req: AuthedRequest, res) => {
  const count = row<{ count: number }>('SELECT COUNT(*) count FROM model_configs WHERE user_id=?', req.user!.id)!.count;
  if (count >= 10) return res.status(400).json({ error: 'Можно сохранить не более 10 моделей' });
  const validation = validateModel(req.body, true);
  if (validation) return res.status(400).json({ error: validation });
  const modelId = id(); const timestamp = now();
  db.prepare(`INSERT INTO model_configs (id,user_id,display_name,provider,model_id,base_url,encrypted_key,input_price,output_price,price_unit,currency,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(modelId, req.user!.id, req.body.displayName.trim(), req.body.provider, req.body.modelId.trim(), req.body.provider === 'timeweb' ? req.body.baseUrl.trim() : null, encrypt(req.body.apiKey.trim(), config.encryptionKey), numberOrNull(req.body.inputPrice), numberOrNull(req.body.outputPrice), Number(req.body.priceUnit || 1_000_000), req.body.currency || 'USD', timestamp, timestamp);
  res.status(201).json(safeModel(row<StoredModel>('SELECT * FROM model_configs WHERE id=?', modelId)!));
});

app.put('/api/models/:id', requireUser, (req: AuthedRequest, res) => {
  const model = row<StoredModel>('SELECT * FROM model_configs WHERE id=? AND user_id=?', req.params.id, req.user!.id);
  if (!model) return res.status(404).json({ error: 'Модель не найдена' });
  const validation = validateModel(req.body, false);
  if (validation) return res.status(400).json({ error: validation });
  const key = req.body.apiKey?.trim() ? encrypt(req.body.apiKey.trim(), config.encryptionKey) : model.encrypted_key;
  db.prepare(`UPDATE model_configs SET display_name=?,provider=?,model_id=?,base_url=?,encrypted_key=?,input_price=?,output_price=?,price_unit=?,currency=?,updated_at=? WHERE id=?`)
    .run(req.body.displayName.trim(), req.body.provider, req.body.modelId.trim(), req.body.provider === 'timeweb' ? req.body.baseUrl.trim() : null, key, numberOrNull(req.body.inputPrice), numberOrNull(req.body.outputPrice), Number(req.body.priceUnit || 1_000_000), req.body.currency || 'USD', now(), model.id);
  res.json(safeModel(row<StoredModel>('SELECT * FROM model_configs WHERE id=?', model.id)!));
});

app.delete('/api/models/:id', requireUser, (req: AuthedRequest, res) => {
  db.prepare('DELETE FROM model_configs WHERE id=? AND user_id=?').run(String(req.params.id), req.user!.id);
  res.status(204).end();
});

function validateModel(body: Record<string, unknown>, keyRequired: boolean) {
  if (!String(body.displayName || '').trim() || !String(body.modelId || '').trim()) return 'Заполните название и идентификатор модели';
  if (!['openai', 'anthropic', 'gemini', 'timeweb'].includes(String(body.provider))) return 'Неизвестный провайдер';
  if (body.provider === 'timeweb') {
    if (!String(body.baseUrl || '').trim()) return 'Введите Base URL или полную ссылку Chat Completions из Timeweb';
    try { timewebEndpoint(String(body.baseUrl)); } catch (error) { return error instanceof Error ? error.message : 'Некорректный URL Timeweb'; }
  }
  if (keyRequired && !String(body.apiKey || '').trim()) return 'Введите API-ключ';
  if (![1, 1000, 1000000].includes(Number(body.priceUnit || 1000000))) return 'Неверная единица тарифа';
  return null;
}
const numberOrNull = (value: unknown) => value === '' || value == null ? null : Number(value);

const demoHits = new Map<string, { count: number; resetAt: number }>();
const DEMO_RATE_LIMIT = 30;
const DEMO_RATE_WINDOW_MS = 3_600_000;
function demoRateOk(ip: string): boolean {
  const nowTs = Date.now();
  const entry = demoHits.get(ip);
  if (!entry || entry.resetAt < nowTs) {
    demoHits.set(ip, { count: 1, resetAt: nowTs + DEMO_RATE_WINDOW_MS });
    return true;
  }
  entry.count += 1;
  return entry.count <= DEMO_RATE_LIMIT;
}

app.get('/api/demo/models', (_req, res) => {
  res.json(config.demoApiKey ? config.demoModels : []);
});

// Публичное сохранение «гостевых» чатов, чтобы read-only ссылка работала без регистрации.
const GUEST_SHARE_USER = 'guest-shared';
db.prepare('INSERT OR IGNORE INTO users (id,name,email,password_hash,is_admin,created_at) VALUES (?,?,?,?,0,?)')
  .run(GUEST_SHARE_USER, 'Guest', 'guest-shared@invalid.local', '!', now());

app.post('/api/shared', (req, res) => {
  if (!demoRateOk(req.ip || 'unknown')) return res.status(429).json({ error: 'Слишком много запросов. Попробуйте позже.' });
  const payload = req.body;
  const chatId = typeof payload?.id === 'string' && payload.id.length <= 64 ? payload.id : id();
  const title = String(payload?.title || 'Без названия').slice(0, 120);
  const comparisons = Array.isArray(payload?.comparisons) ? payload.comparisons.slice(0, 20) : [];
  const timestamp = now();
  db.exec('BEGIN');
  try {
    db.prepare('INSERT OR IGNORE INTO chats (id,user_id,title,created_at,updated_at) VALUES (?,?,?,?,?)')
      .run(chatId, GUEST_SHARE_USER, title, String(payload?.createdAt || timestamp), timestamp);
    const insertComparison = db.prepare('INSERT OR IGNORE INTO comparisons (id,chat_id,user_id,prompt,created_at) VALUES (?,?,?,?,?)');
    const insertResult = db.prepare(`INSERT OR IGNORE INTO results (id,comparison_id,user_id,model_config_id,model_name,provider,model_id,input_price,output_price,price_unit,currency,response,status,error,first_token_ms,total_ms,input_tokens,output_tokens,token_estimated,cost,liked,rating,is_winner,ai_evaluation,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const comparison of comparisons) {
      const comparisonId = typeof comparison?.id === 'string' && comparison.id.length <= 64 ? comparison.id : id();
      insertComparison.run(comparisonId, chatId, GUEST_SHARE_USER, String(comparison?.prompt || '').slice(0, 8000), String(comparison?.createdAt || timestamp));
      for (const result of (Array.isArray(comparison?.results) ? comparison.results : []).slice(0, 8)) {
        insertResult.run(
          typeof result?.id === 'string' && result.id.length <= 64 ? result.id : id(), comparisonId, GUEST_SHARE_USER,
          result?.modelConfigId ? String(result.modelConfigId).slice(0, 120) : null,
          String(result?.modelName || 'Модель').slice(0, 120), String(result?.provider || 'demo').slice(0, 40), String(result?.modelId || '').slice(0, 120),
          numberOrNull(result?.inputPrice), numberOrNull(result?.outputPrice), result?.priceUnit || null, result?.currency || null,
          String(result?.response || '').slice(0, 100000), String(result?.status || 'done').slice(0, 20), result?.error ? String(result.error).slice(0, 500) : null,
          result?.firstTokenMs ?? null, result?.totalMs ?? null, result?.inputTokens ?? null, result?.outputTokens ?? null,
          result?.tokenEstimated ? 1 : 0, result?.cost ?? null, null, null, 0, null, timestamp,
        );
      }
    }
    db.prepare('UPDATE chats SET updated_at=?, title=? WHERE id=?').run(timestamp, title, chatId);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  res.status(201).json({ id: chatId });
});

function resolveModel(req: AuthedRequest, candidate: any): (StoredModel & { apiKey: string }) | null {
  const demo = config.demoModels.find((item) => item.id === candidate?.demoModelId);
  if (demo && config.demoApiKey) {
    return {
      id: demo.id, user_id: '', display_name: demo.displayName, provider: 'timeweb', model_id: demo.modelId, base_url: config.demoBaseUrl,
      encrypted_key: '', apiKey: config.demoApiKey, input_price: null, output_price: null, price_unit: 1_000_000, currency: 'USD',
    };
  }
  if (req.user && candidate.modelConfigId) {
    const model = row<StoredModel>('SELECT * FROM model_configs WHERE id=? AND user_id=?', candidate.modelConfigId, req.user.id);
    return model ? { ...model, apiKey: decrypt(model.encrypted_key, config.encryptionKey) } : null;
  }
  if (!candidate.apiKey || !candidate.displayName || !candidate.modelId || !['openai', 'anthropic', 'gemini', 'timeweb'].includes(candidate.provider)) return null;
  if (candidate.provider === 'timeweb') {
    try { timewebEndpoint(String(candidate.baseUrl || '')); } catch { return null; }
  }
  return {
    id: candidate.id || 'guest', user_id: '', display_name: candidate.displayName, provider: candidate.provider, model_id: candidate.modelId, base_url: candidate.provider === 'timeweb' ? candidate.baseUrl : null,
    encrypted_key: '', apiKey: candidate.apiKey, input_price: numberOrNull(candidate.inputPrice), output_price: numberOrNull(candidate.outputPrice),
    price_unit: Number(candidate.priceUnit || 1_000_000), currency: candidate.currency || 'USD',
  };
}

app.post('/api/models/test', async (req: AuthedRequest, res) => {
  const model = resolveModel(req, req.body);
  if (!model) return res.status(400).json({ error: 'Не удалось получить конфигурацию модели' });
  try {
    const result = await completeProvider({ provider: model.provider, modelId: model.model_id, apiKey: model.apiKey, baseUrl: model.base_url }, [{ role: 'user', content: 'Ответь одним словом: OK' }], AbortSignal.timeout(20_000));
    res.json({ ok: true, reply: result.text.slice(0, 100) });
  } catch (error) { res.status(400).json({ error: cleanError(error) }); }
});

app.post('/api/generate', async (req: AuthedRequest, res) => {
  const model = resolveModel(req, req.body.model);
  const messages = req.body.messages as Message[];
  if (!model || !Array.isArray(messages) || !messages.length) return res.status(400).json({ error: 'Некорректный запрос' });
  if (model.id.startsWith('demo:') && !demoRateOk(req.ip || 'unknown')) {
    return res.status(429).json({ error: 'Слишком много демо-запросов. Попробуйте позже или подключите свою модель.' });
  }
  res.setHeader('content-type', 'text/event-stream; charset=utf-8');
  res.setHeader('cache-control', 'no-cache, no-transform');
  res.setHeader('connection', 'keep-alive');
  res.flushHeaders();
  const started = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error('Тайм-аут провайдера')), config.requestTimeoutMs);
  req.on('aborted', () => controller.abort());
  let output = ''; let firstTokenMs: number | null = null; let inputTokens: number | undefined; let outputTokens: number | undefined;
  const send = (event: unknown) => res.write(`data: ${JSON.stringify(event)}\n\n`);
  try {
    send({ type: 'start', model: model.display_name });
    for await (const event of streamProvider({ provider: model.provider, modelId: model.model_id, apiKey: model.apiKey, baseUrl: model.base_url }, messages, controller.signal)) {
      if (event.type === 'text') {
        if (firstTokenMs == null) firstTokenMs = Math.round(performance.now() - started);
        output += event.text; send({ type: 'text', text: event.text, firstTokenMs });
      } else {
        inputTokens = event.inputTokens ?? inputTokens; outputTokens = event.outputTokens ?? outputTokens;
      }
    }
    let estimated = false;
    if (inputTokens == null || outputTokens == null) {
      estimated = true;
      inputTokens ??= estimateTokens(messages.map((m) => m.content).join('\n'));
      outputTokens ??= estimateTokens(output);
    }
    const totalMs = Math.round(performance.now() - started);
    send({ type: 'done', firstTokenMs, totalMs, inputTokens, outputTokens, estimated,
      cost: calculateCost(inputTokens, outputTokens, model.input_price, model.output_price, model.price_unit), currency: model.currency });
  } catch (error) {
    if (!res.writableEnded) send({ type: controller.signal.aborted ? 'cancelled' : 'error', error: cleanError(error), totalMs: Math.round(performance.now() - started) });
  } finally { clearTimeout(timeout); res.end(); }
});

app.post('/api/judge', async (req: AuthedRequest, res) => {
  if (!req.body.consent) return res.status(400).json({ error: 'Нужно подтвердить отправку данных провайдеру' });
  const model = resolveModel(req, req.body.model);
  if (!model || !Array.isArray(req.body.answers) || !req.body.question) return res.status(400).json({ error: 'Некорректный запрос' });
  const anonymous = req.body.answers.map((answer: string, index: number) => `ОТВЕТ ${index + 1}:\n${answer}`).join('\n\n');
  const prompt = `Ты независимый оценщик. Оцени каждый обезличенный ответ на вопрос по шкале 1-5 по критериям relevance, completeness, clarity, reasoning. Верни только JSON-массив объектов {"answer":1,"relevance":1,"completeness":1,"clarity":1,"reasoning":1,"explanation":"кратко"}.\n\nВОПРОС:\n${req.body.question}\n\n${anonymous}`;
  try {
    const result = await completeProvider({ provider: model.provider, modelId: model.model_id, apiKey: model.apiKey, baseUrl: model.base_url }, [{ role: 'user', content: prompt }], AbortSignal.timeout(config.requestTimeoutMs));
    const match = result.text.match(/\[[\s\S]*\]/);
    if (!match) throw new Error('Модель-оценщик вернула ответ не в формате JSON');
    res.json({ evaluator: model.display_name, evaluations: JSON.parse(match[0]), usage: { inputTokens: result.inputTokens, outputTokens: result.outputTokens } });
  } catch (error) { res.status(400).json({ error: cleanError(error) }); }
});

app.get('/api/chats', requireUser, (req: AuthedRequest, res) => {
  res.json(rows('SELECT id,title,created_at createdAt,updated_at updatedAt FROM chats WHERE user_id=? ORDER BY updated_at DESC', req.user!.id));
});

app.get('/api/chats/:id', requireUser, (req: AuthedRequest, res) => {
  const chat = row<any>('SELECT id,title,created_at createdAt,updated_at updatedAt FROM chats WHERE id=? AND user_id=?', req.params.id, req.user!.id);
  if (!chat) return res.status(404).json({ error: 'Чат не найден' });
  chat.comparisons = rows<any>('SELECT id,prompt,created_at createdAt FROM comparisons WHERE chat_id=? ORDER BY created_at', chat.id).map((comparison) => ({
    ...comparison,
    results: rows(`SELECT id,model_config_id modelConfigId,model_name modelName,provider,model_id modelId,input_price inputPrice,output_price outputPrice,price_unit priceUnit,currency,response,status,error,first_token_ms firstTokenMs,total_ms totalMs,input_tokens inputTokens,output_tokens outputTokens,token_estimated tokenEstimated,cost,liked,rating,is_winner isWinner,ai_evaluation aiEvaluation FROM results WHERE comparison_id=? ORDER BY created_at`, comparison.id),
  }));
  res.json(chat);
});

app.get('/api/shared/:id', (req, res) => {
  const chat = row<any>('SELECT id,title,created_at createdAt,updated_at updatedAt FROM chats WHERE id=?', req.params.id);
  if (!chat) return res.status(404).json({ error: 'Чат не найден' });
  chat.comparisons = rows<any>('SELECT id,prompt,created_at createdAt FROM comparisons WHERE chat_id=? ORDER BY created_at', chat.id).map((comparison) => ({
    ...comparison,
    results: rows(`SELECT id,model_config_id modelConfigId,model_name modelName,provider,model_id modelId,currency,response,status,error,first_token_ms firstTokenMs,total_ms totalMs,input_tokens inputTokens,output_tokens outputTokens,token_estimated tokenEstimated,cost FROM results WHERE comparison_id=? ORDER BY created_at`, comparison.id),
  }));
  res.json(chat);
});

app.post('/api/comparisons', requireUser, (req: AuthedRequest, res) => {
  const payload = req.body;
  let chatId = payload.chatId;
  if (!chatId) {
    chatId = id(); const timestamp = now();
    db.prepare('INSERT INTO chats (id,user_id,title,created_at,updated_at) VALUES (?,?,?,?,?)').run(chatId, req.user!.id, String(payload.prompt).slice(0, 60), timestamp, timestamp);
  } else if (!row('SELECT id FROM chats WHERE id=? AND user_id=?', chatId, req.user!.id)) return res.status(404).json({ error: 'Чат не найден' });
  const comparisonId = id(); const timestamp = now();
  db.exec('BEGIN');
  try {
    db.prepare('INSERT INTO comparisons (id,chat_id,user_id,prompt,created_at) VALUES (?,?,?,?,?)').run(comparisonId, chatId, req.user!.id, payload.prompt, timestamp);
    const insert = db.prepare(`INSERT INTO results (id,comparison_id,user_id,model_config_id,model_name,provider,model_id,input_price,output_price,price_unit,currency,response,status,error,first_token_ms,total_ms,input_tokens,output_tokens,token_estimated,cost,liked,rating,is_winner,ai_evaluation,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const result of payload.results || []) insert.run(result.id || id(), comparisonId, req.user!.id, result.modelConfigId || null, result.modelName, result.provider, result.modelId, numberOrNull(result.inputPrice), numberOrNull(result.outputPrice), result.priceUnit || null, result.currency || null, result.response || '', result.status, result.error || null, result.firstTokenMs ?? null, result.totalMs ?? null, result.inputTokens ?? null, result.outputTokens ?? null, result.tokenEstimated ? 1 : 0, result.cost ?? null, result.liked ?? null, result.rating ?? null, result.isWinner ? 1 : 0, result.aiEvaluation ? JSON.stringify(result.aiEvaluation) : null, timestamp);
    db.prepare('UPDATE chats SET updated_at=? WHERE id=?').run(timestamp, chatId);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  res.status(201).json({ chatId, comparisonId });
});

app.patch('/api/results/:id', requireUser, (req: AuthedRequest, res) => {
  const resultId = String(req.params.id);
  const found = row<{ id: string; comparison_id: string }>('SELECT id,comparison_id FROM results WHERE id=? AND user_id=?', resultId, req.user!.id);
  if (!found) return res.status(404).json({ error: 'Результат не найден' });
  if (req.body.isWinner === true) db.prepare('UPDATE results SET is_winner=0 WHERE comparison_id=? AND user_id=?').run(found.comparison_id, req.user!.id);
  const liked = req.body.liked === undefined ? null : req.body.liked ? 1 : 0;
  const rating = req.body.rating == null ? null : Math.max(1, Math.min(5, Number(req.body.rating)));
  db.prepare('UPDATE results SET liked=COALESCE(?,liked),rating=COALESCE(?,rating),is_winner=COALESCE(?,is_winner),ai_evaluation=COALESCE(?,ai_evaluation) WHERE id=?')
    .run(liked as any, rating as any, (req.body.isWinner == null ? null : req.body.isWinner ? 1 : 0) as any, (req.body.aiEvaluation ? JSON.stringify(req.body.aiEvaluation) : null) as any, resultId);
  res.json({ ok: true });
});

app.get('/api/analytics', requireUser, (req: AuthedRequest, res) => {
  const params: any[] = [req.user!.id];
  let where = 'r.user_id=?';
  if (req.query.from) { where += ' AND r.created_at>=?'; params.push(String(req.query.from)); }
  if (req.query.to) { where += ' AND r.created_at<=?'; params.push(String(req.query.to)); }
  if (req.query.model) { where += ' AND r.model_name=?'; params.push(String(req.query.model)); }
  if (req.query.chat) { where += ' AND c.chat_id=?'; params.push(String(req.query.chat)); }
  res.json(rows(`SELECT r.*,c.prompt,c.chat_id chatId FROM results r JOIN comparisons c ON c.id=r.comparison_id WHERE ${where} ORDER BY r.created_at DESC`, ...params));
});

app.get('/api/admin/overview', requireAdmin, (_req: AuthedRequest, res) => {
  const count = (table: string) => row<{ count: number }>(`SELECT COUNT(*) count FROM ${table}`)!.count;
  const evaluated = row<{ count: number }>('SELECT COUNT(*) count FROM results WHERE liked IS NOT NULL OR rating IS NOT NULL OR ai_evaluation IS NOT NULL')!.count;
  const providers = rows<{ provider: string; configurations: number; users: number }>(`
    SELECT provider, COUNT(*) configurations, COUNT(DISTINCT user_id) users
    FROM model_configs GROUP BY provider ORDER BY configurations DESC
  `);
  const recentUsers = rows(`
    SELECT u.id,u.name,u.email,u.is_admin isAdmin,u.created_at createdAt,
      (SELECT COUNT(*) FROM model_configs m WHERE m.user_id=u.id) modelCount,
      (SELECT COUNT(*) FROM chats c WHERE c.user_id=u.id) chatCount,
      (SELECT COUNT(*) FROM results r WHERE r.user_id=u.id) resultCount
    FROM users u ORDER BY u.created_at DESC LIMIT 50
  `);
  const recentRuns = rows(`
    SELECT c.id,c.prompt,c.created_at createdAt,u.email,
      COUNT(r.id) resultCount,
      SUM(CASE WHEN r.status='done' THEN 1 ELSE 0 END) completedCount
    FROM comparisons c JOIN users u ON u.id=c.user_id
    LEFT JOIN results r ON r.comparison_id=c.id
    GROUP BY c.id ORDER BY c.created_at DESC LIMIT 20
  `);
  res.json({
    generatedAt: now(),
    totals: { users: count('users'), chats: count('chats'), comparisons: count('comparisons'), results: count('results'), modelConfigurations: count('model_configs'), evaluated },
    providers,
    recentUsers,
    recentRuns,
  });
});

function cleanError(error: unknown) {
  if (error instanceof Error) return error.name === 'AbortError' || error.message.includes('timeout') ? 'Превышено время ожидания ответа' : error.message
    .replace(/(?:sk|api|key)[-_][A-Za-z0-9_-]+/gi, '••••')
    .replace(/AIza[A-Za-z0-9_-]+/g, '••••')
    .replace(/[A-Za-z0-9_-]{24,}/g, '••••');
  return 'Неизвестная ошибка провайдера';
}

app.use('/api', (_req, res) => res.status(404).json({ error: 'Маршрут не найден' }));

const clientDir = path.join(config.root, 'dist/client');
if (fs.existsSync(clientDir)) {
  app.use(express.static(clientDir));
  app.get('/{*splat}', (_req, res) => res.sendFile(path.join(clientDir, 'index.html')));
}

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  res.status(400).json({ error: cleanError(error) });
});

if (process.env.NODE_ENV !== 'test') app.listen(config.port, () => console.log(`LLM Compare API: http://localhost:${config.port}`));
export { app };
