// Анализ целой группы: риск каждого сообщения, роли участников, шаблонные сообщения,
// реквизиты и ссылки, итоговый риск группы с объяснением.

import { readFileSync } from 'node:fs';
import type { ParsedChat } from './parse.ts';
import { scoreMessage, loadMessageModel } from './message-model.ts';
import { score, type Model, type RiskLevel, type Score } from './model.ts';
import { highlights } from './highlight.ts';
import { maskRequisite, type Signal } from './signals.ts';
import type { Requisite } from './normalize.ts';

export const CHAT_MODEL_PATH = new URL('../model/chat-model.json', import.meta.url);

export type Role = 'organizer' | 'curator' | 'reviewer' | 'complainant' | 'member';

export const ROLE_TITLES: Record<Role, string> = {
  organizer: 'Организатор',
  curator: 'Куратор',
  reviewer: '«Отзыв»',
  complainant: 'Жалуется',
  member: 'Участник',
};

export const CHAT_FEATURE_TITLES: Record<string, string> = {
  max_prob: 'Самое опасное сообщение в группе',
  top3_mean: 'Несколько опасных сообщений подряд',
  high_count: 'Много сообщений высокого риска',
  promo_share: 'Доля зазывающих сообщений',
  template_share: 'Шаблонные сообщения от разных людей',
  reviewers: 'Несколько «отзывов» о выплатах',
  complaints: 'Жалобы участников на невыплату',
  requisites: 'Реквизиты для перевода в группе',
  organizer: 'Есть организатор с обещаниями и реквизитами',
  curators: 'Есть кураторы, которые подгоняют',
  collapse: 'Сначала «отзывы», потом жалобы',
  warning_share: 'Участники предупреждают об обмане',
  licensed_share: 'Обсуждают легальные финпродукты',
};

export interface AnalyzedMessage {
  id: string;
  author: string;
  authorId: string;
  date: string | null;
  text: string;
  media: string | null;
  probability: number;
  level: RiskLevel;
  signals: Signal[];
  contributions: Score['contributions'];
  highlights: [number, number][];
  templateId: number | null;
}

export interface Participant {
  author: string;
  authorId: string;
  role: Role;
  messages: number;
  flagged: number;
  requisites: string[];
}

export interface TemplateCluster {
  id: number;
  example: string;
  count: number;
  authors: string[];
}

export interface ChatAnalysis {
  title: string;
  source: ParsedChat['source'];
  messages: AnalyzedMessage[];
  participants: Participant[];
  templates: TemplateCluster[];
  requisites: { type: Requisite['type']; value: string; masked: string; authors: string[]; count: number }[];
  links: string[];
  features: Record<string, number>;
  score: Score;
  summary: string;
}

let cachedChatModel: Model | null = null;
export function loadChatModel(): Model {
  if (!cachedChatModel) cachedChatModel = JSON.parse(readFileSync(CHAT_MODEL_PATH, 'utf8')) as Model;
  return cachedChatModel;
}

function shingles(canon: string): Set<string> {
  const words = canon.replace(/\d+/g, '#').split(/[^\p{L}#]+/u).filter((w) => w.length > 1);
  const out = new Set<string>();
  for (let i = 0; i + 2 < words.length; i++) out.add(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

const hasSignal = (signals: Signal[], ...ids: string[]) => signals.some((s) => ids.includes(s.id));

export function analyzeChat(chat: ParsedChat, messageModel: Model = loadMessageModel(), chatModel?: Model): ChatAnalysis {
  const scored = chat.messages.map((m) => {
    const result = scoreMessage(m.text, messageModel);
    return { m, result };
  });

  // Шаблоны: почти одинаковые сообщения (Жаккар по триграммам слов ≥ 0,6) от разных авторов.
  const shingleSets = scored.map(({ result }) => shingles(result.norm.canon));
  const parent = scored.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < scored.length; i++) {
    if (shingleSets[i].size < 2) continue;
    for (let j = i + 1; j < scored.length; j++) {
      if (shingleSets[j].size < 2) continue;
      if (jaccard(shingleSets[i], shingleSets[j]) >= 0.6) parent[find(j)] = find(i);
    }
  }
  const groups = new Map<number, number[]>();
  scored.forEach((_, i) => {
    const root = find(i);
    groups.set(root, [...(groups.get(root) ?? []), i]);
  });
  const templates: TemplateCluster[] = [];
  const templateOf = new Map<number, number>();
  for (const members of groups.values()) {
    const authors = [...new Set(members.map((i) => scored[i].m.author))];
    if (members.length < 2 || authors.length < 2) continue;
    const id = templates.length + 1;
    templates.push({ id, example: scored[members[0]].m.text, count: members.length, authors });
    for (const i of members) templateOf.set(i, id);
  }

  const messages: AnalyzedMessage[] = scored.map(({ m, result }, i) => ({
    id: m.id,
    author: m.author,
    authorId: m.authorId,
    date: m.date,
    text: m.text,
    media: m.media,
    probability: result.score.probability,
    level: result.score.level,
    signals: result.signals,
    contributions: result.score.contributions,
    highlights: highlights(m.text, result.signals),
    templateId: templateOf.get(i) ?? null,
  }));

  // Реквизиты и ссылки
  const requisiteMap = new Map<string, { type: Requisite['type']; value: string; authors: Set<string>; count: number }>();
  const links = new Set<string>();
  scored.forEach(({ m, result }) => {
    for (const r of result.norm.requisites) {
      const entry = requisiteMap.get(r.value) ?? { type: r.type, value: r.value, authors: new Set<string>(), count: 0 };
      entry.authors.add(m.author);
      entry.count++;
      requisiteMap.set(r.value, entry);
    }
    for (const link of result.norm.links) links.add(link);
  });

  // Роли
  const byAuthor = new Map<string, AnalyzedMessage[]>();
  for (const msg of messages) byAuthor.set(msg.authorId, [...(byAuthor.get(msg.authorId) ?? []), msg]);
  const promoScore = (list: AnalyzedMessage[]) =>
    list.reduce((sum, msg) => sum + (hasSignal(msg.signals, 'return', 'percent', 'multiplier', 'gift_circle', 'referral', 'levels', 'personal_transfer') && msg.level !== 'low' ? msg.probability : 0), 0);
  let organizerId: string | null = null;
  let organizerScore = 0;
  for (const [authorId, list] of byAuthor) {
    // Организатор обещает доход. Кто просто публикует номер для сбора на подарок — не организатор.
    const hasOffer = list.some((msg) => hasSignal(msg.signals, 'return', 'percent', 'multiplier', 'gift_circle', 'income_claim') && msg.level !== 'low');
    const s = promoScore(list);
    if (hasOffer && s > organizerScore) {
      organizerScore = s;
      organizerId = authorId;
    }
  }
  const participants: Participant[] = [...byAuthor.entries()].map(([authorId, list]) => {
    const flagged = list.filter((msg) => msg.level !== 'low').length;
    const testimonials = list.filter((msg) => hasSignal(msg.signals, 'testimonial')).length;
    const complaints = list.filter((msg) => hasSignal(msg.signals, 'complaint')).length;
    const pushes = list.filter((msg) => hasSignal(msg.signals, 'scarcity', 'urgency', 'referral', 'levels') && msg.level !== 'low').length;
    const inTemplates = list.filter((msg) => msg.templateId !== null && msg.level !== 'low').length;
    let role: Role = 'member';
    if (authorId === organizerId) role = 'organizer';
    else if (pushes > 0 || inTemplates > 0 || (flagged > 0 && testimonials === 0 && complaints === 0)) role = 'curator';
    else if (testimonials > 0 && testimonials >= list.length / 2) role = 'reviewer';
    else if (complaints > 0) role = 'complainant';
    const requisites = [...requisiteMap.values()].filter((r) => r.authors.has(list[0].author)).map((r) => maskRequisite(r.value, r.type));
    return { author: list[0].author, authorId, role, messages: list.length, flagged, requisites };
  });
  const roleOrder: Role[] = ['organizer', 'curator', 'reviewer', 'complainant', 'member'];
  participants.sort((a, b) => roleOrder.indexOf(a.role) - roleOrder.indexOf(b.role) || b.flagged - a.flagged);

  // Признаки группы
  const probs = messages.map((m) => m.probability).sort((a, b) => b - a);
  const total = Math.max(1, messages.length);
  const firstTestimonial = messages.findIndex((m) => hasSignal(m.signals, 'testimonial'));
  const lastComplaint = messages.map((m, i) => (hasSignal(m.signals, 'complaint') ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
  const features: Record<string, number> = {
    max_prob: probs[0] ?? 0,
    top3_mean: probs.slice(0, 3).reduce((a, b) => a + b, 0) / Math.max(1, Math.min(3, probs.length)),
    high_count: Math.min(1, messages.filter((m) => m.level === 'high').length / 5),
    promo_share: messages.filter((m) => m.level !== 'low').length / total,
    // Шаблоны считаем только зазывающие: одинаковые «с днём рождения» в семейном чате — не признак.
    template_share: Math.min(1, (messages.filter((m) => m.templateId !== null && m.level !== 'low').length / total) * 3),
    reviewers: Math.min(1, participants.filter((p) => p.role === 'reviewer').length / 3),
    complaints: Math.min(1, messages.filter((m) => hasSignal(m.signals, 'complaint')).length / 3),
    requisites: Math.min(1, requisiteMap.size / 2),
    organizer: organizerId ? 1 : 0,
    curators: Math.min(1, participants.filter((p) => p.role === 'curator').length / 2),
    collapse: firstTestimonial >= 0 && lastComplaint > firstTestimonial ? 1 : 0,
    warning_share: Math.min(1, messages.filter((m) => hasSignal(m.signals, 'warning', 'doubt')).length / total * 3),
    licensed_share: Math.min(1, messages.filter((m) => hasSignal(m.signals, 'licensed')).length / total * 3),
  };

  const chatScore = chatModel ? score(chatModel, features, CHAT_FEATURE_TITLES) : fallbackChatScore(features);
  const requisites = [...requisiteMap.values()].map((r) => ({ type: r.type, value: r.value, masked: maskRequisite(r.value, r.type), authors: [...r.authors], count: r.count }));

  return {
    title: chat.title,
    source: chat.source,
    messages,
    participants,
    templates,
    requisites,
    links: [...links],
    features,
    score: chatScore,
    summary: summarize(chatScore, messages, participants, templates, requisites.length),
  };
}

// До обучения модели групп — простая оценка по самому опасному сообщению.
function fallbackChatScore(features: Record<string, number>): Score {
  const probability = features.max_prob;
  return { probability, level: probability >= 0.62 ? 'high' : probability >= 0.52 ? 'medium' : 'low', contributions: [] };
}

function summarize(chatScore: Score, messages: AnalyzedMessage[], participants: Participant[], templates: TemplateCluster[], requisites: number): string {
  if (chatScore.level === 'low') return 'Признаков финансовой пирамиды не обнаружено.';
  const order = ['return', 'gift_circle', 'percent', 'multiplier', 'referral', 'levels', 'personal_transfer', 'testimonial', 'scarcity', 'denial', 'guarantee', 'urgency'];
  const reasons = new Map<string, number>();
  for (const m of messages) {
    if (m.level === 'low') continue;
    for (const s of m.signals) {
      if (s.category === 'dampener' || s.id === 'invest_call' || s.id === 'kaspi') continue;
      const rank = order.indexOf(s.id);
      reasons.set(s.title.toLowerCase(), Math.min(reasons.get(s.title.toLowerCase()) ?? 99, rank < 0 ? 50 : rank));
    }
  }
  const parts = [...reasons.entries()].sort((a, b) => a[1] - b[1]).slice(0, 4).map(([title]) => title);
  const organizer = participants.find((p) => p.role === 'organizer');
  const extra: string[] = [];
  if (organizer) extra.push(`организатор — ${organizer.author}`);
  const curators = participants.filter((p) => p.role === 'curator').length;
  if (curators) extra.push(`кураторов: ${curators}`);
  if (templates.length) extra.push(`шаблонных рассылок: ${templates.length}`);
  if (requisites) extra.push(`реквизитов: ${requisites}`);
  const tail = extra.join(', ');
  return `Обнаружены признаки финансовой пирамиды: ${parts.join(', ')}.${tail ? ` ${tail[0].toUpperCase()}${tail.slice(1)}.` : ''} Требуется проверка специалистом.`;
}
