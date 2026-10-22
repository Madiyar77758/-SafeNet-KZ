// Скриншоты: распознаём текст (русский + казахский) и прогоняем через те же признаки.
// Отдельно узнаём «скриншот перевода/выплаты» — главный материал «прогрева» в группах.

import { createWorker, type Worker } from 'tesseract.js';
import { mkdirSync } from 'node:fs';
import type { Signal } from './signals.ts';

let worker: Promise<Worker> | null = null;

function getWorker(): Promise<Worker> {
  if (!worker) {
    const cachePath = new URL('../model/tessdata', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
    mkdirSync(cachePath, { recursive: true });
    worker = createWorker(['rus', 'kaz'], 1, { cachePath });
  }
  return worker;
}

export async function recognize(image: Buffer): Promise<string> {
  const w = await getWorker();
  const { data } = await w.recognize(image);
  return data.text.replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
}

const RECEIPT_WORDS = /перевод|переведено|получено|зачислено|успешно|выполнен|отправлено|аударым|аударылды|тусти|түсті|чек|квитанци|получатель|комисси/iu;
// Знак ₸ распознаётся то как «₸», то как «т» или «Т».
const AMOUNT = /\d[\d\s]{2,}\s?(?:₸|тг|тенге|теңге|kzt|т(?!\p{L}))/iu;

/** Признак «скриншот перевода или выплаты»: в тексте картинки есть сумма и слова квитанции. */
export function screenshotSignals(text: string): Signal[] {
  if (RECEIPT_WORDS.test(text) && AMOUNT.test(text)) {
    return [{ id: 'testimonial', category: 'proof', title: 'Скриншот перевода / выплаты', detail: 'на картинке квитанция с суммой', evidence: [text.match(AMOUNT)?.[0] ?? ''], strength: 0.9 }];
  }
  return [];
}
