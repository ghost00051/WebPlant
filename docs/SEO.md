# SEO: эксплуатация, панели и деплой

Документ описывает, как устроено SEO «Лейки», как проверять изменения и что делать в Яндекс.Вебмастере и Google Search Console.

## 1. Где что лежит

| Что | Файл |
|---|---|
| Шаблон `head` (title/description/canonical/OG/Twitter/JSON-LD главной, verification) | `Frontend/index.html` |
| Генератор title/description для карточек и статей + проверка уникальности | `Frontend/scripts/generate-seo-meta.mjs` → `Frontend/src/data/seoMeta.js` |
| Пререндер indexable страниц, JSON-LD, sitemap, приватные заглушки | `Frontend/scripts/prerender.mjs` |
| Мета разделов (главная, `/plants`, `/care`), карта топиков, FAQ хаба | `Frontend/src/data/siteMap.js` |
| Метаданные при клиентской навигации | `Frontend/src/component/SeoMetadata/SeoMetadata.jsx`, `Frontend/src/utils/seo.js` |
| Перелинковка (шапка, футер, крошки) | `Frontend/src/component/{SiteHeader,SiteFooter,ContentPage}/` |
| 404 | `Frontend/public/404.html`, `ErrorDocument 404` в `Frontend/htaccess` |
| robots.txt | `Frontend/public/robots.txt` |
| Clean URLs, 301, кеш, сжатие (Apache-хостинг) | `Frontend/htaccess` (копируется в `dist/.htaccess` при сборке) |
| Эталонный nginx-конфиг сайта | `Backend/nginx/conf.d/checktheplants-frontend.conf.example` |
| IndexNow | `Frontend/scripts/indexnow.mjs` + `Frontend/public/<key>.txt` |
| Проверки | `Frontend/scripts/verify-build.mjs`, `verify-routing.mjs`, `seo-check.mjs`, `seo-audit.mjs` |

## 2. Локальная проверка перед выкладкой

```powershell
cd Frontend
npm run build
npm run verify
node scripts/seo-check.mjs
node scripts/seo-audit.mjs --json=seo-audit-live.json
```

`seo-check.mjs` падает, если: дубли title/description, title > 90 или description > 200 символов, canonical не совпадает с URL, h1 не один, на странице нет нужного типа JSON-LD, `<img>` без `alt`, в sitemap есть не-200 URL или lastmod из будущего, robots.txt без `Clean-param`, `.htaccess` без `DirectorySlash Off`/`ErrorDocument`.

## 3. Хостинг: clean URLs, 404, кеш, brotli

### 3.1 Apache (текущая схема: FTP-выгрузка `Frontend/dist`)

`dist/.htaccess` уже содержит: `DirectorySlash Off` (иначе реальный каталог `dist/plants/` с SVG перехватывает маршрут `/plants` и Apache отдаёт 301 на `/plants/`), `Options -Indexes`, 301 для `*.html`-дублей, `ErrorDocument 404 /404.html`, `Cache-Control: immutable` для `/assets/`, `mod_deflate` и `mod_brotli`.

Если после выкладки `/plants` всё ещё отдаёт 301 — на хостинге не подключён `mod_dir`-контекст для `.htaccess` либо nginx стоит перед Apache и добавляет слэш сам. Проверка:

```powershell
curl.exe -s -o NUL -D - -A "Mozilla/5.0" https://checktheplants.ru/plants | Select-String '^HTTP/|^[Ll]ocation:'
```

Ожидаемо: `HTTP/1.1 200 OK` без `Location`.

### 3.2 nginx (если сайт переезжает с Apache)

Готовый server-блок: `Backend/nginx/conf.d/checktheplants-frontend.conf.example`. Он закрывает: http→https без порта в `Location`, www→apex, clean URLs без trailing-slash редиректов, `error_page 404 /404.html`, `brotli on` + `gzip`, `immutable` для `/assets/`, `no-cache` для `sw.js` и HTML, security-заголовки.

Порядок внедрения:

1. Положить файл в `/etc/nginx/conf.d/` **без** суффикса `.example`, поправить `root` на каталог с `dist`.
2. CSP брать из `Frontend/htaccess` **дословно** (там sha256-хеши инлайн-скриптов; при изменении инлайн-скриптов в `index.html` хеши пересчитываются, см. `scripts/check-security-headers.mjs`).
3. `nginx -t && nginx -s reload`, затем прогнать `seo-audit.mjs` — в отчёте не должно быть не-200 URL в sitemap и «голых» 404.
4. Проверить `curl -I https://checktheplants.ru/assets/<любой>.js` → `content-encoding: br` и `cache-control: public, max-age=31536000, immutable`.

### 3.3 Чистые URL и дубли по слэшу

Канонический вид — **без слэша**: `/plants`, `/care`, `/plants/<slug>`, `/care/<slug>`, `/login` и т. д. `canonical` в HTML всегда без слэша. Сейчас `/plants/`, `/care/`, `/plants/<slug>/`, `/login/` отдают 200 (не 301): это не критично при корректном canonical, но 301-нормализация включается только вместе с настройкой хоста (иначе возможен цикл с прод-nginx). Задача — в бэклоге плана (T-10).

## 4. Яндекс.Вебмастер: пошагово

Доступы выдаёт владелец сайта (нужен аккаунт Яндекса с правами на `checktheplants.ru`).

1. **Добавить сайт**: <https://webmaster.yandex.ru> → «Добавить сайт» → `https://checktheplants.ru`.
2. **Подтвердить права.** Мета-тег уже стоит в `Frontend/index.html`: `<meta name="yandex-verification" content="3eb0439788e93078">`. Жмём «Проверить» — должен пройти сразу. Альтернативы: DNS TXT-запись (если есть доступ к DNS) или файл в корне `public/` (тогда добавить `Frontend/public/yandex_<id>.html` и выложить).
3. **Регион.** «Настройки» → «Региональность» → указать регион (Москва, если сервис без географической привязки; для RU-аудитории регион не критичен, но для «комнатные растения» без региона Яндекс может показывать хуже). Регион нельзя изменить без переподтверждения — выбрать сразу осознанно.
4. **Sitemap.** «Индексирование» → «Файлы Sitemap» → `https://checktheplants.ru/sitemap.xml`. После выкладки новой сборки — либо ждать переобхода, либо переобход вручную (п. 5).
5. **Переобход страниц.** «Индексирование» → «Переобход страниц» — до 500 URL в сутки на очередь: вставлять `https://checktheplants.ru/plants`, `/care`, изменённые статьи и карточки.
6. **IndexNow.** «Индексирование» → «IndexNow» — после `npm run indexnow -- --engine=yandex` здесь появится история отправок и результат.
7. **Диагностика.** «Диагностика» → «Ошибки», «Безопасность», «Мобильные страницы», «Микроразметка», «Скорость сайта». Что считать нормой: 0 критичных ошибок индексирования, 0 «Запрещено в robots», страницы с микроразметкой `Article`/`FAQPage`/`BreadcrumbList` — без ошибок «некорректный элемент».
8. **Страницы в поиске.** «Индексирование» → «Страницы в поиске»: добавить `https://checktheplants.ru/plants`, `/care`, `/plants/*`, `/care/*` и следить, чтобы в «Исключённые» не попадали indexable URL с причиной «Дубликат» или «Запрещено robots».
9. **Цели Метрики.** В Метрике (счётчик `113420950`) создать цели: `register_success` (JS-событие), `add_plant_success`, `activation`, `cta_click` (по событию `cta_click` с параметром `cta_id`). Тогда в Вебмастере в «Отчётах» подтянется поведение поискового трафика и конверсия.
10. **Регулярно**: «Поисковые запросы» (Wordstat-подобная статистика) — раз в неделю выгружать запросы с показами и CTR, добавлять в контент-план.

## 5. Google Search Console: пошагово

1. **Добавить ресурс**: <https://search.google.com/search-console> → «Domain» (нужна DNS TXT) или «URL prefix» `https://checktheplants.ru/`.
2. **Подтверждение.** Для URL-prefix — «HTML-тег»: скопировать `<meta name="google-site-verification" content="...">` и вставить в `Frontend/index.html` сразу после `yandex-verification`, затем собрать и выложить (`npm run build`, FTP). Для домена — DNS TXT-запись.
3. **Sitemap.** «Индексирование» → «Файлы Sitemap» → `sitemap.xml`.
4. **Проверка URL.** «Проверка URL» для `/`, `/plants`, `/care`, `/plants/monstera`, `/care/kak-chasto-polivat`, `/care/pochemu-zhelteyut-listya` → «Запросить индексирование». После правок мета — запрашивать повторно.
5. **Показатели Core Web Vitals** («Опыт»): следить за LCP/INP/CLS по группе «Мобильные». Пока в отчёте «Недостаточно данных» — нормально для молодого сайта; наполнение идёт от полевых данных.
6. **Разметка**: «Элементы» (Enhancements) — `Breadcrumbs`, `Articles`, `FAQ`. Ошибки «Missing field datePublished» после этой итерации должны уйти (добавлен `datePublished`).
7. **Ссылки**: «Ссылки» → смотреть внешние ссылки и топ-страницы-доноры; задач по закупке ссылок нет, только органика и упоминания (см. план §8).

## 6. IndexNow

```powershell
cd Frontend
npm run indexnow:dry
npm run indexnow -- --engine=yandex
npm run indexnow -- --engine=bing
npm run indexnow
npm run indexnow -- /plants /care /care/kak-chasto-polivat
```

Перед отправкой скрипт проверяет, что `https://checktheplants.ru/3f0da0a5bc6aedf1bb31377e2b2b61ba.txt` отдаёт 200 и содержит ключ. Запускать **после** выкладки. Регламент: после каждого релиза контента — отправить изменённые URL; после крупных правок — полный список.

## 7. Яндекс.Метрика: что проверить/настроить

* Счётчик `113420950`, инициализация — только после согласия на cookie (`CookieConsentManager`). Вебвизор отключён на `/login`, `/register`, `/reset-password`.
* Цели (тип «JavaScript-событие»): `register_success`, `add_plant_success`, `care_action_created`, `cta_click` (параметр `cta_id`: `plant_follow`, `watering_calculator`, `photo_diagnosis`), `share_garden`.
* Отчёты для SEO: «Источники, сводка» → «Переходы из поисковых систем», «Поисковые запросы» (Метрика показывает запросы Яндекса), «Страницы входа», «Вебвизор» для целевых страниц (`/care/kak-chasto-polivat`, `/care/pochemu-zhelteyut-listya`, `/plants/*`).
* Связать Метрику с Вебмастером: «Настройка» → «Доступ к данным Вебмастера» (или в Вебмастере — «Интеграция с Метрикой»), иначе не будет конверсий из поиска в отчётах.

## 8. Регламент после деплоя

1. `node scripts/seo-check.mjs` — обязательно зелёный на `dist`.
2. FTP-выгрузка `dist` (см. `DEPLOY.md`).
3. `node scripts/seo-audit.mjs` — проверить: все URL sitemap = 200, `/plants` без 301, 404 отдаёт `/404.html`, canonical совпадает.
4. `npm run indexnow -- --engine=yandex` (и при желании `--engine=bing`).
5. Вебмастер: переобход изменённых страниц (если нужно быстрее, чем IndexNow).
6. Через 3–7 дней: Вебмастер «Страницы в поиске» и «Поисковые запросы», Search Console «Покрытие»/«Эффективность» — фиксировать в KPI-таблице плана.

## 9. Известные ограничения

* Регион и подтверждение прав в панелях — только владелец аккаунта; из репозитория это не настраивается.
* Прод-nginx основного домена не в репозитории: часть правок (301 `/plants`, 404, brotli, immutable) применяется на хостинге по инструкции §3.
* Микроразметка при клиентской навигации в браузере не обновляется (статический HTML конкретного URL — корректен). Задача в бэклоге плана (T-11).
