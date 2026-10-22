// Обучение модели группы на синтетических чатах (Telegram JSON) поверх модели сообщений.

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { parseTelegram } from '../src/parse.ts';
import { analyzeChat, CHAT_FEATURE_TITLES } from '../src/chat.ts';
import { score, train, type Model } from '../src/model.ts';

const dir = 'data/train/chats';
const labels = JSON.parse(readFileSync(`${dir}/labels.json`, 'utf8')) as Record<string, { label: 0 | 1 }>;
const files = readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'labels.json').sort();

const examples = files.map((file) => {
  const chat = parseTelegram(JSON.parse(readFileSync(`${dir}/${file}`, 'utf8')));
  return { file, features: analyzeChat(chat).features, label: labels[file].label };
});

// Каждый пятый чат — для подбора порогов.
const validation = examples.filter((_, i) => i % 5 === 0);
const fit = examples.filter((_, i) => i % 5 !== 0);
const featureNames = Object.keys(CHAT_FEATURE_TITLES);
// Доля предупреждений и легальных финпродуктов может только снижать риск группы, остальное — только повышать.
const signs = Object.fromEntries(featureNames.map((f) => [f, f === 'warning_share' || f === 'licensed_share' ? -1 : 1] as const));
const { bias, weights } = train(fit, featureNames, { epochs: 3000, rate: 0.5, l2: 0.02, signs });
const model: Model = { bias, weights, thresholds: { medium: 0.5, high: 0.75 } };

const wrong = validation.filter((e) => (score(model, e.features).probability >= model.thresholds.medium ? 1 : 0) !== e.label);
writeFileSync('model/chat-model.json', JSON.stringify(model, null, 2));
console.log(`чатов: обучение ${fit.length}, подбор ${validation.length}, ошибок на подборе: ${wrong.length}`);
for (const [name, w] of Object.entries(weights).sort((a, b) => b[1] - a[1])) console.log(`  ${w.toFixed(2).padStart(6)}  ${CHAT_FEATURE_TITLES[name]}`);
