from collections.abc import AsyncIterator
from typing import Any
from urllib.parse import parse_qs, urlencode, urlsplit, urlunsplit

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import get_settings


class Base(DeclarativeBase):
    pass


def normalize_database_url(url: str) -> tuple[str, dict[str, Any]]:
    """Split a database URL into an asyncpg-safe URL plus engine connect args.

    Managed Postgres providers such as Neon, RDS, and Supabase hand out
    libpq-style URLs (``sslmode=require``, ``channel_binding=require``). The
    asyncpg driver rejects those as query parameters, so we translate them into
    an explicit ``ssl`` connect argument and drop the libpq-only keys. Plain
    SQLite and non-asyncpg URLs pass through untouched.
    """

    if "+asyncpg" not in url:
        return url, {}

    parts = urlsplit(url)
    query = parse_qs(parts.query)
    sslmode = (query.pop("sslmode", [None])[0] or "").lower()
    query.pop("channel_binding", None)  # asyncpg negotiates channel binding automatically
    query.pop("ssl", None)

    connect_args: dict[str, Any] = {}
    host = parts.hostname or ""
    is_local = host in {"localhost", "127.0.0.1", "::1", ""}
    if sslmode == "disable":
        connect_args["ssl"] = False
    elif sslmode or not is_local:
        # asyncpg uses ssl=True to negotiate TLS with the platform trust store.
        connect_args["ssl"] = True

    rebuilt_query = urlencode({key: values[0] for key, values in query.items()})
    normalized = urlunsplit((parts.scheme, parts.netloc, parts.path, rebuilt_query, parts.fragment))
    return normalized, connect_args


settings = get_settings()
_database_url, _connect_args = normalize_database_url(settings.database_url)
engine = create_async_engine(_database_url, pool_pre_ping=True, connect_args=_connect_args)
SessionFactory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


async def get_session() -> AsyncIterator[AsyncSession]:
    async with SessionFactory() as session:
        yield session


async def create_schema() -> None:
    from app import models  # noqa: F401

    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
