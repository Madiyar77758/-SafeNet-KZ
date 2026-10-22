// Граф связей между группами: общие реквизиты, шаблоны рассылок, ссылки и аккаунты.
// Одна схема часто живёт в нескольких группах под разными названиями — граф собирает их в одну сеть.

import type { ChatAnalysis } from './chat.ts';
import { maskRequisite } from './signals.ts';

export type NodeType = 'chat' | 'requisite' | 'domain' | 'template' | 'person';

export interface GraphNode {
  id: string;
  type: NodeType;
  label: string;
  risk?: number;
  level?: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  kind: NodeType;
}

export interface Network {
  chats: { id: string; title: string; level: string; probability: number }[];
  links: string[];
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  networks: Network[];
}

function domainOf(link: string): string {
  return link.replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0].toLowerCase();
}

function templateKey(text: string): string {
  return text.toLowerCase().replace(/\d+/g, '#').replace(/[^\p{L}#]+/gu, ' ').trim().split(' ').slice(0, 12).join(' ');
}

export function buildGraph(cases: { id: string; analysis: ChatAnalysis }[]): Graph {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const entityChats = new Map<string, Set<string>>();
  const link = (chatId: string, entityId: string, node: GraphNode) => {
    if (!nodes.has(entityId)) nodes.set(entityId, node);
    entityChats.set(entityId, (entityChats.get(entityId) ?? new Set()).add(chatId));
  };

  for (const { id, analysis } of cases) {
    const chatId = `chat:${id}`;
    nodes.set(chatId, { id: chatId, type: 'chat', label: analysis.title, risk: analysis.score.probability, level: analysis.score.level });
    for (const r of analysis.requisites) link(chatId, `req:${r.value}`, { id: `req:${r.value}`, type: 'requisite', label: maskRequisite(r.value, r.type) });
    for (const l of analysis.links) {
      const domain = domainOf(l);
      link(chatId, `dom:${domain}`, { id: `dom:${domain}`, type: 'domain', label: domain });
    }
    // Одинаковые зазывающие сообщения в разных группах — признак одной сети рассылки.
    for (const m of analysis.messages) {
      // Рассылка: помеченное сообщение или сообщение с признаками схемы в подозрительной группе («осталось 3 места, Kaspi …»).
      const promotional = m.level !== 'low' || (analysis.score.level !== 'low' && m.signals.some((s) => s.category !== 'dampener' && s.category !== 'complaint'));
      if (!promotional || m.text.length < 25) continue;
      const key = templateKey(m.text);
      link(chatId, `tpl:${key}`, { id: `tpl:${key}`, type: 'template', label: m.text.slice(0, 70) });
    }
    // Аккаунты связывают группы, только если у автора стабильный идентификатор (Telegram) и он что-то продвигал.
    for (const p of analysis.participants) {
      if (p.role !== 'organizer' && p.role !== 'curator') continue;
      if (analysis.source !== 'telegram') continue;
      link(chatId, `person:${p.authorId}`, { id: `person:${p.authorId}`, type: 'person', label: p.author });
    }
  }

  // В граф идут только сущности, общие хотя бы для двух групп: остальное — шум.
  const kept = new Set<string>();
  for (const [entityId, chats] of entityChats) {
    if (chats.size < 2) continue;
    kept.add(entityId);
    for (const chatId of chats) edges.push({ source: chatId, target: entityId, kind: nodes.get(entityId)!.type });
  }
  const usedChats = new Set(edges.map((e) => e.source));
  const finalNodes = [...nodes.values()].filter((n) => (n.type === 'chat' ? true : kept.has(n.id)));

  // Сети — связные компоненты, где есть ≥ 2 групп.
  const adjacency = new Map<string, Set<string>>();
  for (const e of edges) {
    adjacency.set(e.source, (adjacency.get(e.source) ?? new Set()).add(e.target));
    adjacency.set(e.target, (adjacency.get(e.target) ?? new Set()).add(e.source));
  }
  const seen = new Set<string>();
  const networks: Network[] = [];
  for (const start of usedChats) {
    if (seen.has(start)) continue;
    const stack = [start];
    const component: string[] = [];
    while (stack.length) {
      const current = stack.pop()!;
      if (seen.has(current)) continue;
      seen.add(current);
      component.push(current);
      for (const next of adjacency.get(current) ?? []) stack.push(next);
    }
    const chats = component.filter((id) => id.startsWith('chat:')).map((id) => nodes.get(id)!);
    if (chats.length < 2) continue;
    const entities = component.filter((id) => !id.startsWith('chat:')).map((id) => nodes.get(id)!);
    const describe: Record<NodeType, string> = { requisite: 'Один и тот же реквизит', domain: 'Одна и та же ссылка', template: 'Одинаковая рассылка', person: 'Один и тот же аккаунт', chat: '' };
    networks.push({
      chats: chats.map((c) => ({ id: c.id.slice(5), title: c.label, level: c.level ?? 'low', probability: c.risk ?? 0 })),
      links: entities.map((e) => `${describe[e.type]}: ${e.label} — в ${entityChats.get(e.id)!.size} группах`),
    });
  }
  networks.sort((a, b) => b.chats.length - a.chats.length);
  return { nodes: finalNodes, edges, networks };
}
