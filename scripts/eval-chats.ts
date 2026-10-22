// Метрики на уровне групп: экспорты WhatsApp (.txt) и Telegram (.json) с разметкой в labels.json.
// Группа помечена, если её риск не ниже «среднего». Сравнение с поиском по ключевым словам.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseAny } from '../src/parse.ts';
import { analyzeChat, loadChatModel } from '../src/chat.ts';
import { loadMessageModel } from '../src/message-model.ts';
import { normalize } from '../src/normalize.ts';

interface Label {
  label: 0 | 1;
  kind?: string;
  lang?: string;
  format?: string;
}

const set = process.argv[2] ?? 'test';
const dir = `data/${set}/chats`;
const labels = JSON.parse(readFileSync(`${dir}/labels.json`, 'utf8')) as Record<string, Label>;
const messageModel = loadMessageModel();
const chatModel = loadChatModel();

// Базовый подход: группа помечена, если хотя бы одно сообщение содержит «подозрительное» слово.
const KEYWORDS = /влож|инвест|доход|прибыл|каспи|kaspi|выплат|процент|%|пирамид|получи|заработ|салым|табыс|пайда|бонус/iu;

interface Counts { tp: number; fp: number; fn: number; tn: number }
const empty = (): Counts => ({ tp: 0, fp: 0, fn: 0, tn: 0 });
function add(c: Counts, flagged: boolean, label: 0 | 1) {
  if (flagged && label === 1) c.tp++;
  else if (flagged) c.fp++;
  else if (label === 1) c.fn++;
  else c.tn++;
}
const round = (x: number) => Math.round(x * 1000) / 1000;
function summary(c: Counts) {
  const precision = c.tp / Math.max(1, c.tp + c.fp);
  const recall = c.tp / Math.max(1, c.tp + c.fn);
  const fpr = c.fp / Math.max(1, c.fp + c.tn);
  const f1 = (2 * precision * recall) / Math.max(1e-9, precision + recall);
  return { ...c, precision: round(precision), recall: round(recall), f1: round(f1), fpr: round(fpr) };
}

const ours = empty();
const baseline = empty();
const byLang: Record<string, Counts> = {};
const byFormat: Record<string, Counts> = {};
const chats = [];

for (const [file, meta] of Object.entries(labels)) {
  const chat = parseAny(readFileSync(`${dir}/${file}`, 'utf8'), file);
  const analysis = analyzeChat(chat, messageModel, chatModel);
  const flagged = analysis.score.level !== 'low';
  const keyword = chat.messages.some((m) => KEYWORDS.test(m.text) || KEYWORDS.test(normalize(m.text).canon));
  add(ours, flagged, meta.label);
  add(baseline, keyword, meta.label);
  add((byLang[meta.lang ?? '—'] ??= empty()), flagged, meta.label);
  add((byFormat[meta.format ?? chat.source] ??= empty()), flagged, meta.label);
  chats.push({
    file,
    label: meta.label,
    kind: meta.kind ?? null,
    lang: meta.lang ?? null,
    format: meta.format ?? chat.source,
    messages: chat.messages.length,
    flaggedMessages: analysis.messages.filter((m) => m.level !== 'low').length,
    probability: round(analysis.score.probability),
    level: analysis.score.level,
    summary: analysis.summary,
    correct: flagged === (meta.label === 1),
  });
}

const report = {
  set,
  total: chats.length,
  positives: chats.filter((c) => c.label === 1).length,
  negatives: chats.filter((c) => c.label === 0).length,
  thresholds: chatModel.thresholds,
  ...summary(ours),
  baseline: summary(baseline),
  byLang: Object.fromEntries(Object.entries(byLang).map(([k, c]) => [k, summary(c)])),
  byFormat: Object.fromEntries(Object.entries(byFormat).map(([k, c]) => [k, summary(c)])),
  chats,
};

mkdirSync('reports', { recursive: true });
writeFileSync(`reports/chat-metrics-${set}.json`, JSON.stringify(report, null, 2));
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
console.log(`Группы (${set}): ${report.total} (${report.positives} с пирамидой, ${report.negatives} обычных)`);
console.log(`Наша модель:    precision ${pct(report.precision)}  recall ${pct(report.recall)}  F1 ${pct(report.f1)}  ложные срабатывания ${pct(report.fpr)}`);
console.log(`Ключевые слова: precision ${pct(report.baseline.precision)}  recall ${pct(report.baseline.recall)}  F1 ${pct(report.baseline.f1)}  ложные срабатывания ${pct(report.baseline.fpr)}`);
for (const c of chats) console.log(`  ${c.correct ? '  ' : '✗ '}${String(c.label)} ${c.level.padEnd(6)} ${pct(c.probability).padStart(6)}  ${c.file} [${c.kind ?? ''}, ${c.lang ?? ''}, ${c.format}] помечено сообщений ${c.flaggedMessages}/${c.messages}`);
