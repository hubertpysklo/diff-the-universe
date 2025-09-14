.PHONY: install dev

install: 
	uv venv
	uv sync

dev:
	uv run main.py
	docker compose up -d