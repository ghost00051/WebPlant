var SHEET_NAME = 'Реестр багов';

var NEW_BUGS_20261013 = [
  {
    id: 'BUG-020',
    discoveredAt: '13.10.2026',
    tester: 'Никитин Иван',
    type: 'Логика/расчёт',
    component: 'Frontend',
    screen: '/home, /api/plants/timeline, /api/plants/schedule',
    title: 'В карточке дня видно только одно растение из трёх, а просрочка появляется раньше конца суток',
    steps: '1. Войти в приложение 2. Добавить три растения с временем полива «утро» на сегодня 3. Не поливать их 4. Нажать на сегодняшнюю дату в календаре 5. Сравнить список в карточке дня со списком «Сегодня нужно полить»',
    expected: 'В карточке дня видны все растения дня: неполитые — как план дня (с временем полива), просроченные — как «Просрочено», политые — как «Полито». Пока сутки слота не закончились (до 24:00 по Москве), растение просроченным не считается',
    actual: 'Показывается только одно растение (первое просроченное), остальные растения дня исчезают; растение помечается просроченным сразу после времени слота',
    severity: 'Critical',
    priority: 'P1 - Критический',
    environment: 'WEB, Chrome, full hd (тёмная тема)',
    status: 'Исправлен',
    assignee: 'Никитин И.',
    dueAt: '13.10.2026',
    fixedAt: '13.10.2026',
    commit: '',
    what: 'Причина: день с просроченным событием помечался как «прошедший», поэтому план дня из карточки выпадал — оставалось одно просроченное растение. Теперь день собирается функцией buildDayView (Frontend/src/utils/date.js): события и план живут вместе, растение не дублируется. Просрочка наступает только после конца суток слота — 00:00 МСК следующих суток (Backend/utils/wateringSchedule.js: isWateringMissed/wateringMissDeadline), применяется в /api/plants/timeline, /api/plants/schedule (поле is_missed — готовый признак для фронтенда) и в календаре. Время полива (9:00/14:00/19:00) считается по московским часам, а не по часам контейнера (в Kubernetes UTC утренний слот уезжал на 11:00 МСК); группировка событий идёт по московским суткам. Покрыто тестами plantController.timeline.test.js, wateringSchedule.test.js, Frontend/src/utils/date.test.js (включая прогон в чужих таймзонах)',
    comment: 'Проверить: 3 растения на сегодня — в течение дня все три «ждут полива», после 24:00 МСК все три «Просрочено» без дублей. У уже сохранённых расписаний время станет московским после ближайшего полива'
  },
  {
    id: 'BUG-021',
    discoveredAt: '13.10.2026',
    tester: 'Никитин Иван',
    type: 'Производительность',
    component: 'Backend + Frontend',
    screen: '/home, блок plantsPreview__photoWrap, /uploads/plants/*',
    title: 'Очень долгая загрузка фотографий при открытии даты в календаре',
    steps: '1. Войти в приложение 2. Нажать на дату с поливом в календаре 3. Наблюдать за блоком plantsPreview__photoWrap (превью 40×40 px) 4. Повторить открытие даты',
    expected: 'Превью появляются сразу, при повторном открытии даты фотографии берутся из кэша',
    actual: 'В превью 40×40 px грузятся оригиналы 2–5 МБ (4032×3024), каждое открытие даты тянет мегабайты заново',
    severity: 'Major',
    priority: 'P2 - Высокий',
    environment: 'WEB, Chrome, full hd (тёмная тема), мобильная сеть',
    status: 'Исправлен',
    assignee: 'Никитин И.',
    dueAt: '13.10.2026',
    fixedAt: '13.10.2026',
    commit: '',
    what: 'Причина: в превью подставлялся photo_url оригинала, а /uploads отдавался без кэширования. Теперь при загрузке создаётся миниатюра 160×160 (Backend/utils/plantPhotoThumb.js, sharp, ~5–6 КБ), старые фото получают миниатюру на первом запросе (plantThumbRequestHandler), есть бэкфилл Backend/scripts/generate-plant-thumbs.mjs. uploads отдаётся статикой с max-age=31536000, immutable. Фронтенд берёт миниатюру через plantThumbUrl/PlantPhoto с откатом на оригинал. Замер: 8456 КБ оригиналов → 17 КБ миниатюр',
    comment: 'sharp — необязательная зависимость: без неё приложение работает с оригиналами, поэтому нужен пересбор образа (npm ci). Проверить: открыть дату, затем открыть повторно — фото мгновенно, в Network превью 5–6 КБ'
  },
  {
    id: 'BUG-022',
    discoveredAt: '13.10.2026',
    tester: 'Никитин Иван',
    type: 'Логика/расчёт',
    component: 'Backend + Frontend',
    screen: '/home, /settings, /api/plants/schedule, /api/users/me',
    title: 'Время полива и просрочка считались по Москве, для клиента из другого часового пояса сервис работал неверно',
    steps: '1. Зайти с устройства в поясе, отличном от Москвы (например, Владивосток) 2. Добавить растение «утро» 3. Смотреть время полива, напоминание и момент перехода в «Просрочено» 4. Сравнить с местными часами',
    expected: '«9:00 / 14:00 / 19:00», сутки просрочки и утренняя сводка считаются по часовому поясу пользователя; напоминание приходит в его 9:00',
    actual: 'Всё считалось по Москве: подписанное «9:00» наступало в 16:00 по Владивостоку, пуш приходил в 16:00, просрочка — по московской полуночи (07:00 местного)',
    severity: 'Major',
    priority: 'P2 - Высокий',
    environment: 'WEB, Chrome; пояса UTC+2…UTC+12',
    status: 'Исправлен',
    assignee: 'Никитин И.',
    dueAt: '13.10.2026',
    fixedAt: '13.10.2026',
    commit: '',
    what: 'У пользователя появился часовой пояс (IANA, users.timezone, миграция 20261013_add_user_timezone.sql): фронтенд определяет пояс устройства и сохраняет его в профиль. В нём считаются время полива 9:00/14:00/19:00, сутки просрочки (isWateringMissed), ключи дней календаря, граница «Сегодня нужно полить» и утренняя сводка (9:00 по местному времени пользователя). Разовый скрипт Backend/scripts/normalize-watering-hours.mjs приводит старые расписания (dry-run по умолчанию, --apply для записи): по проду 16 из 16 растений имели смещение +3 ч. Покрыто тестами timeZone.test.js, wateringNormalization.test.js, plantController.timeline.test.js (Владивосток), reminderService.test.js',
    comment: 'Порядок выката: 1) миграция users.timezone 2) backend+frontend 3) normalize-watering-hours.mjs (сначала dry-run, затем --apply). Проверить на устройстве во Владивостоке'
  }
];

function appendNewBugs20261013() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error('Лист «' + SHEET_NAME + '» не найден');

  var lastRow = sheet.getLastRow();
  var existingIds = lastRow > 1
    ? sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues().map(function (row) { return String(row[0]).trim(); })
    : [];

  var appended = [];

  NEW_BUGS_20261013.forEach(function (bug) {
    if (existingIds.indexOf(bug.id) !== -1) return;

    var row = new Array(25).fill('');
    row[0] = bug.id;
    row[1] = bug.discoveredAt;
    row[2] = bug.tester;
    row[3] = bug.type;
    row[4] = bug.component;
    row[5] = bug.screen;
    row[6] = bug.title;
    row[7] = bug.steps;
    row[8] = bug.expected;
    row[9] = bug.actual;
    row[10] = bug.severity;
    row[11] = bug.priority;
    row[12] = bug.environment;
    row[13] = bug.status;
    row[14] = bug.assignee;
    row[15] = parseRuDate(bug.dueAt);
    row[16] = parseRuDate(bug.fixedAt);
    row[17] = '';
    row[18] = bug.commit;
    row[19] = bug.what;
    row[20] = '';
    row[21] = '';
    row[22] = '';
    row[23] = '';
    row[24] = bug.comment;

    sheet.appendRow(row);
    appended.push(bug.id);
  });

  var message = appended.length
    ? 'Добавлены баги: ' + appended.join(', ')
    : 'BUG-020 и BUG-021 уже есть в реестре — изменений нет';
  Logger.log(message);
  SpreadsheetApp.getUi().alert(message);
}

function parseRuDate(text) {
  var parts = String(text).split('.');
  if (parts.length !== 3) return text;
  return new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
}
