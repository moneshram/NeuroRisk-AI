import logging
import os
import re
import secrets
from datetime import timedelta
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
    # ----- Startup guards ---------------------------------------------------
    # Never raise at import time on Vercel: an exception while loading the
    # module makes Vercel answer every request (including CORS preflights)
    # with an opaque "FUNCTION_INVOCATION_FAILED" 500, which the frontend
    # surfaces to users as "Unable to reach the server" — hiding the actual
    # fix. Instead record every problem; create_app() short-circuits on the
    # combined CONFIG_ERROR and serves the messages as a readable JSON 503.
    # (Unprefixed class attributes are skipped by app.config.from_object;
    # the underscore names below stay private to the class body.)
    _startup_errors = []

    # ----- Database ---------------------------------------------------------
    # In production (Vercel) DATABASE_URL MUST be set to a persistent
    # PostgreSQL connection string.  Ephemeral /tmp storage is no longer
    # accepted because every cold-start would create a fresh empty database.
    #
    # For local development, SQLite is used automatically when DATABASE_URL is
    # not set.
    _env_db = _env("DATABASE_URL")
    if IS_VERCEL and not _env_db:
        _startup_errors.append(
            "DATABASE_URL environment variable is required on Vercel. "
            "Set it to a persistent PostgreSQL connection string "
            "(e.g. from Neon, Supabase, or Railway) in the Vercel dashboard "
            "under Settings → Environment Variables, then redeploy."
        )
        _env_db = "sqlite:///:memory:"  # inert placeholder — never queried
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
    # SECURITY: the signing secret MUST come from the environment in
    # production. The previous hard-coded fallback ("dev-only-change-me")
    # meant that a missing Vercel env var let anyone forge admin tokens, so
    # on Vercel a missing/empty JWT_SECRET_KEY is now a startup error
    # (CONFIG_ERROR -> readable JSON 503, same pattern as DATABASE_URL).
    # Locally a random per-process secret is generated instead: sessions do
    # not survive a restart (or a second process), which is the correct
    # trade-off for development and impossible to forge from the outside.
    _jwt_secret = _env("JWT_SECRET_KEY")
    if IS_VERCEL and not _jwt_secret:
        _startup_errors.append(
            "JWT_SECRET_KEY environment variable is required on Vercel. "
            "Generate one with: python -c \"import secrets; print(secrets.token_hex(32))\" "
            "and set it in the Vercel dashboard under Settings → Environment "
            "Variables, then redeploy."
        )
        _jwt_secret = "unconfigured-on-vercel"  # never used — create_app short-circuits
    elif not _jwt_secret:
        _jwt_secret = secrets.token_hex(32)
        logger.warning(
            "JWT_SECRET_KEY is not set — using a random per-process development "
            "secret. Issued tokens will NOT survive a server restart. Set "
            "JWT_SECRET_KEY in backend/.env (see .env.example) for stable sessions."
        )
    JWT_SECRET_KEY = _jwt_secret

    # Access-token lifetime. Flask-JWT-Extended defaults to 15 minutes, which
    # silently logged users out mid-session; 8 hours is a sane default for a
    # bearer-token SPA. Override with JWT_ACCESS_TOKEN_EXPIRES_SECONDS.
    try:
        JWT_ACCESS_TOKEN_EXPIRES = timedelta(
            seconds=int(_env("JWT_ACCESS_TOKEN_EXPIRES_SECONDS", str(8 * 3600)))
        )
    except ValueError:
        logger.warning(
            "JWT_ACCESS_TOKEN_EXPIRES_SECONDS is not a valid integer; "
            "falling back to the 8-hour default."
        )
        JWT_ACCESS_TOKEN_EXPIRES = timedelta(seconds=8 * 3600)

    # The frontend authenticates exclusively via the Authorization: Bearer
    # header (no cookies) — restricting token locations removes the
    # cookie-based attack surface (e.g. CSRF against token cookies).
    JWT_TOKEN_LOCATION = ["headers"]

    # ----- Startup error aggregation ---------------------------------------
    # (Declared after the checks above so every guard contributes one
    # readable sentence; create_app() serves CONFIG_ERROR as JSON 503.)
    CONFIG_ERROR = " ".join(_startup_errors) if _startup_errors else None

    # ----- Rate limiting ----------------------------------------------------
    # Raw env string ("" means enabled). create_app() turns this into the
    # boolean RATELIMIT_ENABLED; set RATELIMIT_DISABLED=1 to switch the
    # limiter off entirely (used by the pytest suite and available as an
    # emergency kill-switch in production).
    RATELIMIT_DISABLED = _env("RATELIMIT_DISABLED", "")

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
    # Literal frontend base URL used to build password-reset links
    # (app.config["FRONTEND_ORIGIN"]). NOTE: this used to be missing from
    # Config entirely, so the forgot-password "link" flow crashed with a
    # KeyError/500 whenever SMTP was configured. First value of the
    # FRONTEND_ORIGIN env var, else a localhost dev default.
    FRONTEND_ORIGIN = _env(
        "FRONTEND_ORIGIN", "http://localhost:5173"
    ).split(",")[0].strip()

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
