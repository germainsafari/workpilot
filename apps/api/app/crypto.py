"""Symmetric encryption for third-party credentials at rest.

Connection tokens (a Scoro API key, a Drive OAuth token) are secrets belonging
to the tenant, not to WorkPilot. They are encrypted with Fernet (AES-128-CBC +
HMAC-SHA256) before they touch the database and decrypted only in the moment a
tool call needs them.

Key resolution, in order:

1. ``WORKPILOT_ENCRYPTION_KEY`` — a urlsafe-base64 32-byte Fernet key. This is
   what production must set. Generate one with::

       python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"

2. ``WORKPILOT_JWT_SECRET`` — derived via SHA-256 so a local checkout that
   already has a JWT secret works without extra configuration.

3. A hardcoded development key, **only** when ``environment`` is local/dev/test.
   Any other environment raises instead, so production cannot silently run with
   a publicly known key.
"""

from __future__ import annotations

import base64
import hashlib
import logging

from cryptography.fernet import Fernet, InvalidToken

from app.config import get_settings

logger = logging.getLogger(__name__)

# Only ever used for local development; see module docstring.
_DEV_KEY_SEED = b"workpilot-local-development-only"
_LOCAL_ENVIRONMENTS = {"local", "dev", "development", "test", "testing", "ci"}


class CredentialEncryptionError(RuntimeError):
    """The credential could not be encrypted or decrypted."""


def _derive_key(material: bytes) -> bytes:
    """Turn arbitrary secret material into a valid Fernet key."""
    return base64.urlsafe_b64encode(hashlib.sha256(material).digest())


def _resolve_key() -> bytes:
    settings = get_settings()

    configured = (settings.encryption_key or "").strip()
    if configured:
        # Accept both a proper Fernet key and any passphrase.
        try:
            Fernet(configured.encode())
            return configured.encode()
        except (ValueError, TypeError):
            return _derive_key(configured.encode())

    jwt_secret = (settings.jwt_secret or "").strip()
    if jwt_secret:
        return _derive_key(jwt_secret.encode())

    if settings.environment.lower() in _LOCAL_ENVIRONMENTS:
        logger.warning(
            "WORKPILOT_ENCRYPTION_KEY is not set — using the development key. "
            "Connection tokens are NOT meaningfully protected. Set a real key "
            "before storing production credentials."
        )
        return _derive_key(_DEV_KEY_SEED)

    raise CredentialEncryptionError(
        f"WORKPILOT_ENCRYPTION_KEY must be set when environment={settings.environment!r}. "
        "Generate one with: python -c \"from cryptography.fernet import Fernet; "
        'print(Fernet.generate_key().decode())"'
    )


def _fernet() -> Fernet:
    return Fernet(_resolve_key())


def encrypt_secret(plaintext: str | None) -> str | None:
    """Encrypt a credential for storage. ``None``/empty passes through."""
    if not plaintext:
        return None
    try:
        return _fernet().encrypt(plaintext.encode()).decode()
    except CredentialEncryptionError:
        raise
    except Exception as exc:  # pragma: no cover - defensive
        raise CredentialEncryptionError(f"could not encrypt credential: {exc}") from exc


def decrypt_secret(ciphertext: str | None) -> str | None:
    """Decrypt a stored credential. ``None``/empty passes through.

    Raises :class:`CredentialEncryptionError` on a key mismatch — which is the
    signal that ``WORKPILOT_ENCRYPTION_KEY`` changed after the row was written.
    """
    if not ciphertext:
        return None
    try:
        return _fernet().decrypt(ciphertext.encode()).decode()
    except InvalidToken as exc:
        raise CredentialEncryptionError(
            "stored credential could not be decrypted — the encryption key has "
            "changed since it was saved. Re-enter the token for this connection."
        ) from exc
    except CredentialEncryptionError:
        raise
    except Exception as exc:  # pragma: no cover - defensive
        raise CredentialEncryptionError(f"could not decrypt credential: {exc}") from exc


def mask_secret(plaintext: str | None) -> str:
    """Render a credential for display: last 4 characters only.

    Deliberately ASCII — a non-ASCII mask character survives the trip through
    JSON and a Windows console badly enough to look like corruption.
    """
    if not plaintext:
        return ""
    if len(plaintext) <= 4:
        return "*" * len(plaintext)
    return "*" * 8 + plaintext[-4:]
