from src.matrixes.slack.database.schema import (
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
    TeamRole,
    TeamSetting,
    UserMention,
    UserRole,
    UserSetting,
    UserTeam,
    FileMessage,
    AuditLog,
    AppSetting,
)

from sqlalchemy import select
from src.matrixes.slack.database.db import session

"""
# I choosed the ones that are most likely to be used by agents. Slack OpenAPI speck has over 150 actions, unable to cover by one person - feel free to add more.

"""

# Replica specific actions


# Create Team


def create_team(team_id: int, team_name: str):
    team = Team(team_id=team_id, team_name=team_name)
    session.add(team)
    session.commit()
    return team


# Create User


# Planned Slack-like actions to be exaposed to agents.
# - create-team
# - create-user
# - create-channel
# - archive-channel / unarchive-channel
# - rename-channel
# - set-channel-topic
# - invite-user-to-channel
# - kick-user-from-channel
# - send-message
# - update-message
# - add-emoji-reaction
# - remove-emoji-reaction
# - list-channels
# - list-members-in-channel
# - list-history (paginated)
