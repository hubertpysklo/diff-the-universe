from dataclasses import dataclass
from datetime import datetime


@dataclass
class InitEnvRequest:
    environment_schema: str
    impersonate_user_id: int | None = None
    impersonate_email: str | None = None
    ttl_seconds: int | None = None
    permanent: bool = False
    max_idle_seconds: int | None = None
    run_id: str | None = None


@dataclass
class InitEnvResult:
    state_id: str
    schema: str
    run_id: str | None
    expires_at: datetime | None
    token: str | None = (
        None  # This is a JWT token for the client to access the correct environment state
    )


@dataclass
class InitTokenRequest:
    state_id: str
    user_id: int
    otel_trace_id: str | None = None  # Optional for linking with OTLP traces
    token_ttl_seconds: int = 1800
    scopes: list[str] | None = None
