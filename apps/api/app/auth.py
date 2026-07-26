"""JWT authentication for WorkPilot.

Production mode  – Cognito RS256 JWTs validated against the pool's JWKS endpoint.
Local-dev mode   – HS256 tokens (jwt_secret) or bare header-based stub principal.
"""

from __future__ import annotations

import base64
from dataclasses import dataclass
from typing import Any

import httpx
import jwt
from cryptography.hazmat.primitives.asymmetric.rsa import RSAPublicNumbers
from fastapi import Header, HTTPException, status

from app.config import get_settings

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

DEMO_TENANT_ID = "tenant-northstar"
DEMO_USER_ID = "user-alex"

# Module-level JWKS cache keyed by Cognito user-pool-id.
# Each entry is a dict mapping kid -> raw JWK dict.
_jwks_cache: dict[str, dict[str, Any]] = {}


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Principal:
    tenant_id: str
    user_id: str
    role: str


# ---------------------------------------------------------------------------
# JWKS helpers
# ---------------------------------------------------------------------------


def _cognito_issuer(region: str, pool_id: str) -> str:
    return f"https://cognito-idp.{region}.amazonaws.com/{pool_id}"


def _jwks_url(region: str, pool_id: str) -> str:
    return f"{_cognito_issuer(region, pool_id)}/.well-known/jwks.json"


def _fetch_jwks(region: str, pool_id: str) -> dict[str, Any]:
    """Fetch JWKS from Cognito and return a kid-keyed dict of raw JWK objects."""
    url = _jwks_url(region, pool_id)
    try:
        response = httpx.get(url, timeout=5.0)
        response.raise_for_status()
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication service unavailable",
        ) from exc

    keys: dict[str, Any] = {k["kid"]: k for k in response.json().get("keys", [])}
    return keys


def _get_jwks(region: str, pool_id: str, *, force_refresh: bool = False) -> dict[str, Any]:
    """Return cached JWKS dict for the pool, fetching (or re-fetching) as needed."""
    if pool_id not in _jwks_cache or force_refresh:
        _jwks_cache[pool_id] = _fetch_jwks(region, pool_id)
    return _jwks_cache[pool_id]


def _b64_to_int(value: str) -> int:
    """Decode a base64url-encoded big-endian integer (JWK n / e fields)."""
    padded = value + "=" * (-len(value) % 4)
    return int.from_bytes(base64.urlsafe_b64decode(padded), "big")


def _jwk_to_public_key(jwk: dict[str, Any]) -> Any:
    """Convert a RSA JWK dict to a cryptography RSAPublicKey object."""
    from cryptography.hazmat.backends import default_backend

    pub_numbers = RSAPublicNumbers(e=_b64_to_int(jwk["e"]), n=_b64_to_int(jwk["n"]))
    return pub_numbers.public_key(default_backend())


# ---------------------------------------------------------------------------
# Cognito RS256 verification
# ---------------------------------------------------------------------------


def _verify_cognito_token(token: str) -> Principal:
    """Decode and validate a Cognito-issued RS256 JWT; return a Principal."""
    settings = get_settings()
    region = settings.cognito_region
    pool_id = settings.cognito_user_pool_id
    client_id = settings.cognito_app_client_id
    expected_issuer = _cognito_issuer(region, pool_id)

    # Decode header only to get the kid (no verification yet).
    try:
        header = jwt.get_unverified_header(token)
    except jwt.DecodeError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid access token"
        ) from exc

    kid: str = header.get("kid", "")

    # Look up public key – re-fetch once if kid is unknown (key rotation).
    jwks = _get_jwks(region, pool_id)
    if kid not in jwks:
        jwks = _get_jwks(region, pool_id, force_refresh=True)
    if kid not in jwks:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token signing key not recognised",
        )

    public_key = _jwk_to_public_key(jwks[kid])

    # Build audience list: accept either the client_id or (for machine tokens) the pool's
    # own "client_id" claim used by some Cognito token types.
    audiences = [client_id] if client_id else None

    try:
        payload: dict[str, Any] = jwt.decode(
            token,
            public_key,
            algorithms=["RS256"],
            issuer=expected_issuer,
            audience=audiences,
            options={"require": ["exp", "iss", "sub"]},
        )
    except jwt.MissingRequiredClaimError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Token claims incomplete"
        ) from exc
    except jwt.InvalidTokenError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid access token"
        ) from exc

    # Extract application claims.
    tenant_id: str = str(payload.get("custom:tenant_id") or payload["sub"])
    role: str = str(payload.get("custom:role") or "workflow_user")
    user_id: str = str(payload["sub"])

    return Principal(tenant_id=tenant_id, user_id=user_id, role=role)


# ---------------------------------------------------------------------------
# Local HS256 verification
# ---------------------------------------------------------------------------


def _verify_hs256_token(token: str) -> Principal:
    """Decode a locally-signed HS256 JWT (dev/test only)."""
    settings = get_settings()
    try:
        payload: dict[str, Any] = jwt.decode(
            token, settings.jwt_secret, algorithms=["HS256"]
        )
        return Principal(
            tenant_id=str(payload["tenant_id"]),
            user_id=str(payload["sub"]),
            role=str(payload["role"]),
        )
    except (jwt.InvalidTokenError, KeyError) as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid access token"
        ) from exc


# ---------------------------------------------------------------------------
# FastAPI dependency
# ---------------------------------------------------------------------------


async def current_principal(
    authorization: str | None = Header(default=None),
    x_workpilot_tenant_id: str | None = Header(default=None),
    x_workpilot_user_id: str | None = Header(default=None),
) -> Principal:
    settings = get_settings()

    if authorization and authorization.startswith("Bearer "):
        token = authorization.removeprefix("Bearer ")

        if settings.cognito_user_pool_id:
            # Production path – Cognito RS256
            return _verify_cognito_token(token)

        # Local / CI path – HS256
        return _verify_hs256_token(token)

    if settings.local_auth_enabled:
        return Principal(
            tenant_id=x_workpilot_tenant_id or DEMO_TENANT_ID,
            user_id=x_workpilot_user_id or DEMO_USER_ID,
            role="workflow_admin",
        )

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED, detail="Sign in required"
    )
