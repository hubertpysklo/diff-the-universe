# Linear GraphQL resolvers - TODO: implement

import secrets

from ariadne import QueryType
from graphql import GraphQLError
from sqlalchemy import select, func
from sqlalchemy.orm import Session
from db_schema import (
    SessionLocal,
    Organization,
    OrganizationDomain,
    Team,
    TeamMembership,
    User,
)


# Query reoslvers
Query = QueryType()

# Skipped Querry:
# - organizationDomainClaimRequest
# - externalUsers


# Probably need to include?
# - organizationInvite
# - organizationInviteDetails?
# - organizationInvites
# - projectStatusProjectCount (am not sure whether in organizations)

# @Query.field("organization")
# def resolve_organization(_, info):
#     user_email = select(User.email)


# platform/graphql.py
from ariadne.asgi import GraphQL

class GraphQLWithSession(GraphQL):
    async def handle_request(self, request):
        token = (request.headers.get("Authorization") or "").removeprefix("Bearer ").strip()
        session = None
        try:
            session = session_provider.create_session_for_token(token)
            request.state.db_session = session
            result = await super().handle_request(request)
            session.commit()
            return result
        except Exception:
            if session:
                session.rollback()
            raise
        finally:
            if session:
                session.close()

    
@Query.field("organizationExists")
def resolve_organizationExists(_parent, info, urlKey: str):
    session = getattr(info.context.state, "db_session", None)
    created_session = False
    if session is None:
        session = SessionLocal()
        created_session = True

    try:
        stmt = (
            select(Organization.id)
            .where(func.lower(Organization.urlKey) == urlKey.lower())
            .limit(1)
        )
        exists_ = session.execute(stmt).scalar_one_or_none() is not None
        return {"exists": exists_, "success": True}
    except Exception:
        if created_session:
            session.rollback()
        return {"exists": False, "success": False}
    finally:
        if created_session:
            session.close()
            
            
@Query.field("archivedTeams")
def resolve_archivedTeams(_parent, info):
    session = info.context.state.db_session
    org_id = getattr(info.context.state, "org_id", None) # Will have to handle this later
    if org_id is None:
        return []

    stmt = select(Team).where(Team.organizationId == org_id, Team.archivedAt.isnot(None))

    try:
        return session.scalars(stmt).all()
    except Exception:
        return []
    
# Querries Teams


# Querries Users:
# Need to implmenet:
#   - administableTeams
#   - teams    

@Query.field("team")
def resolve_team(_parent, info, id: str):
    session = info.context.state.db_session
    stmt = select(Team).where(Team.id == id).limit(1)
    team = session.execute(stmt).scalars().first()

    if team is None:
        raise GraphQLError("Team not found")  # Team! must not be null

    return team
    
@Query.field("teamMembership")
def resolve_teamMembership(_parent, info, id: str):
    session = info.context.state.db_session
    stmt = select(TeamMembership).where(TeamMembership.id == id).limit(1)
    membership = session.execute(stmt).scalars().first()

    if membership is None:
        raise GraphQLError("TeamMembership not found")

    return membership

# Queries User


@Query.field("organization")
def resolve_organization(_parent, info):
    session = info.context.state.db_session

    user_id = getattr(info.context.state, "user_id", None)
    if user_id is None:
        raise GraphQLError("Not authenticated")

    user = session.get(User, user_id)
    if user is None or user.organization is None:
        raise GraphQLError("Organization not found")

    return user.organization

@Query.field("organizationDomainClaimRequest")
def resolve_organizationDomainClaimRequest(_parent, info, id: str):
    session = info.context.state.db_session
    stmt = select(OrganizationDomain).where(OrganizationDomain.id == id).limit(1)
    domain = session.execute(stmt).scalars().first()

    if domain is None:
        raise GraphQLError("Organization domain not found")

    org_id = getattr(info.context.state, "org_id", None)
    if org_id is not None and domain.organizationId != org_id:
        raise GraphQLError("Access denied")

    if domain.claimed or domain.verified:
        raise GraphQLError("Domain already claimed")

    if not domain.verificationString:
        domain.verificationString = secrets.token_urlsafe(16)
        session.add(domain)
        session.flush()

    return {"verificationString": domain.verificationString}

# Still need to add teamMemberships

# Not included:
#   - apiKeys
#   - applicationWithAuthorization
#   - availableUsers
#   - customViewHasSubscribers
#   - customViews
#   - externalUser
#   - externalUsers
#   - notificationSubscriptions
def resolve 







        
        
    
