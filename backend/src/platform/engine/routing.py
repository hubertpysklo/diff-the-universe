from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime
from typing import Iterator

import jwt
from sqlalchemy import cast, String
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from backend.src.platform.db.schema import TestState


@contextmanager
def get_session_for_token(
    engine: Engine,
    secret: str,
    token: str,
    *,
    meta_session: Session,
    audience: str = "dtu",
) -> Iterator[tuple[Session, dict]]:
    """
    Verify JWT, enforce state policy, bind a Session to the state's schema, and yield (Session, context).

    Context contains: user_id, state_id, run_id.
    """
    claims = jwt.decode(
        token,
        secret,
        algorithms=["HS256"],
        audience=audience,
        options={"require": ["exp", "iat", "aud"]},
    )
    state_id = str(claims["state_id"])
    user_id = int(claims["sub"]) if "sub" in claims else None

    # Look up state in meta by id
    st = (
        meta_session.query(TestState)
        .filter(cast(TestState.id, String) == state_id)
        .one_or_none()
    )
    if st is None:
        raise PermissionError("state not found")

    now = datetime.now()
    if st.expiresAt and now > st.expiresAt:
        raise PermissionError("state expired")
    if st.status not in ("ready",):
        raise PermissionError("state not ready")

    st.lastUsedAt = now
    meta_session.commit()

    conn = engine.connect()
    tx = conn.begin()
    conn.exec_driver_sql(f'SET LOCAL search_path TO "{st.schema}", public')
    try:
        SessionLocal = sessionmaker(
            bind=conn, autoflush=False, expire_on_commit=False, future=True
        )
        session = SessionLocal()
        context = {
            "user_id": user_id,
            "state_id": state_id,
            "run_id": claims.get("run_id"),
        }
        yield session, context
    finally:
        try:
            tx.rollback()
        finally:
            conn.close()
