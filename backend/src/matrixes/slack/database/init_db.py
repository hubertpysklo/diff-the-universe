from sqlalchemy import select
from .db import engine, Base
from .schema import (
    User,
    Team,
    Channel,
    Message,
    ChannelMember,
    MessageReaction,
    ChannelTopic,
    DirectMessage,
    File,
    MessageEdit,
    MessageReaction,
    TeamRole,
    TeamSetting,
    UserMention,
    UserRole,
    UserSetting,
    UserTeam,
)
from .db import session


def init_db(seed: bool = False):
    Base.metadata.create_all(engine)

    if not seed:
        return
