from jwt import decode, encode
from os import environ
from datetime import datetime, timedelta
from uuid import uuid4
from backend.src.platform.engine.session import SessionManager
from sqlalchemy.orm import Session
from backend.src.platform.db.schema import User


class TokenHandler:
    def __init__(self, secret: str = environ["SECRET_KEY"]):
        self.secret = secret

    def decode_token(self, token: str) -> dict:
        return decode(token, self.secret, algorithms=["HS256"])

    def encode_token(self, payload: dict) -> str:
        return encode(payload, self.secret, algorithm="HS256")

    def get_and_validate_impersonate_user_id(self, impersonateUser: int | str) -> int:
        if isinstance(impersonateUser, int):
            impersonateUserInstance = self.platform_session.get(User, impersonateUser)
            if impersonateUserInstance is None:
                raise ValueError("User not found")
            return impersonateUserInstance.id
        elif isinstance(impersonateUser, str):
            impersonateUserInstance = (
                self.platform_session.query(User)
                .filter(User.email == impersonateUser)
                .one_or_none()
            )
            if impersonateUserInstance is None:
                raise ValueError("User not found")
            return impersonateUserInstance.id

    def issue_token(
        self,
        *,
        environment_id: str,
        user_id: int,
        impersonateUser: int | str,
        token_ttl_seconds: int = 1800,
    ) -> str:
        now = datetime.now()
        payload = {
            "sub": str(user_id),
            "environment_id": environment_id,
            "impersonate_user_id": self.get_and_validate_impersonate_user_id(
                impersonateUser, session
            ),
            "iat": now,
            "exp": now + timedelta(seconds=token_ttl_seconds),
            "jti": uuid4().hex,
            "aud": "dtu",
        }
        return self.encode_token(payload)
