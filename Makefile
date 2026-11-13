# BMap — обёртки над docker compose и локальной разработкой.
# Linux / macOS / Git Bash / WSL: `make help`

COMPOSE   ?= docker compose
ENV_FILE  ?= .env
WEB_PORT  ?= 8080
API_URL   ?= http://127.0.0.1:8000/api/health
WEB_URL   ?= http://127.0.0.1:$(WEB_PORT)/api/health

.PHONY: help env up up-build up-d down restart ps logs logs-api logs-web \
        dev-infra dev-client backend-venv backend-install backend-dev \
        client-install client-dev client-build client-test client-lint \
        health shell-api shell-neo4j clean clean-volumes rebuild rebuild-api

help: ## Список команд
	@echo BMap — доступные цели:
	@echo.
	@grep -E '^[a-zA-Z0-9_-]+:.*##' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

env: ## Создать .env из .env.example (если ещё нет)
	@if [ ! -f $(ENV_FILE) ]; then cp .env.example $(ENV_FILE) && echo "Created $(ENV_FILE)"; else echo "$(ENV_FILE) already exists"; fi

up: env ## Запустить neo4j + api + web (foreground)
	$(COMPOSE) up

up-build: env ## Собрать образы и запустить стек
	$(COMPOSE) up --build

up-d: env ## Запустить стек в фоне
	$(COMPOSE) up -d

down: ## Остановить контейнеры (данные в volumes сохраняются)
	$(COMPOSE) down

restart: ## Перезапустить сервисы
	$(COMPOSE) restart

ps: ## Статус контейнеров
	$(COMPOSE) ps

logs: ## Логи всех сервисов
	$(COMPOSE) logs -f --tail=200

logs-api: ## Логи API
	$(COMPOSE) logs -f --tail=200 api

logs-web: ## Логи web (nginx + Nitro)
	$(COMPOSE) logs -f --tail=200 web

dev-infra: env ## Только Neo4j + API (для Vite на хосте)
	$(COMPOSE) up neo4j api

dev-client: ## Подсказка: клиент с прокси /api -> :8000
	@echo "cd client && copy .env.example .env.local  (Windows)"
	@echo "cd client && cp .env.example .env.local    (Unix)"
	@echo "cd client && bun run dev   # или: npm run dev"
	@echo "Откройте URL Vite; VITE_API_URL=/ и proxy на http://127.0.0.1:8000"

backend-venv: ## Python venv в backend/.venv
	cd backend && (python3 -m venv .venv || py -3 -m venv .venv)

backend-install: backend-venv ## pip install -r backend/requirements.txt
	cd backend && .venv/bin/pip install -r requirements.txt 2>/dev/null || cd backend && .venv/Scripts/pip install -r requirements.txt

backend-dev: ## Uvicorn с reload (Neo4j должен быть доступен)
	cd backend && .venv/bin/uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 2>/dev/null || cd backend && .venv/Scripts/uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

client-install: ## Установить зависимости клиента
	cd client && (bun install 2>/dev/null || npm install)

client-dev: ## Dev-сервер клиента (TanStack Start / Vite)
	cd client && (bun run dev 2>/dev/null || npm run dev)

client-build: ## Production-сборка клиента
	cd client && (bun run build 2>/dev/null || npm run build)

client-test: ## Vitest
	cd client && (bun run test 2>/dev/null || npm run test)

client-lint: ## ESLint клиента
	cd client && (bun run lint 2>/dev/null || npm run lint)

health: ## Проверить /api/health (API :8000 и web :$(WEB_PORT))
	@echo "API direct: $(API_URL)"
	@curl -sf "$(API_URL)" && echo || echo "API not reachable"
	@echo "Via web:    $(WEB_URL)"
	@curl -sf "$(WEB_URL)" && echo || echo "Web proxy not reachable"

shell-api: ## Shell в контейнере api
	$(COMPOSE) exec api sh

shell-neo4j: ## Cypher-shell в Neo4j (пароль из .env)
	$(COMPOSE) exec neo4j cypher-shell -u neo4j -p "$${NEO4J_PASSWORD:-change-me-neo4j}"

rebuild: ## Пересобрать все образы без кэша
	$(COMPOSE) build --no-cache

rebuild-api: env ## Пересобрать образ api и перезапустить (NO_CACHE=1 — без кэша Docker)
	$(COMPOSE) build $(if $(NO_CACHE),--no-cache,) api
	$(COMPOSE) up -d --force-recreate api

clean: down ## alias: down

clean-volumes: ## ОСТОРОЖНО: down + удалить volumes (Neo4j + SQLite)
	@echo "This removes neo4j_data and api_data volumes."
	$(COMPOSE) down -v
