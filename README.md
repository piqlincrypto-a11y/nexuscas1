# NEXUS — крипто-казино

Полноценный продукт без сторонних водяных знаков и демо-режима: реальные деньги в центах, 12 игр, мультиплеер, админ-панель, RU/EN, Provably Fair, Telegram-бот.

## Стек

- **Сервер**: Express + `node:sqlite` + `ws` (Node 20+)
- **Клиент**: React 18 + Vite 6 + Tailwind v4 (папка `client/`)
- **Сборка**: Vite отдаётся сервером из `dist/` (deep-links фолбэком на SPA)

## Быстрый старт

```bash
npm install
npm run build        # собрать client -> dist/
npm start            # production: http://localhost:4000
# или разработка (API :4000 + vite :5173 с прокси):
npm run dev
```

Windows: использовать `npm.cmd` (PowerShell-скрипты могут быть заблокированы политикой).

Сервер после правок server/*.js обязательно перезапускать.

## Тесты

```bash
node server/index.js &        # тесты идут против :4000
export ADMIN_PASS=...         # или создать test/.creds.json
node test/api.mjs             # HTTP API (22)
node test/ws.mjs              # WS: криш, мультирулетка, покер (23)
node test/client.mjs          # контракт UI <-> API (51)
node test/i18n-keys.mjs       # все t("key") есть в словарях RU/EN
node test/check-sql.mjs       # консистентность prepared statements (48)
node test/check-inserts.mjs   # консистентность INSERT
```

Или `npm test` (сервер должен быть запущен).

## Учётные записи (тестовая БД `data/nexus.db`)

| Роль    | Логин     | Пароль         |
|---------|-----------|----------------|
| Админ   | `admin`   | создаётся автоматически при первом старте (пароль печатается в консоль; можно задать `ADMIN_USERNAME`/`ADMIN_PASSWORD` в env) |
| Игрок   | `player1` | `secret12345`  |
| Тест WS | `wstester1` / `wstester2` | `secret12345` |

Пароль админа для тестов: переменная окружения `ADMIN_PASS` **или** файл `test/.creds.json` (в git-игноре): `{"adminPass": "..."}`.

## Игры (12)

`crash`, `dice`, `limbo`, `mines`, `roulette`, `slots`, `plinko`, `wheel`, `keno`, `hilo`, `mproulette` (мультирулетка с общим пулом), `poker` (техасский холдем, 2–5 мест).

## Денежная модель

- Все суммы хранятся в **центах** (int).
- Ставка двухфазная: `openBet` → `closeBet` / `recordEscrowedBet` (гонки и WS не теряют деньги).
- Из любого луза `admin_commission_pct = 50` → админу, остальное победителю.
- House edge `house_edge_pct = 5` закладывается в выплаты.
- **New-Player Boost**: `boost_enabled = 1`, первые `boost_bets = 30` ставок без комиссии (прозрачно, вместо скрытого рига).

## Ключевые эндпоинты

- `GET /api/meta`, `GET /api/games`, `GET /api/feed/live`, `GET /api/leaderboard`, `GET /api/promotions`
- `POST /api/auth/{register,login,logout}`, `GET /api/auth/session` (HttpOnly cookie `nexus_token`)
- `GET /api/me`, `GET /api/wallet`, `POST /api/wallet/deposit|withdraw` (ручной режим + вебхук `POST /api/wallet/webhook` c `webhook_secret`)
- `GET /api/me/bets`, `GET/POST /api/games/pf*`
- `GET /api/account/telegram`, `POST /api/account/telegram/code`
- `GET /api/admin/*` — overview, players, bets, rounds, transactions, settings, audit, referrals, export

## WebSocket

Единый сокет `/ws`. Подписки `sub/unsub` по комнатам; комнаты: `crash`, `mp:<id>`, `poker:<id>`, `feed`, `balance`.
Команды: `crash:join/crash:cashout`, `mp:create/join/quick/leave/bet/list`, `poker:sit/poker:action`.
Апгрейд требует cookie `nexus_token` (проверяется на handshake).

## Админ-панель `/admin`

Обзор (GGR, комиссия, депозиты/выводы, топы), игроки, ставки, раунды, транзакции, настройки (house edge, комиссия, boost, лимиты, вебхук-секрет, телеграм-токен), аудит, рефералы, экспорт дампа.

## RU/EN

Словари в `client/src/lib/i18n.jsx` (330 ключей), выбор языка в шапке, `POST /api/auth/language` сохраняет на сервере.

## Проверка на демо/водяные знаки

`test/client.mjs` падает, если в shell появятся упоминания Hercules или demo-кредитов.
