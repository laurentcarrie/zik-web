.PHONY: help start stop restart backend frontend build check test kill-backend kill-frontend reindex refresh-and-reset

help:
	@echo "make start           Start backend + frontend"
	@echo "make stop            Stop backend + frontend"
	@echo "make restart         Stop then start"
	@echo "make backend         Start backend on :8080"
	@echo "make frontend        Build + start Vite dev on :3000"
	@echo "make build-frontend  TypeScript check + Vite build"
	@echo "make check           cargo check"
	@echo "make test            cargo test"
	@echo "make reindex         Re-index songs on localhost"
	@echo "make refresh-and-reset  Reset work branch to main (fetch, reset, force push)"

BACKEND_ENV = BUCKET=$(BUCKET) BUCKET_ROOT=$(BUCKET_ROOT) AWS_PROFILE=$(AWS_PROFILE) WRITE_PASSWORD=$(WRITE_PASSWORD) FAVICON=favicon-dev-32x32.png

start: backend frontend

stop: kill-backend kill-frontend

restart: stop start

backend: kill-backend
	cd zik-web && $(BACKEND_ENV) rtk cargo run &

frontend: kill-frontend build-frontend
	cd frontend && npx vite --port 3000 &

build-frontend:
	cd frontend && rtk npx tsc -b
	cd frontend && npx vite build
	rm -rf zik-web/dist && cp -r frontend/dist zik-web/dist

check:
	cd zik-web && rtk cargo check

test:
	cd zik-web && AWS_PROFILE=$(AWS_PROFILE) rtk cargo test

kill-backend:
	-kill $$(lsof -ti :8080) 2>/dev/null || true

kill-frontend:
	-kill $$(lsof -ti :3000) 2>/dev/null || true

reindex:
	curl -s -o /dev/null -w "HTTP %{http_code}\n" -X POST -H "X-Write-Password: $(WRITE_PASSWORD)" http://localhost:8080/api/world

prod-reindex:
	curl -sk -o /dev/null -w "HTTP %{http_code}\n" -X POST -H "X-Write-Password: $(WRITE_PROD_PASSWORD)" https://move-the-line.org/api/world

refresh-and-reset:
	@branch=$$(git rev-parse --abbrev-ref HEAD); \
	if [ "$$branch" != "work" ]; then echo "Error: not on work branch (on $$branch)"; exit 1; fi
	@if [ -n "$$(git status --porcelain)" ]; then echo "Error: uncommitted changes"; git status --short; exit 1; fi
	git fetch origin main:main
	@local=$$(git rev-parse HEAD); remote=$$(git rev-parse main); \
	if [ "$$local" != "$$remote" ]; then echo "Error: work and main differ (work has unmerged commits)"; git log --oneline main..HEAD; exit 1; fi
	git reset --hard main
	git push --force

