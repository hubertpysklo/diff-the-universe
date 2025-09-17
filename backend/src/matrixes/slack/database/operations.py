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
    user = session.get(User, user_id)
    if channel or user is None:
        raise ValueError("Channel or user not found")
    channel_member = ChannelMember(channel_id=channel_id, user_id=user_id)
    session.add(channel_member)
    return channel_member


# kick-user-from-channel


def kick_user_from_channel(session: Session, channel_id: int, user_id: int):
    channel = session.get(Channel, channel_id)
    user = session.get(User, user_id)
    if channel or user is None:
        raise ValueError("Channel or user not found")
    channel_member = session.get(ChannelMember, (channel_id, user_id))
    if channel_member is None:
        raise ValueError("Channel member not found")
    session.delete(channel_member)
    return channel_member


# send-message


def send_message(
    session: Session,
    channel_id: int,
    user_id: int,
    message_text: str,
    message_id: int | None,
):
    channel = session.get(Channel, channel_id)
    user = session.get(User, user_id)
    if channel or user is None:
        raise ValueError("Channel or user not found")
    message = Message(
        channel_id=channel_id,
        user_id=user_id,
        message_text=message_text,
        message_id=message_id,
    )
    session.add(message)
    return message


def reply_to_message(
    session: Session, message_id: int, message_text: str, user_id: int
):
    message = session.get(Message, message_id)
    if message is None:
        raise ValueError("Message not found")
    reply_message = Message(
        parent_id=message.message_id,
        channel_id=message.channel_id,
        message_text=message_text,
        user_id=user_id,
    )
    session.add(reply_message)
    return reply_message


def send_message_to_user(session: Session, user_id: int, message_text: str):
    user = session.get(User, user_id)
    if user is None:
        raise ValueError("User not found")
    message = Message(user_id=user_id, message_text=message_text)
    session.add(message)
    return message


def send_direct_message(
    session: Session,
    user_id: int,
    message_text: str,
    sender_id: int,
    recipient_id: int,
    team_id: int | None = None,
):
    sender = session.get(User, user_id)
    recipient = session.get(User, recipient_id)
    if sender is None:
        raise ValueError("User not found")
    if recipient is None:
        raise ValueError("Sender not found")

    dm_channel = session.execute(
        select(Channel)
        .where(
            Channel.is_dm.is_(True),
        )
        .join(ChannelMember)
        .where(
            ChannelMember.user_id == recipient_id,
            ChannelMember.channel_id == sender_id,
        )
    ).scalar_one_or_none()
    if dm_channel is None:
        dm_channel = Channel(
            is_dm=True,
            team_id=team_id,
            channel_name=f"{sender.username}-{recipient.username}",
        )
        session.add(dm_channel)
        channel_member_sender = ChannelMember(
            channel_id=dm_channel.channel_id, user_id=sender_id
        )
        channel_member_recipient = ChannelMember(
            channel_id=dm_channel.channel_id, user_id=recipient_id
        )
        session.add_all(
            [
                channel_member_sender,
                channel_member_recipient,
            ]
        )
        session.flush()
    message = Message(
        channel_id=dm_channel.channel_id, user_id=sender_id, message_text=message_text
    )
    session.add(message)
    return message


# update-message
# add-emoji-reaction
# remove-emoji-reaction
# list-channels
# list-members-in-channel
# list-history (paginated)
