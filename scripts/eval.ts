// Метрики на вручную написанной тестовой выборке (не пересекается с обучающими шаблонами).
// Сравнение с базовым подходом «поиск по ключевым словам».

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { scoreMessage, loadMessageModel } from '../src/message-model.ts';
import { normalize } from '../src/normalize.ts';

interface Row {
  text: string;
  label: 0 | 1;
  kind: string;
  lang: string;
}

// dev — выборка для разбора ошибок, test — финальная, на ней правила не подгоняются.
const set = process.argv[2] ?? 'test';
const rows = readFileSync(`data/${set}/messages.jsonl`, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as Row);
const model = loadMessageModel();

// Базовый подход: сообщение помечено, если встречается любое «подозрительное» слово.
const KEYWORDS = /влож|инвест|доход|прибыл|каспи|kaspi|выплат|процент|%|пирамид|получи|заработ|салым|табыс|пайда|бонус/iu;

interface Counts { tp: number; fp: number; fn: number; tn: number }
const empty = (): Counts => ({ tp: 0, fp: 0, fn: 0, tn: 0 });
function add(c: Counts, flagged: boolean, label: 0 | 1) {
  if (flagged && label === 1) c.tp++;
  else if (flagged) c.fp++;
  else if (label === 1) c.fn++;
  else c.tn++;
}
function summary(c: Counts) {
  const precision = c.tp / Math.max(1, c.tp + c.fp);
  const recall = c.tp / Math.max(1, c.tp + c.fn);
  const fpr = c.fp / Math.max(1, c.fp + c.tn);
  const f1 = (2 * precision * recall) / Math.max(1e-9, precision + recall);
  return { ...c, precision: round(precision), recall: round(recall), f1: round(f1), fpr: round(fpr) };
}
const round = (x: number) => Math.round(x * 1000) / 1000;

const ours = empty();
const baseline = empty();
const byLang: Record<string, Counts> = {};
const levels: Record<string, Record<string, number>> = { '1': { high: 0, medium: 0, low: 0 }, '0': { high: 0, medium: 0, low: 0 } };
const errors: { text: string; label: number; probability: number; level: string; kind: string }[] = [];

for (const row of rows) {
  const result = scoreMessage(row.text, model);
  const flagged = result.score.level !== 'low';
  add(ours, flagged, row.label);
  add((byLang[row.lang] ??= empty()), flagged, row.label);
  add(baseline, KEYWORDS.test(normalize(row.text).canon) || KEYWORDS.test(row.text), row.label);
  levels[String(row.label)][result.score.level]++;
  if (flagged !== (row.label === 1)) errors.push({ text: row.text, label: row.label, probability: round(result.score.probability), level: result.score.level, kind: row.kind });
}

const report = {
  dataset: { total: rows.length, positives: rows.filter((r) => r.label === 1).length, negatives: rows.filter((r) => r.label === 0).length },
  thresholds: model.thresholds,
  ours: summary(ours),
  baseline: summary(baseline),
  byLang: Object.fromEntries(Object.entries(byLang).map(([lang, c]) => [lang, summary(c)])),
  levels,
  errors,
};

mkdirSync('reports', { recursive: true });
writeFileSync(`reports/message-metrics-${set}.json`, JSON.stringify(report, null, 2));
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
console.log(`Тест: ${report.dataset.total} сообщений (${report.dataset.positives} со схемами, ${report.dataset.negatives} обычных)`);
console.log(`Наша модель:      precision ${pct(report.ours.precision)}  recall ${pct(report.ours.recall)}  F1 ${pct(report.ours.f1)}  ложные срабатывания ${pct(report.ours.fpr)}`);
console.log(`Ключевые слова:   precision ${pct(report.baseline.precision)}  recall ${pct(report.baseline.recall)}  F1 ${pct(report.baseline.f1)}  ложные срабатывания ${pct(report.baseline.fpr)}`);
for (const [lang, s] of Object.entries(report.byLang)) console.log(`  ${lang.padEnd(9)} precision ${pct(s.precision)} recall ${pct(s.recall)} FPR ${pct(s.fpr)} (n=${s.tp + s.fp + s.fn + s.tn})`);
console.log('Уровни риска (схемы):', levels['1'], ' (обычные):', levels['0']);
console.log(`\nОшибки (${errors.length}):`);
for (const e of errors) console.log(`  ${e.label ? 'ПРОПУСК' : 'ЛОЖНОЕ '} p=${e.probability} ${e.level.padEnd(6)} [${e.kind}] ${e.text}`);
