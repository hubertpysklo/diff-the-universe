.PHONY: install up down dev migration migrate

install:
	uv venv
	uv sync

up:
	docker compose up 

down:
	docker compose down

dev:
	uv run main.py

migration:
	uv run alembic revision --autogenerate -m "$(m)"

migrate:
	uv run alembic upgrade head