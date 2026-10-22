// Оценка одного сообщения: признаки → модель → риск и объяснение.

import { readFileSync } from 'node:fs';
import { analyzeMessage, type MessageSignals } from './signals.ts';
import { messageFeatures, score, type Model, type Score } from './model.ts';

export const MESSAGE_MODEL_PATH = new URL('../model/message-model.json', import.meta.url);

export interface MessageResult extends MessageSignals {
  features: Record<string, number>;
  score: Score;
}

let cached: Model | null = null;

export function loadMessageModel(): Model {
  if (!cached) cached = JSON.parse(readFileSync(MESSAGE_MODEL_PATH, 'utf8')) as Model;
  return cached;
}

export function scoreMessage(text: string, model: Model = loadMessageModel()): MessageResult {
  const analysis = analyzeMessage(text);
  const features = messageFeatures(analysis.signals);
  return { ...analysis, features, score: score(model, features) };
}
