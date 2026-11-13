# Curl-команды для локальной разработки Go API.
# Маршруты совпадают с backend-python (Okapi).
#
# Linux / macOS / Git Bash / WSL:
#   make -C backend help
#   make -C backend login
#   make -C backend me TOKEN=<access_token>
#
# Редакторские маршруты требуют Bearer-токен роли editor
# (логин с EDITOR_KEY). Публичные маршруты токен не требуют.

BASE       ?= http://127.0.0.1:8000
USERNAME   ?= dev
PASSWORD   ?= devpass
EDITOR_KEY ?= change-me-editor-key
TOKEN      ?=
NODE_ID    ?= base-forest
TARGET_ID  ?= base-construction
EDGE_ID    ?=
JOB_ID     ?=
FOCUS_ID   ?=

CURL ?= curl
SHOW ?= -sS -w "\nHTTP %{http_code}\n"

.PHONY: help require-token \
	health register login me \
	graph-roots graph graph-focus \
	node create-node patch-node delete-node batch-patch \
	create-edge delete-edge \
	ai-outgoing expand job

help: ## Список curl-целей
	@echo BMap API — curl для разработки  BASE=$(BASE)
	@echo.
	@echo "  Переменные: USERNAME PASSWORD EDITOR_KEY TOKEN NODE_ID TARGET_ID EDGE_ID JOB_ID FOCUS_ID"
	@echo "  Логин редактора: make login    затем TOKEN=... для защищённых целей"
	@echo.
	@echo "  health          GET    /api/health"
	@echo "  register        POST   /api/auth/register"
	@echo "  login           POST   /api/auth/login"
	@echo "  me              GET    /api/auth/me"
	@echo "  graph-roots     GET    /api/graph/roots"
	@echo "  graph           GET    /api/graph"
	@echo "  graph-focus     GET    /api/graph?focusId="
	@echo "  node            GET    /api/nodes/{id}"
	@echo "  create-node     POST   /api/nodes                  editor"
	@echo "  patch-node      PATCH  /api/nodes/{id}             editor"
	@echo "  delete-node     DELETE /api/nodes/{id}             editor"
	@echo "  batch-patch     POST   /api/nodes/batch-patch      editor"
	@echo "  create-edge     POST   /api/edges                  editor"
	@echo "  delete-edge     DELETE /api/edges/{id}             editor"
	@echo "  ai-outgoing     GET    /api/nodes/{id}/ai-outgoing"
	@echo "  expand          POST   /api/nodes/{id}/expand      editor"
	@echo "  job             GET    /api/ai/jobs/{id}           editor"
	@echo.
	@echo "  WebSocket (не HTTP): $(BASE)/api/ws?token=<TOKEN>   editor"

require-token:
	@test -n "$(TOKEN)" || (echo "Задайте TOKEN= (сначала: make login)" && exit 1)

health: ## GET /api/health
	$(CURL) $(SHOW) "$(BASE)/api/health"

register: ## POST /api/auth/register
	$(CURL) $(SHOW) -X POST "$(BASE)/api/auth/register" \
		-H "Content-Type: application/json" \
		-d '{"username":"$(USERNAME)","password":"$(PASSWORD)"}'

login: ## POST /api/auth/login (с editorKey — роль editor)
	$(CURL) $(SHOW) -X POST "$(BASE)/api/auth/login" \
		-H "Content-Type: application/json" \
		-d '{"username":"$(USERNAME)","password":"$(PASSWORD)","editorKey":"$(EDITOR_KEY)"}'

me: require-token ## GET /api/auth/me
	$(CURL) $(SHOW) "$(BASE)/api/auth/me" \
		-H "Authorization: Bearer $(TOKEN)"

graph-roots: ## GET /api/graph/roots
	$(CURL) $(SHOW) "$(BASE)/api/graph/roots"

graph: ## GET /api/graph
	$(CURL) $(SHOW) "$(BASE)/api/graph"

graph-focus: ## GET /api/graph?focusId=$(FOCUS_ID)
	$(CURL) $(SHOW) "$(BASE)/api/graph?focusId=$(FOCUS_ID)"

node: ## GET /api/nodes/$(NODE_ID)
	$(CURL) $(SHOW) "$(BASE)/api/nodes/$(NODE_ID)"

create-node: require-token ## POST /api/nodes
	$(CURL) $(SHOW) -X POST "$(BASE)/api/nodes" \
		-H "Authorization: Bearer $(TOKEN)" \
		-H "Content-Type: application/json" \
		-d '{"name":"Dev node","nodeType":"ACTOR","positionX":100,"positionY":100,"color":"#4A90D9","note":"makefile"}'

patch-node: require-token ## PATCH /api/nodes/$(NODE_ID)
	$(CURL) $(SHOW) -X PATCH "$(BASE)/api/nodes/$(NODE_ID)" \
		-H "Authorization: Bearer $(TOKEN)" \
		-H "Content-Type: application/json" \
		-d '{"name":"Renamed","note":"makefile","positionX":40,"positionY":40}'

delete-node: require-token ## DELETE /api/nodes/$(NODE_ID)
	$(CURL) $(SHOW) -X DELETE "$(BASE)/api/nodes/$(NODE_ID)" \
		-H "Authorization: Bearer $(TOKEN)"

batch-patch: require-token ## POST /api/nodes/batch-patch
	$(CURL) $(SHOW) -X POST "$(BASE)/api/nodes/batch-patch" \
		-H "Authorization: Bearer $(TOKEN)" \
		-H "Content-Type: application/json" \
		-d '[{"id":"$(NODE_ID)","positionX":10,"positionY":20}]'

create-edge: require-token ## POST /api/edges
	$(CURL) $(SHOW) -X POST "$(BASE)/api/edges" \
		-H "Authorization: Bearer $(TOKEN)" \
		-H "Content-Type: application/json" \
		-d '{"sourceId":"$(NODE_ID)","targetId":"$(TARGET_ID)"}'

delete-edge: require-token ## DELETE /api/edges/$(EDGE_ID)
	$(CURL) $(SHOW) -X DELETE "$(BASE)/api/edges/$(EDGE_ID)" \
		-H "Authorization: Bearer $(TOKEN)"

ai-outgoing: ## GET /api/nodes/$(NODE_ID)/ai-outgoing
	$(CURL) $(SHOW) "$(BASE)/api/nodes/$(NODE_ID)/ai-outgoing"

expand: require-token ## POST /api/nodes/$(NODE_ID)/expand
	$(CURL) $(SHOW) -X POST "$(BASE)/api/nodes/$(NODE_ID)/expand" \
		-H "Authorization: Bearer $(TOKEN)" \
		-H "Content-Type: application/json" \
		-d '{"force":false}'

job: require-token ## GET /api/ai/jobs/$(JOB_ID)
	$(CURL) $(SHOW) "$(BASE)/api/ai/jobs/$(JOB_ID)" \
		-H "Authorization: Bearer $(TOKEN)"
