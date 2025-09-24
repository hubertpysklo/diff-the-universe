from backend.src.platform.engine.auth import TokenHandler
from backend.src.platform.engine.session import SessionManager
from contextlib import contextmanager


class Core:
    def __init__(self, token: TokenHandler, sessions: SessionManager):
        self.token = token
        self.sessions = sessions

    def get_session_for_token(self, token: str):
        claims = self.token.decode_token(token)
        schema, _ = self.sessions.lookup_environment(claims["environment_id"])
        return self.sessions.get_session_for_schema(schema)

    @contextmanager
    def with_session(self, token: str):
        claims = self.token.decode_token(token)
        schema, _ = self.sessions.lookup_environment(claims["environment_id"])
        with self.sessions.get_session_for_schema(schema) as s:
            yield s
