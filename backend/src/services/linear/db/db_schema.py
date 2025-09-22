from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy import Integer, String, DateTime, ForeignKey, Boolean, Text
from datetime import datetime
from datetime import date


class LinearBase(DeclarativeBase):
    pass


class Organization(LinearBase):
    __tablename__ = "organizations"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    urlKey: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    allowMembersToInvite: Mapped[bool] = mapped_column(Boolean, default=True)
    restrictLabelManagementToAdmins: Mapped[bool] = mapped_column(
        Boolean, default=False
    )
    restrictTeamCreationToAdmins: Mapped[bool] = mapped_column(Boolean, default=False)
    archivedAt: Mapped[datetime | None] = mapped_column(DateTime)
    createdAt: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    updatedAt: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)


class Team(LinearBase):
    __tablename__ = "teams"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    organizationId: Mapped[int] = mapped_column(
        ForeignKey("organizations.organization_id")
    )  # Used ID instead of name for foreign key
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    displayName: Mapped[str] = mapped_column(String(100), nullable=False)
    private: Mapped[bool] = mapped_column(Boolean, default=False)
    defaultIssueStateId: Mapped[int] = mapped_column(
        ForeignKey(
            "workflow_states.state_id"
        )  # Used ID instead of name for foreign key
    )
    inviteHash: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    key: Mapped[str] = mapped_column(
        String(10), nullable=False
    )  # e.g., "ENG" The team's unique key. The key is used in URLs.

    joinByDefault: Mapped[bool] = mapped_column(Boolean, default=True)
    isPrivate: Mapped[bool] = mapped_column(Boolean, default=False)
    archivedAt: Mapped[datetime | None] = mapped_column(DateTime)
    createdAt: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    updatedAt: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)


class User(LinearBase):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    organizationId: Mapped[int] = mapped_column(
        ForeignKey(
            "organizations.organization_id"
        )  # Used ID instead of name for foreign key
    )
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    displayName: Mapped[str] = mapped_column(String(100), nullable=False)
    isAdmin: Mapped[bool] = mapped_column(
        Boolean, default=False
    )  # used isAdmin instead of admin
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    canAccessAnyPublicTeam: Mapped[bool] = mapped_column(Boolean, default=False)
    isAssignable: Mapped[bool] = mapped_column(Boolean, default=True)
    isMentionable: Mapped[bool] = mapped_column(Boolean, default=True)
    url: Mapped[str] = mapped_column(String(255), nullable=False)  # User's profile URL.
    archivedAt: Mapped[datetime | None] = mapped_column(DateTime)
    createdAt: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    updatedAt: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)


class Issue(LinearBase):
    __tablename__ = "issues"
    issue_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    team_id: Mapped[int] = mapped_column(ForeignKey("teams.team_id"))
    creator_id: Mapped[int] = mapped_column(ForeignKey("users.user_id"))
    assignee_id: Mapped[int | None] = mapped_column(ForeignKey("users.user_id"))
    project_id: Mapped[int | None] = mapped_column(ForeignKey("projects.project_id"))
    state_id: Mapped[int] = mapped_column(ForeignKey("workflow_states.state_id"))

    identifier: Mapped[str] = mapped_column(
        String(20), unique=True, nullable=False
    )  # e.g., "ENG-123"
    number: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    priority: Mapped[int] = mapped_column(
        Integer, default=0
    )  # 0=None, 1=Urgent, 2=High, 3=Normal, 4=Low
    estimate: Mapped[float | None] = mapped_column(Float)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime)
    canceled_at: Mapped[datetime | None] = mapped_column(DateTime)
    due_date: Mapped[date | None] = mapped_column(Date)


class Project(LinearBase):
    __tablename__ = "projects"
    project_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    organization_id: Mapped[int] = mapped_column(
        ForeignKey("organizations.organization_id")
    )
    creator_id: Mapped[int] = mapped_column(ForeignKey("users.user_id"))
    lead_id: Mapped[int | None] = mapped_column(ForeignKey("users.user_id"))

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug_id: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    color: Mapped[str] = mapped_column(String(7), nullable=False)
    icon: Mapped[str | None] = mapped_column(String(50))
    priority: Mapped[int] = mapped_column(Integer, default=0)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime)
    canceled_at: Mapped[datetime | None] = mapped_column(DateTime)
    target_date: Mapped[date | None] = mapped_column(Date)


class Comment(LinearBase):
    __tablename__ = "comments"
    comment_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    issue_id: Mapped[int] = mapped_column(ForeignKey("issues.issue_id"))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.user_id"))
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("comments.comment_id"))

    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    edited_at: Mapped[datetime | None] = mapped_column(DateTime)


class Label(LinearBase):
    __tablename__ = "labels"
    label_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    team_id: Mapped[int | None] = mapped_column(
        ForeignKey("teams.team_id")
    )  # Null for workspace labels
    creator_id: Mapped[int] = mapped_column(ForeignKey("users.user_id"))
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("labels.label_id"))

    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    color: Mapped[str] = mapped_column(String(7), nullable=False)
    is_group: Mapped[bool] = mapped_column(Boolean, default=False)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)


class IssueLabel(LinearBase):
    __tablename__ = "issue_labels"
    issue_id: Mapped[int] = mapped_column(
        ForeignKey("issues.issue_id"), primary_key=True
    )
    label_id: Mapped[int] = mapped_column(
        ForeignKey("labels.label_id"), primary_key=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)


class WorkflowState(LinearBase):
    __tablename__ = "workflow_states"
    state_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    team_id: Mapped[int] = mapped_column(ForeignKey("teams.team_id"))

    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    color: Mapped[str] = mapped_column(String(7), nullable=False)
    type: Mapped[str] = mapped_column(
        String(20), nullable=False
    )  # triage, backlog, unstarted, started, completed, canceled
    position: Mapped[float] = mapped_column(Float, nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
