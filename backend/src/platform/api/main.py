from sqlalchemy import create_engine
from backend.src.platform.engine.auth import TokenHandler
from backend.src.platform.engine.session import SessionManager
from backend.src.platform.engine.environment import EnvironmentHandler
from starlette.applications import Starlette
from os import environ
from backend.src.platform.engine.core import Core


def create_app():
    app = Starlette()
    db_url = environ["DATABASE_URL"]
    secret = environ["SECRET_KEY"]

    platform_engine = create_engine(db_url, pool_pre_ping=True)
    token = TokenHandler(secret=secret)
    envs = EnvironmentHandler()
    sessions = SessionManager(
        platform_engine, token
    )  # constructor takes engine + token

    core = Core(token=token, envs=envs, sessions=sessions)

    app.state.core = core
    app.state.sessions = sessions

    return app
