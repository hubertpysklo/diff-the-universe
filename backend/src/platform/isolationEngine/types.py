from dataclasses import dataclass
from datetime import datetime


@dataclass
class InitEnvRequest:
    environment_schema: str
    impersonate_user_id: str | None = None
    impersonate_email: str | None = None
    ttl_seconds: int = 1800
    permanent: bool = False
    max_idle_seconds: int = 1800


@dataclass
class InitEnvResult:
    environment_id: str
    impersonate_user_id: str
    expires_at: datetime
    token: str  # This is a JWT token for the client to access the correct environment state
