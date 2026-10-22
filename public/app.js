// SafeNet KZ — дашборд аналитика (без сборки, чистый JS).

const LEVEL = { high: 'Высокий', medium: 'Средний', low: 'Низкий' };
const SOURCE = { whatsapp: 'WhatsApp', telegram: 'Telegram', image: 'Скриншот', text: 'Текст' };
const COLORS = { high: '#e5484d', medium: '#f0a020', low: '#2f9e6a' };
// Порядок признаков в карточке: сначала самые говорящие о пирамиде (как в очереди).
const PRIORITY = ['return', 'gift_circle', 'percent', 'multiplier', 'referral', 'levels', 'personal_transfer', 'testimonial', 'scarcity', 'denial', 'guarantee', 'income_claim', 'urgency', 'easy', 'complaint', 'invest_call', 'kaspi', 'emoji'];
// Главное обещание группы — первое найденное по этому порядку.
const PROMISE_ORDER = ['return', 'percent', 'multiplier', 'gift_circle', 'income_claim', 'referral', 'invest_call'];
const LANGS = { ru: 'Русский', kk: 'Казахский', mix: 'Смешанный', translit: 'Транслит' };
const state = { cases: [], selected: null, detail: null, sub: 'why', onlyFlagged: false, graph: null };

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const pct = (x) => `${Math.round(x * 100)}%`;
const plural = (n, one, few, many) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? few : many}`;

async function api(path, options = {}) {
  const res = await fetch(path, options);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

async function loadGraphData() {
  state.graph = await api('/api/graph');
  return state.graph;
}

// ---------- Очередь ----------

async function loadCases(selectId) {
  [state.cases] = await Promise.all([api('/api/cases'), loadGraphData()]);
  renderStats();
  renderList();
  const id = selectId ?? state.selected ?? state.cases[0]?.id;
  if (id) await selectCase(id);
}

function renderStats() {
  const count = (level) => state.cases.filter((c) => c.level === level).length;
  const confirmed = state.cases.filter((c) => c.feedback === 'confirmed').length;
  $('#stats').innerHTML = `
    <div class="stat"><b>${state.cases.length}</b><span>групп в очереди</span></div>
    <div class="stat high"><b>${count('high')}</b><span>высокий риск</span></div>
    <div class="stat medium"><b>${count('medium')}</b><span>средний риск</span></div>
    <div class="stat low"><b>${count('low')}</b><span>низкий риск</span></div>
    <div class="stat"><b>${confirmed}</b><span>подтверждено аналитиком</span></div>`;
}

function renderList() {
  $('#case-list').innerHTML = state.cases
    .map(
      (c) => `
    <button class="case-item ${c.level} ${c.id === state.selected ? 'selected' : ''}" data-id="${esc(c.id)}">
      <div class="row"><span class="title">${esc(c.title)}</span><span class="badge ${c.level}">${pct(c.probability)}</span></div>
      <div class="meta">${SOURCE[c.source] ?? c.source} · ${plural(c.messages, 'сообщение', 'сообщения', 'сообщений')}${c.flagged ? ` · помечено ${c.flagged}` : ''}${c.feedback ? ` · ${c.feedback === 'confirmed' ? '✓ подтверждено' : '✕ ложное'}` : ''}</div>
      <div class="chips">${c.reasons.slice(0, 2).map((r) => `<span class="chip">${esc(r)}</span>`).join('') || '<span class="chip down">признаков пирамиды нет</span>'}</div>
    </button>`,
    )
    .join('');
  document.querySelectorAll('.case-item').forEach((el) => el.addEventListener('click', () => selectCase(el.dataset.id)));
}

async function selectCase(id) {
  state.selected = id;
  document.querySelectorAll('.case-item').forEach((el) => el.classList.toggle('selected', el.dataset.id === id));
  state.detail = await api(`/api/cases/${encodeURIComponent(id)}`);
  renderDetail();
}

function meter(probability, level, small = false) {
  const size = small ? 84 : 112;
  const r = small ? 36 : 48;
  const c = 2 * Math.PI * r;
  return `<div class="meter ${small ? 'sm' : ''}"><svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" stroke="#eef0f3" stroke-width="10" fill="none"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" stroke="${COLORS[level]}" stroke-width="10" fill="none" stroke-linecap="round" stroke-dasharray="${c * probability} ${c}"/></svg>
    <div class="value"><div>${pct(probability)}<small>${LEVEL[level].toLowerCase()}</small></div></div></div>`;
}

function highlight(text, ranges) {
  if (!ranges?.length) return esc(text);
  let out = '';
  let pos = 0;
  for (const [start, end] of [...ranges].sort((a, b) => a[0] - b[0])) {
    if (start < pos) continue;
    out += esc(text.slice(pos, start)) + `<mark>${esc(text.slice(start, end))}</mark>`;
    pos = end;
  }
  return out + esc(text.slice(pos));
}

function contributionsHtml(contributions) {
  if (!contributions.length) return '<div class="empty">Нет данных</div>';
  const max = Math.max(...contributions.map((c) => Math.abs(c.contribution)), 0.01);
  return contributions
    .map(
      (c) => `<div class="contrib"><span>${esc(c.title)}</span><div class="bar"><i class="${c.contribution < 0 ? 'neg' : ''}" style="width:${(Math.abs(c.contribution) / max) * 100}%"></i></div><span class="num">${c.contribution > 0 ? '+' : ''}${c.contribution.toFixed(2).replace('.', ',')}</span></div>`,
    )
    .join('');
}

function signalRow(s, quote, times) {
  return `<div class="reason"><div class="name"><i class="cat ${s.category}"></i>${esc(s.title)}${times > 1 ? `<span class="times">×${times}</span>` : ''}</div>
    <div class="detail">${esc(s.detail)}</div>${quote ? `<div class="quote">«${esc(quote.length > 140 ? `${quote.slice(0, 140)}…` : quote)}»</div>` : ''}</div>`;
}

// Четыре главных факта о группе — их видно сразу, без чтения переписки.
function factsHtml(d) {
  const a = d.analysis;
  const flagged = a.messages.filter((m) => m.level !== 'low');
  let promise = null;
  for (const id of PROMISE_ORDER) {
    const found = flagged.flatMap((m) => m.signals.filter((s) => s.id === id)).sort((x, y) => y.strength - x.strength)[0];
    if (found) {
      promise = found;
      break;
    }
  }
  const network = state.graph?.networks.find((n) => n.chats.some((c) => c.id === d.id));
  const linked = network ? network.chats.filter((c) => c.id !== d.id) : [];
  const organizer = a.participants.find((p) => p.role === 'organizer');
  // «вложить 10 000 → получить 30 000 за 7 дн. (×3,0)» → крупно «×3 за 7 дн.», мелко — суммы.
  let headline = promise ? promise.title : 'не найдено';
  let sub = promise ? promise.detail : 'обещаний дохода нет';
  const ret = promise?.id === 'return' && /^(вложить .+? → получить [\d\s]+?)(?: за ([^(]+?))? \(×([\d,]+)\)/.exec(promise.detail);
  if (ret) [headline, sub] = [`×${ret[3].replace(/,0$/, '')}${ret[2] ? ` за ${ret[2]}` : ''}`, ret[1]];
  const daily = promise?.id === 'percent' && /≈ ([\d,]+% в день)/.exec(promise.detail);
  if (daily) [headline, sub] = [`≈ ${daily[1]}`, promise.detail.replace(/ ≈ .*/, '')];
  return `<div class="facts">
    <div class="fact ${promise ? 'alert' : ''}"><span>Главное обещание</span><b>${esc(headline)}</b><small>${esc(sub)}</small></div>
    <div class="fact"><span>Реквизиты для перевода</span><b>${a.requisites.length || 'нет'}</b><small>${a.requisites.length ? esc(a.requisites.slice(0, 2).map((r) => r.masked).join(', ')) : 'номеров и карт не найдено'}</small></div>
    <div class="fact ${linked.length ? 'alert' : ''}"><span>Связанные группы</span><b>${linked.length ? plural(linked.length, 'группа', 'группы', 'групп') : 'нет'}</b><small>${linked.length ? esc(linked.map((c) => c.title).join(', ')) : 'общих реквизитов и рассылок нет'}</small></div>
    <div class="fact"><span>Помечено сообщений</span><b>${flagged.length} из ${a.messages.length}</b><small>${organizer ? `организатор: ${esc(organizer.author)}` : 'организатор не выявлен'}</small></div>
  </div>`;
}

function renderDetail() {
  const d = state.detail;
  const a = d.analysis;
  const people = a.participants.filter((p) => p.role !== 'member' || p.flagged > 0);
  const subs = [
    ['why', 'Почему помечено'],
    ['messages', `Сообщения<span class="count">${a.messages.length}</span>`],
    ['people', `Участники и реквизиты<span class="count">${people.length + a.requisites.length}</span>`],
  ];
  $('#case-detail').innerHTML = `
    <div class="card">
      <div class="hero">
        ${meter(d.probability, d.level)}
        <div class="hero-text">
          <div class="eyebrow">${SOURCE[d.source] ?? d.source} · ${plural(a.messages.length, 'сообщение', 'сообщения', 'сообщений')} · ${plural(a.participants.length, 'участник', 'участника', 'участников')}${d.synthetic ? ' · <span class="chip synthetic">синтетические данные</span>' : ''}</div>
          <h2>${esc(d.title)}</h2>
          <p class="verdict">${esc(a.summary)}</p>
        </div>
      </div>
      <div class="actions">
        <button class="btn confirm ${d.feedback === 'confirmed' ? 'on' : ''}" data-verdict="confirmed">✓ Признаки подтверждены</button>
        <button class="btn reject ${d.feedback === 'false_positive' ? 'on' : ''}" data-verdict="false_positive">✕ Ложное срабатывание</button>
        <button class="btn" id="print">Отчёт для ведомства</button>
      </div>
      ${d.ocrText ? `<details class="tech" open><summary>Текст, распознанный на скриншоте</summary><div class="canon">${esc(d.ocrText)}</div></details>` : ''}
    </div>
    ${factsHtml(d)}
    <nav class="subtabs">${subs.map(([id, title]) => `<button data-sub="${id}" class="${state.sub === id ? 'active' : ''}">${title}</button>`).join('')}</nav>
    <div id="subtab"></div>`;
  renderSub();

  document.querySelectorAll('.subtabs button').forEach((btn) =>
    btn.addEventListener('click', () => {
      state.sub = btn.dataset.sub;
      document.querySelectorAll('.subtabs button').forEach((b) => b.classList.toggle('active', b === btn));
      renderSub();
    }),
  );
  document.querySelectorAll('[data-verdict]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const verdict = d.feedback === btn.dataset.verdict ? null : btn.dataset.verdict;
      await api(`/api/cases/${encodeURIComponent(d.id)}/feedback`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ verdict }) });
      await loadCases(d.id);
    }),
  );
  $('#print').addEventListener('click', () => window.print());
}

function renderSub() {
  const d = state.detail;
  const a = d.analysis;
  const roles = d.roleTitles;
  const box = $('#subtab');

  if (state.sub === 'why') {
    // Признаки по всей группе: сколько раз сработал и пример цитаты. Сверху — самые говорящие о пирамиде.
    const reasons = new Map();
    for (const m of a.messages) {
      if (m.level === 'low') continue;
      for (const s of m.signals) {
        if (s.category === 'dampener') continue;
        const rank = PRIORITY.indexOf(s.id);
        const entry = reasons.get(s.id) ?? { signal: s, count: 0, quote: m.text, rank: rank < 0 ? 99 : rank };
        entry.count++;
        reasons.set(s.id, entry);
      }
    }
    const dampeners = new Map();
    for (const m of a.messages) for (const s of m.signals) if (s.category === 'dampener' && !dampeners.has(s.id)) dampeners.set(s.id, s);
    box.innerHTML = `<div class="grid2 subtab">
      <div class="card"><h3 class="section-title">Вклад в риск</h3><p class="explain">Красные полосы повышают риск группы, зелёные — снижают.</p>${contributionsHtml(a.score.contributions)}</div>
      <div class="card"><h3 class="section-title">Найденные признаки</h3><p class="explain">С цитатой из переписки — можно проверить каждый.</p>
        ${[...reasons.values()].sort((x, y) => x.rank - y.rank || y.count - x.count).map((r) => signalRow(r.signal, r.quote, r.count)).join('') || '<div class="empty">Признаков пирамиды нет</div>'}
        ${dampeners.size ? `<div class="chips down-list">${[...dampeners.values()].map((s) => `<span class="chip down">↓ ${esc(s.title)}</span>`).join('')}</div>` : ''}
      </div></div>`;
    return;
  }

  if (state.sub === 'messages') {
    const flagged = a.messages.filter((m) => m.level !== 'low');
    const roleOf = new Map(a.participants.map((p) => [p.authorId, p.role]));
    const list = state.onlyFlagged ? flagged : a.messages;
    box.innerHTML = `<div class="card subtab">
      <div class="card-head"><h3 class="section-title">Переписка</h3>
        <div class="seg"><button data-only="0" class="${state.onlyFlagged ? '' : 'active'}">Все · ${a.messages.length}</button><button data-only="1" class="${state.onlyFlagged ? 'active' : ''}">Помеченные · ${flagged.length}</button></div></div>
      ${list
        .map((m) => {
          const role = roleOf.get(m.authorId);
          return `<div class="msg ${m.level}"><div class="stripe"></div><div>
            <div class="top"><span class="author">${esc(m.author)}</span>${role && role !== 'member' ? `<span class="role ${role}">${roles[role]}</span>` : ''}
              <span>${m.date ? esc(m.date.replace('T', ' ').slice(0, 16)) : ''}</span>${m.templateId ? '<span class="tpl">рассылка</span>' : ''}
              <span class="prob">${m.level !== 'low' ? `<span class="badge ${m.level}">${LEVEL[m.level]} · ${pct(m.probability)}</span>` : ''}</span></div>
            <div class="text">${m.media && !m.text ? `<i>[медиа: ${esc(m.media)}]</i>` : highlight(m.text, m.highlights)}</div>
            ${m.level !== 'low' || m.signals.some((s) => s.category === 'dampener') ? `<div class="chips">${m.signals.map((s) => `<span class="chip ${s.category === 'dampener' ? 'down' : ''}">${s.category === 'dampener' ? '↓ ' : ''}${esc(s.title)}</span>`).join('')}</div>` : ''}
          </div></div>`;
        })
        .join('') || '<div class="empty">Помеченных сообщений нет</div>'}
    </div>`;
    box.querySelectorAll('[data-only]').forEach((btn) =>
      btn.addEventListener('click', () => {
        state.onlyFlagged = btn.dataset.only === '1';
        renderSub();
      }),
    );
    return;
  }

  const people = a.participants.filter((p) => p.role !== 'member' || p.flagged > 0);
  box.innerHTML = `<div class="grid2 subtab">
    <div class="card"><h3 class="section-title">Роли участников</h3><p class="explain">Цифры — помечено сообщений из написанных.</p><div class="roles">
      ${people.map((p) => `<div class="person"><span class="role ${p.role}">${roles[p.role]}</span><span class="who">${esc(p.author)}</span><span class="num">${p.flagged} из ${p.messages}</span></div>`).join('') || '<div class="empty">Подозрительных ролей нет</div>'}
    </div></div>
    <div class="card"><h3 class="section-title">Реквизиты, ссылки, рассылки</h3><p class="explain">Номера маскируются: полный номер видит только специалист.</p>
      ${a.requisites.map((r) => `<div class="req"><code>${esc(r.masked)}</code><span>${r.count}× · ${esc(r.authors.join(', '))}</span></div>`).join('')}
      ${a.links.map((l) => `<div class="req"><code>${esc(l)}</code><span>ссылка</span></div>`).join('')}
      ${a.templates.map((t) => `<div class="req"><span style="color:var(--text);text-align:left">«${esc(t.example.slice(0, 80))}…»</span><span>${t.count}× от ${plural(t.authors.length, 'автора', 'авторов', 'авторов')}</span></div>`).join('')}
      ${!a.requisites.length && !a.links.length && !a.templates.length ? '<div class="empty">Не найдено</div>' : ''}
    </div></div>`;
}

// ---------- Вкладки ----------

document.querySelectorAll('nav.tabs button').forEach((btn) => btn.addEventListener('click', () => showTab(btn.dataset.tab)));

function showTab(tab) {
  document.querySelectorAll('nav.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  for (const name of ['queue', 'graph', 'check', 'metrics', 'method']) $(`#tab-${name}`).classList.toggle('hidden', name !== tab);
  if (tab === 'graph') loadGraph();
  if (tab === 'metrics') loadMetrics();
  if (tab === 'method') loadMethod();
}

// ---------- Граф ----------

async function loadGraph() {
  const g = await loadGraphData();
  const svg = $('#graph-svg');
  const W = svg.clientWidth || 900;
  const H = svg.clientHeight || 600;
  const nodes = g.nodes.map((n, i) => ({ ...n, x: W / 2 + Math.cos(i * 2.4) * 240, y: H / 2 + Math.sin(i * 2.4) * 240, vx: 0, vy: 0 }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges = g.edges.map((e) => ({ s: byId.get(e.source), t: byId.get(e.target), kind: e.kind })).filter((e) => e.s && e.t);
  // Физика: отталкивание, пружины по рёбрам, слабое притяжение к центру, остывание.
  const TICKS = 500;
  for (let tick = 0; tick < TICKS; tick++) {
    const heat = 1 - tick / TICKS;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const d2 = Math.max(dx * dx + dy * dy, 100);
        const d = Math.sqrt(d2);
        const f = 14000 / d2;
        a.vx += (dx / d) * f;
        a.vy += (dy / d) * f;
        b.vx -= (dx / d) * f;
        b.vy -= (dy / d) * f;
      }
    }
    for (const e of edges) {
      const dx = e.t.x - e.s.x;
      const dy = e.t.y - e.s.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = (d - 150) * 0.03;
      e.s.vx += (dx / d) * f;
      e.s.vy += (dy / d) * f;
      e.t.vx -= (dx / d) * f;
      e.t.vy -= (dy / d) * f;
    }
    for (const n of nodes) {
      n.vx += (W / 2 - n.x) * 0.002;
      n.vy += (H / 2 - n.y) * 0.002;
      n.x += n.vx * 0.5 * heat;
      n.y += n.vy * 0.5 * heat;
      n.vx *= 0.7;
      n.vy *= 0.7;
    }
  }
  // Вписываем схему в окно с полями под подписи.
  const xs = nodes.map((n) => n.x);
  const ys = nodes.map((n) => n.y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const scale = Math.min((W - 220) / Math.max(maxX - minX, 1), (H - 120) / Math.max(maxY - minY, 1), 1.8);
  const offsetX = (W - (maxX - minX) * scale) / 2;
  const offsetY = (H - (maxY - minY) * scale) / 2;
  for (const n of nodes) {
    n.x = offsetX + (n.x - minX) * scale;
    n.y = offsetY + (n.y - minY) * scale;
  }
  const entityColor = { requisite: '#12325b', template: '#6d4fc2', domain: '#0f8a86', person: '#0f8a86' };
  svg.innerHTML =
    edges.map((e) => `<line x1="${e.s.x}" y1="${e.s.y}" x2="${e.t.x}" y2="${e.t.y}" stroke="#cdd3dc" stroke-width="1.6"/>`).join('') +
    nodes
      .map((n) =>
        n.type === 'chat'
          ? `<g class="gnode" data-id="${esc(n.id.slice(5))}" style="cursor:pointer"><circle cx="${n.x}" cy="${n.y}" r="${13 + (n.risk ?? 0) * 11}" fill="${COLORS[n.level] ?? '#999'}" stroke="#fff" stroke-width="3"/>
             <text x="${n.x}" y="${n.y + 32 + (n.risk ?? 0) * 9}" text-anchor="middle" font-weight="650">${esc(n.label.slice(0, 32))}</text></g>`
          : `<g><rect x="${n.x - 7}" y="${n.y - 7}" width="14" height="14" rx="4" fill="${entityColor[n.type]}"/><text x="${n.x}" y="${n.y - 13}" text-anchor="middle">${esc(n.label.slice(0, 30))}</text></g>`,
      )
      .join('');
  svg.querySelectorAll('.gnode').forEach((el) =>
    el.addEventListener('click', () => {
      showTab('queue');
      selectCase(el.dataset.id);
    }),
  );
  $('#networks').innerHTML = g.networks.length
    ? g.networks
        .map(
          (n, i) => `<div class="network"><h4>Сеть ${i + 1} · ${plural(n.chats.length, 'группа', 'группы', 'групп')}</h4>
        ${n.chats.map((c) => `<div class="row"><span class="badge ${c.level}">${pct(c.probability)}</span><button class="linkish" data-id="${esc(c.id)}">${esc(c.title)}</button></div>`).join('')}
        <ul>${n.links.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></div>`,
        )
        .join('')
    : '<div class="card empty">Связанных групп не найдено</div>';
  document.querySelectorAll('#networks .linkish').forEach((el) =>
    el.addEventListener('click', () => {
      showTab('queue');
      selectCase(el.dataset.id);
    }),
  );
}

// ---------- Проверка текста ----------

const EXAMPLES = [
  ['Вложи 5000 — получи 15 000', 'Вложи 5000 тг, получи 15 000 через 3 дня! Осталось 2 места, Kaspi Gold +7 707 555 12 34'],
  ['Казахский', '5 мың салсаң, 3 күнде 15 мың аласың! Каспиге аударыңыз, орын аз қалды'],
  ['Транслит', 'aqsha salsan 3 kunde 2 ese bolady, kaspige audar'],
  ['Маскировка', 'к а с п и голд, вл0жи 5к → 15к 🔥🔥🔥'],
  ['Таск-скам', 'Работа в телефоне: ставишь лайки, 5000 в день. Для старта VIP-аккаунт 10 000 на каспи'],
  ['Предупреждение с цитатой', 'Осторожно! «Вложи 5000 получи 10000» — это пирамида, не ведитесь'],
  ['Вопрос «это развод?»', 'Маған 5 мың салсаң 15 мың аласың деп жазды, бұл алаяқтық па?'],
  ['Сбор в родительском чате', 'Родители, на шторы в класс по 3000 на каспи Асель +7 701 234 56 78'],
];
$('#examples').innerHTML = EXAMPLES.map(([label], i) => `<button data-i="${i}">${esc(label)}</button>`).join('');
document.querySelectorAll('#examples button').forEach((b) =>
  b.addEventListener('click', () => {
    $('#check-text').value = EXAMPLES[Number(b.dataset.i)][1];
    checkText();
  }),
);
$('#check-btn').addEventListener('click', checkText);

async function checkText() {
  const text = $('#check-text').value;
  if (!text.trim()) return;
  $('#check-result').innerHTML = '<div class="card spinner">Проверяю…</div>';
  const r = await api('/api/analyze-text', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
  if (r.caseId) {
    await loadCases(r.caseId);
    showTab('queue');
    return;
  }
  const found = r.signals.filter((s) => s.category !== 'dampener');
  const down = r.signals.filter((s) => s.category === 'dampener');
  $('#check-result').innerHTML = `
    <div class="card">
      <div class="hero">${meter(r.probability, r.level, true)}<div class="hero-text"><h2 style="font-size:20px;margin:0 0 4px">${r.level === 'low' ? 'Признаков пирамиды мало' : 'Есть признаки финансовой пирамиды'}</h2>
        <p class="verdict">${r.level === 'low' ? (down.length ? `Снижает риск: ${esc(down.map((s) => s.title.toLowerCase()).join(', '))}.` : 'Обещаний дохода и вербовки не найдено.') : 'Сообщение стоит передать специалисту на проверку.'}</p></div></div>
      <div class="result-text">${highlight(text, r.highlights)}</div>
    </div>
    <div class="card"><h3 class="section-title">Что нашли</h3>
      ${found.map((s) => signalRow(s, null, 1)).join('') || '<p class="explain">Признаков схемы нет.</p>'}
      ${down.length ? `<div class="chips down-list">${down.map((s) => `<span class="chip down">↓ ${esc(s.title)}</span>`).join('')}</div>` : ''}
    </div>
    <div class="card"><h3 class="section-title">Вклад в риск</h3>${contributionsHtml(r.contributions)}
      <details class="tech"><summary>Как текст видит система после нормализации</summary><div class="canon">${esc(r.canon)}</div></details>
    </div>`;
}

// ---------- Загрузка файла ----------

$('#file').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  event.target.value = '';
  showTab('queue');
  $('#case-detail').innerHTML = `<div class="card spinner">${/\.(png|jpe?g|webp)$/i.test(file.name) ? 'Распознаю текст на скриншоте (русский и казахский)…' : 'Разбираю экспорт чата…'}</div>`;
  try {
    const r = await api('/api/upload', { method: 'POST', headers: { 'x-filename': encodeURIComponent(file.name) }, body: file });
    await loadCases(r.caseId);
  } catch (error) {
    $('#case-detail').innerHTML = `<div class="card empty">Не получилось: ${esc(error.message)}</div>`;
  }
});

// ---------- Точность ----------

async function loadMetrics() {
  const m = await api('/api/metrics');
  const msg = m.messageTest;
  if (!msg) {
    $('#tab-metrics').innerHTML = '<div class="card empty">Финальная слепая проверка ещё не проведена</div>';
    return;
  }
  const o = msg.ours;
  const b = msg.baseline;
  const cmp = (name, ours, base) => `<div class="cmp"><span>${name}</span><div><div class="bar"><i style="width:${ours * 100}%"></i></div><div class="bar" style="margin-top:4px"><i class="base" style="width:${base * 100}%"></i></div></div><span class="num">${pct(ours)}<br><span style="color:var(--faint)">${pct(base)}</span></span></div>`;
  const chat = m.chatTest;
  const frozen = m.freeze ? new Date(m.freeze.frozenAt).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : '';
  const row = (title, s, n, cls = '') => `<tr class="${cls}"><td>${title}</td><td class="num">${n}</td><td class="num">${pct(s.precision)}</td><td class="num">${pct(s.recall)}</td><td class="num">${pct(s.fpr)}</td></tr>`;
  $('#tab-metrics').innerHTML = `
    <div class="principle"><svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2 3 5v5c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V5l-7-3Z" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>
      <div><b>Слепая проверка.</b> ${msg.dataset.total} сообщений${chat ? ` и ${chat.total} групп` : ''} составил отдельный исполнитель, не видевший ни правил, ни обучающих данных. Модель заморожена${frozen ? ` ${frozen}` : ''} до прогона.</div></div>
    <div class="metrics-grid">
      <div class="metric"><b>${pct(o.precision)}</b><span>Точность (precision)</span><div class="vs">ключевые слова: ${pct(b.precision)}</div></div>
      <div class="metric"><b>${pct(o.recall)}</b><span>Полнота (recall)</span><div class="vs">ключевые слова: ${pct(b.recall)}</div></div>
      <div class="metric"><b>${pct(o.f1)}</b><span>F1</span><div class="vs">ключевые слова: ${pct(b.f1)}</div></div>
      <div class="metric"><b>${pct(o.fpr)}</b><span>Ложные срабатывания</span><div class="vs">ключевые слова: ${pct(b.fpr)}</div></div>
    </div>
    <div class="grid2">
      <div class="card"><h3 class="section-title">Сообщения: система и поиск по ключевым словам</h3>
        <p class="explain">${msg.dataset.total} сообщений: ${msg.dataset.positives} со схемами и ${msg.dataset.negatives} обычных, в том числе трудные — предупреждения с цитатами обещаний, «это развод?», сборы на Kaspi, депозиты, сетевой маркетинг.</p>
        <div class="bars-legend"><span><i style="background:var(--accent)"></i>SafeNet</span><span><i style="background:#c4cbd6"></i>ключевые слова</span></div>
        ${cmp('Точность', o.precision, b.precision)}${cmp('Полнота', o.recall, b.recall)}${cmp('F1', o.f1, b.f1)}${cmp('Ложные срабатывания', o.fpr, b.fpr)}
      </div>
      <div class="card"><h3 class="section-title">По языкам</h3>
        <table><tr><th>Язык</th><th class="num">Точность</th><th class="num">Полнота</th><th class="num">Ложные</th><th class="num">n</th></tr>
        ${Object.entries(msg.byLang).map(([lang, s]) => `<tr><td>${LANGS[lang] ?? lang}</td><td class="num">${pct(s.precision)}</td><td class="num">${pct(s.recall)}</td><td class="num">${pct(s.fpr)}</td><td class="num">${s.tp + s.fp + s.fn + s.tn}</td></tr>`).join('')}</table>
        <h3 class="section-title" style="margin-top:18px">Матрица ошибок</h3>
        <table><tr><th></th><th class="num">помечено</th><th class="num">не помечено</th></tr>
          <tr><td>Схема</td><td class="num">${o.tp}</td><td class="num">${o.fn}</td></tr>
          <tr><td>Обычное</td><td class="num">${o.fp}</td><td class="num">${o.tn}</td></tr></table>
      </div>
      ${chat ? `<div class="card"><h3 class="section-title">Группы целиком</h3>
        <div class="metrics-grid inner">
          <div class="metric"><b>${pct(chat.precision)}</b><span>Точность</span><div class="vs">ключевые слова: ${pct(chat.baseline.precision)}</div></div>
          <div class="metric"><b>${pct(chat.recall)}</b><span>Полнота</span><div class="vs">ключевые слова: ${pct(chat.baseline.recall)}</div></div>
          <div class="metric"><b>${pct(chat.f1)}</b><span>F1</span><div class="vs">ключевые слова: ${pct(chat.baseline.f1)}</div></div>
          <div class="metric"><b>${pct(chat.fpr)}</b><span>Ложные</span><div class="vs">ключевые слова: ${pct(chat.baseline.fpr)}</div></div></div>
        <p class="explain">${chat.total} экспортов WhatsApp и Telegram: ${chat.positives} с пирамидой, ${chat.negatives} обычных — родительские сборы, попутки, магазины, сетевой маркетинг, финансы.</p>
        <table><tr><th>Группа</th><th>Язык</th><th class="num">Риск</th><th class="num">Разметка</th></tr>
        ${chat.chats.map((c) => `<tr><td>${c.correct ? '' : '✗ '}${esc(c.file)}</td><td>${LANGS[c.lang] ?? esc(c.lang ?? '')}</td><td class="num"><span class="badge ${c.level}">${pct(c.probability)}</span></td><td class="num">${c.label ? 'пирамида' : 'обычная'}</td></tr>`).join('')}</table></div>` : ''}
      <div class="card"><h3 class="section-title">История проверок</h3>
        <p class="explain">После каждой проверки ошибки разбирались по видам, а сам набор переходил в настроечные. Итог считается только на новом слепом наборе.</p>
        <table><tr><th>Проверка</th><th class="num">n</th><th class="num">Точность</th><th class="num">Полнота</th><th class="num">Ложные</th></tr>
        ${(m.history ?? []).map((h) => row(`${esc(h.title)}<div style="color:var(--faint);font-size:12px">${esc(h.note)}</div>`, h, h.total)).join('')}
        ${row('Итог: финальный слепой тест', o, msg.dataset.total, 'final')}</table>
      </div>
      <div class="card"><h3 class="section-title">Ошибки системы · ${msg.errors.length}</h3>
        ${msg.errors.slice(0, 8).map((e) => `<div class="reason"><div class="name"><span class="chip ${e.label ? '' : 'down'}">${e.label ? 'пропуск' : 'ложное'}</span><span class="times">${pct(e.probability)}</span></div><div class="quote">${esc(e.text)}</div></div>`).join('') || '<p class="explain">Ошибок нет</p>'}
        ${msg.errors.length > 8 ? `<details class="tech"><summary>Ещё ${msg.errors.length - 8}</summary>${msg.errors.slice(8).map((e) => `<div class="reason"><div class="name"><span class="chip ${e.label ? '' : 'down'}">${e.label ? 'пропуск' : 'ложное'}</span><span class="times">${pct(e.probability)}</span></div><div class="quote">${esc(e.text)}</div></div>`).join('')}</details>` : ''}
      </div>
    </div>`;
}

// ---------- Как это работает ----------

async function loadMethod() {
  const m = await api('/api/methodology');
  const table = (rows) => `<table><tr><th>Признак</th><th class="num">Вес</th></tr>${rows.map((r) => `<tr><td>${esc(r.title)}</td><td class="num" style="color:${r.weight < 0 ? 'var(--low-text)' : 'var(--text)'}">${r.weight > 0 ? '+' : ''}${r.weight.toFixed(2).replace('.', ',')}</td></tr>`).join('')}</table>`;
  const steps = [
    ['Нормализация', 'Казахские буквы, транслит, маскировка «к а с п и», суммы «5к», «20 мыңнан» — к одному виду.'],
    ['Признаки', 'Обещание дохода, давление, вербовка, перевод на карту, «отзывы». Каждый — с цитатой.'],
    ['Риск сообщения', 'Логистическая регрессия: вклад каждого признака виден аналитику.'],
    ['Риск группы', 'Роли участников, рассылки от разных людей, хронология «отзывы → жалобы».'],
    ['Сеть связей', 'Общие реквизиты, рассылки и ссылки объединяют группы в сети.'],
    ['Решение человека', 'Очередь, проверка, отчёт. Ответы аналитика становятся новой разметкой.'],
  ];
  $('#tab-method').innerHTML = `
    <div class="steps">${steps.map(([title, text], i) => `<div class="step"><div class="n">${i + 1}</div><b>${title}</b><p>${text}</p></div>`).join('')}</div>
    <div class="card">
      <h3 class="section-title">Как считается риск</h3>
      <p class="explain" style="font-size:14px;color:#344054">Риск = σ(b + Σ wᵢ·xᵢ): xᵢ — сила признака от 0 до 1, wᵢ — его вес. Знаки весов закреплены: признак схемы может только повышать риск, снимающий — только понижать. Пороги подобраны на настроечных наборах с точностью не ниже 95%: средний риск — от ${pct(m.message.thresholds.medium)}, высокий — от ${pct(m.message.thresholds.high)}.</p>
      <p class="explain" style="font-size:14px;color:#344054;margin-bottom:0">Снижают риск: предупреждения и новости, сомнение «это развод?», легальные финпродукты, бонусы магазинов, зарплата и пособия — и <b>обещание в цитате</b>: «ходит сообщение «вложи 5000…» — это пирамида».</p>
    </div>
    <div class="grid2" style="margin-top:14px">
      <div class="card"><h3 class="section-title">Веса признаков сообщения</h3>${table(m.message.weights)}</div>
      <div class="card"><h3 class="section-title">Веса признаков группы</h3>${table(m.chat.weights)}</div>
    </div>`;
}

loadCases();
// Ссылка на вкладку: #graph, #check, #metrics, #method; #check:текст — сразу проверить текст.
if (['#graph', '#check', '#metrics', '#method'].includes(location.hash)) showTab(location.hash.slice(1));
if (location.hash.startsWith('#check:')) {
  showTab('check');
  $('#check-text').value = decodeURIComponent(location.hash.slice(7));
  checkText();
}
