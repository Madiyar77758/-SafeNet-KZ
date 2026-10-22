// Нормализация текста групп: русский, казахский, транслит, сленг, маскировка.
// На выходе «канонический» текст, по которому работают признаки:
// кириллица, нижний регистр, казахские буквы сведены к русским (қ→к, ң→н…),
// латиница-двойники и цифры-двойники внутри слов заменены, разрядка «к а с п и» склеена,
// повторы «срооочно» сжаты, суммы «5к», «5 мың», «10 000» приведены к числам.
// Ссылки и реквизиты (телефоны, карты, IBAN) извлекаются до нормализации и заменяются метками.

export interface Requisite {
  type: 'phone' | 'card' | 'iban';
  value: string; // только цифры (для IBAN — как есть, без пробелов)
  raw: string;
}

export interface Normalized {
  raw: string;
  canon: string;
  links: string[];
  requisites: Requisite[];
  moneyEmoji: number;
  hypeEmoji: number;
}

const KAZAKH_FOLD: Record<string, string> = { ә: 'а', ғ: 'г', қ: 'к', ң: 'н', ө: 'о', ұ: 'у', ү: 'у', һ: 'х', і: 'и' };

// Латинские буквы, неотличимые от кириллических, — частая маскировка: «kаspi», «вл0жи».
const LOOKALIKE: Record<string, string> = { a: 'а', e: 'е', o: 'о', p: 'р', c: 'с', x: 'х', y: 'у', k: 'к', m: 'м', t: 'т', b: 'в', h: 'н', i: 'і' };
const LEET: Record<string, string> = { '0': 'о', '3': 'з', '4': 'ч', '6': 'б', '@': 'а' };

// Транслит латиницей (рус. и каз.) → кириллица. Сначала диграфы.
const TRANSLIT_MULTI: [string, string][] = [
  ['shch', 'щ'], ['sch', 'щ'], ['zh', 'ж'], ['kh', 'х'], ['ts', 'ц'], ['ch', 'ч'], ['sh', 'ш'],
  ['ya', 'я'], ['yu', 'ю'], ['yo', 'ё'], ['ye', 'е'], ['gh', 'ғ'], ['ng', 'ң'],
];
const TRANSLIT_SINGLE: Record<string, string> = {
  a: 'а', b: 'б', c: 'ц', d: 'д', e: 'е', f: 'ф', g: 'г', h: 'х', i: 'и', j: 'ж', k: 'к', l: 'л', m: 'м', n: 'н',
  o: 'о', p: 'п', q: 'қ', r: 'р', s: 'с', t: 'т', u: 'у', v: 'в', w: 'у', x: 'кс', y: 'ы', z: 'з',
  ä: 'ә', ö: 'ө', ü: 'ү', ğ: 'ғ', ı: 'ы', ş: 'ш', ç: 'ч', ñ: 'ң', ń: 'ң', ū: 'ұ',
};

const MONEY_EMOJI = /[💰💵💴💶💷💸🤑💲💳🏦🪙]/gu;
const HYPE_EMOJI = /[🔥🚀💯⚡✅❗‼⏳⌛🎁🏆💎]/gu;
const OTHER_EMOJI = /\p{Extended_Pictographic}|️/gu;

const URL_RE = /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(?:kz|ru|com|net|org|io|me|top|xyz|site|online|info|pro|link|click|cc|app)(?:\/\S*)?/giu;
const PHONE_RE = /(?<!\d)(?:\+?7|8)[\s\-()]*7\d{2}[\s\-()]*\d{3}[\s\-]*\d{2}[\s\-]*\d{2}(?!\d)/g;
const CARD_RE = /(?<!\d)\d{4}[\s-]?[\d*]{4}[\s-]?[\d*]{4}[\s-]?\d{4}(?!\d)/g;
const IBAN_RE = /\bkz\d{2}[a-z0-9]{16}\b/gi;

export function extractRequisites(text: string): { text: string; requisites: Requisite[] } {
  const requisites: Requisite[] = [];
  let out = text.replace(IBAN_RE, (raw) => {
    requisites.push({ type: 'iban', value: raw.toUpperCase(), raw });
    return ' реквизит ';
  });
  out = out.replace(CARD_RE, (raw) => {
    requisites.push({ type: 'card', value: raw.replace(/[\s-]/g, ''), raw });
    return ' реквизит ';
  });
  out = out.replace(PHONE_RE, (raw) => {
    const digits = raw.replace(/\D/g, '');
    requisites.push({ type: 'phone', value: '7' + digits.slice(-10), raw });
    return ' реквизит ';
  });
  return { text: out, requisites };
}

/** «5к», «5 k», «5 тыс», «5 мың», «1,5 млн», «10 000», «10.000» → число. */
export function normalizeAmounts(text: string): string {
  const num = (n: string) => Number(n.replace(',', '.'));
  let out = text.replace(/(\d)[ .](?=\d{3}(?!\d))/g, '$1'); // 10 000 / 10.000 → 10000
  // Диапазон с общей единицей: «10-15 мың», «от 20 до 60 тыс» — множитель для обоих чисел.
  out = out.replace(/(\d+(?:[.,]\d+)?)(\s*(?:-|–|—|до)\s*)(\d+(?:[.,]\d+)?)\s*(млн|к|k|тыс\p{L}*|мың\p{L}{0,3}|мын\p{L}{0,3})(?!\p{L})/gu, (m, a: string, sep: string, b: string, unit: string) => {
    const mult = unit.startsWith('млн') ? 1_000_000 : 1000;
    return num(a) < num(b) ? `${Math.round(num(a) * mult)}${sep}${Math.round(num(b) * mult)}` : m;
  });
  out = out.replace(/(\d+(?:[.,]\d+)?)\s*(млн|миллион\p{L}*)/gu, (_, n: string) => String(Math.round(num(n) * 1_000_000)));
  // «20 мыңнан», «5 мыңға» — казахские падежные окончания после «мың».
  out = out.replace(/(\d+(?:[.,]\d+)?)\s*(к|k|тыс\p{L}*|т\.р|мың\p{L}{0,3}|мын\p{L}{0,3})(?!\p{L})/gu, (_, n: string) => String(Math.round(num(n) * 1000)));
  return out;
}

// Числа словами: «пять тысяч», «бес мың», «жиырма бес мың» (после свёртки казахских букв).
const NUMBER_WORDS: Record<string, number> = {
  один: 1, одна: 1, два: 2, две: 2, три: 3, четыре: 4, пять: 5, шесть: 6, семь: 7, восемь: 8, девять: 9, десять: 10,
  пятнадцать: 15, двадцать: 20, тридцать: 30, сорок: 40, пятьдесят: 50, сто: 100, двести: 200, триста: 300, пятьсот: 500,
  бир: 1, еки: 2, уш: 3, торт: 4, бес: 5, алты: 6, жети: 7, сегиз: 8, тогыз: 9, он: 10, жиырма: 20, отыз: 30, кырык: 40, елу: 50, жуз: 100,
};
const NUMBER_WORD = Object.keys(NUMBER_WORDS).join('|');
const WORD_AMOUNT = new RegExp(`(?<!\\p{L})((?:(?:${NUMBER_WORD})\\s+){0,2}(?:${NUMBER_WORD}))\\s+(?:тысяч\\p{L}*|тыс|мын\\p{L}*)(?!\\p{L})`, 'gu');

/** «пять тысяч», «5 косарей», «пятихатка», «2 ляма», «пол-ляма», «5 процентов», «3 пайыз». */
function normalizeWords(text: string): string {
  return text
    .replace(WORD_AMOUNT, (_, words: string) => String(words.split(/\s+/).reduce((sum, w) => sum + (NUMBER_WORDS[w] ?? 0), 0) * 1000))
    .replace(/(?<!\p{L})пол[\s-]?лям\p{L}*/gu, '500000')
    .replace(/(?:(\d+(?:[.,]\d+)?)\s*)?(?<!\p{L})лям(?:а|ов)?(?!\p{L})/gu, (_, n?: string) => String(Math.round(Number((n ?? '1').replace(',', '.')) * 1_000_000)))
    .replace(/(?:(\d+)\s*)?(?<!\p{L})косар\p{L}*/gu, (_, n?: string) => String(Number(n ?? '1') * 1000))
    .replace(/(?<!\p{L})пятихатк\p{L}*/gu, '500')
    .replace(/(\d+(?:[.,]\d+)?)\s*(?:процент\p{L}*|пайыз\p{L}*)/gu, '$1%');
}

function transliterate(word: string): string {
  let out = '';
  for (let i = 0; i < word.length; ) {
    const multi = TRANSLIT_MULTI.find(([latin]) => word.startsWith(latin, i));
    if (multi) {
      out += multi[1];
      i += multi[0].length;
      continue;
    }
    const ch = word[i];
    const prev = out[out.length - 1] ?? '';
    const next = word[i + 1] ?? '';
    // «dney», «uspey», «kaitar»: y/i после гласной перед согласной или в конце слова — это «й».
    const afterVowel = prev !== '' && (ch === 'y' ? 'аеиоуыэюя' : 'аеоу').includes(prev);
    const beforeVowel = next !== '' && 'aeiouy'.includes(next);
    if ((ch === 'y' || ch === 'i') && afterVowel && !beforeVowel) {
      out += 'й';
      i += 1;
      continue;
    }
    out += TRANSLIT_SINGLE[ch] ?? ch;
    i += 1;
  }
  return out;
}

function fixToken(token: string): string {
  const hasCyr = /[а-яёәғқңөұүһі]/u.test(token);
  const hasLat = /[a-zäöüğışçñńū]/u.test(token);
  const letters = (token.match(/\p{L}/gu) ?? []).length;
  let out = token;
  if (hasCyr && hasLat) out = [...out].map((ch) => LOOKALIKE[ch] ?? ch).join('');
  else if (hasLat && !hasCyr) out = transliterate(out);
  // Цифры-двойники внутри слова («вл0жи», «к3шбэк»), но не суммы вида «5к».
  // «3» между согласными — это «е» («м3сяц», «инв3стиции»), иначе «з» («3аработок»).
  if (letters >= 3 && /\p{L}[0346@]|[0346@]\p{L}/u.test(out)) {
    out = out.replace(/(?<=[бвгджзклмнпрстфхцчшщ])3(?=[бвгджзклмнпрстфхцчшщ])/gu, 'е');
    out = [...out].map((ch) => LEET[ch] ?? ch).join('');
  }
  return out;
}

export function normalize(raw: string): Normalized {
  // Невидимые символы внутри слов («ка​спи») убираем, неразрывные и узкие пробелы (так копируются суммы с телефона) — в обычные.
  let text = raw.toLowerCase().replace(/ё/g, 'е').replace(/[​-‍⁠﻿]/g, '').replace(/[  -   　]/g, ' ');
  const links: string[] = [];
  text = text.replace(URL_RE, (url) => {
    links.push(url);
    return ' ссылка ';
  });
  const extracted = extractRequisites(text);
  text = extracted.text;

  const moneyEmoji = (text.match(MONEY_EMOJI) ?? []).length;
  const hypeEmoji = (text.match(HYPE_EMOJI) ?? []).length;
  text = text.replace(MONEY_EMOJI, ' ').replace(OTHER_EMOJI, ' ');

  text = text.replace(/(?<!\d)(?:\d[ ._*-]){2,}\d(?!\d)/g, (m) => m.replace(/[ ._*-]/g, '')); // «5 0 0 0» → 5000
  text = text.replace(/(?<=\p{L})[1!|](?=\p{L})/gu, 'и'); // «пр!гласи», «пр1гласи»
  text = normalizeAmounts(text);
  text = text.replace(/[\p{L}0-9@]+/gu, fixToken);
  text = [...text].map((ch) => KAZAKH_FOLD[ch] ?? ch).join('');
  text = normalizeWords(text);
  text = normalizeAmounts(text); // ещё раз: «10 myn» после транслита стало «10 мын»
  text = text.replace(/(\p{L})\1{2,}/gu, '$1'); // срооочно → срочно
  // Разрядка: «к а с п и», «к.а.с.п.и» → «каспи»
  text = text.replace(/(?<!\p{L})(?:\p{L}[\s.\-_*]){2,}\p{L}(?!\p{L})/gu, (m) => m.replace(/[\s.\-_*]/g, ''));
  text = text.replace(/\s+/g, ' ').trim();

  return { raw, canon: text, links, requisites: extracted.requisites, moneyEmoji, hypeEmoji };
}
