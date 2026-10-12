
var SHEET_NAME = 'Реестр багов';

var COLUMNS = { id: 1, status: 14, fixedAt: 17, commit: 19, what: 20, comment: 25 };

var UPDATES = {
  "BUG-001": {
    "status": "На проверке (QA)",
    "fixedAt": "10.10.2026",
    "commit": "b6fe6bc",
    "what": "Тёмная тема: белая карточка шага 2 «Частота полива» и соседние светлые поверхности не перекрашивались. Добавлены правила в addPlants/dark-theme.css для .wateringFrequency, .wateringPreset, .customSchedule, .askAI, .wateringWeekday.",
    "comment": "Нужна проверка на iPhone в тёмной теме: шаг 2 «Частота полива»."
  },
  "BUG-005": {
    "status": "На проверке (QA)",
    "fixedAt": "10.10.2026",
    "commit": "b6fe6bc",
    "what": "Плашка «Настройки cookie» показывалась на всех страницах, кроме /home, и после согласия читалась как неисчезнувшее уведомление. Теперь она не выводится на /login и /register, где согласия вынесены в саму форму.",
    "comment": "Проверить: согласиться с cookie на /login — уведомление и плашка исчезают."
  },
  "BUG-008": {
    "status": "На проверке (QA)",
    "fixedAt": "10.10.2026",
    "commit": "b6fe6bc",
    "what": "Диалог ИИ-подсказки (.wateringAdviceDialog) оставался светлым в тёмной теме: перекрашены оболочка диалога, шапка, кнопка закрытия и подписи.",
    "comment": "Нужна проверка на iPhone в тёмной теме: шаг 2 → «Спросить ИИ»."
  },
  "BUG-009": {
    "comment": "Нужны уточнения: в отчёте не заполнены шаги воспроизведения, ожидаемый и фактический результат, серьёзность, приоритет и окружение. Без них баг не воспроизводится — добавьте, пожалуйста, шаги, экран/разрешение и скриншот."
  },
  "BUG-010": {
    "status": "Исправлен",
    "fixedAt": "10.10.2026",
    "commit": "b6fe6bc",
    "what": "Причина: просроченная позиция расписания одновременно считалась плановой. Теперь прошедшие позиции расписания не попадают в план (partitionScheduleDates), у дня одна согласованная отметка (resolveWateringMarkers), просрочка считается до первого полива после слота.",
    "comment": "Повторное закрытие: коммит b92f5e7 причину не устранил. Покрыто юнит-тестами (Frontend/src/utils/date.test.js, Backend/utils/wateringSchedule.test.js)."
  },
  "BUG-011": {
    "status": "Исправлен",
    "fixedAt": "10.10.2026",
    "commit": "b6fe6bc",
    "what": "Просроченный полив больше не «пропадает»: дата остаётся помеченной как пропущенная, карточка дня открывается с событием «Просрочено/Пропущено», а просрочка не застревает на «1 день» — считается до текущего момента либо до первого полива после слота.",
    "comment": "Повторное закрытие: коммит b92f5e7 причину не устранил. Проверено на сценарии из отчёта (интервал 2 дня, пропуски 7 и 9 октября)."
  },
  "BUG-012": {
    "status": "На проверке (QA)",
    "fixedAt": "10.10.2026",
    "commit": "b6fe6bc",
    "what": "На странице профиля секция «Мои растения» была пустой: заголовок и ссылка «Все» без списка. Пустой блок убран, список растений доступен в разделе «Мои растения».",
    "comment": "Нужна проверка на WEB, Chrome, full hd."
  },
  "BUG-013": {
    "status": "На проверке (QA)",
    "fixedAt": "10.10.2026",
    "commit": "b6fe6bc",
    "what": "Вёрстка «ехала» из-за отступов в процентах от ширины окна (margin 10%/5%, padding 3%): проценты заменены на px, контент ограничен 480px и центрирован, форма больше не растягивается на широком экране.",
    "comment": "Нужна проверка на WEB 1920×1080."
  },
  "BUG-014": {
    "status": "На проверке (QA)",
    "fixedAt": "10.10.2026",
    "commit": "b6fe6bc",
    "what": "Верхний блок с кнопкой «Назад» уходил под чёлку: в отступы страницы добавлен env(safe-area-inset-*), включая мобильные media-запросы.",
    "comment": "Нужна проверка на iPhone, в том числе в установленном PWA."
  },
  "BUG-017": {
    "status": "На проверке (QA)",
    "fixedAt": "10.10.2026",
    "commit": "b6fe6bc",
    "what": "В альбомной ориентации календарь растягивался на всю ширину и не приходил в норму после возврата в портретную. Добавлен ландшафтный режим: мобильная колонка держится шириной до 520px по центру. Блокировка поворота уже запрошена в манифесте (orientation: portrait-primary), но iOS её игнорирует, поэтому нужен именно устойчивый ландшафтный layout.",
    "comment": "Нужна проверка на iPhone: повернуть в альбомную ориентацию и обратно."
  },
  "BUG-018": {
    "status": "На проверке (QA)",
    "fixedAt": "10.10.2026",
    "commit": "b6fe6bc",
    "what": "Причина: у .screenTransition стоял will-change: transform, из-за чего он становился containing block для position: fixed — модалка дня позиционировалась от прокручиваемого блока (уезжала при скролле), а нижнее меню рисовалось поверх оверлея. Модалка перенесена в портал к body, will-change заменён на opacity, прокрутка фона блокируется через body.vision-open.",
    "comment": "Нужна проверка на iPhone: открыть день с поливом, прокрутить, посмотреть на нижнее меню."
  },
  "BUG-019": {
    "status": "Исправлен",
    "fixedAt": "10.10.2026",
    "commit": "b6fe6bc",
    "what": "Дни недели подсвечивались все сразу, если частота полива не кратна неделе. Теперь: 7 и 14 дней → конкретный день недели первого полива, «каждый день» → все дни, смещающийся график (3, 4, 10 дней) → ограничение по дням не накладывается, в интерфейсе появилось пояснение.",
    "comment": "Проверено юнит-тестами: Frontend/src/utils/date.test.js (reminderWeekdaysForInterval), 9 тестов — все проходят."
  }
};

function applyBugTrackerUpdates() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error('Лист «' + SHEET_NAME + '» не найден');

  var lastRow = sheet.getLastRow();
  var ids = sheet.getRange(2, COLUMNS.id, lastRow - 1, 1).getValues();
  var applied = [];

  for (var i = 0; i < ids.length; i++) {
    var id = String(ids[i][0]).trim();
    var update = UPDATES[id];
    if (!update) continue;

    var row = i + 2;
    var changed = [];
    ['status', 'fixedAt', 'commit', 'what', 'comment'].forEach(function (key) {
      if (update[key] === undefined) return;
      var column = COLUMNS[key];
      var value = key === 'fixedAt' ? parseRuDate(update[key]) : update[key];
      if (String(sheet.getRange(row, column).getDisplayValue()).trim() === String(update[key]).trim()) return;
      sheet.getRange(row, column).setValue(value);
      changed.push(key);
    });
    if (changed.length) applied.push(id + ' (' + changed.join(', ') + ')');
  }

  var message = applied.length
    ? 'Обновлено: ' + applied.join('; ')
    : 'Все строки уже заполнены — изменений нет';
  Logger.log(message);
  SpreadsheetApp.getUi().alert(message);
}

function parseRuDate(text) {
  var parts = String(text).split('.');
  if (parts.length !== 3) return text;
  return new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
}
