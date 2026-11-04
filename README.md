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
  config.toml  конфиг локального Supabase
```

Монорепо на **pnpm workspaces**.

Качество кода: ESLint 9 (flat config, `eslint.config.mjs`) и Prettier (`.prettierrc.json`), запуск — `pnpm lint`,
`pnpm format`. ESLint 9, а не 10: `eslint-config-next` 16 тянет `eslint-plugin-react`, который пока поддерживает
только ESLint ≤ 9.

Соглашения по файлам:
- типы — только в файлах `*.types.ts` рядом с модулем (`circle/circle.types.ts`, `lib/db.types.ts`,
  `components/WalletCard.types.ts`, …); контракт API — `packages/shared/src/api.types.ts`;
- middleware — в `*.middleware.ts`:
  - бэкенд, `apps/backend/src/middleware/`: `error` (404 и маппинг ошибок), `request-logger`, `cors`;
  - фронт, `apps/web/lib/middleware/`: цепочка для запросов к API — `network` (бэкенд недоступен), `json`
    (Content-Type).
- переводы интерфейса — `apps/web/messages/{ru,en}.json`, настройка i18n — `apps/web/i18n/`.

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

Открыть http://localhost:3000. Аутентификации нет (по ТЗ): пользователь создаётся и выбирается из списка.
Как пользоваться — раздел [«Как пользоваться»](#как-пользоваться).

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

1. **Создать пользователя** — кнопка «Новый» справа вверху → имя → «Создать». Бэкенд создаёт этому
   пользователю отдельный кошелёк Circle в BASE-SEPOLIA; его адрес — адрес для пополнения. Переключаться между
   пользователями — выпадающий список рядом.
2. **Пополнить** — кнопка «Пополнить» в карточке пользователя: адрес, QR-код и ссылка на
   [faucet.circle.com](https://faucet.circle.com). На фаусете выберите **USDC** и сеть **Base Sepolia**
   (не Arc Testnet и не другую — иначе токены уйдут в другую сеть), вставьте адрес. Пополнение появится в истории
   со статусом «В обработке», а после `COMPLETE` в Circle (обычно несколько минут) — «Выполнен», и сумма станет
   доступна.
3. **Вывести** — форма «Вывод»: адрес получателя (`0x…`), сумма (кнопка MAX — весь доступный баланс) → «Вывести».
   Сумма сразу резервируется («Выводится»), статус идёт до «Выполнен» или «Не выполнен» (тогда средства
   возвращаются). Для проверки можно вывести на адрес другого своего пользователя — у него появится пополнение.
4. **История и баланс** обновляются автоматически: через вебхуки Circle, а без них — опросом раз в 30 секунд
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

### Скрипты

| Команда | Что делает |
|---|---|
| `pnpm dev` | backend + web в watch-режиме |
| `pnpm build` / `pnpm typecheck` | сборка / проверка типов всех пакетов |
| `pnpm lint` / `pnpm lint:fix` | ESLint по всему монорепо (typescript-eslint с проверкой типов, Next.js, правила хуков React) |
| `pnpm format` / `pnpm format:check` | Prettier |
| `pnpm check` | всё сразу: формат, линтер, типы, тесты |
| `pnpm test` | тесты (интеграционные запускаются, если задан `TEST_SUPABASE_*`, см. ниже) |
| `pnpm db:start` / `db:stop` / `db:reset` / `db:push` | Supabase CLI |

**Тесты.** Юнит-тесты покрывают суммы и подпись вебхуков. Интеграционные тесты гоняют полный HTTP-стек бэкенда
против настоящего Postgres (локальный Supabase) с фейковым Circle: пополнение, вывод, идемпотентность,
вебхуки не по порядку, конкурентные выводы, повторная отправка, догоняющая синхронизация.

```bash
pnpm db:start
TEST_SUPABASE_URL=http://127.0.0.1:54321 TEST_SUPABASE_SERVICE_ROLE_KEY=<service_role> pnpm test
```

---

## API бэкенда

Базовый URL `http://localhost:4000`. Аутентификации нет (по ТЗ); вебхуки защищены подписью Circle. JSON, успешные ответы `{ "data": ... }`, ошибки
`{ "error": { "code", "message", "details?" } }`. Все суммы передаются **десятичными строками** (`"10.5"`).
Типы описаны в `packages/shared/src/index.ts`.

| Метод | Путь | Описание |
|---|---|---|
| `GET` | `/health` | healthcheck |
| `GET` | `/api/users` | список пользователей |
| `POST` | `/api/users` | создать пользователя `{ "name": "Alice" }`, создаёт ему кошелёк Circle, отвечает `201` и `User` |
| `GET` | `/api/users/:id` | пользователь + балансы (`UserDetails`) |
| `GET` | `/api/users/:id/transactions` | история операций (последние 100, новые сверху) |
| `POST` | `/api/users/:id/withdrawals` | вывод `{ tokenId, destinationAddress, amount }`, заголовок `Idempotency-Key` (рекомендуется) → `201` и `Transaction`; повтор с тем же ключом → `200` |
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
- `422 idempotency_key_reused` — `Idempotency-Key` уже использован для вывода с другими токеном, суммой или адресом;
- `404 not_found` — пользователь не найден;
- `502 circle_error` — Circle недоступен при создании пользователя.

Если Circle отклонил перевод (4xx), вывод возвращается со статусом `201`, `status: "failed"` и `errorReason`.

**Идемпотентность вывода.** Клиент передаёт `Idempotency-Key: <строка до 255 символов: буквы, цифры, _ . : ->`.
Повтор запроса с тем же ключом (двойной клик, повтор после обрыва связи, две вкладки) не создаёт второй вывод и
не резервирует деньги повторно: возвращается исходный вывод со статусом `200` и заголовком
`Idempotent-Replayed: true`. Ключ действует в рамках пользователя. Без заголовка каждый запрос создаёт новый вывод.

```bash
curl -X POST localhost:4000/api/users/<id>/withdrawals -H 'content-type: application/json' \
  -H 'Idempotency-Key: 9f1c2d1e-...' \
  -d '{"tokenId":"<circle token id>","destinationAddress":"0xabc...","amount":"1.5"}'
```

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

**Ledger — источник правды, баланс — его материализованная сумма.** Таблица `transactions` хранит все операции.
Баланс хранится в `balances` (строка на пару пользователь + токен: `available`, `incoming`, `outgoing`) и
обновляется триггерами на `transactions` в той же транзакции БД, что и сама операция. Поэтому:
- чтение баланса — поиск по первичному ключу, не зависит от длины истории. Замер на 300 тыс. операций
  одного пользователя: сумма по истории ~750 мс, чтение из `balances` ~0,8 мс; вывод (проверка + резерв) ~2,5 мс;
- баланс не может разойтись с историей: любая запись в `transactions` (SQL-функции, будущий код, ручная правка)
  проходит через триггер. Правило «какая операция как влияет на баланс» записано в одном месте —
  `tx_balance_effect()`;
- триггеры уровня statement с transition tables: дельты суммируются по паре (пользователь, токен), каждая строка
  баланса обновляется один раз за SQL-запрос. Построчный триггер переписывал бы одну и ту же строку N раз —
  массовая вставка 300 тыс. строк заняла бы минуты, а так ~4 с;
- строки балансов блокируются в фиксированном порядке — параллельные запросы не попадают во взаимную блокировку;
- `balance_drift()` пересчитывает балансы из истории и возвращает расхождения (ожидается пусто) — проверяется
  в тестах после всех сценариев, можно запускать как периодический аудит.

**Денежные инварианты живут в БД.** Все изменения ledger проходят через SQL-функции:
- `create_withdrawal` блокирует строку баланса (`FOR UPDATE`), проверяет доступную сумму и вставляет
  pending-вывод в одной транзакции. Конкурентные выводы одного пользователя по одному токену сериализуются, двойное
  списание невозможно (есть тест на 5 параллельных запросов);
- `apply_circle_transaction` применяет снимок транзакции Circle идемпотентно и независимо от порядка. Финальные
  статусы не меняются, а pending двигается только вперёд по рангу состояния Circle. Вебхуки могут приходить
  повторно и не по порядку, это безопасно;
- `fail_withdrawal` помечает вывод, который Circle отклонил, и освобождает резерв.

**Защита от двойного списания — на трёх уровнях.**
- Разные выводы одновременно: `create_withdrawal` блокирует строку баланса (`FOR UPDATE`), проверяет сумму и
  резервирует в одной транзакции — второй поток ждёт и видит уже уменьшенный баланс.
- Повтор одного запроса клиентом: `Idempotency-Key` + уникальный индекс `(user_id, idempotency_key)`. Ключ
  проверяется под той же блокировкой; гонку параллельных повторов решает уникальный индекс. Форма вывода создаёт
  ключ на «намерение» (токен + адрес + сумма): повтор тех же данных идёт с тем же ключом, новые данные или
  следующий вывод — с новым.
- Повторная отправка в Circle: `idempotencyKey` = id записи вывода плюс поиск по `refId` перед повтором
  (см. ниже).

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

**Без аутентификации**, как требует ТЗ: пользователь создаётся и выбирается из списка, выбор хранится в URL
(`?user=`). Ответы API не кэшируются браузером (без ETag), потому что UI их постоянно опрашивает.

**i18n на клиенте — `next-intl`**, языки `ru` (по умолчанию) и `en`, переключатель RU/EN в шапке. Язык хранится
в cookie `NEXT_LOCALE` (без префикса в URL, чтобы не ломать `?user=`); без cookie берётся из `Accept-Language`.
Ключи сообщений типизированы (`i18n/i18n.types.ts`): опечатка в ключе или пропущенный аргумент — ошибка
typecheck. Ошибки API переводятся по `error.code` (`insufficient_funds`, `network_error`, …), остальные
показываются как есть. Даты форматируются в языке интерфейса и часовом поясе пользователя. Бэкенд
не локализован: он отдаёт коды ошибок, а не тексты для пользователя.

### Что сделал бы дальше
- Аутентификация и авторизация по владельцу: сейчас любой может вывести с любого кошелька. Это сознательное
  упрощение по ТЗ (выбор пользователя из списка).
- Rate limiting и лимиты на вывод, проверка адреса получателя (screening).
- Вынести reconciler в отдельный воркер или cron (pg_cron / Supabase Edge Function) с распределённой блокировкой
  на случай нескольких инстансов бэкенда.
- Пагинация истории.
