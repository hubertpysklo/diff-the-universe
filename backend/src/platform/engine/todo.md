# Engine TODO (Isolation, Templates, Evals)

## Phase 1 — Control plane (meta schema)
- [ ] Create `meta` schema with tables:
  - [ ] `meta.templates(id, service, owner_scope, name, version, kind['schema'|'artifact'|'jsonb'], location, seed_hash, created_at)`
  - [ ] `meta.test_states(id, schema, template_id, seed_hash, permanent, expires_at, max_idle_seconds, status, created_at, last_used_at)`
  - [ ] `meta.test_runs(id, template_id, state_schema, created_by, started_at, finished_at)`
  - [ ] `meta.agent_actions(id, run_id, state_schema, started_at, duration_ms, method, path_or_operation, status_code, req_body jsonb?, res_body jsonb?, trace_id)`
  - [ ] `meta.snapshots(id, run_id, kind['baseline'|'final'], data jsonb, created_at)`
  - [ ] `meta.diffs(id, run_id, baseline_id, final_id, diff jsonb, created_at)`
  - [ ] `meta.evaluations(id, run_id, pass boolean, details jsonb, created_at)`
- [ ] Alembic migration for `meta` schema

## Phase 2 — Template schemas
- [ ] Admin role that can `CREATE/USAGE` on `template_*` schemas; app role cannot
- [ ] Helper: run Linear migrations with `search_path` set to arbitrary schema
- [ ] Seed at least one template schema (e.g., `template_linear_minimal_v1`) via services/fixtures
- [ ] Register template in `meta.templates` (kind='schema', location=schema_name, seed_hash)

## Phase 3 — Init environment API
- [ ] `POST /init_state { template_id, impersonate_user_id|email, ttl_seconds?, permanent?, max_idle_seconds?, seed_overrides?, run_id? }`
- [ ] Flow:
  - [ ] Lookup template in `meta.templates`
  - [ ] `CREATE SCHEMA "state_<uuid>"`
  - [ ] Run Linear migrations with `search_path="state_<uuid>"`
  - [ ] Clone data FK-safe from `template_*` → `state_<uuid>`; reset sequences
  - [ ] Insert `meta.test_states` row; optional `meta.test_runs`
  - [ ] Issue short‑lived JWT: claims `{ sub, state_id, run_id?, iat, exp, jti }`
  - [ ] Return `{ state_id, token, expires_at, run_id }`

## Phase 4 — Routing middleware
- [ ] Verify JWT → get `state_id`
- [ ] Load `meta.test_states`; enforce `permanent/ttl/max_idle`
- [ ] Resolve `schema` and set per-transaction routing:
  - [ ] `SET LOCAL search_path TO "<schema>", public`
  - [ ] or `schema_translate_map={None: "<schema>"}`
- [ ] Update `last_used_at`
- [ ] Attach `state_id/run_id` to request context + trace attrs
- [ ] Reject any schema not matching `^state_[a-f0-9]+$`

## Phase 5 — Save-as-template API (researcher UX)
- [ ] `POST /templates/save { state_id, name, visibility[global|org|user], version_note?, redact? }`
- [ ] Flow:
  - [ ] Validate state schema; (optional) redact
  - [ ] `CREATE SCHEMA "template_linear_<name>_vN"`
  - [ ] Copy rows FK-safe from state → template; reset sequences
  - [ ] Insert `meta.templates` pointer (owner_scope, schema_name, seed_hash)

## Phase 6 — Observability
- [ ] OpenTelemetry for HTTP + SQL; attrs: `state_id`, `run_id`, `operation_name`
- [ ] Interceptor logs each request into `meta.agent_actions` (duration, status, hashes or redacted bodies, trace_id)
- [ ] Correlate traces via `trace_id`

## Phase 7 — Snapshot & diff
- [ ] Snapshotter (Linear): deterministic, minimal JSON for core tables
- [ ] `POST /finalize_run { run_id }`:
  - [ ] Take final snapshot
  - [ ] Compute diff (added/updated/deleted per table, field-wise)
  - [ ] Store in `meta.snapshots` and `meta.diffs`

## Phase 8 — Evaluation & rewards
- [ ] Coded assertions: expected/forbidden/invariants over snapshot+diff
- [ ] Optional LLM judge on compact “case file” (strict JSON output; store model/version/prompt hash)
- [ ] Compute reward; insert `meta.evaluations`
- [ ] Return reward + evaluation to caller

## Phase 9 — Security & policy
- [ ] DB roles:
  - [ ] `engine_role`: access to `template_*`, can `CREATE SCHEMA`, migrations, cloning
  - [ ] `app_role`: access to `state_*` only; no `template_*`
- [ ] Short‑lived tokens; server-side policy in `meta.test_states`
- [ ] Redaction utilities for “save as template” and logs

## Phase 10 — Performance & pooling
- [ ] DB pool tuning (e.g., `pool_size`, `max_overflow`, pre_ping)
- [ ] Optional prewarmed state pool per popular template (checkout/refill)
- [ ] Concurrency test: 100 parallel init/run/finalize cycles

## CLI/SDK
- [ ] CLI: `init-state`, `finalize-run`, `save-template`, `list-templates`
- [ ] Python SDK helpers for tests/RL loops

## Docs
- [ ] README: isolation model, template workflow, API examples
- [ ] Researcher guide: create/edit seeds, save as template, share
- [ ] Ops guide: TTL/idle cleanup, Neon notes, migrations per schema