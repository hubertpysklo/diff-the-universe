from sqlalchemy import create_engine
from backend.src.platform.isolationEngine.auth import TokenHandler
from backend.src.platform.isolationEngine.session import SessionManager
from starlette.applications import Starlette
from os import environ
from backend.src.platform.isolationEngine.core import Core
from backend.src.platform.isolationEngine.environment import EnvironmentHandler


def create_app():
    app = Starlette()
    db_url = environ["DATABASE_URL"]
    secret = environ["SECRET_KEY"]

    platform_engine = create_engine(db_url, pool_pre_ping=True)
    token = TokenHandler(secret=secret)
    sessions = SessionManager(platform_engine, token)
    environment_handler = EnvironmentHandler(
        token_handler=token, session_manager=sessions
    )

    core = Core(token=token, sessions=sessions, environment_handler=environment_handler)

    app.state.core = core
    app.state.sessions = sessions

    return app
