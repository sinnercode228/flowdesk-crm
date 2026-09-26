# FlowDesk

![Дашборд FlowDesk: открытая воронка, взвешенный прогноз, выручка по месяцам, конверсия по стадиям, результаты менеджеров](docs/screenshots/dashboard.png)

Мини-CRM для отдела продаж: канбан сделок, контакты, карточка сделки с заметками и историей, дашборд, роли admin и manager. Refresh-токены ротируются, а повторно предъявленный старый токен отзывает всю цепочку своего входа. Порядок карточек на канбане одинаково считают сервер, оптимистичное обновление в UI и демо-API в браузере. Компании, контакты и сделки в демо сгенерированы сидом.

Демо: https://sinnercode228.github.io/flowdesk-crm/ — API работает прямо в браузере. Форма входа уже заполнена учёткой admin, кнопка Manager подставляет вторую (`admin@flowdesk.example` и `manager@flowdesk.example`, пароль у обоих `demo1234`). Менеджер создаёт сделки и контакты, но редактирует и двигает только свои сделки и ничего не удаляет. Кнопка Reset data в шапке возвращает исходные данные.

## Запуск

Монорепозиторий на npm workspaces из трёх пакетов: `web` (Next.js 16 со static export, TanStack Query, dnd-kit, Recharts, Tailwind CSS 4), `server` (Fastify 5, Prisma 6, `jose`, zod 4 через `fastify-type-provider-zod`, Swagger UI; PostgreSQL, а локально и в тестах SQLite) и `packages/shared`. Node.js 22 (так в `.nvmrc`, CI и Docker-образах). Зависимости ставятся из корня:

```bash
npm install
npm run dev                          # демо-режим, http://localhost:3000
```

Настоящий API на SQLite, без Docker:

```bash
cp server/.env.example server/.env
npm run db:setup:sqlite -w server    # SQLite-схема, клиент Prisma, таблицы, сид
npm run dev:server                   # http://localhost:4000/api, Swagger UI на /docs
NEXT_PUBLIC_API_MODE=http NEXT_PUBLIC_API_URL=http://localhost:4000/api npm run dev:web
```

Всё в Docker: PostgreSQL 17, API и собранная статика за nginx:

```bash
docker compose up --build            # web: http://localhost:3000, API: http://localhost:4000/docs
```

Контейнер API при старте выполняет `prisma migrate deploy` и запускает сид, если база пустая ([`server/docker-entrypoint.sh`](server/docker-entrypoint.sh)). `JWT_ACCESS_SECRET` compose берёт из окружения, а без него подставляет локальное значение из [`docker-compose.yml`](docker-compose.yml). Пример переменных сервера лежит в [`server/.env.example`](server/.env.example), полный список с дефолтами — в [`server/src/config/env.ts`](server/src/config/env.ts). Там же zod проверяет их при старте, так что `JWT_ACCESS_SECRET` короче 32 символов не пройдёт, а при `NODE_ENV=production` сервер не запустится с dev-секретом по умолчанию. У клиента переменных три, см. [`web/.env.example`](web/.env.example): `NEXT_PUBLIC_API_MODE`, `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_BASE_PATH`.

## Украденный refresh-токен и два refresh одновременно

Access-токен — JWT на 15 минут: HS256 через `jose`, при проверке алгоритм зафиксирован, issuer и audience сверяются. Refresh-токен — не JWT, а 32 случайных байта в base64url; он одноразовый и живёт 7 дней (сроки задаются `JWT_ACCESS_TTL` и `REFRESH_TOKEN_TTL_DAYS`). В базе лежит только его SHA-256 ([`server/src/lib/tokens.ts`](server/src/lib/tokens.ts)), так что дамп таблицы `RefreshToken` готовых токенов не даёт. Медленный хэш тут не нужен: 256 случайных бит перебором не подобрать.

`POST /api/auth/refresh` отзывает предъявленный токен и выдаёт новую пару с тем же `familyId`, общим для всех токенов одного логина. Если на refresh приходит уже отозванный токен, сервер считает это повторным предъявлением: токен мог отправить второй раз сам клиент или тот, кто его скопировал. Кто из них настоящий, сервер не знает, поэтому отзывает всю семью и отвечает `401 TOKEN_REUSED`. Войти заново придётся обоим ([`auth.service.ts`](server/src/modules/auth/auth.service.ts)). Другие сессии пользователя это не задевает, у них свои семьи. Цепочку «ротация → повтор старого токена → новый тоже отклонён» проверяют и тесты API, и тесты демо.

Два запроса с одним живым токеном оба прочитают его с `revokedAt = null`, и без защиты каждый выпустил бы по новой паре: у семьи появились бы две рабочие ветки. От этого защищает условное обновление внутри транзакции:

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

Строку обновит только один запрос. Второй увидит `count === 0` и получит `401 TOKEN_REUSED`, второй пары не появится. Клиент в пределах вкладки и сам не шлёт параллельных refresh: все запросы, получившие 401, ждут один общий ([`web/src/lib/api/client.ts`](web/src/lib/api/client.ts)). Сервер на это не полагается. В [`client.test.ts`](web/src/lib/api/client.test.ts) два запроса уходят с истёкшим access-токеном, и до `/auth/refresh` доходит ровно один вызов.

Refresh и логин ограничены отдельно от остальных маршрутов: по умолчанию с одного IP сервер пропускает в минуту 30 запросов на refresh, 10 на логин и 300 на всё остальное; лимиты задаются через `RATE_LIMIT_LOGIN_MAX` (для refresh он утраивается) и `RATE_LIMIT_MAX`. Пароль на логине сверяется через scrypt с N=16384, r=8, p=1. Параметры лежат в самом хэше, поэтому их можно поднять, и старые пароли продолжат проверяться. Если e-mail не найден, пароль всё равно сверяется с фиктивным хэшем, чтобы логин не отвечал на такой адрес заметно быстрее; ошибка в обоих случаях `INVALID_CREDENTIALS` ([`password.ts`](server/src/lib/password.ts)).

## Куда встаёт карточка после перетаскивания

![Канбан сделок: колонки стадий с суммами, поиск и фильтр по владельцу](docs/screenshots/deals-kanban.png)

Порядок в стадии хранится в целом `position`, без дробных значений и пропусков: после каждого перемещения обе затронутые колонки перенумеровываются в 0..n−1. `POST /api/deals/:id/move` делает это в одной интерактивной транзакции Prisma ([`deals.service.ts`](server/src/modules/deals/deals.service.ts)). Он читает целевую колонку без перемещаемой сделки, вставляет сделку на нужный индекс (позиция за концом обрезается до длины колонки) и перенумеровывает; если стадия сменилась, так же перенумеровывается исходная колонка. Пишутся только строки, у которых позиция поменялась, так что обмен двух соседних карточек стоит двух `UPDATE`.

Инвариант держат и создание (новая сделка встаёт наверх, остальные сдвигаются одним `updateMany` с `increment`) и удаление (`decrement` у карточек ниже). Перемещение в начало колонки при этом переписывает позицию каждой карточки в ней. При смене стадии в той же транзакции обновляются `stageChangedAt` и `closedAt` (ставится для Won и Lost, сбрасывается при возврате в открытую стадию), а в ленту активности пишется запись.

Тот же алгоритм на клиенте — `applyMove` в [`web/src/lib/kanban.ts`](web/src/lib/kanban.ts), с тем же порядком сортировки (`position`, при равенстве более новые выше). Его вызывают оптимистичное обновление в `useMoveDeal` ([`web/src/hooks/queries.ts`](web/src/hooks/queries.ts)) и обработчик `/deals/:id/move` в демо-сервере. Так доска ещё до ответа сервера показывает те же позиции, которые он потом посчитает, а при ошибке `useMoveDeal` возвращает в кэш прежний список.

Пока включён поиск или фильтр по владельцу, перетаскивание выключено, над доской появляется подсказка «Clear filters to reorder cards». Индекс, куда бросили карточку, считается по видимой колонке, а фильтр часть колонки прячет, и сервер получил бы не ту позицию. Чужие сделки менеджер тоже не перетащит: карточку блокирует тот же `can()`, что проверяет сервер. Таскать можно мышью, пальцем (после удержания 180 мс) и с клавиатуры: пробел, стрелки, пробел.

<p><img src="docs/screenshots/mobile-deals.png" alt="Канбан на телефоне" width="260"></p>

## Что у демо общего с сервером

UI ходит в API через `ApiClient` с подменяемым `Transport` ([`web/src/lib/api`](web/src/lib/api)). В демо-сборке (`NEXT_PUBLIC_API_MODE=demo`, значение по умолчанию, так собран GitHub Pages) транспортом становится `createDemoServer` из [`web/src/lib/demo/server.ts`](web/src/lib/demo/server.ts): роутер в браузере с состоянием в localStorage и задержкой 180 мс.

Общее вынесено в [`packages/shared`](packages/shared/src). Его zod-схемами валидируют запросы и Fastify, и демо-роутер, из них же собирается OpenAPI для Swagger. `can()` из [`permissions.ts`](packages/shared/src/permissions.ts) вызывают сервисы сервера, демо-API и UI, который по ней прячет кнопки. Сид базы и начальное состояние демо даёт один генератор (mulberry32, seed 20260924): 4 пользователя, 6 стадий, 60 контактов, 54 сделки, даты отсчитываются от момента генерации.

Аналитику я считаю на JS по выборке строк, без SQL-агрегатов: для CRM такого размера это проще поддерживать, чем SQL под конкретную СУБД ([`analytics.routes.ts`](server/src/modules/analytics/analytics.routes.ts)). Заодно демо и сервер вызывают одни и те же функции `compute*`; на сервере тест сверяет три поля `/analytics/summary` с `computeSummary` на сидовых данных. Но каждый из четырёх эндпоинтов на каждый запрос читает все сделки и стадии, а дашборд вызывает все четыре. Если сделок станет много, аналитику придётся переводить на агрегаты в SQL, а `GET /api/deals`, который отдаёт доску целиком, — на пагинацию.

Демо-роутер выполняет каждый запрос на `structuredClone` состояния и при ошибке возвращается к снимку. При `TOKEN_REUSED` отзыв семьи сохраняется до `throw` и не откатывается, иначе повтор токена ничего бы не отзывал. Из 26 операций API демо реализует 23: стадии в нём, как и в интерфейсе, только читаются.

## Формат ошибок и маскировка в логах

Ошибки идут в одном формате `{ error: { code, message, details? } }`, включая 404 на неизвестный маршрут и 429; P2002 и P2003 от Prisma превращаются в 409, P2025 — в 404. Ответы проходят через zod-сериализатор: если ответ не совпал со схемой, клиент получает 500, а расхождение пишется в лог ([`error-handler.ts`](server/src/plugins/error-handler.ts)).

В логах pino заменяет на `[redacted]` значения по путям `req.headers.authorization`, `req.headers.cookie`, `*.password`, `*.refreshToken`, `*.accessToken`. В каждом ответе есть заголовок `x-request-id` ([`server/src/app.ts`](server/src/app.ts)).

## Слабые места

- Интеграционные тесты API идут только на SQLite. Job `api-postgres` в CI поднимает PostgreSQL 17, но только применяет миграцию и прогоняет сид.
- `move` не блокирует строки колонки. Два одновременных перемещения в одну стадию на Postgres могут оставить сделки с одинаковой `position`; порядок при этом детерминирован (вторым ключом идёт `createdAt`), а следующее перемещение в колонку перенумерует её заново.
- Токены лежат в localStorage ([`session-store.ts`](web/src/lib/api/session-store.ts)) и доступны любому скрипту на странице. Refresh-токен в httpOnly-cookie был бы правильнее, это место я бы переделал.
- Вкладки токены не синхронизируют: `SessionStore` держит пару в памяти и не слушает событие `storage`. Если с настоящим API одна сессия открыта в двух вкладках и первая уже ротировала токен, вторая на своём refresh предъявит отозванный. Сервер отзовёт семью: вторая вкладка выйдет сразу, первая — когда истечёт её access-токен.

## Тесты

97 тестов на Vitest:

| Пакет | Тестов | Что проверяют |
| --- | ---: | --- |
| `packages/shared` | 18 | функции аналитики, `can()`, zod-схемы, детерминированность и целостность демо-данных |
| `server` | 48 | HTTP через supertest: логин, ротация и повтор refresh-токенов, истёкшие и подделанные JWT, перемещение с перенумерацией, поиск, сортировка и пагинация, 409 на дубликат, права менеджера на контакты и стадии, аналитика, rate limit |
| `web` | 31 | демо-API (контракт, права, откат упавших запросов, сохранение), `ApiClient`, `applyMove`, форматирование, компоненты через Testing Library |

Prisma не умеет менять провайдер в рантайме, так что [`server/scripts/sqlite-schema.mjs`](server/scripts/sqlite-schema.mjs) генерирует из Postgres-схемы SQLite-копию, а [`global-setup.ts`](server/test/global-setup.ts) один раз создаёт из неё шаблонную базу с сидом, которую каждый тестовый файл копирует себе. Провайдеры в коде расходятся только в поиске без учёта регистра: Postgres нужен `mode: 'insensitive'`, SQLite эту опцию не принимает ([`server/src/lib/db.ts`](server/src/lib/db.ts)).

```bash
npm test                                            # все три пакета
npm run lint && npm run typecheck && npm run format:check
```

CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) гоняет lint, prettier, typecheck, тесты и сборку, отдельный job собирает Docker-образы.

Лицензия MIT.
