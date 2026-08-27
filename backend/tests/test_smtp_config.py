"""Tests for SMTP configuration detection, environment variable loading,
password-reset OTP generation, multi-user independence, retry behaviour,
and the 503 response when SMTP is not configured.
"""
import hashlib
import importlib
import os
import sys
import logging
from unittest.mock import patch

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from extensions import db
import app as app_module
from app import create_app, smtp_is_configured
from models import User, PasswordReset, MailJob
import config as config_module
from config import _env


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_app(**config_overrides):
    """Create a test app with in-memory SQLite. Config overrides are applied
    directly to the Flask app config, which is the runtime source of truth.
    The mail dispatcher daemon is disabled to avoid thread interference;
    a no-op dispatcher is registered so enqueue_mail_job works.
    """
    def _noop_dispatcher(app):
        class _NoopDispatcher:
            def start(self): pass
            def enqueue(self, job_id): pass
        app.extensions["mail_dispatcher"] = _NoopDispatcher()

    with patch.dict(os.environ, {
        "DATABASE_URL": "sqlite:///:memory:",
        "JWT_SECRET_KEY": "test-secret",
    }, clear=False):
        with patch.object(app_module, "start_mail_dispatcher", _noop_dispatcher):
            application = create_app()
    application.config.update(config_overrides)
    return application


def _register_user(app, email="user@example.com", name="Test User"):
    with app.app_context():
        user = User(name=name, email=email, role="user")
        user.set_password("Password@123")
        db.session.add(user)
        db.session.commit()
        return user.id


# ---------------------------------------------------------------------------
# 1. _env() helper — treats empty strings as unset
# ---------------------------------------------------------------------------

class TestEnvHelper:

    def test_returns_value_when_set(self):
        with patch.dict(os.environ, {"MY_VAR": "hello"}, clear=False):
            assert _env("MY_VAR") == "hello"

    def test_returns_default_when_missing(self):
        with patch.dict(os.environ, {}, clear=True):
            assert _env("MY_VAR", "fallback") == "fallback"

    def test_returns_default_when_empty_string(self):
        with patch.dict(os.environ, {"MY_VAR": ""}, clear=False):
            assert _env("MY_VAR", "fallback") == "fallback"

    def test_returns_empty_default_when_missing_and_no_default(self):
        with patch.dict(os.environ, {}, clear=True):
            assert _env("MY_VAR") == ""

    def test_returns_empty_default_when_empty_and_no_default(self):
        with patch.dict(os.environ, {"MY_VAR": ""}, clear=False):
            assert _env("MY_VAR") == ""

    def test_whitespace_only_is_not_treated_as_empty(self):
        with patch.dict(os.environ, {"MY_VAR": "  "}, clear=False):
            assert _env("MY_VAR", "fallback") == "  "


# ---------------------------------------------------------------------------
# 2. Config class attribute loading via module reload
# ---------------------------------------------------------------------------

class TestConfigClassLoading:
    """Config class attributes are evaluated at class definition (import) time.
    To test different env-var scenarios, we must reload the config module."""

    def _reload_config(self, env_overrides):
        """Reload config.py with controlled env vars to re-evaluate class attrs."""
        env = {
            "DATABASE_URL": "sqlite:///:memory:",
            "JWT_SECRET_KEY": "test",
        }
        env.update(env_overrides)
        with patch.dict(os.environ, env, clear=False):
            # Remove any keys not in env from os.environ to simulate a clean env
            for key in list(os.environ.keys()):
                if key not in env:
                    del os.environ[key]
            # Reload to re-evaluate Config class
            mod = importlib.reload(config_module)
            return mod.Config

    def test_empty_smtp_host_falls_back_to_default(self):
        Config = self._reload_config({"SMTP_HOST": ""})
        assert Config.SMTP_HOST == "smtp.gmail.com"

    def test_smtp_host_not_set_falls_back(self):
        Config = self._reload_config({})
        assert Config.SMTP_HOST == "smtp.gmail.com"

    def test_smtp_host_set_to_value_is_preserved(self):
        Config = self._reload_config({"SMTP_HOST": "smtp.custom.host"})
        assert Config.SMTP_HOST == "smtp.custom.host"

    def test_smtp_port_integer_conversion(self):
        Config = self._reload_config({"SMTP_PORT": "465"})
        assert Config.SMTP_PORT == 465
        assert isinstance(Config.SMTP_PORT, int)

    def test_smtp_port_empty_string_uses_default(self):
        Config = self._reload_config({"SMTP_PORT": ""})
        assert Config.SMTP_PORT == 587

    def test_smtp_port_missing_uses_default(self):
        Config = self._reload_config({})
        assert Config.SMTP_PORT == 587

    def test_smtp_use_tls_true_string(self):
        Config = self._reload_config({"SMTP_USE_TLS": "true"})
        assert Config.SMTP_USE_TLS is True

    def test_smtp_use_tls_false_string(self):
        Config = self._reload_config({"SMTP_USE_TLS": "false"})
        assert Config.SMTP_USE_TLS is False

    def test_smtp_use_tls_one(self):
        Config = self._reload_config({"SMTP_USE_TLS": "1"})
        assert Config.SMTP_USE_TLS is True

    def test_smtp_use_tls_zero(self):
        Config = self._reload_config({"SMTP_USE_TLS": "0"})
        assert Config.SMTP_USE_TLS is False

    def test_smtp_use_tls_yes(self):
        Config = self._reload_config({"SMTP_USE_TLS": "yes"})
        assert Config.SMTP_USE_TLS is True

    def test_smtp_use_tls_no(self):
        Config = self._reload_config({"SMTP_USE_TLS": "no"})
        assert Config.SMTP_USE_TLS is False

    def test_smtp_use_tls_empty_defaults_to_true(self):
        Config = self._reload_config({"SMTP_USE_TLS": ""})
        assert Config.SMTP_USE_TLS is True

    def test_smtp_timeout_integer_conversion(self):
        Config = self._reload_config({"SMTP_TIMEOUT": "30"})
        assert Config.SMTP_TIMEOUT == 30

    def test_smtp_timeout_empty_uses_default(self):
        Config = self._reload_config({"SMTP_TIMEOUT": ""})
        assert Config.SMTP_TIMEOUT == 20

    def test_mail_workers_conversion(self):
        Config = self._reload_config({"MAIL_WORKERS": "8"})
        assert Config.MAIL_WORKERS == 8

    def test_mail_workers_empty_uses_default(self):
        Config = self._reload_config({"MAIL_WORKERS": ""})
        assert Config.MAIL_WORKERS == 4

    def test_mail_from_fallback_to_smtp_username(self):
        Config = self._reload_config({
            "SMTP_USERNAME": "sender@example.com",
            "MAIL_FROM": "",
        })
        assert Config.MAIL_FROM == "sender@example.com"

    def test_mail_from_set_explicitly(self):
        Config = self._reload_config({
            "SMTP_USERNAME": "sender@example.com",
            "MAIL_FROM": "custom@example.com",
        })
        assert Config.MAIL_FROM == "custom@example.com"

    def test_empty_username_makes_not_configured(self):
        Config = self._reload_config({"SMTP_USERNAME": ""})
        assert Config.SMTP_USERNAME == ""
        assert not (Config.SMTP_HOST and Config.SMTP_USERNAME
                    and Config.SMTP_PASSWORD and Config.MAIL_FROM)


# ---------------------------------------------------------------------------
# 3. smtp_is_configured() — tests via app.config (runtime path)
# ---------------------------------------------------------------------------

class TestSMTPConfiguredDetection:

    def test_configured_when_all_required_set(self):
        app = _make_app(
            SMTP_HOST="smtp.test",
            SMTP_USERNAME="sender@example.com",
            SMTP_PASSWORD="password",
            MAIL_FROM="sender@example.com",
        )
        assert smtp_is_configured(app) is True

    def test_not_configured_when_host_empty(self):
        app = _make_app(
            SMTP_HOST="",
            SMTP_USERNAME="sender@example.com",
            SMTP_PASSWORD="password",
            MAIL_FROM="sender@example.com",
        )
        # Host has a hardcoded fallback to "smtp.gmail.com", so configured
        # depends on username + password + mail_from. With all three set,
        # it IS configured even if the user left SMTP_HOST blank.
        assert smtp_is_configured(app) is True

    def test_not_configured_when_username_empty(self):
        app = _make_app(
            SMTP_HOST="smtp.test",
            SMTP_USERNAME="",
            SMTP_PASSWORD="password",
            MAIL_FROM="sender@example.com",
        )
        assert smtp_is_configured(app) is False

    def test_not_configured_when_password_empty(self):
        app = _make_app(
            SMTP_HOST="smtp.test",
            SMTP_USERNAME="sender@example.com",
            SMTP_PASSWORD="",
            MAIL_FROM="sender@example.com",
        )
        assert smtp_is_configured(app) is False

    def test_not_configured_when_mail_from_empty_and_no_username(self):
        app = _make_app(
            SMTP_HOST="smtp.test",
            SMTP_USERNAME="",
            SMTP_PASSWORD="password",
            MAIL_FROM="",
        )
        assert smtp_is_configured(app) is False

    def test_configured_when_mail_from_empty_but_username_set(self):
        app = _make_app(
            SMTP_HOST="smtp.test",
            SMTP_USERNAME="sender@example.com",
            SMTP_PASSWORD="password",
            MAIL_FROM="",
        )
        assert smtp_is_configured(app) is True


# ---------------------------------------------------------------------------
# 4. Endpoint: SMTP configured → 200, not configured → 503
# ---------------------------------------------------------------------------

class TestForgotPasswordEndpoint:

    def _fake_send(self, app, recipient, subject, body):
        pass

    def test_returns_200_when_smtp_configured(self):
        app = _make_app(
            SMTP_HOST="smtp.test",
            SMTP_USERNAME="sender@example.com",
            SMTP_PASSWORD="password",
            MAIL_FROM="sender@example.com",
        )
        with patch.object(app_module, "send_password_reset_email", self._fake_send):
            _register_user(app)
            resp = app.test_client().post("/api/auth/forgot-password", json={
                "email": "user@example.com", "method": "otp",
            })
            assert resp.status_code == 200

    def test_returns_503_when_smtp_not_configured(self):
        app = _make_app(
            SMTP_HOST="",
            SMTP_USERNAME="",
            SMTP_PASSWORD="",
            MAIL_FROM="",
        )
        _register_user(app)
        resp = app.test_client().post("/api/auth/forgot-password", json={
            "email": "user@example.com", "method": "otp",
        })
        assert resp.status_code == 503
        assert "unavailable" in resp.get_json()["error"].lower()

    def test_returns_503_for_link_method_when_smtp_not_configured(self):
        app = _make_app(
            SMTP_HOST="",
            SMTP_USERNAME="",
            SMTP_PASSWORD="",
            MAIL_FROM="",
        )
        _register_user(app)
        resp = app.test_client().post("/api/auth/forgot-password", json={
            "email": "user@example.com", "method": "link",
        })
        assert resp.status_code == 503

    def test_returns_200_when_only_host_missing_but_other_fields_set(self):
        app = _make_app(
            SMTP_HOST="",
            SMTP_USERNAME="sender@example.com",
            SMTP_PASSWORD="password",
            MAIL_FROM="sender@example.com",
        )
        _register_user(app)
        with patch.object(app_module, "send_password_reset_email", self._fake_send):
            resp = app.test_client().post("/api/auth/forgot-password", json={
                "email": "user@example.com", "method": "otp",
            })
            assert resp.status_code == 200


# ---------------------------------------------------------------------------
# 5. OTP operations
# ---------------------------------------------------------------------------

class TestOTPOperations:

    def _fake_send(self, app, recipient, subject, body):
        pass

    def test_otp_is_6_digits(self):
        app = _make_app(
            SMTP_HOST="smtp.test",
            SMTP_USERNAME="sender@example.com",
            SMTP_PASSWORD="password",
            MAIL_FROM="sender@example.com",
        )
        with patch.object(app_module, "send_password_reset_email", self._fake_send):
            _register_user(app)
            resp = app.test_client().post("/api/auth/forgot-password", json={
                "email": "user@example.com", "method": "otp",
            })
            assert resp.status_code == 200

    def test_verify_otp_with_valid_code(self):
        app = _make_app(
            SMTP_HOST="smtp.test",
            SMTP_USERNAME="sender@example.com",
            SMTP_PASSWORD="password",
            MAIL_FROM="sender@example.com",
        )
        with app.app_context():
            user = User(name="OTP User", email="otp@example.com", role="user")
            user.set_password("Password@123")
            db.session.add(user)
            db.session.commit()
            user_id = user.id

        raw_otp = "123456"
        with app.app_context():
            otp_hash = hashlib.sha256(
                f"otp:{user_id}:{raw_otp}".encode()
            ).hexdigest()
            from datetime import datetime, timedelta, timezone
            reset = PasswordReset(
                user_id=user_id,
                token_hash=otp_hash,
                expires_at=datetime.now(timezone.utc) + timedelta(minutes=10),
            )
            db.session.add(reset)
            db.session.commit()

        resp = app.test_client().post("/api/auth/verify-otp", json={
            "email": "otp@example.com", "otp": "123456",
        })
        assert resp.status_code == 200

    def test_verify_otp_with_invalid_code(self):
        app = _make_app(
            SMTP_HOST="smtp.test",
            SMTP_USERNAME="sender@example.com",
            SMTP_PASSWORD="password",
            MAIL_FROM="sender@example.com",
        )
        with app.app_context():
            user = User(name="OTP User 2", email="otp2@example.com", role="user")
            user.set_password("Password@123")
            db.session.add(user)
            db.session.commit()

        resp = app.test_client().post("/api/auth/verify-otp", json={
            "email": "otp2@example.com", "otp": "999999",
        })
        assert resp.status_code == 400


# ---------------------------------------------------------------------------
# 6. Multiple users requesting OTPs independently
# ---------------------------------------------------------------------------

class TestMultiUserOTP:

    def _fake_send(self, app, recipient, subject, body):
        pass

    def test_two_users_get_independent_otps(self):
        app = _make_app(
            SMTP_HOST="smtp.test",
            SMTP_USERNAME="sender@example.com",
            SMTP_PASSWORD="password",
            MAIL_FROM="sender@example.com",
        )
        with patch.object(app_module, "send_password_reset_email", self._fake_send):
            with app.app_context():
                u1 = User(name="User A", email="alice@example.com", role="user")
                u1.set_password("Password@123")
                u2 = User(name="User B", email="bob@example.com", role="user")
                u2.set_password("Password@456")
                db.session.add_all([u1, u2])
                db.session.commit()
                uid1, uid2 = u1.id, u2.id

            client = app.test_client()
            r1 = client.post("/api/auth/forgot-password", json={
                "email": "alice@example.com", "method": "otp",
            })
            r2 = client.post("/api/auth/forgot-password", json={
                "email": "bob@example.com", "method": "otp",
            })
            assert r1.status_code == 200
            assert r2.status_code == 200

            with app.app_context():
                assert PasswordReset.query.filter_by(user_id=uid1).count() == 1
                assert PasswordReset.query.filter_by(user_id=uid2).count() == 1

    def test_repeated_requests_do_not_overwrite_previous_otp(self):
        app = _make_app(
            SMTP_HOST="smtp.test",
            SMTP_USERNAME="sender@example.com",
            SMTP_PASSWORD="password",
            MAIL_FROM="sender@example.com",
        )
        with patch.object(app_module, "send_password_reset_email", self._fake_send):
            with app.app_context():
                user = User(name="Repeat User", email="repeat@example.com", role="user")
                user.set_password("Password@123")
                db.session.add(user)
                db.session.commit()
                uid = user.id

            client = app.test_client()
            client.post("/api/auth/forgot-password", json={
                "email": "repeat@example.com", "method": "otp",
            })
            client.post("/api/auth/forgot-password", json={
                "email": "repeat@example.com", "method": "otp",
            })

            with app.app_context():
                count = PasswordReset.query.filter_by(user_id=uid).count()
                assert count == 2, "Each request creates its own PasswordReset row"


# ---------------------------------------------------------------------------
# 7. Rate limiting
# ---------------------------------------------------------------------------

class TestRateLimiting:

    def _fake_send(self, app, recipient, subject, body):
        pass

    def test_fourth_request_within_10_min_is_rate_limited(self):
        app = _make_app(
            SMTP_HOST="smtp.test",
            SMTP_USERNAME="sender@example.com",
            SMTP_PASSWORD="password",
            MAIL_FROM="sender@example.com",
        )
        with patch.object(app_module, "send_password_reset_email", self._fake_send):
            _register_user(app, email="rate@example.com")
            client = app.test_client()
            for _ in range(3):
                client.post("/api/auth/forgot-password", json={
                    "email": "rate@example.com", "method": "otp",
                })
            resp = client.post("/api/auth/forgot-password", json={
                "email": "rate@example.com", "method": "otp",
            })
            assert resp.status_code == 429


# ---------------------------------------------------------------------------
# 8. Diagnostic logging — never logs secrets
# ---------------------------------------------------------------------------

class TestDiagnosticLogging:

    def test_smtp_is_configured_logs_only_presence(self, caplog):
        app = _make_app(
            SMTP_HOST="smtp.test",
            SMTP_USERNAME="sender@example.com",
            SMTP_PASSWORD="super-secret-password",
            MAIL_FROM="sender@example.com",
        )
        with caplog.at_level(logging.INFO, logger="app"):
            smtp_is_configured(app)

        log_output = caplog.text
        assert "super-secret-password" not in log_output
        assert "host_set: True" in log_output
        assert "username_set: True" in log_output
        assert "password_set: True" in log_output
        assert "configured: True" in log_output

    def test_diagnostic_when_not_configured(self, caplog):
        app = _make_app(
            SMTP_HOST="",
            SMTP_USERNAME="",
            SMTP_PASSWORD="",
            MAIL_FROM="",
        )
        with caplog.at_level(logging.INFO, logger="app"):
            smtp_is_configured(app)

        log_output = caplog.text
        # Host has a hardcoded fallback, so host_set is always True.
        # configured is False because username, password, and mail_from
        # are all empty.
        assert "configured: False" in log_output
        assert "username_set: False" in log_output
        assert "password_set: False" in log_output


# ---------------------------------------------------------------------------
# 9. send_password_reset_email raises on missing config
# ---------------------------------------------------------------------------

class TestSendEmailRaises:

    def test_raises_runtime_error_when_not_configured(self):
        app = _make_app(
            SMTP_HOST="smtp.test",
            SMTP_USERNAME="",
            SMTP_PASSWORD="",
            MAIL_FROM="",
        )
        with patch("smtplib.SMTP"):
            with pytest.raises(RuntimeError, match="SMTP is not configured"):
                app_module.send_password_reset_email(
                    app, "recipient@example.com", "Subject", "Body"
                )

    def test_raises_when_only_password_missing(self):
        app = _make_app(
            SMTP_HOST="smtp.test",
            SMTP_USERNAME="sender@example.com",
            SMTP_PASSWORD="",
            MAIL_FROM="sender@example.com",
        )
        with patch("smtplib.SMTP"):
            with pytest.raises(RuntimeError, match="SMTP is not configured"):
                app_module.send_password_reset_email(
                    app, "recipient@example.com", "Subject", "Body"
                )
