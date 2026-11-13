# BMap — карта рынка

Подробное развёртывание: **[DEPLOY.md](DEPLOY.md)**. Команды Docker и dev: **`make help`**.

## Быстрый старт (Docker)

1. Скопируйте `.env.example` в `.env` и задайте секреты (`JWT_SECRET`, `NEO4J_PASSWORD`, `EDITOR_KEY`).
2. `make up-build` или `docker compose up --build`
3. Откройте http://127.0.0.1:18480 — UI; API доступен по `/api/*` через nginx.
4. Вход: пользователь `viewer`, пароль из `SEED_VIEWER_PASSWORD` (по умолчанию `viewer`), или **регистрация** (`POST /api/auth/register`, роль `viewer`). Ключ редактора — значение `EDITOR_KEY`.

Проверка API: `GET http://127.0.0.1:18480/api/health` или `http://127.0.0.1:18400/api/health`. Оба порта только на localhost.

## Локальная разработка без пересборки web

```powershell
make dev-infra
# или: docker compose up neo4j api
cd client
copy .env.example .env.local
bun run dev
```

В настройках входа укажите сервер `/` (или оставьте `VITE_API_URL=/` в `.env.local`). Vite проксирует `/api` на `http://127.0.0.1:18400`.

## Backend отдельно

```powershell
cd backend
py -3 -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt
$env:NEO4J_URI="bolt://localhost:7687"
$env:JWT_SECRET="dev-secret"
$env:EDITOR_KEY="dev-editor"
.\.venv\Scripts\uvicorn app.main:app --reload --port 8000
```

Требуется запущенный Neo4j с теми же учётными данными, что в `.env`.

## API графа (этап 2)

| Метод | Путь | Права | Описание |
|---|---|---|---|
| GET | `/api/graph` | все | Весь граф; `?focusId=` — только ветка узла |
| GET | `/api/graph/roots` | все | Корневые узлы для переключателя веток |
| GET | `/api/nodes/{id}` | все | Полный узел (включая описание) |
| POST | `/api/nodes` | editor | Создать узел |
| PATCH | `/api/nodes/{id}` | editor | Обновить узел (`descriptionPinned` и др.) |
| DELETE | `/api/nodes/{id}` | editor | Удалить узел и связи |
| POST | `/api/nodes/batch-patch` | editor | Пакетное обновление (JSON или `text/plain`, JWT в `?token=`) |
| POST | `/api/edges` | editor | Создать связь |
| DELETE | `/api/edges/{id}` | editor | Удалить связь |

При старте API создаются 10 базовых областей из `backend/app/seeds/base_markets.json` (один раз на `seed_id`). В списке графа поле `description` отдаётся только если `descriptionPinned=true`; иначе есть флаг `hasDescription`.

## AI / DeepSeek (этап 4)

В `.env` задайте `DEEPSEEK_API_KEY` (и при необходимости `DEEPSEEK_BASE_URL`, `DEEPSEEK_MODEL`).

| Метод | Путь | Описание |
|---|---|---|
| POST | `/api/nodes/{id}/expand` | `{ "force": false }` → `{ "jobId" }`, фоновая генерация |
| GET | `/api/nodes/{id}/ai-outgoing` | Есть ли уже AI-цепочка |
| GET | `/api/ai/jobs/{jobId}` | Статус и результат (fallback без WebSocket) |
| WS | `/api/ws?token=` | Только `editor`: `ai.status`, `graph.patch` |

В demo-режиме клиента AI строит короткую demo-цепочку без DeepSeek.
