.DEFAULT_GOAL := help
.PHONY: help install install-browsers dev backend frontend test test-backend test-frontend e2e lint format typecheck build check clean

help: ## Show available commands
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

install: ## Install backend and frontend dependencies
	cd backend && uv sync
	cd frontend && npm install

install-browsers: ## Download Chromium for browser tests (system libs: see docs/DEVELOPMENT.md)
	cd frontend && npx playwright install chromium

dev: ## Run backend and frontend together
	./scripts/dev.sh

backend: ## Run only the backend (http://127.0.0.1:8000)
	cd backend && uv run python -m pixelgpu

frontend: ## Run only the frontend (http://localhost:5173)
	cd frontend && npm run dev

test: test-backend test-frontend ## Run all tests

test-backend:
	cd backend && uv run pytest

test-frontend:
	cd frontend && npm test

e2e: ## Browser tests (starts its own servers on ports 8765/5199)
	cd frontend && npm run test:e2e

lint: ## Lint and format-check everything
	cd backend && uv run ruff check . && uv run ruff format --check .
	cd frontend && npm run lint

format: ## Auto-format everything
	cd backend && uv run ruff check --fix . && uv run ruff format .
	cd frontend && npm run format

typecheck: ## Run mypy and tsc
	cd backend && uv run mypy
	cd frontend && npm run typecheck

build: ## Production frontend build
	cd frontend && npm run build

check: lint typecheck test build ## Everything CI would run

clean: ## Remove build artifacts and caches
	rm -rf frontend/dist frontend/node_modules/.tmp frontend/test-results frontend/playwright-report backend/.pytest_cache backend/.mypy_cache backend/.ruff_cache
