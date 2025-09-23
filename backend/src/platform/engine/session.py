from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime
from typing import Iterator

import jwt
from sqlalchemy import cast, String
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from backend.src.platform.db.schema import RunTimeEnvironment


class SessionManager:
    def __init__(self, base_engine: Engine):
        self.base_engine = base_engine

    def get_meta_session(self) -> Session:
        return sessionmaker(bind=self.base_engine)()

    def get_session_for_schema(self, schema: str) -> Session:
        translated_engine = self.base_engine.execution_options(
            schema_translate_map={
                None: schema,
            }
        )
        return sessionmaker(bind=translated_engine)()

    def decode_token(self, token: str, *, secret: str, audience: str = "dtu") -> dict:
        return jwt.decode(
            token,
            secret,
            algorithms=["HS256"],
            audience=audience,
            options={"require": ["exp", "iat", "aud"]},
        )

    def get_session_for_token(
        self, token: str, *, secret: str, audience: str = "dtu"
    ) -> Session:
        claims = self.decode_token(token, secret=secret, audience=audience)
        environmentId = claims["environmentId"]
        meta_session = self.get_meta_session()
        try:
            environment = (
                meta_session.query(RunTimeEnvironment)
                .filter(RunTimeEnvironment.id == environmentId)
                .one_or_none()
            )

            if environment is None:
                raise PermissionError("environment not found")

            environment.lastUsedAt = datetime.now()
            meta_session.commit()

        finally:
            meta_session.close()

        return self.get_session_for_schema(environment.schema)
