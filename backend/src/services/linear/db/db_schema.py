from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy import (
    Integer,
    String,
    DateTime,
    ForeignKey,
    Boolean,
    Text,
    Float,
    Date,
)
from datetime import datetime
from datetime import date
from sqlalchemy.dialects.postgresql import JSONB


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
        ForeignKey("organizations.id")
    )  # Used ID instead of name for foreign key
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    displayName: Mapped[str] = mapped_column(String(100), nullable=False)
    defaultIssueStateId: Mapped[int] = mapped_column(
        ForeignKey("workflow_states.id")  # Used ID instead of name for foreign key
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
        ForeignKey("organizations.id")  # Used ID instead of name for foreign key
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
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    teamId: Mapped[int] = mapped_column(
        ForeignKey("teams.id")
    )  # Used ID instead of name for foreign key
    creatorId: Mapped[int] = mapped_column(ForeignKey("users.id"))
    assigneeId: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    projectId: Mapped[int | None] = mapped_column(ForeignKey("projects.id"))
    projectMilestoneId: Mapped[int | None] = mapped_column(
        ForeignKey("project_milestones.id")
    )
    stateId: Mapped[int] = mapped_column(ForeignKey("workflow_states.id"))
    identifier: Mapped[str] = mapped_column(
        String(20), unique=True, nullable=False
    )  # e.g., "ENG-123" The issue's unique identifier.
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    priority: Mapped[int] = mapped_column(
        Integer, default=0
    )  # 0=None, 1=Urgent, 2=High, 3=Normal, 4=Low
    parentId: Mapped[int | None] = mapped_column(
        ForeignKey("issues.issue_id")
    )  # ID of the parrent issue if the issue is a sub-issue
    number: Mapped[float] = mapped_column(Float, nullable=False)
    labelIds: Mapped[list[str]] = mapped_column(
        JSONB
    )  # This is a list of label IDs. If we want to check lebels for the issue, we need to use the ids and get the labels from the labels table.
    dueDate: Mapped[date | None] = mapped_column(Date)
    createdAt: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    updatedAt: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    completedAt: Mapped[datetime | None] = mapped_column(DateTime)
    canceledAt: Mapped[datetime | None] = mapped_column(DateTime)


class Project(LinearBase):
    __tablename__ = "projects"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    organizationId: Mapped[int] = mapped_column(ForeignKey("organizations.id"))
    url: Mapped[str] = mapped_column(String(255), nullable=False)
    creatorId: Mapped[int] = mapped_column(ForeignKey("users.id"))
    leadId: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    priority: Mapped[int] = mapped_column(Integer, default=0)
    labelIds: Mapped[list[str]] = mapped_column(JSONB)
    slugId: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    convertedFromIssueId: Mapped[int | None] = mapped_column(ForeignKey("issues.id"))
    statusId: Mapped[int] = mapped_column(ForeignKey("project_statuses.id"))
    completedAt: Mapped[datetime | None] = mapped_column(DateTime)
    startDate: Mapped[date | None] = mapped_column(Date)
    startedAt: Mapped[datetime | None] = mapped_column(DateTime)
    canceledAt: Mapped[datetime | None] = mapped_column(DateTime)
    trashed: Mapped[bool] = mapped_column(Boolean, default=False)
    targetDate: Mapped[date | None] = mapped_column(Date)
    archivedAt: Mapped[datetime | None] = mapped_column(DateTime)
    createdAt: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    updatedAt: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)


class Comment(LinearBase):
    __tablename__ = "comments"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    issueId: Mapped[int | None] = mapped_column(ForeignKey("issues.id"))
    url: Mapped[str] = mapped_column(String(255), nullable=False)
    userId: Mapped[int] = mapped_column(ForeignKey("users.id"))
    parentId: Mapped[int | None] = mapped_column(ForeignKey("comments.id"))
    projectUpdateId: Mapped[int | None] = mapped_column(
        ForeignKey("project_updates.id")
    )
    initiativeUpdateId: Mapped[int | None] = mapped_column(
        ForeignKey("initiative_updates.id")
    )
    body: Mapped[str] = mapped_column(Text, nullable=False)
    createdAt: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    updatedAt: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    archivedAt: Mapped[datetime | None] = mapped_column(DateTime)


class Label(LinearBase):
    __tablename__ = "labels"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    teamId: Mapped[int | None] = mapped_column(
        ForeignKey("teams.id")
    )  # Null for workspace labels
    creatorId: Mapped[int] = mapped_column(ForeignKey("users.id"))
    parentId: Mapped[int | None] = mapped_column(ForeignKey("labels.id"))
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    createdAt: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    updatedAt: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    archivedAt: Mapped[datetime | None] = mapped_column(DateTime)


class WorkflowState(LinearBase):
    __tablename__ = "workflow_states"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    teamId: Mapped[int] = mapped_column(ForeignKey("teams.id"))
    inheritedFromId: Mapped[int | None] = mapped_column(
        ForeignKey("workflow_states.id")
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    type: Mapped[str] = mapped_column(
        String(20), nullable=False
    )  # Backlog, Todo, In Progress, In Review, Done, Canceled, Duplicate
    position: Mapped[float] = mapped_column(Float, nullable=False)
    createdAt: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    updatedAt: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)
    archivedAt: Mapped[datetime | None] = mapped_column(DateTime)
