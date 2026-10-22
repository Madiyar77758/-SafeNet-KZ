import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from '../src/normalize.ts';
import { analyzeMessage } from '../src/signals.ts';
import { loadMessageModel, scoreMessage } from '../src/message-model.ts';

const model = loadMessageModel();
const ids = (text: string) => analyzeMessage(text).signals.map((s) => s.id);
const level = (text: string) => scoreMessage(text, model).score.level;

test('нормализация: транслит, казахские суммы, маскировка', () => {
  assert.match(normalize('vlozhi 5k poluchi 15k za 3 dney').canon, /вложи 5000 получи 15000 за 3 дней/);
  assert.match(normalize('20 мыңнан салады').canon, /20000 салады/);
  assert.match(normalize('к а с п и, вл0жи 5 0 0 0').canon, /каспи, вложи 5000/);
  assert.match(normalize('investiruy 100 000 tg').canon, /инвестируй 100000 тг/);
  assert.match(normalize('пр0фит 40% в м3сяц').canon, /профит 40% в месяц/);
});

test('реквизиты извлекаются и маскируются', () => {
  const n = normalize('Kaspi Gold +7 707 555 12 34, карта 4400 4302 7788 1122');
  assert.deepEqual(n.requisites.map((r) => r.type).sort(), ['card', 'phone']);
});

test('доходность считается по формуле', () => {
  const r = analyzeMessage('Вложи 5000, получи 15000 через 3 дня').returnPromise;
  assert.equal(r?.ratio, 3);
  assert.equal(r?.days, 3);
});

test('пирамиды на трёх языках — высокий риск', () => {
  assert.equal(level('Вложи 5000 тг, получи 15 000 через 3 дня! Kaspi Gold +7 707 555 12 34'), 'high');
  assert.equal(level('5 мың салсаң, 3 күнде 15 мың аласың! Каспиге аударыңыз'), 'high');
  assert.equal(level('aqsha salsan 3 kunde 2 ese bolady, kaspige audar'), 'high');
});

test('цитата обещания в предупреждении не поднимает риск', () => {
  const text = '«Вложи 5000 получи 10000» — это пирамида, не ведитесь';
  assert.ok(ids(text).includes('reported'));
  assert.equal(level(text), 'low');
});

test('обычные сообщения с деньгами и бонусами — низкий риск', () => {
  assert.equal(level('Родители, на шторы в класс по 3000 на каспи Асель +7 701 234 56 78'), 'low');
  assert.equal(level('При оплате картой бонусы х2 на всю технику до воскресенья'), 'low');
  assert.equal(level('Пригласи друга в приложение — оба получите по 1000 бонусов на первый заказ'), 'low');
  assert.equal(level('Брат открыл кофейню, вложил 8 млн, окупилась за 3 года'), 'low');
  assert.equal(level('Тойға шақырамыз! 200 адам шақырдық, келіңіздер'), 'low');
});
