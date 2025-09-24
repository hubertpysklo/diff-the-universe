from __future__ import annotations
from datetime import datetime
from sqlalchemy.orm import Session, sessionmaker
from backend.src.platform.engine.auth import TokenHandler
from sqlalchemy import create_engine
from os import environ
from backend.src.platform.db.schema import RunTimeEnvironment


class SessionManager:
    def __init__(self):
        self.base_engine = create_engine(environ["DATABASE_URL"], echo=True)
        self.token_handler = TokenHandler()

    def get_meta_session(self) -> Session:
        return sessionmaker(bind=self.base_engine)()

    def get_session_for_schema(self, schema: str) -> Session:
        translated_engine = self.base_engine.execution_options(
            schema_translate_map={
                None: schema,
            }
        )
        return sessionmaker(bind=translated_engine)()

    def get_session_for_token(self, token: str) -> Session:
        claims = self.token_handler.decode_token(token)
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
