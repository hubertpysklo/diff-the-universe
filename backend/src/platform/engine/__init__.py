from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Iterator
from uuid import uuid4

import base64
import hashlib
import hmac
import json
from sqlalchemy import text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker


@dataclass
class InitEnvRequest:
    template_schema: str
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


@dataclass
class InitTokenRequest:
    state_id: str
    user_id: int
    run_id: str | None = None
    token_ttl_seconds: int = 1800
    scopes: list[str] | None = None
