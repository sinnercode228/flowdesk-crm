# FlowDesk

English version: [README.md](README.md)

![Дашборд FlowDesk: открытая воронка, взвешенный прогноз, выручка по месяцам, конверсия по стадиям, результаты менеджеров](docs/screenshots/dashboard.png)

Мини-CRM для отдела продаж: канбан сделок, контакты, карточка сделки с заметками и историей, дашборд, роли admin и manager. Фронтенд на Next.js со статическим экспортом ходит в API на Fastify и Prisma, а между ними общий пакет с zod-контрактом, политикой прав и функциями аналитики.

Это демо-проект на сгенерированных данных, а не продукт для клиента. Название FlowDesk выдумано, все компании, контакты и сделки выдаёт детерминированный генератор в [`packages/shared/src/demo-data.ts`](packages/shared/src/demo-data.ts): e-mail на зарезервированных доменах `.example`, телефоны из зарезервированного диапазона 555-01XX.

Демо: https://sinnercode228.github.io/flowdesk-crm/ — тот же REST-API работает прямо в браузере, состояние лежит в localStorage, бэкенда за ним нет. Форма входа уже заполнена учёткой admin, кнопка Manager подставляет вторую (`admin@flowdesk.example` и `manager@flowdesk.example`, пароль у обоих `demo1234`). Кнопка Reset data в шапке возвращает исходные данные.

## Гонка за refresh-токеном

Access-токен — JWT на 15 минут: HS256 через `jose`, при проверке алгоритм зафиксирован, issuer и audience сверяются. Refresh-токен — не JWT, а 32 случайных байта в base64url; он одноразовый и живёт 7 дней (сроки задаются `JWT_ACCESS_TTL` и `REFRESH_TOKEN_TTL_DAYS`). В базе лежит только его SHA-256 ([`server/src/lib/tokens.ts`](server/src/lib/tokens.ts)), так что дамп таблицы `RefreshToken` готовых токенов не даёт. Медленный хэш для 256 случайных бит не нужен.

`POST /api/auth/refresh` отзывает предъявленный токен и выдаёт новую пару с тем же `familyId`, общим для всех токенов одного логина; `replacedById` связывает каждую строку с её преемником. Если на refresh приходит уже отозванный токен, его отправил второй раз либо сам клиент, либо тот, кто его скопировал. Кто из них настоящий, сервер не знает, поэтому отзывает всю семью и отвечает `401 TOKEN_REUSED`, и войти заново придётся обоим ([`auth.service.ts:38-41`](server/src/modules/auth/auth.service.ts#L38-L41)). Другие сессии пользователя это не задевает, у них свои семьи. Цепочку «ротация → повтор старого токена → новый тоже отклонён» проверяют и тесты API, и тесты демо.

Из-за этого правила обычная гонка на клиенте превращается в выход из системы. Дашборд отправляет четыре запроса параллельно (`useAnalytics`, [`web/src/hooks/queries.ts:58`](web/src/hooks/queries.ts#L58)). Если access истёк, все четыре получают 401. Пойди каждый из них за новой парой сам, первый refresh прошёл бы, остальные три принесли бы только что отозванный токен, сервер счёл бы это кражей, отозвал семью, и пользователь оказался бы на странице входа. В `ApiClient` это закрыто одним общим промисом: `refresh()` кладёт запрос в `this.refreshing` через `??=`, параллельные 401 ждут его и повторяют себя с новым access-токеном ([`web/src/lib/api/client.ts:67-84`](web/src/lib/api/client.ts#L67-L84)). В [`client.test.ts:27-38`](web/src/lib/api/client.test.ts#L27-L38) два запроса уходят с истёкшим access-токеном, и до `/auth/refresh` доходит ровно один вызов.

Сервер на это не полагается. Два запроса с одним живым токеном оба прочитают его с `revokedAt = null`, и без защиты каждый выпустил бы по новой паре: у семьи появились бы две рабочие ветки. От этого защищает условное обновление внутри транзакции ([`auth.service.ts:44-60`](server/src/modules/auth/auth.service.ts#L44-L60)):

```ts
return this.prisma.$transaction(async (tx) => {
  // Conditional update guards against two concurrent refreshes with the same token.
  const { count } = await tx.refreshToken.updateMany({
    where: { id: stored.id, revokedAt: null },
    data: { revokedAt: now },
  });
  if (count !== 1)
    throw unauthorized('Refresh token reuse detected, please log in again', 'TOKEN_REUSED');
```

Строку обновит только один запрос. Второй увидит `count === 0` и получит `401 TOKEN_REUSED`, второй пары не появится. Чего это не закрывает — две вкладки одной сессии и тест с действительно параллельными refresh, — описано в разделе [Известные ограничения](#известные-ограничения).

Refresh и логин ограничены отдельно от остальных маршрутов: по умолчанию с одного IP сервер пропускает в минуту 30 запросов на refresh, 10 на логин и 300 на всё остальное; лимиты задаются через `RATE_LIMIT_LOGIN_MAX` (для refresh он утраивается) и `RATE_LIMIT_MAX` ([`auth.routes.ts`](server/src/modules/auth/auth.routes.ts)). Пароль на логине сверяется через scrypt с N=16384, r=8, p=1. Параметры лежат в самом хэше, поэтому их можно поднять, и старые пароли продолжат проверяться. Если e-mail не найден, пароль всё равно сверяется с фиктивным хэшем, чтобы логин не отвечал на такой адрес заметно быстрее; ошибка в обоих случаях `INVALID_CREDENTIALS` ([`password.ts`](server/src/lib/password.ts), [`auth.service.ts:18-24`](server/src/modules/auth/auth.service.ts#L18-L24)).

## Куда встаёт карточка после перетаскивания

![Канбан сделок: колонки стадий с суммами, поиск и фильтр по владельцу](docs/screenshots/deals-kanban.png)

У сделки есть `stageId` и целочисленная `position` внутри колонки. Самый короткий путь — при перетаскивании записать `position = индекс` — быстро даёт дубли и дыры: карточки с одинаковой позицией сортируются как попало, после удаления остаются пропуски, а при переносе между колонками исходная колонка вообще не трогается. Поэтому позиции хранятся без дробных значений и пропусков: после каждого перемещения обе затронутые колонки перенумеровываются в 0..n−1.

`POST /api/deals/:id/move` делает это в одной интерактивной транзакции Prisma ([`deals.service.ts:156-208`](server/src/modules/deals/deals.service.ts#L156-L208)). Он читает целевую колонку без перемещаемой сделки, отсортированную по `position`, а затем по `createdAt` по убыванию, вставляет сделку на нужный индекс (позиция за концом обрезается до длины колонки) и перенумеровывает; если стадия сменилась, так же перенумеровывается исходная колонка. `reindex` пишет только строки, у которых позиция поменялась ([`:34-40`](server/src/modules/deals/deals.service.ts#L34-L40)), так что обмен двух соседних карточек стоит двух `UPDATE`, а перемещение в начало колонки переписывает позицию каждой карточки в ней. При смене стадии в той же транзакции обновляются `stageChangedAt` и `closedAt` (ставится для Won и Lost, сбрасывается при возврате в открытую стадию), а в ленту активности пишется запись. Инвариант держат и создание (новая сделка встаёт наверх, остальные сдвигаются одним `updateMany` с `increment`, [`:89-112`](server/src/modules/deals/deals.service.ts#L89-L112)), и удаление (`decrement` у карточек ниже, [`:210-221`](server/src/modules/deals/deals.service.ts#L210-L221)).

Тот же алгоритм на клиенте — `applyMove` в [`web/src/lib/kanban.ts:17-43`](web/src/lib/kanban.ts#L17-L43), с тем же порядком сортировки. Оптимистичное обновление в `useMoveDeal` применяет его к кэшу TanStack Query до ответа сервера, а при ошибке возвращает в кэш прежний список ([`web/src/hooks/queries.ts:78-95`](web/src/hooks/queries.ts#L78-L95)); нетронутые строки сохраняют идентичность объектов, и React не перерисовывает всю доску. Обработчик `/deals/:id/move` в демо-сервере вызывает ту же функцию ([`web/src/lib/demo/server.ts:428`](web/src/lib/demo/server.ts#L428)), поэтому сборка на GitHub Pages расставляет карточки так же, как настоящий API. Интеграционные тесты проверяют непрерывность позиций после каждого перемещения, создания и удаления (`expectContiguous` в [`server/test/deals.test.ts`](server/test/deals.test.ts)).

Пока включён поиск или фильтр по владельцу, перетаскивание выключено, над доской появляется подсказка «Clear filters to reorder cards.» ([`deals-view.tsx:93-106`](web/src/components/deals/deals-view.tsx#L93-L106)). Индекс, куда бросили карточку, считается по видимой колонке, а фильтр часть колонки прячет, и сервер получил бы не ту позицию. Чужие сделки менеджер тоже не перетащит: карточку блокирует тот же `can()`, что проверяет сервер. Таскать можно мышью, пальцем (после удержания 180 мс) и с клавиатуры: пробел, стрелки, пробел ([`kanban-board.tsx:142-144`](web/src/components/deals/kanban-board.tsx#L142-L144)).

<p><img src="docs/screenshots/mobile-deals.png" alt="Канбан на телефоне" width="260"></p>

## Что ещё есть

- Роли. `admin` может всё. `manager` создаёт сделки и контакты, редактирует контакты, редактирует и двигает только свои сделки, ничего не удаляет и не переназначает, стадии только читает. Одну функцию `can()` из [`permissions.ts`](packages/shared/src/permissions.ts) вызывают сервисы сервера, демо-API и UI, который по ней прячет кнопки.
- Карточка сделки: редактирование полей, смена стадии, заметки, лента активности, удаление для admin.
- Контакты: серверный поиск, сортировка по колонкам, пагинация, 409 на дубликат e-mail.
- Дашборд: KPI, выручка по месяцам, конверсия по стадиям, таблица по менеджерам. Аналитику я считаю на JS по выборке строк, без SQL-агрегатов: для CRM такого размера это проще поддерживать, чем SQL под конкретную СУБД. Демо и сервер вызывают одни и те же функции `compute*` из [`analytics.ts`](packages/shared/src/analytics.ts), а на сервере тест сверяет три поля `/analytics/summary` с `computeSummary` на сидовых данных.
- API: Fastify 5, zod-схемы на вход и на выход, Swagger UI на `/docs`, экспорт OpenAPI в [`docs/openapi.json`](docs/openapi.json) (`npm run openapi -w server`), helmet, CORS, `/api/health`; по SIGTERM сервер закрывается и отключает Prisma ([`server/src/index.ts`](server/src/index.ts)).
- Ошибки идут в одном формате `{ error: { code, message, details? } }`, включая 404 на неизвестный маршрут и 429; P2002 и P2003 от Prisma превращаются в 409, P2025 — в 404. Если ответ не совпал со своей схемой, клиент получает 500, а расхождение пишется в лог ([`error-handler.ts`](server/src/plugins/error-handler.ts)).
- Логи: pino заменяет на `[redacted]` значения по путям `req.headers.authorization`, `req.headers.cookie`, `*.password`, `*.refreshToken`, `*.accessToken`; в каждом ответе есть заголовок `x-request-id` ([`server/src/app.ts`](server/src/app.ts)).
- Демо в браузере. UI ходит в API через `ApiClient` с подменяемым `Transport` ([`web/src/lib/api`](web/src/lib/api)). При `NEXT_PUBLIC_API_MODE=demo` (значение по умолчанию, так собран GitHub Pages) транспортом становится `createDemoServer` из [`web/src/lib/demo/server.ts`](web/src/lib/demo/server.ts): роутер в браузере с состоянием в localStorage и задержкой 180 мс. Он валидирует запросы теми же zod-схемами и реализует 23 из 26 операций API: стадии в нём, как и в интерфейсе, только читаются. Каждый запрос выполняется на `structuredClone` состояния и при ошибке откатывается к снимку, кроме `TOKEN_REUSED`: отзыв семьи сохраняется до `throw`, иначе повтор токена ничего бы не отзывал. Границей безопасности демо-роутер не является: access-токен там — base64 без подписи, пароли и refresh-токены лежат в состоянии открытым текстом ([`server.ts:166-197`](web/src/lib/demo/server.ts#L166-L197), [`:272`](web/src/lib/demo/server.ts#L272)).
- Данные: сид базы и начальное состояние демо даёт один генератор (mulberry32, seed 20260924): 4 пользователя, 6 стадий, 60 контактов, 54 сделки, даты отсчитываются от момента генерации.
- Пользователи есть только из сида. Регистрации, смены пароля и «выйти везде» нет; logout отзывает одну семью токенов.
- Тёмная тема применяется inline-скриптом до первой отрисовки ([`use-theme.tsx:9`](web/src/hooks/use-theme.tsx#L9)), на телефоне сайдбар превращается в меню. Интерфейс только на английском.
- БД: каноническая схема Prisma написана под PostgreSQL, к ней есть миграция. Prisma не умеет менять провайдер в рантайме, так что [`server/scripts/sqlite-schema.mjs`](server/scripts/sqlite-schema.mjs) генерирует SQLite-копию для локального запуска и тестов. Провайдеры в коде расходятся только в поиске без учёта регистра: Postgres нужен `mode: 'insensitive'`, SQLite эту опцию не принимает ([`server/src/lib/db.ts`](server/src/lib/db.ts)).

Стек: монорепозиторий на npm workspaces из трёх пакетов — `web` (Next.js 16 со static export, TanStack Query, dnd-kit, Recharts, Tailwind CSS 4), `server` (Fastify 5, Prisma 6, `jose`, zod 4 через `fastify-type-provider-zod`, Swagger UI) и `packages/shared`.

## Запуск

1. Node.js 22: так в `.nvmrc`, CI и Docker-образах, а `engines` в корневом `package.json` допускает 20.9 и новее. Зависимости ставятся из корня репозитория: `npm install`.
2. Только фронтенд в демо-режиме: `npm run dev`, затем открыть http://localhost:3000. Бэкенд не нужен.
3. Фронтенд с настоящим API на SQLite, без Docker:

   ```bash
   cp server/.env.example server/.env
   npm run db:setup:sqlite -w server    # SQLite-схема, клиент Prisma, таблицы, сид
   npm run dev:server                   # API на http://localhost:4000/api, Swagger UI на http://localhost:4000/docs
   ```

   Затем во втором терминале:

   ```bash
   NEXT_PUBLIC_API_MODE=http NEXT_PUBLIC_API_URL=http://localhost:4000/api npm run dev:web
   ```

   Повторный `db:setup:sqlite` или `npm run db:seed -w server` перед сидом стирает все данные, включая пользователей и сессии ([`server/src/db/seed.ts:22-28`](server/src/db/seed.ts#L22-L28)).

4. Всё в Docker (PostgreSQL 17, API и собранная статика за nginx): `docker compose up --build`. Веб-приложение на http://localhost:3000, Swagger UI на http://localhost:4000/docs. Контейнер API при старте выполняет `prisma migrate deploy` и запускает сид, только если база пустая ([`server/docker-entrypoint.sh`](server/docker-entrypoint.sh)). `JWT_ACCESS_SECRET` compose берёт из окружения, а без него подставляет значение, записанное в [`docker-compose.yml`](docker-compose.yml); для всего, кроме localhost, задайте свой (см. [Известные ограничения](#известные-ограничения)).
5. Настройки. Пример переменных сервера лежит в [`server/.env.example`](server/.env.example), полный список с дефолтами — в [`server/src/config/env.ts`](server/src/config/env.ts). Там же zod проверяет их при старте: `JWT_ACCESS_SECRET` короче 32 символов не пройдёт, а при `NODE_ENV=production` сервер не запустится с dev-секретом из `.env.example`. У клиента переменных три, см. [`web/.env.example`](web/.env.example): `NEXT_PUBLIC_API_MODE`, `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_BASE_PATH`.
6. Проверки: `npm test`, `npm run lint`, `npm run typecheck`, `npm run format:check`. `npm run ci` прогоняет lint, typecheck, тесты и сборку подряд.

## Известные ограничения

1. Две вкладки одной сессии выбивают друг друга ([issue #1](https://github.com/sinnercode228/flowdesk-crm/issues/1)). `SessionStore` держит пару токенов в памяти и не слушает событие `storage` ([`session-store.ts`](web/src/lib/api/session-store.ts)), а общий промис refresh работает только внутри одной вкладки. После того как вкладка A ротировала токен, вкладка B на своём refresh предъявляет отозванный, сервер отзывает семью, B вызывает `session.set(null)` ([`client.ts:61`](web/src/lib/api/client.ts#L61)) и заодно стирает из localStorage свежую пару A. B выходит сразу, A — когда истечёт её access-токен.
2. Токены лежат в localStorage ([`session-store.ts:39`](web/src/lib/api/session-store.ts#L39)) и доступны любому скрипту на странице. Refresh-токен в httpOnly-cookie был бы правильнее, это место я бы переделал.
3. У гонки refresh нет конкурентного теста: в [`server/test/auth.test.ts:96-121`](server/test/auth.test.ts#L96-L121) повтор токена проверяется только последовательно. К тому же две ветки повтора ведут себя по-разному: проигравший условное обновление ([`auth.service.ts:50-51`](server/src/modules/auth/auth.service.ts#L50-L51)) семью не трогает, а нашедший уже отозванный токен ([`:38-41`](server/src/modules/auth/auth.service.ts#L38-L41)) отзывает её, так что исход для опоздавшего дубликата зависит от тайминга. Комментария о том, намеренно ли это, в коде нет.
4. Отозванные и просроченные refresh-токены никто не удаляет. Единственный `deleteMany` по таблице `RefreshToken` — в сиде ([`server/src/db/seed.ts:27`](server/src/db/seed.ts#L27)), так что таблица только растёт.
5. `move` не блокирует строки колонки, а на `(stageId, position)` стоит обычный индекс, не уникальный ключ ([`schema.prisma:105`](server/prisma/schema.prisma#L105)). Два одновременных перемещения в одну стадию на PostgreSQL могут оставить сделки с одинаковой `position`. Порядок при этом детерминирован (вторым ключом сортировки идёт `createdAt`), а следующее перемещение в колонку перенумерует её заново.
6. `reindex` делает по одному `UPDATE` на каждую сдвинутую строку ([`deals.service.ts:34-40`](server/src/modules/deals/deals.service.ts#L34-L40)). Перенос карточки в начало колонки из пары сотен сделок — это пара сотен запросов внутри интерактивной транзакции с таймаутом Prisma по умолчанию в 5 секунд: `move` не передаёт опцию `timeout`.
7. Смена стадии из карточки сделки всегда ставит её на позицию 0 в новой колонке ([`deal-drawer.tsx:105`](web/src/components/deals/deal-drawer.tsx#L105)).
8. `docker compose up` запускает API с `NODE_ENV=production` и, если `JWT_ACCESS_SECRET` не задан, с секретом, записанным в [`docker-compose.yml:25,29`](docker-compose.yml#L25-L29). Проверка при старте в [`env.ts:27-35`](server/src/config/env.ts#L27-L35) отвергает только dev-секрет из `.env.example`, поэтому значение из compose её проходит.
9. `trustProxy: true` стоит безусловно ([`server/src/app.ts:62`](server/src/app.ts#L62)). Без обратного прокси перед API клиент, который в каждом запросе шлёт новое значение `X-Forwarded-For`, каждый раз считается новым IP и до лимита на логин не доходит. Счётчики лимитера живут в памяти процесса.
10. Интеграционные тесты API идут только на SQLite. Job `api-postgres` в [`ci.yml`](.github/workflows/ci.yml) поднимает PostgreSQL 17, но только применяет миграцию и прогоняет сид, так что ветка `mode: 'insensitive'` в [`db.ts:9`](server/src/lib/db.ts#L9) автотестами не покрыта.
11. Со сделками нет пагинации. `GET /api/deals` отдаёт доску целиком, каждый из четырёх эндпоинтов аналитики на каждый запрос читает все сделки и стадии ([`analytics.routes.ts:23-32`](server/src/modules/analytics/analytics.routes.ts#L23-L32)), а дашборд вызывает все четыре. Страница сделок к тому же фильтрует на клиенте ([`deals-view.tsx:28-38`](web/src/components/deals/deals-view.tsx#L28-L38)), хотя `GET /api/deals` принимает `search` и `ownerId`. На 54 сделках это незаметно; на тысячах аналитику придётся переводить на агрегаты в SQL, а доску — на пагинацию.
12. Стадиями можно управлять только через API. `POST`, `PATCH` и `DELETE /api/stages` есть ([`stages.routes.ts`](server/src/modules/stages/stages.routes.ts)), но веб-клиент стадии только читает ([`client.ts:107`](web/src/lib/api/client.ts#L107)), а демо-сервер реализует только `GET /stages` ([`server.ts:321`](web/src/lib/demo/server.ts#L321)).

## Тесты и CI

[![CI](https://github.com/sinnercode228/flowdesk-crm/actions/workflows/ci.yml/badge.svg)](https://github.com/sinnercode228/flowdesk-crm/actions/workflows/ci.yml)

97 тестов на Vitest:

| Пакет | Тестов | Что проверяют |
| --- | ---: | --- |
| `packages/shared` | 18 | функции аналитики, `can()`, zod-схемы, детерминированность и целостность демо-данных |
| `server` | 48 | HTTP через supertest: логин, ротация и повтор refresh-токенов, истёкшие и подделанные JWT, перемещение с перенумерацией, поиск, сортировка и пагинация, 409 на дубликат, права менеджера на контакты и стадии, аналитика, rate limit |
| `web` | 31 | демо-API (контракт, права, откат упавших запросов, сохранение), `ApiClient`, `applyMove`, форматирование, компоненты через Testing Library |

Тесты API поднимают настоящий Fastify на случайном порту loopback и ходят в него через supertest. [`global-setup.ts`](server/test/global-setup.ts) один раз создаёт шаблонную SQLite-базу с сидом, а каждый тестовый файл копирует её себе ([`helpers.ts`](server/test/helpers.ts)), поэтому файлы выполняются параллельно.

```bash
npm test                                            # все три пакета
npm run lint && npm run typecheck && npm run format:check
```

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) гоняет lint, prettier, typecheck, тесты и сборку; второй job применяет миграцию и сид к PostgreSQL 17, третий собирает Docker-образы. [`.github/workflows/pages.yml`](.github/workflows/pages.yml) собирает демо с `NEXT_PUBLIC_BASE_PATH=/<имя репозитория>` и публикует через `actions/deploy-pages`; в настройках репозитория источником Pages должен стоять GitHub Actions.

## Карта репозитория

```
packages/shared/   zod-контракт, RBAC, аналитика, генератор демо-данных, тесты к ним
server/            Fastify API: src/modules/{auth,deals,contacts,stages,analytics,users,health}, prisma/, test/
web/               Next.js: src/app, src/components, src/hooks, src/lib/{api,demo,kanban.ts}
docs/              скриншоты, openapi.json
```

---

Автор — Грешный Котик (sinnercode), беру заказы на похожие задачи: Telegram [@sinnercode](https://t.me/sinnercode). Лицензия [MIT](LICENSE).
