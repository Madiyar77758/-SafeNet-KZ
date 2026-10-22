// SafeNet KZ: API и дашборд аналитика.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { extname, join } from 'node:path';
import { parseAny, type ParsedChat } from './parse.ts';
import { analyzeChat, loadChatModel, CHAT_FEATURE_TITLES, ROLE_TITLES, type ChatAnalysis } from './chat.ts';
import { loadMessageModel, scoreMessage } from './message-model.ts';
import { buildGraph } from './graph.ts';
import { FEATURE_TITLES, score, messageFeatures } from './model.ts';
import { highlights } from './highlight.ts';
import { recognize, screenshotSignals } from './ocr.ts';

const PORT = Number(process.env.PORT ?? 3600);
const HOST = process.env.HOST ?? '127.0.0.1';
const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const PUBLIC = join(ROOT, 'public');
const FEEDBACK_FILE = join(ROOT, 'data', 'feedback.json');

type Verdict = 'confirmed' | 'false_positive';

interface Case {
  id: string;
  title: string;
  source: ParsedChat['source'] | 'image';
  createdAt: string;
  synthetic: boolean;
  analysis: ChatAnalysis;
  ocrText?: string;
}

const messageModel = loadMessageModel();
const chatModel = loadChatModel();
const cases = new Map<string, Case>();
const feedback: Record<string, { verdict: Verdict; at: string }> = existsSync(FEEDBACK_FILE) ? JSON.parse(readFileSync(FEEDBACK_FILE, 'utf8')) : {};

function addCase(id: string, chat: ParsedChat, source: Case['source'], synthetic: boolean, ocrText?: string): Case {
  const analysis = analyzeChat(chat, messageModel, chatModel);
  const item: Case = { id, title: chat.title, source, createdAt: new Date().toISOString(), synthetic, analysis, ocrText };
  cases.set(id, item);
  return item;
}

// Демо-группы (синтетические) загружаются при старте.
const demoDir = join(ROOT, 'data', 'demo');
const demoTitles: Record<string, string> = existsSync(join(demoDir, 'index.json')) ? JSON.parse(readFileSync(join(demoDir, 'index.json'), 'utf8')) : {};
for (const file of readdirSync(demoDir).filter((f) => f !== 'index.json')) {
  const chat = parseAny(readFileSync(join(demoDir, file), 'utf8'), file);
  chat.title = demoTitles[file] ?? chat.title;
  addCase(file.replace(/\.\w+$/, ''), chat, chat.source, true);
}

// Какие признаки показывать в карточке первыми: самые говорящие о пирамиде.
const PRIORITY = ['return', 'gift_circle', 'percent', 'multiplier', 'referral', 'levels', 'personal_transfer', 'testimonial', 'scarcity', 'denial', 'guarantee', 'income_claim', 'urgency', 'easy', 'complaint', 'invest_call', 'kaspi', 'emoji'];

function caseSummary(c: Case) {
  const a = c.analysis;
  const reasons = new Map<string, number>();
  for (const m of a.messages) {
    if (m.level === 'low') continue;
    for (const s of m.signals) {
      if (s.category === 'dampener') continue;
      const rank = PRIORITY.indexOf(s.id);
      reasons.set(s.title, Math.min(reasons.get(s.title) ?? 99, rank < 0 ? 98 : rank));
    }
  }
  return {
    id: c.id,
    title: c.title,
    source: c.source,
    synthetic: c.synthetic,
    createdAt: c.createdAt,
    level: a.score.level,
    probability: a.score.probability,
    summary: a.summary,
    messages: a.messages.length,
    flagged: a.messages.filter((m) => m.level !== 'low').length,
    participants: a.participants.length,
    reasons: [...reasons.entries()].sort((x, y) => x[1] - y[1]).slice(0, 3).map(([title]) => title),
    feedback: feedback[c.id]?.verdict ?? null,
  };
}

const LEVEL_ORDER = { high: 0, medium: 1, low: 2 } as const;

const HISTORY = [
  { file: 'history-blind-v1-messages.json', title: 'Тест №1: написан вручную', note: 'ошибки разобраны, набор стал настроечным' },
  { file: 'history-blind-v2-messages.json', title: 'Тест №2: независимый исполнитель', note: 'ошибки разобраны, набор стал настроечным' },
  { file: 'history-blind-v3-messages.json', title: 'Тест №3: независимый исполнитель', note: 'ошибки разобраны, набор стал настроечным' },
  { file: 'history-real-v1.json', title: 'Реальные тексты из СМИ и сообщений АФМ', note: '61 текст; ошибки разобраны' },
];

const pick = (o: { precision: number; recall: number; f1: number; fpr: number }) => ({ precision: o.precision, recall: o.recall, f1: o.f1, fpr: o.fpr });

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;

  if (req.method === 'GET' && path === '/api/cases') {
    const list = [...cases.values()].map(caseSummary).sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level] || b.probability - a.probability);
    return json(res, 200, list);
  }
  const caseMatch = /^\/api\/cases\/([^/]+)$/.exec(path);
  if (req.method === 'GET' && caseMatch) {
    const c = cases.get(decodeURIComponent(caseMatch[1]));
    if (!c) return json(res, 404, { error: 'Не найдено' });
    return json(res, 200, { ...caseSummary(c), analysis: c.analysis, ocrText: c.ocrText ?? null, roleTitles: ROLE_TITLES, thresholds: chatModel.thresholds });
  }
  const feedbackMatch = /^\/api\/cases\/([^/]+)\/feedback$/.exec(path);
  if (req.method === 'POST' && feedbackMatch) {
    const id = decodeURIComponent(feedbackMatch[1]);
    const body = JSON.parse((await readBody(req)).toString('utf8') || '{}') as { verdict?: Verdict | null };
    if (body.verdict === null) delete feedback[id];
    else if (body.verdict === 'confirmed' || body.verdict === 'false_positive') feedback[id] = { verdict: body.verdict, at: new Date().toISOString() };
    else return json(res, 400, { error: 'verdict: confirmed | false_positive' });
    writeFileSync(FEEDBACK_FILE, JSON.stringify(feedback, null, 2));
    return json(res, 200, { ok: true });
  }
  if (req.method === 'POST' && path === '/api/analyze-text') {
    const { text } = JSON.parse((await readBody(req)).toString('utf8') || '{}') as { text?: string };
    if (!text?.trim()) return json(res, 400, { error: 'Пустой текст' });
    const parsed = parseAny(text, 'Вставленный текст');
    if (parsed.messages.length > 1) {
      const c = addCase(randomUUID(), { ...parsed, title: `Вставленный чат (${parsed.messages.length} сообщ.)` }, parsed.source, false);
      return json(res, 200, { caseId: c.id });
    }
    const result = scoreMessage(text, messageModel);
    return json(res, 200, {
      level: result.score.level,
      probability: result.score.probability,
      signals: result.signals,
      contributions: result.score.contributions,
      canon: result.norm.canon,
      highlights: highlights(text, result.signals),
      thresholds: messageModel.thresholds,
    });
  }
  if (req.method === 'POST' && path === '/api/upload') {
    const filename = decodeURIComponent(String(req.headers['x-filename'] ?? 'файл'));
    const body = await readBody(req);
    if (/\.(png|jpe?g|webp|bmp)$/i.test(filename)) {
      const text = await recognize(body);
      const chat: ParsedChat = { title: `Скриншот: ${filename}`, source: 'text', messages: [{ id: '1', author: 'Скриншот', authorId: 'image', date: null, text, media: filename }] };
      const c = addCase(randomUUID(), chat, 'image', false, text);
      // Скриншот квитанции — сам по себе «прогрев»: добавляем признак и пересчитываем риск сообщения.
      const extra = screenshotSignals(text);
      if (extra.length) {
        const m = c.analysis.messages[0];
        m.signals = [...m.signals, ...extra];
        const s = score(messageModel, messageFeatures(m.signals));
        Object.assign(m, { probability: s.probability, level: s.level, contributions: s.contributions, highlights: highlights(text, m.signals) });
        c.analysis = { ...c.analysis, score: { ...s }, summary: s.level === 'low' ? c.analysis.summary : `Обнаружены признаки «прогрева»: ${extra[0].title.toLowerCase()}, ${m.signals.filter((x) => x.category !== 'dampener' && x.id !== 'testimonial').map((x) => x.title.toLowerCase()).slice(0, 3).join(', ')}. Требуется проверка специалистом.` };
      }
      return json(res, 200, { caseId: c.id });
    }
    const chat = parseAny(body.toString('utf8'), filename);
    const c = addCase(randomUUID(), chat, chat.source, false);
    return json(res, 200, { caseId: c.id });
  }
  if (req.method === 'GET' && path === '/api/graph') {
    return json(res, 200, buildGraph([...cases.values()].map((c) => ({ id: c.id, analysis: c.analysis }))));
  }
  if (req.method === 'GET' && path === '/api/metrics') {
    const read = (name: string) => (existsSync(join(ROOT, 'reports', name)) ? JSON.parse(readFileSync(join(ROOT, 'reports', name), 'utf8')) : null);
    // История: каждый виденный набор после разбора ошибок становился настроечным, финальные цифры — на новом слепом.
    const history = HISTORY.map((h) => ({ ...h, report: read(h.file) }))
      .filter((h) => h.report)
      .map(({ title, note, report }) => ({ title, note, total: report.dataset.total, ...pick(report.ours) }));
    return json(res, 200, {
      messageTest: read('message-metrics-test.json'),
      messageDev: read('message-metrics-dev.json'),
      chatTest: read('chat-metrics-test.json'),
      freeze: read('freeze.json'),
      history,
    });
  }
  if (req.method === 'GET' && path === '/api/methodology') {
    const weights = (w: Record<string, number>, titles: Record<string, string>) =>
      Object.entries(w).map(([feature, weight]) => ({ feature, title: titles[feature] ?? feature, weight })).sort((a, b) => b.weight - a.weight);
    return json(res, 200, {
      message: { bias: messageModel.bias, thresholds: messageModel.thresholds, weights: weights(messageModel.weights, FEATURE_TITLES) },
      chat: { bias: chatModel.bias, thresholds: chatModel.thresholds, weights: weights(chatModel.weights, CHAT_FEATURE_TITLES) },
    });
  }
  if (req.method === 'GET' && !path.startsWith('/api/')) return serveStatic(path, res);
  json(res, 404, { error: 'Не найдено' });
}

const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };

async function serveStatic(path: string, res: ServerResponse) {
  const file = join(PUBLIC, path === '/' ? 'index.html' : path.replace(/\.\.+/g, ''));
  try {
    const content = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(content);
  } catch {
    json(res, 404, { error: 'Не найдено' });
  }
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 25 * 1024 * 1024) {
        reject(new Error('Файл больше 25 МБ'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function json(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

createServer((req, res) => {
  route(req, res).catch((error) => {
    console.error(error);
    if (!res.headersSent) json(res, 500, { error: String(error instanceof Error ? error.message : error) });
  });
}).listen(PORT, HOST, () => {
  console.log(`SafeNet KZ: http://${HOST}:${PORT}  (групп в очереди: ${cases.size})`);
});
