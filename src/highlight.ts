// Подсветка: какие слова исходного сообщения дали признаки.
// Цитаты признаков — в каноническом тексте, а аналитик смотрит исходный. Поэтому нормализуем
// каждое исходное слово отдельно и подсвечиваем те, что входят в цитаты.

import { normalize } from './normalize.ts';
import type { Signal } from './signals.ts';

const STOP = new Set(['это', 'для', 'что', 'как', 'вам', 'нас', 'все', 'или', 'при', 'его', 'она', 'они', 'уже', 'еще', 'так', 'тоже', 'мне', 'там', 'тут', 'реквизит', 'ссылка']);

export function highlights(text: string, signals: Signal[]): [number, number][] {
  const evidenceTokens = new Set<string>();
  for (const s of signals) {
    if (s.category === 'dampener') continue;
    for (const quote of s.evidence) {
      for (const token of normalize(quote).canon.split(/[^\p{L}\d]+/u)) {
        if (token.length >= 3 && !STOP.has(token)) evidenceTokens.add(token);
      }
    }
  }
  const ranges: [number, number][] = [];
  for (const m of text.matchAll(/[\p{L}\d@*+]+(?:[\s-]\d[\d*]*)*/gu)) {
    const canon = normalize(m[0]).canon;
    const tokens = canon.split(/[^\p{L}\d]+/u).filter(Boolean);
    if (tokens.some((t) => evidenceTokens.has(t)) || /реквизит/.test(canon)) ranges.push([m.index ?? 0, (m.index ?? 0) + m[0].length]);
  }
  return ranges;
}
