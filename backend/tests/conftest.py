"""Pytest isolation - tests must never touch the production database.

Production data lives in backend/instance/stroke.db (gitignored). Several
historical test modules did not pin DATABASE_URL, so a full `pytest tests/`
run fell back to that file via config.py and could read/attempt writes
against real user records (observed as UNIQUE user.email failures, since
fixture users from earlier sessions already existed there).

This conftest runs BEFORE any test module is imported, so setting the
environment here isolates every test on an in-memory SQLite database.
Individual test modules that already set DATABASE_URL keep working (same
value). Nothing in production config is modified - this only affects pytest.
"""

import os

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret")

# config.py calls load_dotenv(override=False), which imports the real
# SMTP_HOST/SMTP_USERNAME/SMTP_PASSWORD/MAIL_FROM values from backend/.env
# into os.environ when app/config is first imported. smtp_is_configured()
# and send_password_reset_email() fall back to os.environ when a config
# value is empty, so those leaked credentials defeated every test that
# asserted "empty config => SMTP not configured". Pre-seeding empty strings
# here (before any test imports config.py) blocks the dotenv leak without
# touching backend/.env or any application code: load_dotenv(override=False)
# will not overwrite keys that already exist.
for _mail_var in ("SMTP_HOST", "SMTP_USERNAME", "SMTP_PASSWORD", "MAIL_FROM"):
    os.environ[_mail_var] = ""
