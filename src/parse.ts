// Разбор экспортов чатов: WhatsApp (.txt, Android и iPhone, русская локаль) и Telegram Desktop (result.json).

export interface ChatMessage {
  id: string;
  author: string;
  /** Стабильный идентификатор автора (Telegram from_id); для WhatsApp — имя. */
  authorId: string;
  date: string | null;
  text: string;
  media: string | null;
}

export interface ParsedChat {
  title: string;
  source: 'whatsapp' | 'telegram' | 'text';
  messages: ChatMessage[];
}

// 22.10.2026, 14:05 - Имя: текст        (Android)
// [22.10.2026, 14:05:33] Имя: текст     (iPhone)
const WA_LINE = /^\[?(\d{1,2}[./]\d{1,2}[./]\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?)\]?\s*[-–]?\s*([^:]{1,60}):\s?(.*)$/;
const WA_MEDIA = /<(?:Без медиафайлов|Media omitted|Медиа пропущено)>|\(файл добавлен\)|\.(?:jpg|jpeg|png|webp|opus|mp4)\b/i;

function waDate(date: string, time: string): string | null {
  const [d, m, y] = date.split(/[./]/).map(Number);
  if (!d || !m || !y) return null;
  const year = y < 100 ? 2000 + y : y;
  return `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T${time.length === 5 ? time + ':00' : time}`;
}

export function parseWhatsApp(content: string, title = 'Чат WhatsApp'): ParsedChat {
  const messages: ChatMessage[] = [];
  for (const rawLine of content.replace(/\r/g, '').replace(/\u200E/g, '').split('\n')) {
    const line = rawLine.trimEnd();
    const m = WA_LINE.exec(line);
    if (m) {
      const [, date, time, author, text] = m;
      const media = WA_MEDIA.test(text) ? text : null;
      messages.push({ id: String(messages.length + 1), author: author.trim(), authorId: author.trim(), date: waDate(date, time), text: media ? '' : text, media });
    } else if (messages.length > 0 && line.trim()) {
      messages[messages.length - 1].text += `\n${line}`;
    }
  }
  return { title, source: 'whatsapp', messages };
}

type TelegramText = string | ({ type?: string; text?: string } | string)[];

interface TelegramExport {
  name?: string;
  messages?: { id?: number; type?: string; date?: string; from?: string; from_id?: string; text?: TelegramText; photo?: string; file?: string; media_type?: string }[];
}

function telegramText(text: TelegramText | undefined): string {
  if (!text) return '';
  if (typeof text === 'string') return text;
  return text.map((part) => (typeof part === 'string' ? part : (part.text ?? ''))).join('');
}

export function parseTelegram(json: TelegramExport, fallbackTitle = 'Чат Telegram'): ParsedChat {
  const messages: ChatMessage[] = [];
  for (const m of json.messages ?? []) {
    if (m.type && m.type !== 'message') continue;
    const author = m.from ?? 'Неизвестно';
    messages.push({
      id: String(m.id ?? messages.length + 1),
      author,
      authorId: m.from_id ?? author,
      date: m.date ?? null,
      text: telegramText(m.text),
      media: m.photo ?? m.file ?? (m.media_type ? m.media_type : null),
    });
  }
  return { title: json.name ?? fallbackTitle, source: 'telegram', messages };
}

/** Определяет формат по содержимому: JSON — Telegram, строки «дата, время - имя:» — WhatsApp, иначе — одно сообщение. */
export function parseAny(content: string, filename = 'чат'): ParsedChat {
  const trimmed = content.trimStart();
  const title = filename.replace(/\.(txt|json)$/i, '');
  if (trimmed.startsWith('{')) {
    try {
      return parseTelegram(JSON.parse(trimmed) as TelegramExport, title);
    } catch {
      // не JSON — пробуем как текст
    }
  }
  const whatsapp = parseWhatsApp(content, title);
  if (whatsapp.messages.length > 0) return whatsapp;
  return { title, source: 'text', messages: [{ id: '1', author: 'Текст', authorId: 'text', date: null, text: content, media: null }] };
}
