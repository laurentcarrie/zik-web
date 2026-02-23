.PHONY: help start stop restart backend frontend build check test kill-backend kill-frontend reindex

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
	curl -s -X POST -H "X-Write-Password: $(WRITE_PASSWORD)" http://localhost:8080/api/world

prod-reindex:
	curl -sk -X POST -H "X-Write-Password: $(WRITE_PASSWORD)" https://move-the-line.org/api/world

