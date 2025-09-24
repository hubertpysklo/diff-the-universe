from jwt import decode, encode
from os import environ
from datetime import datetime, timedelta
from uuid import uuid4


class TokenHandler:
    def __init__(self, secret: str = environ["SECRET_KEY"], audience: str = "dtu"):
        self.secret = secret
        self.audience = audience

    def decode_token(self, token: str) -> dict:
        return decode(
            token,
            self.secret,
            algorithms=["HS256"],
            audience=self.audience,
            options={"require": ["exp", "iat", "aud"]},
        )

    def encode_token(self, payload: dict) -> str:
        return encode(payload, self.secret, algorithm="HS256")

    def issue_token(
        self,
        *,
        environment_id: str,
        user_id: int,
        impersonate_user_id: int | None = None,
        token_ttl_seconds: int = 1800,
    ) -> str:
        now = datetime.now()
        payload = {
            "sub": str(user_id),
            "environment_id": environment_id,
            "impersonate_user_id": impersonate_user_id,
            "iat": now,
            "exp": now + timedelta(seconds=token_ttl_seconds),
            "jti": uuid4().hex,
            "aud": self.audience,
        }
        return self.encode_token(payload)
