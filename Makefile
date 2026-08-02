.PHONY: help start stop restart backend frontend build check test test-frontend kill-backend kill-frontend check-ports check-backend-port check-frontend-port fonts reindex prod-reindex refresh-and-reset deploy-fargate-dev deploy-fargate-prod

# .env uses shell syntax ($HOME/$PATH); make would mangle it into "OME/...:ATH",
# so keep the real PATH and re-apply the node bin dir with make syntax.
REAL_PATH := $(PATH)
include .env
export
PATH := $(HOME)/.local/node/bin:$(REAL_PATH)

BACKEND_PORT ?= 8080
FRONTEND_PORT ?= 3000

# Wait (up to ~5s) for a port to be released, then fail loudly if it is not.
# Used after the kill targets, since kill is asynchronous.
#
# Detection uses `ss`, not `lsof`: lsof only reports processes owned by the
# calling user, so a root-owned listener (typically a docker-proxy for a
# published container port) looks "free" right up until bind() fails with
# EADDRINUSE. `ss` lists every listening socket. lsof is still used afterwards,
# just to name the PIDs when they do belong to us.
# $(1) = port, $(2) = label
define wait-port-free
	@for i in 1 2 3 4 5 6 7 8 9 10; do \
		[ -n "$$(ss -ltnH "sport = :$(1)" 2>/dev/null)" ] || break; \
		sleep 0.5; \
	done; \
	if [ -n "$$(ss -ltnH "sport = :$(1)" 2>/dev/null)" ]; then \
		echo "Error: port $(1) ($(2)) is in use"; \
		pids=$$(lsof -ti :$(1) 2>/dev/null | tr '\n' ' '); \
		if [ -n "$$pids" ]; then \
			echo "       held by PID(s): $$pids -- kill them, then retry"; \
		else \
			echo "       no PID visible to this user, so it is root-owned or a container:"; \
			docker ps --format '         docker: {{.Names}} ({{.Ports}})' 2>/dev/null | grep ':$(1)->' \
				|| echo "         try: sudo ss -ltnp \"sport = :$(1)\""; \
		fi; \
		exit 1; \
	fi; \
	echo "port $(1) ($(2)) is free"
endef

help:
	@echo "make start           Start backend + frontend"
	@echo "make stop            Stop backend + frontend"
	@echo "make restart         Stop then start"
	@echo "make backend         Start backend on :$(BACKEND_PORT)"
	@echo "make frontend        Build + start Vite dev on :$(FRONTEND_PORT)"
	@echo "make build-frontend  TypeScript check + Vite build"
	@echo "make fonts           Install bundled fonts for circles-sketch text rendering"
	@echo "make check           cargo check"
	@echo "make test            cargo test"
	@echo "make test-frontend   Playwright e2e tests"
	@echo "make check-ports     Check that :$(BACKEND_PORT) and :$(FRONTEND_PORT) are free"
	@echo "make reindex         Re-index songs on localhost"
	@echo "make prod-reindex    Re-index songs on move-the-line.org"
	@echo "make deploy-fargate-dev  Deploy to Fargate dev via GitHub Actions"
	@echo "make deploy-fargate-prod Deploy to Fargate prod via GitHub Actions"
	@echo "make refresh-and-reset Reset work branch to main (fetch, reset, force push)"

#BACKEND_ENV = BUCKET=$(BUCKET) BUCKET_ROOT=$(BUCKET_ROOT) AWS_PROFILE=$(AWS_PROFILE) WRITE_PASSWORD=$(WRITE_PASSWORD) FAVICON=favicon-dev-32x32.png
#BACKEND_ENV = LOCAL_DIR=$$HOME/perso/songbook  WRITE_PASSWORD=$(WRITE_PASSWORD)

# BACKEND_ENV comes from .env, where the value must stay quoted so `source .env`
# handles the embedded space. Make keeps those quotes literally, which would turn
# the whole string into a single command name ("...: command not found") instead
# of a run of env assignments -- so strip them here.
BACKEND_ENV := $(subst ",,$(BACKEND_ENV))

start: backend frontend

stop: kill-backend kill-frontend

restart: stop start

backend: kill-backend fonts
	cd zik-web && $(BACKEND_ENV) rtk cargo run &

# Install the bundled fonts locally so circles-sketch text animations render.
# Mirrors Dockerfile.production; user-space (no sudo), idempotent.
fonts:
	@mkdir -p $$HOME/.local/share/fonts
	@cp zik-web/static/*.ttf $$HOME/.local/share/fonts/ 2>/dev/null || true
	@fc-cache -f $$HOME/.local/share/fonts >/dev/null 2>&1 || true

frontend: kill-frontend build-frontend
	cd frontend && npx vite --port $(FRONTEND_PORT) &

build-frontend:
	cd frontend && rtk npx tsc -b
	cd frontend && npx vite build
	rm -rf zik-web/dist && cp -r frontend/dist zik-web/dist

check:
	cd zik-web && rtk cargo check

test:
	cd zik-web && AWS_PROFILE=$(AWS_PROFILE) rtk cargo test

test-frontend:
	cd frontend && npx playwright test

kill-backend:
	-kill $$(lsof -ti :$(BACKEND_PORT)) 2>/dev/null || true
	$(call wait-port-free,$(BACKEND_PORT),backend)

kill-frontend:
	-kill $$(lsof -ti :$(FRONTEND_PORT)) 2>/dev/null || true
	$(call wait-port-free,$(FRONTEND_PORT),frontend)

check-ports: check-backend-port check-frontend-port

check-backend-port:
	$(call wait-port-free,$(BACKEND_PORT),backend)

check-frontend-port:
	$(call wait-port-free,$(FRONTEND_PORT),frontend)

# Both environments authenticate with the same WRITE_PASSWORD: the deploy
# workflows and the CloudFormation stacks all inject secrets.WRITE_PASSWORD.
# Read it as $$WRITE_PASSWORD (exported from .env) rather than $(WRITE_PASSWORD),
# and keep the recipes @-prefixed, so make never echoes the secret.
reindex:
	@[ -n "$$WRITE_PASSWORD" ] || { echo "Error: WRITE_PASSWORD not set (check .env)"; exit 1; }
	@curl -s -o /dev/null -w "HTTP %{http_code}\n" -X POST -H "X-Write-Password: $$WRITE_PASSWORD" http://localhost:$(BACKEND_PORT)/api/world

prod-reindex:
	@[ -n "$$WRITE_PASSWORD" ] || { echo "Error: WRITE_PASSWORD not set (check .env)"; exit 1; }
	@curl -sk -o /dev/null -w "HTTP %{http_code}\n" -X POST -H "X-Write-Password: $$WRITE_PASSWORD" https://move-the-line.org/api/world

deploy-fargate:
	gh workflow run $(YML) --ref main
	@while true ; do gh run list --workflow="$(YML)" -L 1 ; sleep 15 ; done

deploy-fargate-dev:
	make deploy-fargate YML="deploy-dev-fargate.yml"



deploy-fargate-prod:
	gh workflow run deploy-prod-fargate.yml --ref main
	@echo "Deploy triggered. Run 'gh run list --workflow=deploy-prod-fargate.yml -L 1' to check status."

refresh-and-reset:
	@branch=$$(git rev-parse --abbrev-ref HEAD); \
	if [ "$$branch" != "work" ]; then echo "Error: not on work branch (on $$branch)"; exit 1; fi
	@if [ -n "$$(git status --porcelain)" ]; then echo "Error: uncommitted changes"; git status --short; exit 1; fi
	git fetch origin main:main
	@local=$$(git rev-parse HEAD); remote=$$(git rev-parse main); \
	if [ "$$local" != "$$remote" ]; then echo "Error: work and main differ (work has unmerged commits)"; git log --oneline main..HEAD; exit 1; fi
	git reset --hard main
	git push --force

