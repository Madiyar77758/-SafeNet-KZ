// Обучение модели сообщений на синтетической обучающей выборке.
// 80% — обучение весов, 20% — подбор порогов (средний риск — лучший F1, высокий — точность ≥ 97%).

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { analyzeMessage, type Signal } from '../src/signals.ts';
import { messageFeatures, score, train, DAMPENERS, FEATURE_TITLES, type Model } from '../src/model.ts';

interface Row {
  text: string;
  label: 0 | 1;
}

const rows = readFileSync('data/train/messages.jsonl', 'utf8').trim().split('\n').map((line) => JSON.parse(line) as Row);
const analyzed = rows.map((row) => ({ signals: analyzeMessage(row.text).signals, label: row.label }));

// Детерминированное перемешивание
let seed = 7;
const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const shuffled = analyzed.map((e) => ({ e, k: random() })).sort((a, b) => a.k - b.k).map((x) => x.e);
const cut = Math.floor(shuffled.length * 0.8);

// Устойчивость к неполному распознаванию: на незнакомой формулировке срабатывают 1–2 признака из многих.
// К каждому примеру со схемой добавляем копии, где часть признаков «не нашлась», но хотя бы один основной остался.
// «Призыв вложить» в основные не входит: «вход 2000 на концерт» сам по себе не схема.
const CORE = new Set(['return', 'percent', 'multiplier', 'income_claim', 'gift_circle', 'referral', 'levels', 'testimonial', 'denial', 'guarantee']);
function dropout(signals: Signal[]): Signal[] {
  const kept = signals.filter((s) => s.category === 'dampener' || random() < 0.5);
  const core = signals.filter((s) => CORE.has(s.id));
  if (core.length && !kept.some((s) => CORE.has(s.id))) kept.push(core[Math.floor(random() * core.length)]);
  return kept;
}
const fit = shuffled.slice(0, cut).flatMap((r) => {
  const copies = r.label === 1 ? [r.signals, dropout(r.signals), dropout(r.signals)] : [r.signals];
  return copies.map((signals) => ({ features: messageFeatures(signals), label: r.label }));
});
const validation = shuffled.slice(cut).map((r) => ({ features: messageFeatures(r.signals), label: r.label }));

const featureNames = Object.keys(FEATURE_TITLES);
// Жалоба на невыплату — сообщение пострадавшего, а не зазывание: её знак модель выбирает сама.
const signs = Object.fromEntries(featureNames.filter((f) => f !== 'complaint').map((f) => [f, DAMPENERS.has(f) ? -1 : 1] as const));
const { bias, weights } = train(fit, featureNames, { signs });
const model: Model = { bias, weights, thresholds: { medium: 0.5, high: 0.8 } };

// Пороги подбираются на рукописных настроечных выборках (data/dev*): они ближе к живым чатам, чем сгенерированные.
// Слепая тестовая выборка (data/test) в подборе не участвует.
const devRows = readdirSync('data')
  .filter((dir) => dir.startsWith('dev') && existsSync(`data/${dir}/messages.jsonl`))
  .flatMap((dir) => readFileSync(`data/${dir}/messages.jsonl`, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as Row));
const tuning = devRows.length ? devRows.map((row) => ({ features: messageFeatures(analyzeMessage(row.text).signals), label: row.label })) : validation;

function metricsAt(threshold: number) {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (const e of tuning) {
    const flagged = score(model, e.features).probability >= threshold;
    if (flagged && e.label === 1) tp++;
    else if (flagged) fp++;
    else if (e.label === 1) fn++;
    else tn++;
  }
  const precision = tp / Math.max(1, tp + fp);
  const recall = tp / Math.max(1, tp + fn);
  return { precision, recall, f1: (2 * precision * recall) / Math.max(1e-9, precision + recall) };
}

// Средний риск — лучший F1 при точности не ниже 95% (ложное срабатывание дороже пропуска одного сообщения:
// группу целиком всё равно поднимут соседние сообщения). Высокий — точность не ниже 98%.
let bestMedium = 0.5;
let bestF1 = -1;
for (const minPrecision of [0.95, 0]) {
  for (let t = 0.2; t <= 0.8; t += 0.01) {
    const { f1, precision } = metricsAt(t);
    if (precision >= minPrecision && f1 > bestF1 + 1e-9) {
      bestF1 = f1;
      bestMedium = t;
    }
  }
  if (bestF1 >= 0) break;
}
let high = 0.8;
for (let t = Math.max(bestMedium, 0.5); t <= 0.99; t += 0.01) {
  if (metricsAt(t).precision >= 0.98) {
    high = t;
    break;
  }
}
model.thresholds = { medium: Math.round(bestMedium * 100) / 100, high: Math.round(Math.max(high, bestMedium + 0.08) * 100) / 100 };

mkdirSync('model', { recursive: true });
writeFileSync('model/message-model.json', JSON.stringify(model, null, 2));
console.log(`обучено на ${fit.length}, пороги подобраны на ${tuning.length} (${devRows.length ? 'рукописные data/dev*' : 'сгенерированные'}):`, model.thresholds, `F1 на подборе ${bestF1.toFixed(3)}`);
const top = Object.entries(weights).sort((a, b) => b[1] - a[1]);
console.log('веса (сверху — сильнее всего повышают риск):');
for (const [name, w] of top) console.log(`  ${w.toFixed(2).padStart(6)}  ${FEATURE_TITLES[name] ?? name}`);
