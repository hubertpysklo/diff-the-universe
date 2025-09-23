from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Iterable
from uuid import uuid4
import jwt
from sqlalchemy import text, MetaData
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker


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
    expires_at: datetime | None
    token: str | None = (
        None  # This is a JWT token for the client to access the correct environment state
    )


class EnvironmentHandler:
    def __init__(self, engine: Engine):
        self.engine = engine

    def issue_token(
        self,
        *,
        secret: str,
        state_id: str,
        user_id: int,
        token_ttl_seconds: int = 1800,
        run_id: str | None = None,
        scopes: list[str] | None = None,
    ) -> str:
        now = datetime.now()
        payload = {
            "sub": str(user_id),
            "state_id": state_id,
            "run_id": run_id,
            "scopes": scopes or ["linear:*"],
            "iat": now,
            "exp": now + timedelta(seconds=token_ttl_seconds),
            "jti": uuid4().hex,
            "aud": "dtu",
        }
        return jwt.encode(payload, secret, algorithm="HS256")

    def create_schema(self, schema: str) -> None:
        with self.engine.begin() as conn:
            conn.execute(text(f'CREATE SCHEMA "{schema}"'))

    def migrate_schema(self, schema: str) -> None:
        # TODO: Migrations for this connection with search_path set
        # To do add search_path
        with self.engine.begin() as conn:
            conn.execute(text(f'SET LOCAL search_path TO "{schema}", public'))

    def _list_tables(self, conn, schema: str) -> list[str]:
        rows = conn.execute(
            text(
                """
                SELECT table_name
                FROM information_schema.tables
                WHERE table_schema = :schema AND table_type = 'BASE TABLE'
                ORDER BY table_name
                """
            ),
            {"schema": schema},
        ).fetchall()
        return [r[0] for r in rows]

    def _reset_sequences(self, conn, schema: str, tables: Iterable[str]) -> None:
        for tbl in tables:
            seq_name_row = conn.execute(
                text("SELECT pg_get_serial_sequence(:rel, 'id')"),
                {"rel": f"{schema}.{tbl}"},
            ).fetchone()
            if not seq_name_row or not seq_name_row[0]:
                continue
            conn.execute(
                text(
                    "SELECT setval(:seq, COALESCE((SELECT MAX(id) FROM "
                    f'"{schema}".{tbl}'
                    "), 0) + 1, false)"
                ),
                {"seq": seq_name_row[0]},
            )

    def clone_from_template(
        self,
        template_schema: str,
        state_schema: str,
        tables_order: list[str] | None = None,
    ) -> None:
        with self.engine.begin() as conn:
            conn.execute(text(f'SET LOCAL search_path TO "{state_schema}", public'))
            existing = set(self._list_tables(conn, template_schema))
            if tables_order:
                ordered = [t for t in tables_order if t in existing]
            else:
                # Use SQLAlchemy reflection to get FK-safe order
                meta = MetaData()
                meta.reflect(bind=self.engine, schema=template_schema)
                ordered = [t.name for t in meta.sorted_tables if t.name in existing]
            trailing = [t for t in existing if t not in ordered]
            for tbl in ordered + trailing:
                conn.execute(
                    text(
                        f'INSERT INTO "{state_schema}".{tbl} SELECT * FROM "{template_schema}".{tbl}'
                    )
                )
            self._reset_sequences(conn, state_schema, ordered + trailing)

    def init_env(self, request: InitEnvRequest) -> InitEnvResult:
        state_id = datetime.now().strftime("%Y%m%d%H%M%S%f")
        state_schema = f"state_{state_id}"
        self.create_schema(state_schema)
        self.migrate_schema(state_schema)
        self.clone_from_template(request.environment_schema, state_schema)
        expires_at = (
            datetime.now() + timedelta(seconds=request.ttl_seconds)
            if request.ttl_seconds
            else None
        )
        return InitEnvResult(
            state_id=state_id, schema=state_schema, expires_at=expires_at
        )

    def init_env_and_issue_token(
        self,
        request: InitEnvRequest,
        *,
        secret: str,
        user_id: int,
        token_ttl_seconds: int = 1800,
    ) -> InitEnvResult:
        res = self.init_env(request)
        res.token = self.issue_token(
            secret=secret,
            state_id=res.state_id,
            user_id=user_id,
            token_ttl_seconds=token_ttl_seconds,
            run_id=request.run_id,
        )
        return res

    def session_for_schema(self, schema: str) -> Session:
        conn = self.engine.connect()
        conn.execute(text(f'SET LOCAL search_path TO "{schema}", public'))
        SessionLocal = sessionmaker(
            bind=conn, autoflush=False, expire_on_commit=False, future=True
        )
        return SessionLocal()
