from sqlalchemy.orm import Session
from backend.src.platform.db.schema import User


def resolve_impersonate_user_id(
    impersonate: int | str | None, session: Session
) -> int | None:
    if impersonate is None:
        return None
    if isinstance(impersonate, int):
        return (
            impersonate
            if session.get(User, impersonate)
            else (_ for _ in ()).throw(ValueError("User not found"))
        )
    user = session.query(User).filter(User.email == impersonate).one_or_none()
    if not user:
        raise ValueError("User not found")
    return user.id
