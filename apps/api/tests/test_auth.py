"""Tests for app/auth.py – local HS256 mode and Cognito RS256 mode.

The Cognito tests generate a real RS256 key pair locally with `cryptography`,
build a minimal JWT that matches what Cognito produces, and mock the JWKS
endpoint so no network calls are made.
"""

from __future__ import annotations

import base64
import os
import time
from collections.abc import Generator
from typing import Any
from unittest.mock import MagicMock, patch

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

# Ensure local auth is on before importing app modules.
os.environ.setdefault("WORKPILOT_LOCAL_AUTH_ENABLED", "true")
os.environ.setdefault("WORKPILOT_DATABASE_URL", "sqlite+aiosqlite:///./test-workpilot.db")
# The HS256 path needs a signing secret. Set it here rather than relying on a
# .env file: pydantic-settings resolves env_file relative to the working
# directory, so the repo-root .env is invisible when pytest runs from apps/api.
os.environ.setdefault("WORKPILOT_JWT_SECRET", "test-only-hs256-signing-secret-32-bytes-min")


# ---------------------------------------------------------------------------
# Re-usable RSA key pair (generated once for the whole test session)
# ---------------------------------------------------------------------------


@pytest.fixture(scope="session")
def rsa_key_pair() -> dict[str, Any]:
    """Return a private key, its public numbers, and a synthetic kid."""
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public_key = private_key.public_key()
    pub_numbers = public_key.public_numbers()  # type: ignore[attr-defined]

    def _int_to_b64(n: int) -> str:
        byte_length = (n.bit_length() + 7) // 8
        raw = n.to_bytes(byte_length, "big")
        return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()

    kid = "test-key-id-001"
    jwk: dict[str, Any] = {
        "kty": "RSA",
        "use": "sig",
        "alg": "RS256",
        "kid": kid,
        "n": _int_to_b64(pub_numbers.n),
        "e": _int_to_b64(pub_numbers.e),
    }
    return {
        "private_key": private_key,
        "public_key": public_key,
        "kid": kid,
        "jwk": jwk,
        "jwks": {"keys": [jwk]},
    }


# ---------------------------------------------------------------------------
# Minimal FastAPI app that exposes the dependency for testing
# ---------------------------------------------------------------------------


@pytest.fixture()
def auth_app() -> FastAPI:
    """A tiny FastAPI app that returns the resolved Principal as JSON."""
    from app.auth import Principal, current_principal

    mini = FastAPI()

    @mini.get("/whoami")
    async def whoami(principal: Principal = Depends(current_principal)) -> dict[str, str]:
        return {
            "tenant_id": principal.tenant_id,
            "user_id": principal.user_id,
            "role": principal.role,
        }

    return mini


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_hs256_token(secret: str, tenant_id: str, sub: str, role: str) -> str:
    payload = {
        "tenant_id": tenant_id,
        "sub": sub,
        "role": role,
        "exp": int(time.time()) + 3600,
    }
    return jwt.encode(payload, secret, algorithm="HS256")


def _make_rs256_token(
    private_key: Any,
    kid: str,
    sub: str,
    issuer: str,
    client_id: str,
    *,
    tenant_id: str | None = None,
    role: str | None = None,
    exp_offset: int = 3600,
    include_sub: bool = True,
) -> str:
    payload: dict[str, Any] = {
        "iss": issuer,
        "aud": client_id,
        "exp": int(time.time()) + exp_offset,
    }
    if include_sub:
        payload["sub"] = sub
    if tenant_id:
        payload["custom:tenant_id"] = tenant_id
    if role:
        payload["custom:role"] = role

    pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.TraditionalOpenSSL,
        encryption_algorithm=serialization.NoEncryption(),
    )
    return jwt.encode(payload, pem, algorithm="RS256", headers={"kid": kid})


# ---------------------------------------------------------------------------
# ── Local HS256 token tests ──────────────────────────────────────────────
# ---------------------------------------------------------------------------


class TestHS256Auth:
    """Tests for the local-dev HS256 JWT path."""

    @pytest.fixture(autouse=True)
    def _fresh_settings(self) -> Generator[None, None, None]:
        """Drop the settings cache so the env var above is picked up.

        Another test module may have already populated the lru_cache during
        collection, before this module's os.environ defaults were applied.
        """
        from app.config import get_settings

        get_settings.cache_clear()
        yield
        get_settings.cache_clear()

    def test_valid_hs256_token_returns_principal(self, auth_app: FastAPI) -> None:
        from app.config import get_settings

        secret = get_settings().jwt_secret
        token = _make_hs256_token(secret, "tenant-abc", "user-123", "admin")

        with TestClient(auth_app) as client:
            resp = client.get("/whoami", headers={"Authorization": f"Bearer {token}"})

        assert resp.status_code == 200
        data = resp.json()
        assert data["tenant_id"] == "tenant-abc"
        assert data["user_id"] == "user-123"
        assert data["role"] == "admin"

    def test_malformed_bearer_token_returns_401(self, auth_app: FastAPI) -> None:
        with TestClient(auth_app) as client:
            resp = client.get("/whoami", headers={"Authorization": "Bearer not.a.jwt"})
        assert resp.status_code == 401
        assert "Invalid access token" in resp.json()["detail"]

    def test_wrong_secret_returns_401(self, auth_app: FastAPI) -> None:
        token = _make_hs256_token("wrong-secret", "tenant-abc", "user-123", "admin")
        with TestClient(auth_app) as client:
            resp = client.get("/whoami", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 401

    def test_expired_hs256_token_returns_401(self, auth_app: FastAPI) -> None:
        from app.config import get_settings

        secret = get_settings().jwt_secret
        # exp in the past
        payload = {
            "tenant_id": "t1",
            "sub": "u1",
            "role": "admin",
            "exp": int(time.time()) - 10,
        }
        token = jwt.encode(payload, secret, algorithm="HS256")
        with TestClient(auth_app) as client:
            resp = client.get("/whoami", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# ── Local header-based stub auth tests ──────────────────────────────────
# ---------------------------------------------------------------------------


class TestLocalHeaderAuth:
    """Tests for the header-based stub principal (local_auth_enabled=True)."""

    def test_no_auth_header_uses_demo_defaults(self, auth_app: FastAPI) -> None:
        with TestClient(auth_app) as client:
            resp = client.get("/whoami")
        assert resp.status_code == 200
        data = resp.json()
        # defaults from DEMO_TENANT_ID / DEMO_USER_ID
        assert data["tenant_id"] == "tenant-northstar"
        assert data["user_id"] == "user-alex"
        assert data["role"] == "workflow_admin"

    def test_custom_tenant_header_overrides_demo(self, auth_app: FastAPI) -> None:
        with TestClient(auth_app) as client:
            resp = client.get(
                "/whoami",
                headers={
                    "X-WorkPilot-Tenant-ID": "tenant-custom",
                    "X-WorkPilot-User-ID": "user-custom",
                },
            )
        assert resp.status_code == 200
        assert resp.json()["tenant_id"] == "tenant-custom"
        assert resp.json()["user_id"] == "user-custom"

    def test_missing_auth_raises_401_when_local_disabled(self, auth_app: FastAPI) -> None:
        from app import config as config_module

        original = config_module.get_settings

        def patched_settings() -> Any:
            s = original()
            # Return a fresh Settings-like object with local_auth_enabled=False
            object.__setattr__(s, "local_auth_enabled", False)  # type: ignore[misc]
            return s

        # We can't easily mutate a frozen pydantic model, so patch at module level.
        with patch("app.auth.get_settings") as mock_get:
            fake = MagicMock()
            fake.local_auth_enabled = False
            fake.cognito_user_pool_id = ""
            fake.jwt_secret = "does-not-matter"
            mock_get.return_value = fake

            with TestClient(auth_app) as client:
                resp = client.get("/whoami")

        assert resp.status_code == 401
        assert "Sign in required" in resp.json()["detail"]


# ---------------------------------------------------------------------------
# ── Cognito RS256 tests ──────────────────────────────────────────────────
# ---------------------------------------------------------------------------


POOL_ID = "eu-central-1_TESTPOOL"
REGION = "eu-central-1"
CLIENT_ID = "test-client-id"
ISSUER = f"https://cognito-idp.{REGION}.amazonaws.com/{POOL_ID}"


def _mock_settings_cognito(
    *,
    pool_id: str = POOL_ID,
    region: str = REGION,
    client_id: str = CLIENT_ID,
    local_auth_enabled: bool = False,
) -> MagicMock:
    s = MagicMock()
    s.cognito_user_pool_id = pool_id
    s.cognito_region = region
    s.cognito_app_client_id = client_id
    s.local_auth_enabled = local_auth_enabled
    return s


@pytest.fixture(autouse=True)
def clear_jwks_cache() -> Generator[None, None, None]:
    """Wipe the module-level JWKS cache before each test for isolation."""
    import app.auth as auth_module

    auth_module._jwks_cache.clear()
    yield
    auth_module._jwks_cache.clear()


class TestCognitoRS256Auth:
    """Tests for the Cognito RS256 JWT path – JWKS endpoint is fully mocked."""

    def _jwks_response(self, jwks: dict[str, Any]) -> MagicMock:
        mock_resp = MagicMock()
        mock_resp.raise_for_status = MagicMock()
        mock_resp.json.return_value = jwks
        return mock_resp

    def test_valid_rs256_token_with_custom_claims(
        self, auth_app: FastAPI, rsa_key_pair: dict[str, Any]
    ) -> None:
        token = _make_rs256_token(
            rsa_key_pair["private_key"],
            rsa_key_pair["kid"],
            sub="cognito-sub-001",
            issuer=ISSUER,
            client_id=CLIENT_ID,
            tenant_id="tenant-prod",
            role="workflow_admin",
        )

        with (
            patch("app.auth.get_settings", return_value=_mock_settings_cognito()),
            patch("httpx.get", return_value=self._jwks_response(rsa_key_pair["jwks"])),
        ):
            with TestClient(auth_app) as client:
                resp = client.get("/whoami", headers={"Authorization": f"Bearer {token}"})

        assert resp.status_code == 200
        data = resp.json()
        assert data["tenant_id"] == "tenant-prod"
        assert data["user_id"] == "cognito-sub-001"
        assert data["role"] == "workflow_admin"

    def test_rs256_token_falls_back_to_sub_when_no_custom_tenant(
        self, auth_app: FastAPI, rsa_key_pair: dict[str, Any]
    ) -> None:
        token = _make_rs256_token(
            rsa_key_pair["private_key"],
            rsa_key_pair["kid"],
            sub="cognito-sub-no-tenant",
            issuer=ISSUER,
            client_id=CLIENT_ID,
            # No tenant_id / role custom claims
        )

        with (
            patch("app.auth.get_settings", return_value=_mock_settings_cognito()),
            patch("httpx.get", return_value=self._jwks_response(rsa_key_pair["jwks"])),
        ):
            with TestClient(auth_app) as client:
                resp = client.get("/whoami", headers={"Authorization": f"Bearer {token}"})

        assert resp.status_code == 200
        data = resp.json()
        assert data["tenant_id"] == "cognito-sub-no-tenant"  # fell back to sub
        assert data["role"] == "workflow_user"  # default role

    def test_unknown_kid_returns_401(
        self, auth_app: FastAPI, rsa_key_pair: dict[str, Any]
    ) -> None:
        token = _make_rs256_token(
            rsa_key_pair["private_key"],
            "unknown-kid-999",  # not in JWKS
            sub="cognito-sub-001",
            issuer=ISSUER,
            client_id=CLIENT_ID,
        )

        with (
            patch("app.auth.get_settings", return_value=_mock_settings_cognito()),
            patch("httpx.get", return_value=self._jwks_response(rsa_key_pair["jwks"])),
        ):
            with TestClient(auth_app) as client:
                resp = client.get("/whoami", headers={"Authorization": f"Bearer {token}"})

        assert resp.status_code == 401
        assert "signing key not recognised" in resp.json()["detail"]

    def test_wrong_issuer_returns_401(
        self, auth_app: FastAPI, rsa_key_pair: dict[str, Any]
    ) -> None:
        token = _make_rs256_token(
            rsa_key_pair["private_key"],
            rsa_key_pair["kid"],
            sub="cognito-sub-001",
            issuer="https://evil-issuer.example.com",
            client_id=CLIENT_ID,
        )

        with (
            patch("app.auth.get_settings", return_value=_mock_settings_cognito()),
            patch("httpx.get", return_value=self._jwks_response(rsa_key_pair["jwks"])),
        ):
            with TestClient(auth_app) as client:
                resp = client.get("/whoami", headers={"Authorization": f"Bearer {token}"})

        assert resp.status_code == 401

    def test_expired_rs256_token_returns_401(
        self, auth_app: FastAPI, rsa_key_pair: dict[str, Any]
    ) -> None:
        token = _make_rs256_token(
            rsa_key_pair["private_key"],
            rsa_key_pair["kid"],
            sub="cognito-sub-001",
            issuer=ISSUER,
            client_id=CLIENT_ID,
            exp_offset=-10,  # expired
        )

        with (
            patch("app.auth.get_settings", return_value=_mock_settings_cognito()),
            patch("httpx.get", return_value=self._jwks_response(rsa_key_pair["jwks"])),
        ):
            with TestClient(auth_app) as client:
                resp = client.get("/whoami", headers={"Authorization": f"Bearer {token}"})

        assert resp.status_code == 401

    def test_jwks_network_error_returns_503(self, auth_app: FastAPI) -> None:
        import httpx as real_httpx

        with (
            patch("app.auth.get_settings", return_value=_mock_settings_cognito()),
            patch("httpx.get", side_effect=real_httpx.ConnectError("timeout")),
        ):
            with TestClient(auth_app) as client:
                resp = client.get(
                    "/whoami",
                    headers={"Authorization": "Bearer eyJhbGciOiJSUzI1NiIsImtpZCI6InRlc3QifQ.e30.sig"},
                )

        assert resp.status_code == 503
        assert "unavailable" in resp.json()["detail"]

    def test_jwks_cache_used_on_second_call(
        self, auth_app: FastAPI, rsa_key_pair: dict[str, Any]
    ) -> None:
        """JWKS should be fetched once and cached for the second request."""
        token = _make_rs256_token(
            rsa_key_pair["private_key"],
            rsa_key_pair["kid"],
            sub="cognito-sub-001",
            issuer=ISSUER,
            client_id=CLIENT_ID,
        )

        mock_get = MagicMock(return_value=self._jwks_response(rsa_key_pair["jwks"]))

        with (
            patch("app.auth.get_settings", return_value=_mock_settings_cognito()),
            patch("httpx.get", mock_get),
        ):
            with TestClient(auth_app) as client:
                resp1 = client.get("/whoami", headers={"Authorization": f"Bearer {token}"})
                resp2 = client.get("/whoami", headers={"Authorization": f"Bearer {token}"})

        assert resp1.status_code == 200
        assert resp2.status_code == 200
        assert mock_get.call_count == 1  # only fetched once

    def test_kid_rotation_triggers_refetch(
        self, auth_app: FastAPI, rsa_key_pair: dict[str, Any]
    ) -> None:
        """When kid is missing from cache, auth should re-fetch JWKS once."""
        import app.auth as auth_module

        # Pre-populate cache with a different kid so the real one appears to be missing.
        auth_module._jwks_cache[POOL_ID] = {"some-other-kid": {}}

        token = _make_rs256_token(
            rsa_key_pair["private_key"],
            rsa_key_pair["kid"],
            sub="cognito-sub-rotation",
            issuer=ISSUER,
            client_id=CLIENT_ID,
        )

        mock_get = MagicMock(return_value=self._jwks_response(rsa_key_pair["jwks"]))

        with (
            patch("app.auth.get_settings", return_value=_mock_settings_cognito()),
            patch("httpx.get", mock_get),
        ):
            with TestClient(auth_app) as client:
                resp = client.get("/whoami", headers={"Authorization": f"Bearer {token}"})

        assert resp.status_code == 200
        assert mock_get.call_count == 1  # one forced refresh
        assert resp.json()["user_id"] == "cognito-sub-rotation"
