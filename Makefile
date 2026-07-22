.PHONY: setup dev test lint typecheck migrate seed e2e down

setup:
	npm ci
	python -m pip install -e "./apps/api[dev]"

dev:
	docker compose up --build

test:
	npm run test
	python -m pytest apps/api/tests

lint:
	npm run lint
	python -m ruff check apps/api

typecheck:
	npm run typecheck
	python -m mypy apps/api/app

migrate:
	cd apps/api && alembic upgrade head

seed:
	cd apps/api && python -m app.seed

e2e:
	npm run test:frontend
	python -m pytest apps/api/tests/test_api.py

down:
	docker compose down
