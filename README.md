# Circle Wallet

Небольшой fullstack-криптокошелёк на **Circle Developer-Controlled Wallets** в тестовой сети **BASE-SEPOLIA**.
Пользователь пополняет кошелёк тестовыми токенами, выводит их на любой адрес и видит баланс и историю операций.

```
apps/
  backend/   Express + TypeScript: работа с Circle API, приём вебхуков, учёт балансов
  web/       Next.js (App Router) + Mantine + TanStack Query: интерфейс
packages/
  shared/    типы API-контракта, общие для backend и web
supabase/
  migrations/  схема БД (таблицы, представления, SQL-функции)
  seed.sql     тестовый аккаунт для входа (только локально)
  config.toml  конфиг локального Supabase
```

Монорепо на **pnpm workspaces**.

---

## Быстрый старт (локально)

Нужно: Node.js ≥ 20 (проверено на 24), pnpm ≥ 10, Docker (для локального Supabase).

```bash
pnpm install
pnpm db:start                                   # локальный Supabase + применение миграций
cp apps/backend/.env.example apps/backend/.env  # заполнить, см. ниже
cp apps/web/.env.example apps/web/.env.local
pnpm dev                                        # backend :4000 + web :3000
```

Открыть http://localhost:3000 и войти тестовым аккаунтом:

| Email | Пароль |
|---|---|
| `demo@example.com` | `demo12345` |

Аккаунт создаётся автоматически из `supabase/seed.sql` при `pnpm db:start` / `pnpm db:reset`. Дальше — раздел
[«Как пользоваться»](#как-пользоваться).

### 1. Supabase

**Вариант А — локально (рекомендуется для разработки).** `pnpm db:start` поднимает Postgres + PostgREST в Docker и
применяет `supabase/migrations`. Команда печатает `API_URL` и `service_role key`. Их нужно указать в
`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`. Пересоздать базу: `pnpm db:reset`.

**Вариант Б — облачный проект.** Создайте проект на supabase.com, затем:

```bash
pnpm exec supabase link --project-ref <ref>
pnpm db:push                       # применить миграции
```

Также можно выполнить `supabase/migrations/*.sql` в SQL Editor.
`SUPABASE_URL` и `service_role` key находятся в Project Settings → API.

Бэкенд ходит в базу только с ключом `service_role`. RLS включён на всех таблицах, политик нет: anon/authenticated
доступа не имеют, фронтенд работает только через API бэкенда.

### Авторизация (Supabase Auth)

Вход по email и паролю через Supabase Auth. Это «замок» на всё приложение: без входа фронтенд показывает форму, а
API отвечает `401`. После входа всё работает как в ТЗ: список пользователей, выбор любого, пополнение, вывод.

> **Аккаунт для входа ≠ пользователь кошелька.** Аккаунт Supabase Auth нужен, чтобы попасть в приложение.
> Пользователь кошелька (с адресом и балансом) создаётся уже внутри приложения кнопкой «Новый».

**Как получить аккаунт для входа** (любой способ):

1. **Тестовый аккаунт** `demo@example.com` / `demo12345` — уже есть после `pnpm db:start` или `pnpm db:reset`
   (`supabase/seed.sql`). Если база поднималась до появления seed, создайте его командой из п. 3 или выполните
   `pnpm db:reset` (удалит данные локальной базы).
2. **Регистрация в интерфейсе.** На форме входа переключитесь на «Регистрация», введите email и пароль
   (не короче 6 символов) и нажмите «Зарегистрироваться». Локальный Supabase подтверждает email автоматически,
   поэтому вход происходит сразу.
3. **Командой** (создаёт уже подтверждённый аккаунт через admin API):
   ```bash
   pnpm --filter backend auth:create-user you@example.com yourpassword
   ```

Выйти — кнопка «Выйти» справа вверху. Сессия хранится в браузере и переживает перезагрузку страницы.

Облачный Supabase: seed туда не применяется, а подтверждение email по умолчанию включено — после регистрации нужно
перейти по ссылке из письма (или отключить: Authentication → Providers → Email → Confirm email). Тестовый аккаунт
в облаке создаётся командой из п. 3.

### 2. Circle

1. Зарегистрируйтесь на https://console.circle.com (бесплатно, testnet).
2. **API key**: Keys → Create a key → Standard key (`TEST_API_KEY:...`) → `CIRCLE_API_KEY`.
   `CIRCLE_BASE_URL=https://api.circle.com`.
3. **Entity Secret.** Сгенерируйте и зарегистрируйте его скриптом:
   ```bash
   pnpm --filter @circle-wallet/backend circle:entity-secret
   ```
   Скрипт создаёт 32-байтовый секрет (или берёт уже заданный `CIRCLE_ENTITY_SECRET`), шифрует его публичным ключом
   Circle и регистрирует. Recovery file он сохраняет в `apps/backend/recovery_file_*.dat` (этот файл в .gitignore).
   Напечатанное значение пропишите в `CIRCLE_ENTITY_SECRET`.
4. **Wallet set** создаётся автоматически при создании первого пользователя, его id сохраняется в таблице
   `app_settings`. Можно указать готовый через `CIRCLE_WALLET_SET_ID`.
5. **Вебхуки.** Circle нужен публичный HTTPS-адрес. Для локальной разработки подойдёт туннель:
   ```bash
   cloudflared tunnel --url http://localhost:4000      # или: ngrok http 4000
   pnpm --filter @circle-wallet/backend circle:subscribe-webhook https://<tunnel-host>/webhooks/circle
   ```
   Другой способ — Console → Webhooks → Add subscription с тем же URL. Circle проверяет URL запросом `HEAD`.
   Бэкенд отвечает на него `200`.
6. **Тестовые токены**: https://faucet.circle.com → USDC → Base Sepolia → адрес пользователя из интерфейса.

> Без вебхуков приложение тоже работает: фоновый reconciler опрашивает Circle каждые `RECONCILE_INTERVAL_MS`,
> кроме того, есть кнопка «Синхронизировать с Circle». Вебхуки дают обновление почти сразу, опрос служит страховкой.

### 3. Без аккаунта Circle (mock)

Чтобы посмотреть весь поток без регистрации, используйте локальный mock Circle API. Он реализует используемые
эндпоинты, подписывает вебхуки ECDSA-ключом так же, как Circle, и сам двигает статусы переводов:

```bash
pnpm --filter @circle-wallet/backend circle:fake   # :4010, печатает CIRCLE_ENTITY_SECRET
# в apps/backend/.env: CIRCLE_BASE_URL=http://localhost:4010 и напечатанный CIRCLE_ENTITY_SECRET
pnpm dev
# пополнение:
curl -X POST localhost:4010/_fake/deposit -H 'content-type: application/json' \
     -d '{"address":"0x<адрес пользователя>","amount":"25"}'
```

Вывод суммы `13.13` в mock заканчивается статусом `FAILED`. Так можно посмотреть путь неуспешного вывода.

### Как пользоваться

1. **Войти** — `demo@example.com` / `demo12345` (или свой аккаунт, см. «Авторизация»).
2. **Создать пользователя кошелька** — кнопка «Новый» справа вверху → имя → «Создать». Бэкенд создаёт этому
   пользователю отдельный кошелёк Circle в BASE-SEPOLIA; его адрес — адрес для пополнения. Переключаться между
   пользователями — выпадающий список рядом.
3. **Пополнить** — кнопка «Пополнить» в карточке пользователя: адрес, QR-код и ссылка на
   [faucet.circle.com](https://faucet.circle.com). На фаусете выберите **USDC** и сеть **Base Sepolia**
   (не Arc Testnet и не другую — иначе токены уйдут в другую сеть), вставьте адрес. Пополнение появится в истории
   со статусом «В обработке», а после `COMPLETE` в Circle (обычно несколько минут) — «Выполнен», и сумма станет
   доступна.
4. **Вывести** — форма «Вывод»: адрес получателя (`0x…`), сумма (кнопка MAX — весь доступный баланс) → «Вывести».
   Сумма сразу резервируется («Выводится»), статус идёт до «Выполнен» или «Не выполнен» (тогда средства
   возвращаются). Для проверки можно вывести на адрес другого своего пользователя — у него появится пополнение.
5. **История и баланс** обновляются автоматически: через вебхуки Circle, а без них — опросом раз в 30 секунд
   (или кнопкой «Синхронизировать»).

### Переменные окружения

**apps/backend/.env**

| Переменная | Обяз. | По умолчанию | Описание |
|---|---|---|---|
| `SUPABASE_URL` | да | | URL Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | да | | service_role key |
| `CIRCLE_BASE_URL` | да | | адрес Circle API (`https://api.circle.com`) |
| `CIRCLE_API_KEY` | да | | `TEST_API_KEY:...` |
| `CIRCLE_ENTITY_SECRET` | да | | 32 байта hex |
| `CIRCLE_BLOCKCHAIN` | | `BASE-SEPOLIA` | сеть кошельков |
| `CIRCLE_ACCOUNT_TYPE` | | `SCA` | `SCA` или `EOA` (см. решения) |
| `CIRCLE_WALLET_SET_ID` | | | использовать существующий wallet set |
| `CIRCLE_WEBHOOK_VERIFY_SIGNATURE` | | `true` | проверка подписи вебхуков |
| `RECONCILE_INTERVAL_MS` | | `30000` | период сверки с Circle, `0` отключает |
| `PORT` | | `4000` | |
| `CORS_ORIGIN` | | `http://localhost:3000` | origin фронтенда, можно через запятую |
| `LOG_LEVEL` | | `info` | |

**apps/web/.env.local**

| Переменная | Описание |
|---|---|
| `NEXT_PUBLIC_API_URL` | адрес бэкенда, `http://localhost:4000` |
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL Supabase (локально `http://127.0.0.1:54321`) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable (anon) key Supabase, выводится `pnpm db:start` |

### Скрипты

| Команда | Что делает |
|---|---|
| `pnpm dev` | backend + web в watch-режиме |
| `pnpm build` / `pnpm typecheck` | сборка / проверка типов всех пакетов |
| `pnpm test` | тесты (интеграционные запускаются, если задан `TEST_SUPABASE_*`, см. ниже) |
| `pnpm db:start` / `db:stop` / `db:reset` / `db:push` | Supabase CLI |
| `pnpm --filter backend auth:create-user <email> <password>` | создать тестовый аккаунт Supabase Auth |

**Тесты.** Юнит-тесты покрывают суммы и подпись вебхуков. Интеграционные тесты гоняют полный HTTP-стек бэкенда
против настоящего Postgres (локальный Supabase) с фейковым Circle: пополнение, вывод, идемпотентность,
вебхуки не по порядку, конкурентные выводы, повторная отправка, догоняющая синхронизация.

```bash
pnpm db:start
TEST_SUPABASE_URL=http://127.0.0.1:54321 TEST_SUPABASE_SERVICE_ROLE_KEY=<service_role> pnpm test
```

---

## API бэкенда

Базовый URL `http://localhost:4000`. Все `/api/*` требуют заголовок `Authorization: Bearer <access token Supabase Auth>`,
без него ответ `401 unauthorized`. `/health` и `/webhooks/circle` открыты: вебхуки защищены подписью Circle. JSON, успешные ответы `{ "data": ... }`, ошибки
`{ "error": { "code", "message", "details?" } }`. Все суммы передаются **десятичными строками** (`"10.5"`).
Типы описаны в `packages/shared/src/index.ts`.

| Метод | Путь | Описание |
|---|---|---|
| `GET` | `/health` | healthcheck |
| `GET` | `/api/me` | текущий аккаунт Supabase Auth `{ id, email }` |
| `GET` | `/api/users` | список пользователей |
| `POST` | `/api/users` | создать пользователя `{ "name": "Alice" }`, создаёт ему кошелёк Circle, отвечает `201` и `User` |
| `GET` | `/api/users/:id` | пользователь + балансы (`UserDetails`) |
| `GET` | `/api/users/:id/transactions` | история операций (последние 100, новые сверху) |
| `POST` | `/api/users/:id/withdrawals` | вывод `{ tokenId, destinationAddress, amount }` → `201` и `Transaction` |
| `POST` | `/api/users/:id/sync` | принудительная сверка кошелька пользователя с Circle → `{ updated }` |
| `HEAD/POST` | `/webhooks/circle` | приём уведомлений Circle |

**User**: `{ id, name, address, blockchain, circleWalletId, createdAt }`

**Balance** (по каждому токену):
- `available` — доступно к выводу: завершённые пополнения минус все не-failed выводы;
- `incoming` — пополнения, которые Circle уже видит, но которые ещё не `COMPLETE`;
- `outgoing` — выводы в обработке (уже зарезервированы и вычтены из `available`).

**Transaction**: `{ id, userId, direction: deposit|withdrawal, status: pending|completed|failed, circleState,
circleTransactionId, token, amount, sourceAddress, destinationAddress, txHash, explorerUrl, errorReason, createdAt,
updatedAt }`

Статусы. Наш `status` — упрощённый жизненный цикл, сырой статус Circle виден в `circleState`:

| Circle state | status |
|---|---|
| `INITIATED`, `CLEARED`, `QUEUED`, `SENT`, `STUCK`, `CONFIRMED` | `pending` |
| `COMPLETE` | `completed` |
| `FAILED`, `DENIED`, `CANCELLED` | `failed` |

Ошибки вывода:
- `400 bad_request` / `validation_error` — неверный адрес, сумма, точность или токен;
- `422 insufficient_funds` — сумма больше доступного баланса;
- `404 not_found` — пользователь не найден;
- `502 circle_error` — Circle недоступен при создании пользователя.

Если Circle отклонил перевод (4xx), вывод возвращается со статусом `201`, `status: "failed"` и `errorReason`.

Пример:

```bash
curl -X POST localhost:4000/api/users/<id>/withdrawals -H 'content-type: application/json' \
  -d '{"tokenId":"<circle token id>","destinationAddress":"0xabc...","amount":"1.5"}'
```

---

## Ключевые решения

**Один кошелёк Circle на пользователя.** Адрес кошелька служит адресом пополнения. Входящий перевод однозначно
относится к пользователю по `walletId`: не нужны memo/теги и не нужно переводить средства между кошельками. В Circle
у кошелька `refId = userId`, а `idempotencyKey = userId`, так что повтор запроса не создаст второй кошелёк.

**SCA-кошельки (по умолчанию).** На тестнетах газ для SCA спонсирует Circle Gas Station, поэтому для вывода
пользователю не нужен нативный ETH и сумма списывается ровно та, что указана. EOA можно включить через
`CIRCLE_ACCOUNT_TYPE=EOA`, но тогда на кошелёк нужно положить ETH для газа.

**Баланс выводится из ledger, а не хранится отдельно.** Таблица `transactions` — единственный источник правды.
Балансы считает представление `user_balances`, поэтому баланс и история, которые видит пользователь, не могут
разойтись. При таком объёме данных агрегирование дешёвое. Для масштаба можно добавить материализованный баланс,
который обновляется в тех же SQL-функциях.

**Денежные инварианты живут в БД.** Все изменения ledger проходят через SQL-функции:
- `create_withdrawal` блокирует строку пользователя (`FOR UPDATE`), проверяет доступный баланс и вставляет
  pending-вывод в одной транзакции. Конкурентные выводы сериализуются, двойное списание невозможно (есть тест на
  5 параллельных запросов);
- `apply_circle_transaction` применяет снимок транзакции Circle идемпотентно и независимо от порядка. Финальные
  статусы не меняются, а pending двигается только вперёд по рангу состояния Circle. Вебхуки могут приходить
  повторно и не по порядку, это безопасно;
- `fail_withdrawal` помечает вывод, который Circle отклонил, и освобождает резерв.

**Вывод в два шага: резерв, затем отправка.** Сначала средства резервируются строкой в ledger, затем идёт запрос в
Circle с `idempotencyKey = refId = id строки`. Если Circle недоступен, вывод остаётся `pending`, и reconciler
повторяет отправку с тем же ключом. Перед повтором он ищет перевод в Circle по `refId`, чтобы не отправить его
второй раз, даже если истёк срок idempotency key. После 5 неудачных попыток вывод помечается `failed`, а средства
возвращаются. Ответ 4xx от Circle сразу означает `failed`.

**Вебхуки.**
- Подпись проверяется по сырому телу: ECDSA SHA-256, `X-Circle-Signature`, публичный ключ из
  `/v2/notifications/publicKey/{keyId}`, ключи кэшируются.
- Дедупликация идёт по `notificationId` в таблице `webhook_events`, она же служит журналом.
- Бэкенд не доверяет полезной нагрузке: по `notification.id` он заново читает транзакцию из Circle API и применяет
  актуальный снимок.
- При ошибке обработки возвращается 5xx, и Circle повторяет доставку.

**Reconciler как страховка.** Вебхук может потеряться: туннель упал, подписку ещё не настроили. Поэтому раз в
`RECONCILE_INTERVAL_MS` фоновая задача:
1. переотправляет зависшие выводы;
2. обновляет pending-транзакции;
3. подтягивает новые транзакции всех кошельков с курсором по времени. Так находятся пропущенные пополнения.

Все пути идут через ту же идемпотентную функцию.

**Пополнение засчитывается только в `COMPLETE`.** До этого оно видно в истории как `pending` и в балансе как
`incoming`, но вывести его нельзя.

**Суммы — строки и `numeric`.** Ни на одном этапе нет float: API принимает и отдаёт строки, Postgres хранит
`numeric(38,18)`, в PostgREST значения отдаются через `::text`. Точность проверяется по `decimals` токена. На
фронте суммы сравниваются через `BigInt`.

**Мульти-токен «бесплатно».** Учёт ведётся по `token_id` Circle, метаданные токена (symbol, decimals) кэшируются
в таблице `tokens`. Если с фаусета придёт EURC, он появится отдельной строкой баланса.

**Свой тонкий клиент Circle вместо SDK.** Он работает на `fetch`, базовый адрес берётся строго из
`CIRCLE_BASE_URL`, idempotency keys выбирает приложение, а `entitySecretCiphertext` генерируется заново на каждый
запрос (RSA-OAEP SHA-256). Тот же клиент используется в mock-сервере и в тестах.

**Общий пакет `@circle-wallet/shared`.** В нём только типы, поэтому сборка не нужна. Контракт API один для бэкенда
и фронта.

**Тестовая авторизация как «замок».** В ТЗ аутентификация не нужна, пользователь выбирается из списка (выбор
хранится в URL, `?user=`). Этот сценарий сохранён, а вход через Supabase Auth только закрывает UI и API от
анонимного доступа. Бэкенд проверяет access token через `auth.getUser` (это работает и с HS256, и с новыми
асимметричными ключами Supabase, и отклоняет отозванные сессии), результат кэшируется на 60 с. Ответы API
не кэшируются браузером (`Cache-Control: no-store`, без ETag). Следующий шаг — привязать кошельки к аккаунту
(`users.owner_id = auth.uid()`) и проверять владельца в каждом запросе.

### Что сделал бы дальше
- Авторизация по владельцу: сейчас любой вошедший аккаунт может вывести с любого кошелька. Это сознательное
  упрощение по ТЗ (выбор пользователя из списка).
- Rate limiting и лимиты на вывод, проверка адреса получателя (screening).
- Вынести reconciler в отдельный воркер или cron (pg_cron / Supabase Edge Function) с распределённой блокировкой
  на случай нескольких инстансов бэкенда.
- Пагинация истории.
