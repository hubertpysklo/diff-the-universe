from src.matrixes.slack.database.schema import (
    User,
    Team,
    Channel,
    Message,
    ChannelMember,
    MessageReaction,
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
    AppSetting,
)

from datetime import datetime
from sqlalchemy.orm import Session
from sqlalchemy import select

"""
# I choosed the ones that are most likely to be used by agents. Slack OpenAPI speck has over 150 actions, unable to cover by one person - feel free to add more.

"""

# Replica specific actions


# Create Team


def create_team(session: Session, team_name: str, created_at: datetime):
    team = Team(team_name=team_name, created_at=created_at)
    session.add(team)
    return team


# Create User


def create_user(session: Session, username: str, email: str, created_at: datetime):
    user = User(username=username, email=email, created_at=created_at)
    session.add(user)
    return user


# create-channel


def create_channel(
    session: Session, channel_name: str, team_id: int, created_at: datetime
) -> Channel:
    team = session.get(Team, team_id)
    if team is None:
        raise ValueError("Team not found")

    channel = Channel(channel_name=channel_name, team_id=team_id, created_at=created_at)
    session.add(channel)
    return channel


# archive-channel


def archive_channel(session: Session, channel_id: int):
    channel = session.get(Channel, channel_id)
    if channel is None:
        raise ValueError("Channel not found")
    channel.is_archived = True
    return channel


# unarchive-channel


def unarchive_channel(session: Session, channel_id: int):
    channel = session.get(Channel, channel_id)
    if channel is None:
        raise ValueError("Channel not found")
    channel.is_archived = False
    return channel


# rename-channel


def rename_channel(session: Session, channel_id: int, new_name: str) -> Channel:
    channel = session.get(Channel, channel_id)
    if channel is None:
        raise ValueError("Channel not found")
    channel.channel_name = new_name
    return channel


# set-channel-topic


def set_channel_topic(session: Session, channel_id: int, topic: str) -> Channel:
    channel = session.get(Channel, channel_id)
    if channel is None:
        raise ValueError("Channel not found")
    channel.topic_text = topic
    return channel


# invite-user-to-channel


def invite_user_to_channel(
    session: Session, channel_id: int, user_id: int
) -> ChannelMember:
    channel = session.get(Channel, channel_id)
    if channel is None:
        raise ValueError("Channel not found")
    channel_member = ChannelMember(channel_id=channel_id, user_id=user_id)
    session.add(channel_member)
    return channel_member


# kick-user-from-channel
# send-message
# update-message
# add-emoji-reaction
# remove-emoji-reaction
# list-channels
# list-members-in-channel
# list-history (paginated)
