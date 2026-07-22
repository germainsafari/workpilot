from dataclasses import dataclass

import jwt
from fastapi import Header, HTTPException, status

from app.config import get_settings

DEMO_TENANT_ID = "tenant-northstar"
DEMO_USER_ID = "user-alex"


@dataclass(frozen=True)
class Principal:
    tenant_id: str
    user_id: str
    role: str


async def current_principal(
    authorization: str | None = Header(default=None),
    x_workpilot_tenant_id: str | None = Header(default=None),
    x_workpilot_user_id: str | None = Header(default=None),
) -> Principal:
    settings = get_settings()
    if authorization and authorization.startswith("Bearer "):
        try:
            payload = jwt.decode(
                authorization.removeprefix("Bearer "), settings.jwt_secret, algorithms=["HS256"]
            )
            return Principal(
                tenant_id=str(payload["tenant_id"]), user_id=str(payload["sub"]), role=str(payload["role"])
            )
        except (jwt.InvalidTokenError, KeyError) as error:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid access token"
            ) from error
    if settings.local_auth_enabled:
        return Principal(
            tenant_id=x_workpilot_tenant_id or DEMO_TENANT_ID,
            user_id=x_workpilot_user_id or DEMO_USER_ID,
            role="workflow_admin",
        )
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sign in required")
