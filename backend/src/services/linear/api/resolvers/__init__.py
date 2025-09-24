# Linear GraphQL resolvers - TODO: implement

from ariadne import QueryType
from sqlalchemy import select
from sqlalchemy.orm import Session
from db_schema import SessionLocal, Organization, Team, User


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
    session = info.context.state.db_session
    stmt = select(Organization.id).where(Organization.urlKey == urlKey).limit(1)
    try:
        exists_ = session.execute(stmt).scalar_one_or_none() is not None
        return {"exists": exists_, "success": True}
    except Exception:
        return {"exists": False, "success": False}
            
            
@Query.field("archivedTeams")
def resolve_archivedTeams(_parent, info):
    session = info.context.state.db_session
    org_id = getattr(info.context.state, "org_id", None) # Will have to handle this later
    if org_id is None:
        return []

    stmt = select(Team).where(Team.organizationId == org_id, Team.archivedAt.is_not(None))

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
    with session_provider.get_session(authorization) as session:
        team = session.execute(
            select(Team)
            .where(Team.slugId == id)
            .limit(1)
        ).scalars().first()

        if not team:
            raise GraphQLError("Team not found")  # Team! must not be null

        return team
    
@Query.field("teamMembership")
def resolve_teamMembership(_parent, _info, teamId: str):
    with session_provider.get_session(authorization) as session:
        tm = session.get(TeamMembership, teamId) # May need to change that
        if not tm:
            raise GraphQLError("TeamMembership not found")
        return tm

# Still need to add teamMemberships

# Queries User

# Not included:
#   - apiKeys
#   - applicationWithAuthorization
#   - availableUsers
#   - customViewHasSubscribers
#   - customViews
#   - externalUser
#   - externalUsers
#   - notificationSubscriptions
#   - organization
def resolve 







        
        
    