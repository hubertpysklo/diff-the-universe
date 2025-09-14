.PHONY: up down logs ps db psql migrate migration backend-dev

up:
	docker compose up 

down:
	docker compose down

logs:
	docker compose logs

migration:
	cd backend && uv run alembic revision --autogenerate -m "$(m)"

migrate:
	cd backend && uv run alembic upgrade head

backend-dev: up
	cd backend && uv run main.py