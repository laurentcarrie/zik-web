.PHONY: help start stop restart backend frontend build check test kill-backend kill-frontend

help:
	@echo "make start           Start backend + frontend"
	@echo "make stop            Stop backend + frontend"
	@echo "make restart         Stop then start"
	@echo "make backend         Start backend on :8080"
	@echo "make frontend        Build + start Vite dev on :3000"
	@echo "make build-frontend  TypeScript check + Vite build"
	@echo "make check           cargo check"
	@echo "make test            cargo test"

BACKEND_ENV = BUCKET=zik-laurent BUCKET_ROOT=dev AWS_PROFILE=zik-laurent WRITE_PASSWORD=xxx FAVICON=favicon-dev-32x32.png

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

check:
	cd zik-web && rtk cargo check

test:
	cd zik-web && AWS_PROFILE=zik-laurent rtk cargo test

kill-backend:
	-kill $$(lsof -ti :8080) 2>/dev/null || true

kill-frontend:
	-kill $$(lsof -ti :3000) 2>/dev/null || true
