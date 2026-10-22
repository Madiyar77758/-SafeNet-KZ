// Оценка риска: логистическая регрессия над признаками и их сочетаниями.
// Веса обучаются на размеченном датасете и видны целиком — каждый вклад в риск объясним:
// вклад признака = вес × сила признака.

import type { Signal } from './signals.ts';

export type RiskLevel = 'high' | 'medium' | 'low';

export interface Model {
  bias: number;
  weights: Record<string, number>;
  thresholds: { medium: number; high: number };
}

export interface Contribution {
  feature: string;
  title: string;
  value: number;
  contribution: number;
}

export interface Score {
  probability: number;
  level: RiskLevel;
  contributions: Contribution[];
}

export const FEATURE_TITLES: Record<string, string> = {
  return: 'Нереалистичная доходность',
  percent: 'Высокий процент за короткий срок',
  multiplier: 'Обещание умножить деньги',
  guarantee: 'Гарантия дохода без риска',
  easy: 'Лёгкий пассивный доход',
  denial: 'Уверения «это не пирамида»',
  invest_call: 'Призыв вложить деньги',
  scarcity: 'Искусственный дефицит',
  urgency: 'Давление срочностью',
  referral: 'Доход за приглашённых',
  levels: 'Многоуровневая структура',
  personal_transfer: 'Перевод на личную карту / номер',
  kaspi: 'Упоминание Kaspi',
  testimonial: 'Отзыв о выплате («прогрев»)',
  complaint: 'Жалоба на невыплату',
  emoji: 'Эмодзи денег и ажиотажа',
  warning: 'Предупреждение о мошенничестве',
  licensed: 'Признаки легального финпродукта',
  income_claim: 'Заявления о доходе в день',
  gift_circle: 'Схема «круг / ячейка» с дарением',
  doubt: 'Пересказ или сомнение',
  free_reward: 'Награда не деньгами',
  legit_payout: 'Законные выплаты',
  question: 'Сообщение — вопрос',
  reported: 'Обещание в цитате или пересказе',
  promise_any: 'Есть обещание дохода',
  pressure_any: 'Есть давление',
  referral_any: 'Есть вербовка',
  payment_any: 'Есть перевод денег',
  promise_x_payment: 'Сочетание: доходность + перевод на карту',
  promise_x_referral: 'Сочетание: доходность + вербовка',
  promise_x_pressure: 'Сочетание: доходность + давление',
  referral_x_payment: 'Сочетание: вербовка + перевод на карту',
};

export const SIGNAL_FEATURES = [
  'return', 'percent', 'multiplier', 'guarantee', 'easy', 'denial', 'invest_call', 'scarcity', 'urgency',
  'referral', 'levels', 'personal_transfer', 'kaspi', 'testimonial', 'complaint', 'emoji', 'warning', 'licensed',
  'income_claim', 'gift_circle', 'doubt', 'free_reward', 'legit_payout', 'question', 'reported',
] as const;

export function messageFeatures(signals: Signal[]): Record<string, number> {
  const f: Record<string, number> = {};
  for (const name of SIGNAL_FEATURES) f[name] = 0;
  for (const s of signals) f[s.id] = Math.max(f[s.id] ?? 0, s.strength);
  // Обобщённые признаки: модель учится на «есть обещание дохода», а не на конкретной формулировке.
  const promise = Math.max(f.return, f.percent, f.multiplier, f.income_claim, f.gift_circle);
  const payment = Math.max(f.personal_transfer, f.kaspi * 0.6);
  const referral = Math.max(f.referral, f.levels, f.gift_circle);
  const pressure = Math.max(f.scarcity, f.urgency);
  f.promise_any = promise;
  f.pressure_any = pressure;
  f.referral_any = referral;
  f.payment_any = payment;
  f.promise_x_payment = promise * payment;
  f.promise_x_referral = promise * referral;
  f.promise_x_pressure = promise * pressure;
  f.referral_x_payment = referral * f.personal_transfer;
  return f;
}

export function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

export function levelOf(probability: number, model: Model): RiskLevel {
  if (probability >= model.thresholds.high) return 'high';
  if (probability >= model.thresholds.medium) return 'medium';
  return 'low';
}

export function score(model: Model, features: Record<string, number>, titles: Record<string, string> = FEATURE_TITLES): Score {
  let z = model.bias;
  const contributions: Contribution[] = [];
  for (const [feature, value] of Object.entries(features)) {
    if (!value) continue;
    const weight = model.weights[feature] ?? 0;
    const contribution = weight * value;
    z += contribution;
    if (Math.abs(contribution) > 0.01) contributions.push({ feature, title: titles[feature] ?? feature, value, contribution });
  }
  contributions.sort((a, b) => b.contribution - a.contribution);
  const probability = sigmoid(z);
  return { probability, level: levelOf(probability, model), contributions };
}

export interface Example {
  features: Record<string, number>;
  label: 0 | 1;
}

/** Снимающие признаки: могут только понижать риск. Остальные признаки схемы — только повышать. */
export const DAMPENERS = new Set(['warning', 'licensed', 'doubt', 'free_reward', 'legit_payout', 'question', 'reported']);

/**
 * Логистическая регрессия: градиентный спуск, L2-регуляризация, балансировка классов.
 * signs: знак веса фиксирован (1 — не меньше нуля, -1 — не больше), чтобы объяснение не противоречило смыслу признака.
 */
export function train(
  examples: Example[],
  featureNames: string[],
  options: { epochs?: number; rate?: number; l2?: number; signs?: Record<string, 1 | -1> } = {},
): { bias: number; weights: Record<string, number> } {
  const epochs = options.epochs ?? 4000;
  const rate = options.rate ?? 0.3;
  const l2 = options.l2 ?? 0.01;
  const positives = examples.filter((e) => e.label === 1).length;
  const negatives = examples.length - positives;
  const classWeight = (label: number) => (label === 1 ? examples.length / (2 * positives) : examples.length / (2 * negatives));
  const w = new Map(featureNames.map((name) => [name, 0]));
  let bias = 0;
  for (let epoch = 0; epoch < epochs; epoch++) {
    const grad = new Map(featureNames.map((name) => [name, 0]));
    let gradBias = 0;
    for (const example of examples) {
      let z = bias;
      for (const name of featureNames) z += (w.get(name) ?? 0) * (example.features[name] ?? 0);
      const error = (sigmoid(z) - example.label) * classWeight(example.label);
      gradBias += error;
      for (const name of featureNames) grad.set(name, (grad.get(name) ?? 0) + error * (example.features[name] ?? 0));
    }
    bias -= (rate * gradBias) / examples.length;
    for (const name of featureNames) {
      const current = w.get(name) ?? 0;
      let next = current - rate * ((grad.get(name) ?? 0) / examples.length + l2 * current);
      const sign = options.signs?.[name];
      if ((sign === 1 && next < 0) || (sign === -1 && next > 0)) next = 0;
      w.set(name, next);
    }
  }
  return { bias, weights: Object.fromEntries([...w].map(([k, v]) => [k, Math.round(v * 1000) / 1000])) };
}
