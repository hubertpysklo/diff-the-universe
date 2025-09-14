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

"""
# I choosed the ones that are most likely to be used by agents. Slack OpenAPI speck has over 150 actions, unable to cover by one person - feel free to add more.

"""

# Replica specific actions
# Create Team
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
