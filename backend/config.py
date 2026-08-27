import logging
import os
import re
from pathlib import Path
from dotenv import load_dotenv

logger = logging.getLogger(__name__)

# Always load the backend/.env file, regardless of the directory from which
# `python run.py` is launched. This prevents local SMTP settings from being
# silently missed when the project is started from another working directory.
# On Vercel (no .env file) this is a no-op; Vercel environment variables are
# used directly.
BASE_DIR = Path(__file__).resolve().parent
_loaded = load_dotenv(BASE_DIR / ".env", override=False)
logger.info(
    "dotenv loaded: %s (file exists at %s)",
    _loaded,
    BASE_DIR / ".env",
)

IS_VERCEL = bool(os.getenv("VERCEL"))


def _env(name, default=""):
    """Read an environment variable, treating both missing and empty-string
    values as *unset*.  ``os.getenv(name, default)`` only applies the default
    when the variable is absent; if it is set to ``""`` the empty string is
    returned, which silently breaks SMTP and integer conversions.  Using
    ``or`` ensures empty strings fall through to the default.
    """
    return os.getenv(name) or default


def _normalise_db_uri(uri):
    """Normalise a DATABASE_URL for SQLAlchemy compatibility.

    - ``postgres://`` → ``postgresql://`` (Heroku / some providers)
    - Strips trailing ``?sslmode=...`` when Neon/Supabase already negotiate
      TLS via the ``sslmode`` query parameter — psycopg2-binary handles TLS
      natively when the URI starts with ``postgresql://`` and ``sslmode`` is
      part of the URI.  We keep ``sslmode`` in the URI; SQLAlchemy / psycopg2
      will honour it.
    """
    if uri.startswith("postgres://"):
        uri = "postgresql://" + uri[len("postgres://"):]
    return uri


class Config:
    # ----- Database ---------------------------------------------------------
    # In production (Vercel) DATABASE_URL MUST be set to a persistent
    # PostgreSQL connection string.  Ephemeral /tmp storage is no longer
    # accepted because every cold-start would create a fresh empty database.
    #
    # For local development, SQLite is used automatically when DATABASE_URL is
    # not set.
    _env_db = _env("DATABASE_URL")
    if IS_VERCEL and not _env_db:
        raise RuntimeError(
            "DATABASE_URL environment variable is required on Vercel. "
            "Set it to a persistent PostgreSQL connection string "
            "(e.g. from Neon, Supabase, or Railway) in the Vercel dashboard "
            "under Settings → Environment Variables."
        )
    _default_db = (
        f"sqlite:///{BASE_DIR / 'instance' / 'stroke.db'}"
        if not IS_VERCEL
        else _env_db
    )
    _raw_uri = _env("DATABASE_URL", _default_db) if not IS_VERCEL else _env_db
    SQLALCHEMY_DATABASE_URI = _normalise_db_uri(_raw_uri)
    SQLALCHEMY_TRACK_MODIFICATIONS = False

    _is_postgres = SQLALCHEMY_DATABASE_URI.startswith("postgresql")
    SQLALCHEMY_ENGINE_OPTIONS = (
        # SQLite — local development only
        {"connect_args": {"timeout": 30}}
        if not _is_postgres
        else {
            # PostgreSQL — production / serverless-safe settings
            "pool_pre_ping": True,
            "pool_recycle": 300,
            "pool_timeout": 30,
            "pool_size": 1,
            "max_overflow": 0,
        }
    )

    if IS_VERCEL:
        logger.info(
            "Vercel production: using persistent PostgreSQL database "
            "(pool_size=1, pool_recycle=300, pool_pre_ping=True)."
        )
    elif _is_postgres:
        logger.info(
            "PostgreSQL database configured (pool_size=1, pool_recycle=300)."
        )
    else:
        logger.info(
            "Local development: using SQLite at %s",
            SQLALCHEMY_DATABASE_URI.replace("sqlite:///", ""),
        )

    # ----- JWT --------------------------------------------------------------
    JWT_SECRET_KEY = _env("JWT_SECRET_KEY", "dev-only-change-me")

    # ----- CORS -------------------------------------------------------------
    # Use regex patterns so every Vercel preview deployment of the frontend
    # project is automatically allowed without manually listing each hash URL.
    FRONTEND_ORIGINS = [
        r"^https?://localhost(:[0-9]+)?$",                                  # local dev
        r"^https://neuro-risk-ai-frontend(-[a-zA-Z0-9]+)*\.vercel\.app$",   # Vercel (prod + previews)
    ]
    # Optional: add extra literal origins from the FRONTEND_ORIGIN env var
    # (comma-separated).  Each value is regex-escaped so it is matched exactly.
    _extra = _env("FRONTEND_ORIGIN", "")
    if _extra:
        FRONTEND_ORIGINS.extend(
            re.escape(o.strip()) for o in _extra.split(",") if o.strip()
        )

    # ----- SMTP / email configuration ---------------------------------------
    # Use ``_env`` (not ``os.getenv``) so that variables set to an empty
    # string in Vercel (or any other environment) correctly fall back to the
    # default instead of silently becoming falsy.
    SMTP_HOST = _env("SMTP_HOST", "smtp.gmail.com")
    SMTP_PORT = int(_env("SMTP_PORT", "587"))
    SMTP_USERNAME = _env("SMTP_USERNAME")
    SMTP_PASSWORD = _env("SMTP_PASSWORD")
    SMTP_USE_TLS = _env("SMTP_USE_TLS", "true").strip().lower() in ("true", "1", "yes")
    SMTP_TIMEOUT = int(_env("SMTP_TIMEOUT", "20"))

    # Password-reset email delivery is asynchronous. Keep this bounded so
    # SMTP is not flooded when dozens/hundreds of users request OTPs together.
    MAIL_WORKERS = int(_env("MAIL_WORKERS", "4"))
    MAIL_MAX_ATTEMPTS = int(_env("MAIL_MAX_ATTEMPTS", "5"))
    MAIL_RETRY_DELAY_SECONDS = int(_env("MAIL_RETRY_DELAY_SECONDS", "5"))
    # If MAIL_FROM is omitted, use the SMTP account as the sender.
    MAIL_FROM = _env("MAIL_FROM") or SMTP_USERNAME
    GOOGLE_CLIENT_ID = _env("GOOGLE_CLIENT_ID")


logger.info(
    "SMTP diagnostic — host_set: %s, username_set: %s, password_set: %s, "
    "mail_from_set: %s, configured: %s (VERCEL=%s)",
    bool(Config.SMTP_HOST),
    bool(Config.SMTP_USERNAME),
    bool(Config.SMTP_PASSWORD),
    bool(Config.MAIL_FROM),
    bool(Config.SMTP_HOST and Config.SMTP_USERNAME and Config.SMTP_PASSWORD and Config.MAIL_FROM),
    IS_VERCEL,
)
