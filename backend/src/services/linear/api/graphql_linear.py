from ariadne.asgi import GraphQL


class GraphQLWithSession(GraphQL):
    def __init__(self, schema, session_provider):
        super().__init__(schema)
        self.session_provider = session_provider

    async def context_value(self, request):
        token = request.headers.get("Authorization")
        session = self.session_provider.get_session_for_token(token) if token else None
        request.state.db_session = session
        return {"request": request, "session": session}

    async def handle_request(self, request):
        try:
            resp = await super().handle_request(request)
            if request.state.db_session:
                request.state.db_session.commit()
            return resp
        except Exception:
            if request.state.db_session:
                request.state.db_session.rollback()
            raise
        finally:
            if request.state.db_session:
                request.state.db_session.close()
                request.state.db_session = None
