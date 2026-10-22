// Синтетический обучающий датасет: сообщения и чаты (русский, казахский, смешанный, транслит).
// Все имена, номера и карты выдуманы. Тестовая выборка пишется вручную отдельно (data/test/messages.jsonl),
// чтобы метрики не завышались за счёт одинаковых шаблонов.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

type Kind =
  | 'offer' | 'referral' | 'push' | 'testimonial' | 'denial_offer' | 'gift_circle' | 'income_brag'
  | 'collection' | 'finance' | 'warning' | 'news' | 'smalltalk' | 'ad' | 'legit_referral' | 'job' | 'debt' | 'question' | 'complaint'
  | 'legit_scarcity' | 'doubt' | 'legit_payout' | 'job_daily' | 'task_scam' | 'toi' | 'legit_mlm' | 'shop' | 'business_income';

export const POSITIVE_KINDS: readonly Kind[] = ['offer', 'referral', 'push', 'testimonial', 'denial_offer', 'gift_circle', 'income_brag', 'task_scam'];

interface Message {
  text: string;
  kind: Kind;
  label: 0 | 1;
  lang: 'ru' | 'kk' | 'mix' | 'translit';
}

// Детерминированный генератор случайных чисел: датасет воспроизводим.
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = rng(20261022);
const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)];
const chance = (p: number) => rand() < p;
const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));

function amount(n: number, kk = false): string {
  const style = int(0, kk ? 5 : 4);
  const thousands = n / 1000;
  const cur = pick(kk ? ['теңге', 'тг', '₸', ''] : ['тг', 'тенге', '₸', '']);
  const body = [
    String(n),
    n.toLocaleString('ru-RU').replace(/ /g, ' '),
    `${thousands}к`,
    `${thousands}k`,
    `${thousands} тыс`,
    `${thousands} мың`,
  ][style];
  return `${body} ${cur}`.trim();
}

const phone = () => `+7 7${pick(['01', '02', '05', '07', '08', '47', '71', '75', '77', '78'])} ${int(100, 999)} ${int(10, 99)} ${int(10, 99)}`;
const card = () => `4400 43${int(10, 99)} ${int(1000, 9999)} ${int(1000, 9999)}`;
const BASE = [3000, 5000, 10000, 15000, 20000, 25000, 50000, 100000];
const MULT = [1.5, 2, 2, 3, 3, 5, 10];

const HOOK_RU = ['🔥 Внимание!', 'Девочки!', 'Друзья,', 'Ребята, новый проект!', 'Только для своих:', 'Срочная новость!', 'Кто хочет заработать?', '', '', '💰💰💰'];
const HOOK_KK = ['Назар аударыңыз!', 'Қыздар!', 'Достар,', 'Жаңа жоба!', 'Ақша тапқыңыз келе ме?', '', '🔥🔥'];
const PERIOD_RU = ['за 3 дня', 'через неделю', 'за 24 часа', 'через 5 дней', 'за 10 дней', 'за сутки', 'через 2 недели', 'за месяц'];
const PERIOD_KK = ['3 күнде', 'бір аптада', '24 сағатта', '5 күнде', '10 күнде', 'бір айда'];
const PRESSURE_RU = ['Осталось 3 места!', 'Успей сегодня!', 'Набор закрывается в 21:00', 'Только сегодня!', 'Мест мало, пишите срочно', 'Последний шанс!', ''];
const PRESSURE_KK = ['3 орын қалды!', 'Үлгеріп қалыңыз!', 'Бүгін ғана!', 'Орын аз, тез жазыңыз', ''];
const PAY_RU = () => pick([`Kaspi Gold ${phone()}`, `перевод на карту ${card()}`, `оплата на Kaspi по номеру ${phone()}`, 'перевод на каспи, реквизиты в лс', `скидываете на мой каспи ${phone()}`, 'Каспи перевод']);
const PAY_KK = () => pick([`Каспиге аударыңыз ${phone()}`, `Kaspi Gold ${phone()}`, `картаға аударым ${card()}`, 'Каспиге аударасыз, нөмірі лс-те']);
const NAMES = ['Айгерим', 'Динара', 'Ерлан', 'Нурлан', 'Асель', 'Жанар', 'Мадина', 'Бауыржан', 'Сауле', 'Арман', 'Гульнара', 'Ольга', 'Ирина', 'Сергей', 'Алия', 'Дамир', 'Карина', 'Айдос', 'Әсем', 'Нұрсұлтан', 'Ләззат', 'Тимур', 'Аружан', 'Санжар', 'Елена', 'Марат'];

// Маскировка, которой прикрываются в группах: латиница-двойники, разрядка, цифры вместо букв, повторы букв.
function disguise(text: string): string {
  let out = text;
  if (chance(0.3)) out = out.replace(/каспи/gi, () => pick(['к а с п и', 'kaspi', 'Kаspi', 'КАСПИ', 'kаспи']));
  if (chance(0.25)) out = out.replace(/о/g, (m) => (chance(0.3) ? '0' : m));
  if (chance(0.2)) out = out.replace(/срочно/gi, 'срооочно');
  if (chance(0.3)) out = out + ' ' + pick(['🔥', '💰💰', '✅', '🚀🚀', '💸']);
  return out;
}

function offerRu(): string {
  const base = pick(BASE);
  const mult = pick(MULT);
  const parts = [
    pick(HOOK_RU),
    pick([`Вложи ${amount(base)}`, `Вкладываешь ${amount(base)}`, `Инвестируй ${amount(base)}`, `Закинь ${amount(base)}`, `Вход от ${amount(base)}`]),
    pick([`получи ${amount(base * mult)}`, `заберёшь ${amount(base * mult)}`, `выведешь ${amount(base * mult)}`, `на выходе ${amount(base * mult)}`, `получаешь ${amount(base * mult)}`]),
    pick(PERIOD_RU) + '!',
    chance(0.5) ? pick(['Гарантия 100%', 'Без риска', 'Работает железно', 'Это не пирамида!', '']) : '',
    pick(PRESSURE_RU),
    chance(0.75) ? PAY_RU() : '',
  ];
  return disguise(parts.filter(Boolean).join(' '));
}

function offerKk(): string {
  const base = pick(BASE);
  const mult = pick(MULT);
  const parts = [
    pick(HOOK_KK),
    `${amount(base, true)} ${pick(['салсаң', 'салыңыз', 'салып', 'салсаңыз'])},`,
    `${pick(PERIOD_KK)} ${amount(base * mult, true)} ${pick(['аласың', 'аласыз', 'қайтарамыз', 'табыс'])}!`,
    chance(0.5) ? pick(['Кепілдік бар!', 'Тәуекелсіз!', 'Бұл пирамида емес!', '']) : '',
    pick(PRESSURE_KK),
    chance(0.75) ? PAY_KK() : '',
  ];
  return disguise(parts.filter(Boolean).join(' '));
}

function offerMix(): string {
  const base = pick(BASE);
  const mult = pick(MULT);
  return disguise(
    `${pick(['Салым', 'Вклад'])} ${amount(base)}, ${pick(['3 күнде', 'через неделю', '5 күнде'])} ${amount(base * mult)} аласыз! ${pick(['Каспиге аударыңыз', 'Kaspi перевод', 'оплата на каспи'])} ${chance(0.6) ? phone() : ''} ${pick(['үлгеріп қалыңыз', 'успейте', ''])}`,
  );
}

function offerTranslit(): string {
  const base = pick(BASE);
  const mult = pick(MULT);
  return `${pick(['vlozhi', 'vkladyvay', 'zakin'])} ${base / 1000}k ${pick(['poluchi', 'zaberesh', 'vyvedesh'])} ${(base * mult) / 1000}k ${pick(['za 3 dnya', 'za nedelyu', 'cherez 5 dney'])}, ${pick(['kaspi po nomeru', 'perevod na kaspi', 'pishi v lichku, kaspi'])} ${pick(['uspey!', 'mest malo', ''])}`;
}

function percentOffer(): string {
  const pct = pick([1, 2, 3, 5, 10, 15, 30]);
  return disguise(
    pick([
      `${pick(HOOK_RU)} Доход ${pct}% в день! ${pick(['Гарантия', 'Без риска', 'Выплаты каждый день'])}, вход от ${amount(pick(BASE))}. ${PAY_RU()}`,
      `Күніне ${pct}% табыс! ${pick(['Кепілдік', 'Тәуекелсіз'])}, салым ${amount(pick(BASE), true)}-дан. ${PAY_KK()}`,
      `${pct * 7}% в неделю на ваш вклад, пассивный доход без усилий. ${pick(PRESSURE_RU)} ${PAY_RU()}`,
    ]),
  );
}

function referral(): string {
  const pct = pick([5, 10, 15, 20]);
  return disguise(
    pick([
      `Приведи друга и получай ${pct}% с каждого его вклада! 1 линия ${pct}%, 2 линия ${pct / 2}%`,
      `За каждого приглашённого бонус ${amount(pick([1000, 2000, 5000]))}! Чем больше команда — тем больше доход`,
      `Досыңды шақыр — әр салымнан ${pct}% бонус! 1-деңгей ${pct}%, 2-деңгей ${pct / 2}%`,
      `Приглашай знакомых в проект, процент с приглашённых идёт тебе каждый день. Реферальная ссылка в лс`,
      `Командный бонус: приведи 3 человека — вход возвращается, дальше чистая прибыль`,
      `С каждого приведённого тобой участника — ${pct}% от его взноса`,
      `Шақырған әр адамыңнан ${pct}% бонус аласың, салымы қанша болса да`,
      `2 адам әкел, әрқайсысы ${amount(20000, true)} салады, сен ${amount(50000, true)} аласың`,
      `Бонус ${amount(5000)} за каждого, кто зарегистрируется по твоей ссылке и вложит от ${amount(20000)}`,
      `Чем больше пригласишь людей, тем больше доход с твоей линии`,
      `priglasi druzey i poluchay ${pct}% s ih vkladov`,
    ]),
  );
}

// Задания за деньги с платным входом (таск-скам).
function taskScam(): string {
  const fee = pick([3000, 5000, 10000, 15000, 20000]);
  const daily = pick([2000, 3000, 5000, 8000, 15000]);
  return disguise(
    pick([
      `Работа в телефоне: ставишь лайки и оцениваешь товары, ${amount(daily)} в день. Для старта VIP-аккаунт ${amount(fee)}`,
      `Выполняй задания в приложении и получай ${amount(daily)} ежедневно! Активация ${amount(fee)} на каспи`,
      `Тапсырмаларды орындап, күніне ${amount(daily, true)} табыңыз! Тіркелу ${amount(fee, true)}, Каспиге аударасыз`,
      `Онлайн подработка: пополни баланс на ${amount(fee)} и открой задания, выплаты ${amount(daily)} в день`,
      `VIP-уровень за ${amount(fee)} даёт задания на ${amount(daily)} каждый день, вывод на Kaspi`,
      `Смотришь ролики — получаешь деньги за каждый просмотр. Сначала купи пакет доступа за ${amount(fee)}`,
      `Отзыв жазып ${amount(500, true)} табасың, VIP ${amount(fee, true)}, кейін күніне ${amount(daily, true)} шығарасың`,
      `Тауарларды бағалап табыс табыңыз, бастау үшін балансты ${amount(fee, true)} толтыру керек`,
    ]),
  );
}

// Поддельные инвестплатформы «от имени государства».
function fakePlatform(): string {
  const stake = pick(BASE);
  return pick([
    `Новая государственная инвестиционная платформа: вложите от ${amount(stake)} и получайте доход от нефти каждый месяц`,
    `Национальная программа: доходы от газа для каждого гражданина, вход от ${amount(stake)}, выплаты каждую неделю`,
    `Мемлекеттік инвестициялық платформа: ${amount(stake, true)} салып, ай сайын ${amount(stake * 3, true)} табыс аласыз`,
  ]);
}

// Доходность «в день на вложение» и «окупаемость за дни».
function rateOffer(): string {
  const stake = pick(BASE);
  const daily = Math.round(stake * pick([0.03, 0.05, 0.1, 0.2]));
  return disguise(
    pick([
      `Купи место в проекте за ${amount(stake)} и получай ${amount(daily)} ежедневно`,
      `Пакет «Старт» ${amount(stake)} — начисления ${amount(daily)} в день, вывод на каспи`,
      `${amount(stake, true)} салып, күніне ${amount(daily, true)} табыс аласыз`,
      `Твоё вложение ${amount(stake)} окупится за ${int(3, 10)} дней, дальше только прибыль`,
      `Деньги идут от новых участников, поэтому каждый получает в ${pick([2, 3, 4])} раза больше вложенного`,
    ]),
  );
}

function push(): string {
  return disguise(
    pick([
      `Осталось ${int(2, 5)} места! Кто готов — пишите в лс, ${PAY_RU()}`,
      `Набор закрывается сегодня в ${int(18, 23)}:00, успейте зайти! Вход ${amount(pick(BASE))}`,
      `${int(2, 5)} орын қалды! Үлгеріп қалыңыз, ${PAY_KK()}`,
      `Не упустите шанс, завтра вход уже ${amount(pick(BASE))}! Пишите куратору`,
      `Последний поток с доходом ${pick([2, 3, 5])}% в день, закрываем вход в ${int(20, 23)}:00`,
      `Последний набор в этом месяце, мест мало! Kaspi ${phone()}`,
    ]),
  );
}

function testimonial(): string {
  const n = pick(BASE) * pick([2, 3]);
  return disguise(
    pick([
      `Выплата пришла ${amount(n)} ✅ спасибо организатору!`,
      `Девочки, вывела ${amount(n)}, всё честно, реально платят!`,
      `Получила свои ${amount(n)}, кто сомневается — не сомневайтесь`,
      `${amount(n, true)} ақша түсті, рахмет куратор! 🔥`,
      `${amount(n, true)} алдым, бәрі шын!`,
      `Скрин выплаты кидаю, деньги пришли за 3 дня!`,
      `Спасибо админу, вывод пришёл вовремя 🙏`,
      `Вывожу уже ${int(2, 5)}-й раз, деньги приходят день в день 💸`,
      `Проверила на себе: вложила ${amount(n / 3)}, через неделю вышла в плюс`,
      `Иду на второй круг, первый закрыла с прибылью!`,
      `${amount(n, true)} шығардым, бәрі шын!`,
      `vyvela ${n / 1000}k, vse chestno, spasibo!`,
      `${amount(n / 3, true)} салдым, бір аптада ${amount(n, true)} болды, барлығыңызға кеңес беремін`,
      `Сначала не верила, а теперь всем рекомендую: ${amount(n)} уже на карте`,
    ]),
  );
}

function denialOffer(): string {
  return disguise(
    pick([
      `Это не пирамида! Официальная компания, ${pick([2, 3, 5])}% в день гарантировано, оплата на Kaspi`,
      `Мы не лохотрон, всё легально! Вложи ${amount(pick(BASE))} — через неделю заберёшь в 3 раза больше`,
      `Бұл пирамида емес! Ресми компания, күніне ${pick([2, 3, 5])}% табыс, Каспиге аударыңыз`,
      `Хватит называть нас пирамидой! У нас арбитраж, ${pick([2, 3])}% в день, лицензия есть`,
    ]),
  );
}

// --- Отрицательные (в т.ч. трудные) ---------------------------------------

function collection(): string {
  return pick([
    `Родители, скидываемся по ${amount(pick([1000, 2000, 3000, 5000]))} на подарок учителю, Kaspi ${phone()} (Айгерим Б.)`,
    `Мұғалімге сыйлыққа ${amount(pick([2000, 3000]), true)}-ден Каспиге аударыңыздар ${phone()}`,
    `На выпускной собираем по ${amount(pick([10000, 15000]))}, перевод на мой каспи до пятницы`,
    `Скиньте пожалуйста за экскурсию ${amount(5000)} на карту ${card()}`,
    `Сынып қорына ${amount(5000, true)} жинаймыз, каспи нөмірім ${phone()}`,
    `На день рождения Марата скинемся по 2000, кому удобно — на каспи`,
  ]);
}

function finance(): string {
  return pick([
    `Kaspi Депозит ${pick([12, 14, 15, 16])}% годовых, ГЭСВ ${pick(['15,1', '16,3'])}%, вклад застрахован КФГД`,
    `Halyk открыл депозит под ${pick([13, 15])}% годовых, минимальная сумма ${amount(10000)}`,
    `Кто брал ипотеку 7-20-25? Какой первоначальный взнос?`,
    `Kaspi Red рассрочка 0-0-12 на технику, удобно`,
    `Облигации на KASE дают около ${pick([14, 16])}% годовых, но надо разбираться`,
    `Жылдық ${pick([14, 15])}% депозит ашқым келеді, қай банк жақсы?`,
    `Инвестировать лучше в индексные фонды через лицензированного брокера, доходность 10-15% в год`,
  ]);
}

function warning(): string {
  return pick([
    `Осторожно! Это финансовая пирамида, не вкладывайте деньги, АФМ предупреждает`,
    `Не ведитесь на «вложи 5000 получи 10000» — это мошенники!`,
    `Абай болыңыздар, бұл қаржы пирамидасы, ақша салмаңыздар!`,
    `Мою знакомую обманули в такой группе, обещали 3% в день. Не переводите никому!`,
    `Если обещают гарантированный доход — это пирамида, сообщите в полицию 102`,
    `Будьте бдительны, мошенники пишут в WhatsApp от имени инвесткомпаний`,
    `В группах рассылают «${amount(5000, true)} салсаң, 3 күнде ${amount(15000, true)} аласың» — бұл алаяқтар!`,
    `Пишут «вложи ${amount(10000)}, через неделю заберёшь ${amount(30000)}». Не ведитесь, это пирамида`,
    `«${pick([2, 3, 5])}% в день, гарантия, перевод на Kaspi Gold» — классическая схема, не переводите деньги`,
    `Ватсапта таратып жүр: «вход ${amount(10000, true)}, выход ${amount(80000, true)}». Абай болыңыздар, сенбеңіздер`,
    `Будьте осторожны с клубом, который обещает ${pick([2, 3, 5])}% в день: лицензии АРРФР у них нет`,
    `Көршім ${amount(30000, true)} салып, ештеңе ала алмады. Ақшаңызды ешкімге аудармаңыздар`,
  ]);
}

function news(): string {
  return pick([
    `АФМ ликвидировало финансовую пирамиду в Шымкенте, ущерб ${int(50, 900)} млн тенге`,
    `В Алматы задержали организаторов пирамиды, пострадали ${int(100, 3000)} человек`,
    `Шымкентте қаржы пирамидасының ұйымдастырушылары ұсталды`,
    `Новый закон ужесточает наказание за создание финансовых пирамид`,
    `Суд вынес приговор организатору проекта, который принимал вклады под ${pick([2, 3])}% в день, ущерб ${int(100, 900)} млн тенге`,
    `Пирамида ұйымдастырушысы сотталды, ${int(200, 2000)} адам зардап шекті`,
  ]);
}

function smalltalk(): string {
  return pick([
    'Кто завтра на той?', 'Привет всем! Как дела?', 'Сәлем, қалайсыңдар?', 'Завтра собрание в 18:00, не забудьте',
    'Кто знает хорошего стоматолога в Шымкенте?', 'Ертең жиналыс бар ма?', 'Спасибо всем за поздравления 🌸', 'Фото с праздника скину вечером',
    'Есть кто едет в сторону Сайрама? Подвезите', 'Рахмет баршаңызға!', 'Сегодня жара, берегите детей', 'Кто продаёт свежий кумыс?',
  ]);
}

function ad(): string {
  return pick([
    `Продаю iPhone 13, ${amount(pick([180000, 220000, 250000]))}, Kaspi рассрочка`,
    `Скидка 20% на всё до конца дня! Магазин «Әсем», доставка по Шымкенту`,
    `Набор на курсы английского, осталось 5 мест, оплата по Kaspi QR`,
    `Сдаю квартиру посуточно, ${amount(pick([12000, 15000]))} в сутки, Kaspi перевод`,
    `Торттар жасаймыз, тапсырыс беріңіз! Каспи арқылы төлем`,
    `Акция только сегодня: второй кофе бесплатно ☕`,
  ]);
}

function legitReferral(): string {
  return pick([
    'Приведи друга в фитнес-клуб и получи месяц бесплатно',
    'Пригласите друга в наш салон — скидка 10% вам обоим',
    'Досыңды шақыр, екеуіңе де 10% жеңілдік!',
    'Реферальная программа такси: бонус за поездку друга',
    `Приводите друзей на танцы — за каждого скидка ${pick([10, 15, 20])}% на абонемент`,
    'Пригласи подругу на маникюр и получи покрытие в подарок',
    'Приходите с другом в бассейн — второй абонемент бесплатно',
    'Досыңызды әкеліңіз, сабақ тегін!',
    `Пригласи друга в приложение — оба получите по ${amount(1000)} бонусов на первый заказ`,
    'Досыңды әкел — бонус картаңа 1000 бонус түседі',
  ]);
}

// Обычные объявления с дефицитом и сроками — не пирамида: нет обещания дохода.
function legitScarcity(): string {
  return pick([
    `Набор в группу по ${pick(['шахматам', 'робототехнике', 'английскому', 'плаванию', 'рисованию'])}, осталось ${int(2, 6)} мест, первое занятие бесплатно`,
    `Билеты на концерт заканчиваются, осталось ${int(5, 30)} штук, касса в ТРЦ`,
    `Запись к врачу на субботу, осталось ${int(1, 4)} окна`,
    `Мест мало, успейте записать ребёнка в летний лагерь до ${int(10, 30)} мая`,
    `Курсы вождения: набор до конца месяца, оплата частями`,
    `Секция борьбы, последний набор в этом году, приходите на пробное`,
    `Үйірмеге ${int(3, 6)} орын қалды, тіркеліңіздер`,
    `Сегодня в ${int(17, 20)}:00 бесплатный мастер-класс, вход свободный`,
    `Шымкент — Алматы завтра в 6:00, осталось ${int(1, 3)} места, ${amount(8000)} с человека, пишите в лс`,
    `ҰБТ курсына тіркелу басталды, айына ${amount(30000, true)}, ${int(2, 5)} орын қалды`,
    'Кезегіңіз келгенде дәрігер шақырады, күте тұрыңыз',
  ]);
}

// Вопросы и пересказы: человек сомневается, а не зазывает.
function doubtMessage(): string {
  const base = pick(BASE);
  return pick([
    `Мне предлагали вложить ${amount(base)} и получить ${amount(base * 3)}, это развод?`,
    `Соседке обещали ${pick([2, 3, 5])}% в день, это реально вообще?`,
    `Кто-нибудь слышал про проект, где ${amount(base)} превращают в ${amount(base * 2)}? Похоже на обман`,
    `Маған ${amount(base, true)} салсаң екі есе аласың деді, бұл алаяқтық па?`,
    `Нам обещали 40% годовых в какой-то компании, это законно?`,
    `Я отказалась вкладывать, хотя обещали удвоение за неделю. Правильно сделала?`,
    `Мне вчера писали: вложи ${amount(base)}, через неделю получишь ${amount(base * 3)}. Я отказался, это же развод?`,
    `Знакомой предложили «${amount(base, true)} салсаң, ${amount(base * 2, true)} аласың», бұл алаяқтық па?`,
    `Сестре обещают ${pick([2, 3, 5])}% в день за вклад, как ей объяснить, что это пирамида?`,
    `Кто-нибудь слышал про клуб, где за 5 дней удваивают вклад? Подозрительно`,
    `Маған күніне ${pick([2, 3, 5])}% табыс деп жазды, сенуге бола ма?`,
    `Мошенники обещают ${pick([2, 3, 5])}% в день и просят перевести на Kaspi — не ведитесь`,
    `Апам «өзара көмек кассасына» қосылғысы келеді, ${amount(base, true)} салу керек дейді. Қауіпті емес пе?`,
    `Маған ${amount(base, true)} салсаң, ${amount(base * 3, true)} аласың деп жазды. Бұл пирамида емес пе?`,
    `Зовут в какой-то клуб: вход ${amount(base)}, обещают ${amount(base * 8)} через месяц. Звучит подозрительно`,
  ]);
}

// Законные выплаты: обсуждают зарплату, пособия, ОСМС — не «прогрев».
function legitPayout(): string {
  return pick([
    'Выплата пособия пришла сегодня, у всех пришла?',
    'Зарплата пришла, но налог вычли больше обычного',
    'Кто получил выплату по уходу за ребёнком? Когда приходит?',
    'Пенсия пришла раньше в этом месяце',
    'Стипендию перечислили, проверьте каспи',
    'Жалақы түсті ме бәріңізге?',
    'Алименты пришли наконец-то',
  ]);
}

// Объявления о работе с ежедневной оплатой — не доход «без вложений труда».
function jobDaily(): string {
  return pick([
    `Курьеры, оплата каждый день ${amount(pick([8000, 10000, 12000]))} за смену`,
    `Подработка на стройке, ${amount(15000)} в день, оплата вечером`,
    `Официант на банкеты, ${amount(10000)} за вечер плюс чаевые`,
  ]);
}

// Пирамиды-«круги» с дарением и хвастовство доходом.
function giftCircle(): string {
  const base = pick([5000, 10000, 20000]);
  return disguise(
    pick([
      `Клуб взаимопомощи: дарите ${amount(base)} получателю, через круг получаете ${amount(base * 8)} от новых участников`,
      `Ячейка из 8 человек: вносишь ${amount(base)}, когда ячейка заполнится — забираешь ${amount(base * 8)}`,
      `Касса взаимопомощи «Бірлік»: подарок ${amount(base, true)}, қайтарым ${amount(base * 6, true)}`,
      `Круг дарения открыт! Вход ${amount(base)}, выход ${amount(base * 4)}, нужен 1 приглашённый`,
      `«Цветок изобилия»: даришь ${amount(base)} тому, кто в центре. Через три круга сама в центре и получаешь ${amount(base * 8)}`,
      `Ортадағы адамға ${amount(base, true)} сыйлайсыз, шеңбер толғанда өзіңіз ортаға шығып ${amount(base * 8, true)} аласыз`,
      `Список из 10 человек: переводишь первому в списке ${amount(base)}, встаёшь в конец списка и ждёшь ${amount(base * 10)}`,
      `Тізімдегі бірінші адамға ${amount(base, true)} аударасыз, кезегіңіз келгенде ${amount(base * 10, true)} жиналады`,
    ]),
  );
}

function incomeBrag(): string {
  const stake = pick([20000, 30000, 50000]);
  return disguise(
    pick([
      `Зарабатываю по ${amount(pick([10000, 15000, 20000]))} в день на вложениях, хочешь так же — пиши`,
      `Поднимаю ${amount(pick([5000, 10000]))} в день не выходя из дома, всё через каспи`,
      `Декреттегі ана күніне ${amount(10000, true)} табады! Жазыңыз`,
      `Жобадан бір айда ${amount(stake * 6, true)} таптым, бар болғаны ${amount(stake, true)} салғанмын. Сіз де қосылғыңыз келсе, жазыңыз`,
      `Үйден шықпай айына ${amount(stake * 5, true)} табамын, ${amount(stake, true)} салып бастадым`,
      `podnyala ${(stake * 6) / 1000}k za mesyac, vlozhila vsego ${stake / 1000}k, hotite takzhe — pishite`,
    ]),
  );
}

// Приглашения на той и благодарности организаторам — «шақырамыз» не вербовка.
function toi(): string {
  return pick([
    'Құрметті ағайын! Ұлымыздың үйлену тойына шақырамыз! 15 қазан, сағат 18:00, «Алтын сарай» тойханасы',
    'Приглашаем вас на свадьбу наших детей, 20 ноября в 18:00, ресторан «Плаза»',
    'Количество приглашённых гостей 250 человек, столы на 10 персон',
    'Достар, қыз ұзатуға шақырамыз! Келіңіздер',
    'Спасибо организаторам тоя, всё было на высшем уровне!',
    'Рахмет асабаға және ұйымдастырушыларға, той керемет өтті',
    'Пригласите бабушек и дедушек на утренник в пятницу в 10:00',
    'Екі есе көп адам келді, орын жетпей қалды 😅',
  ]);
}

// Законный сетевой маркетинг: доход от продажи товара, без взносов «в кассу».
function legitMlm(): string {
  return pick([
    'Новый каталог Oriflame, скидка 20% для консультантов, заказ до пятницы',
    'Приглашаю в команду консультантов Faberlic: скидка на продукцию 30%, доход от продаж',
    'Продукция Atomy: витамины и косметика, цены ниже магазина, пишите в лс',
    'Greenway: эко-товары для дома, заказ через меня со скидкой',
    'Сетевой маркетинг — это продажи: заработок только с продаж продукции',
  ]);
}

// Магазины и банки: проценты скидок, гарантия на товар, займы — не обещание дохода.
function shop(): string {
  return pick([
    `Скидка ${pick([20, 30, 40, 50])}% до конца месяца на всю коллекцию!`,
    'Цены в 2 раза дешевле, чем на рынке! Доставка бесплатно',
    'Цены на мясо выросли в 2 раза за год, ужас',
    `iPhone 14, гарантия 1 год, ${amount(pick([250000, 300000]))}, Kaspi рассрочка`,
    'Футболки 100% хлопок, размеры S–XL, оптом и в розницу',
    '100% предоплата на заказ торта, остальное при получении',
    'Банк даёт бонус +1% к вкладу при открытии онлайн',
    'Займ под 0,5% в день без справок — кто брал? Переплата огромная',
    'Микрокредит 3% в месяц, переплата большая, не советую',
    'При оплате картой бонусы х2 на всю технику до воскресенья',
    'Кешбэк х3 на продукты в выходные, проверьте приложение',
  ]);
}

// Реальный доход от работы и бизнеса — без призыва вложить.
function businessIncome(): string {
  return pick([
    'Брат открыл кофейню, вложил 8 млн, окупилась за 3 года',
    'Взяли в аренду теплицу, за сезон выручка 2 млн, чистыми 600 тысяч',
    'Мой доход как таксиста около 300 000 в месяц, если работать каждый день',
    'Получаю зарплату 280 000 в месяц, на ипотеку уходит половина',
    'Вакансия: менеджер по продажам, доход от 300 000 до 500 000 тенге',
    'Фото салдым чатқа, қараңыздар',
  ]);
}

function job(): string {
  return pick([
    `Требуется продавец, зарплата ${amount(pick([200000, 250000, 300000]))} в месяц, график 5/2`,
    `Ищем водителя на доставку, оплата ежедневно ${amount(pick([10000, 15000]))} за смену`,
    `Жұмысқа аспаз керек, айлық ${amount(250000, true)}`,
  ]);
}

function debt(): string {
  return pick([
    'Верни мне 5000, что брал на прошлой неделе', 'Скинь пожалуйста 2000 до зарплаты, верну в пятницу',
    'Қарызыңды қайтар, 10 мың', 'Переведи мне за такси 1500 на каспи',
  ]);
}

function question(): string {
  return pick([
    'А какой минимальный вклад?', 'Как вывести деньги?', 'Это точно безопасно?', 'А есть договор?', 'Қалай қосылуға болады?',
    'Можно подробнее в лс?', 'Сколько людей уже получили?', 'А если я вложу 50к?',
  ]);
}

function complaint(): string {
  return pick([
    'Уже неделю жду выплату, где мои деньги?', 'Мне не выплатили, верните деньги!', 'Админ не отвечает, нас кинули',
    'Ақшамды қайтарыңыз, алдап кетті!', 'Вывод не приходит уже 10 дней', 'Меня удалили из группы после вопроса про выплату',
  ]);
}

const GENERATORS: Record<Kind, () => string> = {
  offer: () => pick([offerRu, offerRu, offerKk, offerMix, offerTranslit, percentOffer, rateOffer, fakePlatform])(),
  referral, push, testimonial, denial_offer: denialOffer, gift_circle: giftCircle, income_brag: incomeBrag, task_scam: taskScam,
  collection, finance, warning, news, smalltalk, ad, legit_referral: legitReferral, job, debt, question, complaint,
  legit_scarcity: legitScarcity, doubt: doubtMessage, legit_payout: legitPayout, job_daily: jobDaily,
  toi, legit_mlm: legitMlm, shop, business_income: businessIncome,
};

function langOf(text: string): Message['lang'] {
  const kk = /[әғқңөұүһі]/i.test(text);
  const cyr = /[а-яё]/i.test(text);
  const lat = /[a-z]{4,}/i.test(text.replace(/kaspi|gold|whatsapp|qr|iphone/gi, ''));
  if (lat && !cyr) return 'translit';
  if (kk && /(?<!\p{L})(?:вклад|вложи|успейте|успей|оплата|перевод|гарантия)(?!\p{L})/iu.test(text)) return 'mix';
  return kk ? 'kk' : 'ru';
}

const OPENERS = ['', '', 'Всем привет! ', 'Сәлем! ', 'Девочки, ', 'Народ, ', 'Добрый день! ', 'Қайырлы таң! '];
const CLOSERS = ['', '', ' 🙏', ' 😊', ' Спасибо!', ' Рахмет!', ' 👍', ' Кто знает?'];

function make(kind: Kind): Message {
  let text = GENERATORS[kind]().replace(/\s+/g, ' ').trim();
  if (!POSITIVE_KINDS.includes(kind) && chance(0.6)) text = `${pick(OPENERS)}${text}${pick(CLOSERS)}`.trim();
  return { text, kind, label: POSITIVE_KINDS.includes(kind) ? 1 : 0, lang: langOf(text) };
}

// --- Чаты ------------------------------------------------------------------

interface ChatMessage {
  from: string;
  text: string;
}

function pyramidChat(): ChatMessage[] {
  const shuffled = [...NAMES].sort(() => rand() - 0.5);
  const organizer = `${shuffled[0]} ${pick(['Куратор', 'Admin', 'Инвест', '💎'])}`;
  const curators = shuffled.slice(1, 1 + int(1, 2));
  const reviewers = shuffled.slice(3, 3 + int(3, 5));
  const members = shuffled.slice(8, 8 + int(3, 6));
  const template = push();
  const out: ChatMessage[] = [{ from: organizer, text: make('offer').text }];
  for (const curator of curators) out.push({ from: curator, text: template.replace(/\d+ места?/, `${int(2, 4)} места`) });
  for (let i = 0; i < int(8, 18); i++) {
    const roll = rand();
    if (roll < 0.3) out.push({ from: pick(reviewers), text: make('testimonial').text });
    else if (roll < 0.5) out.push({ from: pick(members), text: make('question').text });
    else if (roll < 0.62) out.push({ from: organizer, text: pick([make('offer'), make('referral'), make('denial_offer')]).text });
    else if (roll < 0.75) out.push({ from: pick(curators), text: chance(0.5) ? template : make('push').text });
    else out.push({ from: pick(members), text: make('smalltalk').text });
  }
  if (chance(0.5)) for (let i = 0; i < int(1, 3); i++) out.push({ from: pick(members), text: make('complaint').text });
  return out;
}

function legitChat(): ChatMessage[] {
  const shuffled = [...NAMES].sort(() => rand() - 0.5);
  const people = shuffled.slice(0, int(4, 9));
  const theme = pick(['parents', 'business', 'finance', 'friends', 'courses', 'toi', 'shop']);
  const mix: Record<string, Kind[]> = {
    parents: ['collection', 'smalltalk', 'smalltalk', 'question', 'collection', 'warning'],
    business: ['ad', 'ad', 'smalltalk', 'job', 'legit_referral', 'legit_mlm', 'business_income'],
    finance: ['finance', 'finance', 'warning', 'news', 'smalltalk', 'question', 'doubt', 'shop'],
    friends: ['smalltalk', 'smalltalk', 'debt', 'smalltalk', 'news', 'business_income'],
    courses: ['ad', 'smalltalk', 'question', 'legit_referral', 'collection', 'legit_scarcity'],
    toi: ['toi', 'toi', 'collection', 'smalltalk', 'smalltalk'],
    shop: ['shop', 'shop', 'ad', 'legit_referral', 'question'],
  };
  const out: ChatMessage[] = [];
  for (let i = 0; i < int(10, 25); i++) out.push({ from: pick(people), text: make(pick(mix[theme])).text });
  return out;
}

function toTelegram(name: string, messages: ChatMessage[], startDay: number): object {
  const ids = new Map<string, string>();
  return {
    name,
    type: 'private_supergroup',
    messages: messages.map((m, i) => {
      if (!ids.has(m.from)) ids.set(m.from, `user${1000 + ids.size}`);
      const date = new Date(Date.UTC(2026, 8, startDay, 9, 0) + i * 37 * 60_000).toISOString().slice(0, 19);
      return { id: i + 1, type: 'message', date, from: m.from, from_id: ids.get(m.from), text: m.text };
    }),
  };
}

// --- Запись ----------------------------------------------------------------

const PLAN: [Kind, number][] = [
  ['offer', 300], ['referral', 80], ['push', 70], ['testimonial', 100], ['denial_offer', 30], ['gift_circle', 40], ['income_brag', 30], ['task_scam', 50],
  ['collection', 80], ['finance', 70], ['warning', 70], ['news', 30], ['smalltalk', 110], ['ad', 70], ['legit_referral', 60], ['job', 30], ['debt', 30], ['question', 50], ['complaint', 40],
  ['legit_scarcity', 80], ['doubt', 110], ['legit_payout', 50], ['job_daily', 30], ['toi', 40], ['legit_mlm', 30], ['shop', 50], ['business_income', 30],
];

mkdirSync('data/train/chats', { recursive: true });
const seen = new Set<string>();
const messages: Message[] = [];
for (const [kind, count] of PLAN) {
  let attempts = 0;
  for (let made = 0; made < count && attempts < count * 20; attempts++) {
    const message = make(kind);
    if (seen.has(message.text)) continue;
    seen.add(message.text);
    messages.push(message);
    made++;
  }
}
writeFileSync('data/train/messages.jsonl', messages.map((m) => JSON.stringify(m)).join('\n') + '\n');

const labels: Record<string, { label: 0 | 1; theme: string }> = {};
for (let i = 0; i < 45; i++) {
  const file = `pyramid_${String(i + 1).padStart(2, '0')}.json`;
  writeFileSync(`data/train/chats/${file}`, JSON.stringify(toTelegram(`Инвест клуб ${i + 1}`, pyramidChat(), 1 + (i % 25)), null, 1));
  labels[file] = { label: 1, theme: 'pyramid' };
}
for (let i = 0; i < 45; i++) {
  const file = `legit_${String(i + 1).padStart(2, '0')}.json`;
  writeFileSync(`data/train/chats/${file}`, JSON.stringify(toTelegram(`Группа ${i + 1}`, legitChat(), 1 + (i % 25)), null, 1));
  labels[file] = { label: 0, theme: 'legit' };
}
writeFileSync('data/train/chats/labels.json', JSON.stringify(labels, null, 2));

const positives = messages.filter((m) => m.label === 1).length;
console.log(`сообщений: ${messages.length} (признаки пирамиды: ${positives}, обычные: ${messages.length - positives}), чатов: ${Object.keys(labels).length}`);
const byLang: Record<string, number> = {};
for (const m of messages) byLang[m.lang] = (byLang[m.lang] ?? 0) + 1;
console.log('по языкам:', byLang);
void readFileSync;
