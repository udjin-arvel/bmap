# Развёртывание BMap

Краткое руководство: как поднять проект **локально** (разработка) и **на проде** (VPS / свой сервер).  
Удобные команды — в [Makefile](Makefile): `make help`.

---

## Что входит в стек

| Компонент | Назначение |
|-----------|------------|
| **web** | Собранный клиент (TanStack Start) + nginx: UI и прокси `/api` → API |
| **api** | Okapi: граф, auth, DeepSeek, WebSocket |
| **neo4j** | Граф `MarketNode` / `NEXT_STEP` |
| **SQLite** (volume `api_data`) | Пользователи, `applied_seeds` |

Секреты и ключи — только в `.env` на сервере, не в git.

---

## Требования

- **Docker** 24+ и **Docker Compose** v2  
- Для гибридной разработки: **Node.js 20+** (или **Bun**) в `client/`  
- Для API без Docker: **Python 3.12+** в `backend/`  
- На проде: домен, HTTPS (Let's Encrypt), открытые порты **80/443** (Neo4j наружу не публикуем)

---

## Первичная настройка

1. Клонируйте репозиторий на машину.
2. Создайте `.env`:

   ```bash
   cp .env.example .env
   ```

   Или: `make env`

3. Задайте в `.env` **уникальные** значения:

   | Переменная | Назначение |
   |------------|------------|
   | `NEO4J_PASSWORD` | Пароль Neo4j |
   | `JWT_SECRET` | Секрет JWT (длинная случайная строка) |
   | `EDITOR_KEY` | Ключ редактора в UI |
   | `SEED_VIEWER_PASSWORD` | Пароль пользователя `viewer` при первом старте |
   | `DEEPSEEK_API_KEY` | Ключ DeepSeek (AI на узлах); без него expand упадёт с ошибкой |
   | `WEB_PORT` | Порт UI на localhost (по умолчанию **18480**) |
   | `API_PORT` | Порт API на localhost (по умолчанию **18400**) |

4. Опционально: `DEEPSEEK_BASE_URL`, `DEEPSEEK_MODEL`, `CORS_ORIGINS` (для dev с другого origin).

---

## Локально: полный стек в Docker

Подходит, чтобы быстро проверить «как на проде».

```bash
make up-build
# или в фоне:
make up-d
```

- UI: http://127.0.0.1:18480 (или `WEB_PORT` из `.env`)  
- API напрямую: http://127.0.0.1:18400  
- Health: http://127.0.0.1:18480/api/health — `make health`  
- Neo4j на хост не публикуется, Bolt только внутри compose (`bolt://neo4j:7687`)

**Вход:** логин `viewer`, пароль — `SEED_VIEWER_PASSWORD`, ключ редактора — `EDITOR_KEY`. Новые пользователи — регистрация в UI или `POST /api/auth/register` (роль `viewer`).

Остановка: `make down`. Логи: `make logs` / `make logs-api`.

---

## Локально: гибрид (рекомендуется для разработки UI)

Инфраструктура в Docker, клиент с hot reload на хосте.

**Терминал 1:**

```bash
make dev-infra
```

Поднимаются **neo4j** и **api** (на хосте `127.0.0.1:18400`).

**Терминал 2:**

```bash
cd client
cp .env.example .env.local   # Windows: copy .env.example .env.local
make client-dev              # из корня — или bun run dev / npm run dev
```

В `.env.local` должно быть `VITE_API_URL=/`. Vite проксирует `/api` на `http://127.0.0.1:18400` (см. `client/vite.config.ts`).

В модалке входа укажите сервер **`/`** (same-origin относительно dev-сервера).

---

## Локально: Windows / OSPanel без Docker для клиента

Тот же гибридный сценарий:

1. Docker Desktop: `docker compose up neo4j api` или `make dev-infra`.
2. В `client`: `npm install` → `npm run dev`.
3. `.env.local` с `VITE_API_URL=/`.

Если Docker недоступен — установите Neo4j отдельно, поднимите API из `backend/` (см. ниже) с `NEO4J_URI=bolt://localhost:7687`.

**Backend на хосте (PowerShell):**

```powershell
cd backend
py -3 -m venv .venv
.\.venv\Scripts\pip install -r requirements.txt
$env:NEO4J_URI="bolt://localhost:7687"
$env:NEO4J_USER="neo4j"
$env:NEO4J_PASSWORD="<из .env>"
$env:JWT_SECRET="<из .env>"
$env:EDITOR_KEY="<из .env>"
$env:SQLITE_PATH="./data/app.db"
.\.venv\Scripts\uvicorn app.main:app --reload --port 8000
```

Из корня: `make backend-install` и `make backend-dev` (если установлен GNU Make в Git Bash / WSL).

---

## Прод: Docker на VPS

Пример: Ubuntu 22.04+, 2 GB RAM минимум (Neo4j + API + web).

1. Установите Docker и Compose.
2. Скопируйте проект на сервер (git clone / rsync). **Не** коммитьте `.env`.
3. Создайте `.env` с **продакшен-секретами** и реальным `DEEPSEEK_API_KEY`.
4. Запуск:

   ```bash
   make up-d
   docker compose ps
   make health
   ```

5. Порты compose слушают только `127.0.0.1`. Снаружи открыты 80/443 хостового nginx.

### Reverse proxy и HTTPS

Готовый vhost: [docker/bmap.arvelov.space.conf](docker/bmap.arvelov.space.conf). Он проксирует `https://bmap.arvelov.space` на `http://127.0.0.1:18480` и прокидывает WebSocket (`/api/ws`). Сертификат тот же, что у thebook.

```bash
cp docker/bmap.arvelov.space.conf /etc/nginx/sites-available/bmap.arvelov.space.conf
ln -sfn /etc/nginx/sites-available/bmap.arvelov.space.conf /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

Статический `root /opt/bmap/dist` в этом vhost не нужен: страницы отдаёт Nitro в контейнере `web`, `/api` — его nginx на контейнер `api`.

Собранный клиент в образе `web` собирается с **`NITRO_PRESET=node-server`** (см. `client/Dockerfile`). Без этого Nitro отдаёт Cloudflare Worker, Node не слушает порт — nginx покажет **502**.

### CORS на проде

При доступе только через один домен (same-origin) CORS не нужен. Если API когда-либо вызывают с другого origin — добавьте origin в `CORS_ORIGINS` в `.env` API.

### Один инстанс API

Очередь AI-jobs и WebSocket — **в памяти одного процесса**. В `docker-compose.yml` держите **одну реплику** `api`. Горизонтальное масштабирование потребует Redis/очереди — в текущей версии не реализовано.

---

## Обновление релиза

```bash
git pull
make up-d          # пересборка при изменении Dockerfile/кода
# или явно:
docker compose up -d --build
```

При изменении только `.env`: `docker compose up -d --force-recreate api`.

---

## Бэкапы

| Данные | Где |
|--------|-----|
| Граф | Docker volume `neo4j_data` |
| Пользователи, seeds | Docker volume `api_data` (`SQLITE_PATH=/data/app.db`) |

Рекомендуется периодически:

- дамп Neo4j (`neo4j-admin database dump` или backup policy Neo4j 5);
- копия файла SQLite из volume `api_data`.

**Не выполняйте** `make clean-volumes` на проде без бэкапа — удалит оба volume.

---

## Проверка после деплоя

1. `GET /api/health` → `"status":"ok"`, neo4j и sqlite ok.
2. Открыть UI, загрузить карту (10 базовых областей слева после первого старта).
3. Войти с `EDITOR_KEY`, создать узел / связь.
4. AI: выбрать узел → **AI**; при настроенном DeepSeek — новая ветка; WebSocket только для роли editor.

---

## Demo-режим клиента

В UI можно выбрать сервер **demo** — mock в браузере, без API. Для интеграционных проверок используйте `/` или URL вашего деплоя.

---

## Справка

- [README.md](README.md) — обзор API и этапов  
- [Makefile](Makefile) — `make help`  
- Спека: [.project/bmap-tech-spec.md](.project/bmap-tech-spec.md)
