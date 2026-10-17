"""Security hardening regression tests (fast — no ML model, no SMTP, no network).

Covers:
* security headers on /api responses (incl. HSTS only over HTTPS)
* admin routes reject a normal user's JWT (403) and missing JWT (401)
* assessment ownership (IDOR): user A cannot read user B's records
* legacy pbkdf2 password hashes keep verifying; new hashes use scrypt
* rate limiting: disabled under the test config, enforced when enabled
* Vercel boot guard: missing JWT_SECRET_KEY (and DATABASE_URL) surface in
  CONFIG_ERROR instead of shipping a forgeable default secret
* JWT config: 8-hour default expiry, header-only token location
"""
import importlib
import os
import sys
from unittest.mock import patch

import pytest
from werkzeug.security import check_password_hash, generate_password_hash

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from app import create_app
from extensions import db
from models import Prediction, User
import config as config_module


def _make_app(**overrides):
    application = create_app(overrides or None)
    return application


def _make_user(app, email, password="Password@123", name="Sec User"):
    with app.app_context():
        user = User(name=name, email=email, role="user")
        user.set_password(password)
        db.session.add(user)
        db.session.commit()
        return user.id


def _login(client, email, password="Password@123"):
    resp = client.post("/api/auth/login", json={"email": email, "password": password})
    assert resp.status_code == 200, resp.get_json()
    return {"Authorization": f"Bearer {resp.get_json()['access_token']}"}


# ---------------------------------------------------------------------------
# Security headers
# ---------------------------------------------------------------------------

class TestSecurityHeaders:

    def test_headers_present_on_api_responses(self):
        app = _make_app()
        resp = app.test_client().get("/api/health")
        assert resp.status_code == 200
        assert resp.headers["X-Content-Type-Options"] == "nosniff"
        assert resp.headers["X-Frame-Options"] == "DENY"
        assert resp.headers["Referrer-Policy"] == "strict-origin-when-cross-origin"
        assert resp.headers["Permissions-Policy"] == (
            "camera=(), microphone=(), geolocation=()"
        )
        assert "default-src 'none'" in resp.headers["Content-Security-Policy"]
        assert "frame-ancestors 'none'" in resp.headers["Content-Security-Policy"]
        assert resp.headers["Cache-Control"] == "no-store"

    def test_hsts_absent_over_http_present_over_https(self):
        app = _make_app()
        client = app.test_client()
        assert "Strict-Transport-Security" not in client.get("/api/health").headers
        secure = client.get("/api/health", base_url="https://localhost")
        assert secure.headers["Strict-Transport-Security"] == (
            "max-age=31536000; includeSubDomains"
        )

    def test_headers_applied_to_error_responses(self):
        app = _make_app()
        resp = app.test_client().get("/api/does-not-exist")
        assert resp.status_code == 404
        assert resp.headers["X-Content-Type-Options"] == "nosniff"
        assert resp.headers["Cache-Control"] == "no-store"


# ---------------------------------------------------------------------------
# Authorization: admin routes vs user tokens
# ---------------------------------------------------------------------------

class TestAdminAuthZ:

    def test_admin_route_rejects_user_token(self):
        app = _make_app()
        _make_user(app, "user-token@example.com")
        client = app.test_client()
        headers = _login(client, "user-token@example.com")
        for path in ("/api/admin/users", "/api/admin/metrics", "/api/admin/predictions"):
            resp = client.get(path, headers=headers)
            assert resp.status_code == 403, path
            assert resp.get_json()["error"] == "Forbidden"

    def test_admin_route_rejects_missing_token(self):
        app = _make_app()
        resp = app.test_client().get("/api/admin/users")
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# IDOR: user-scoped records are fenced by ownership
# ---------------------------------------------------------------------------

class TestOwnershipEnforcement:

    def _setup(self):
        app = _make_app()
        a_id = _make_user(app, "owner-a@example.com", name="User A")
        b_id = _make_user(app, "owner-b@example.com", name="User B")
        with app.app_context():
            record = Prediction(
                user_id=b_id,
                payload_json="{}",
                prediction="Stroke Risk",
                probability=0.5,
            )
            db.session.add(record)
            db.session.commit()
            record_id = record.id
        return app, a_id, b_id, record_id

    def test_user_cannot_read_another_users_assessment_report(self):
        app, a_id, b_id, record_id = self._setup()
        client = app.test_client()
        headers = _login(client, "owner-a@example.com")
        resp = client.get(f"/api/user/assessments/{record_id}/report", headers=headers)
        assert resp.status_code == 403
        assert "access" in resp.get_json()["error"].lower()

    def test_assessments_list_only_contains_own_records(self):
        app, a_id, b_id, record_id = self._setup()
        client = app.test_client()
        headers = _login(client, "owner-a@example.com")
        listing = client.get("/api/user/assessments", headers=headers).get_json()
        assert listing == []
        b_headers = _login(client, "owner-b@example.com")
        listing_b = client.get("/api/user/assessments", headers=b_headers).get_json()
        assert [row["id"] for row in listing_b] == [record_id]


# ---------------------------------------------------------------------------
# Password hashing: upgrade path
# ---------------------------------------------------------------------------

class TestPasswordHashing:

    def test_new_hashes_use_scrypt(self):
        app = _make_app()
        with app.app_context():
            user = User(name="Hash User", email="hash@example.com", role="user")
            user.set_password("Password@123")
            assert user.password_hash.startswith("scrypt:")
            assert user.check_password("Password@123")
            assert not user.check_password("wrong-password")

    def test_legacy_pbkdf2_hashes_still_verify(self):
        legacy = generate_password_hash("Legacy@123", method="pbkdf2:sha256")
        assert legacy.startswith("pbkdf2:sha256:")
        assert check_password_hash(legacy, "Legacy@123")
        assert not check_password_hash(legacy, "nope")

        app = _make_app()
        with app.app_context():
            user = User(name="Legacy User", email="legacy@example.com", role="user")
            user.password_hash = legacy  # pre-upgrade hash stored in the DB
            db.session.add(user)
            db.session.commit()
        client = app.test_client()
        resp = client.post(
            "/api/auth/login",
            json={"email": "legacy@example.com", "password": "Legacy@123"},
        )
        assert resp.status_code == 200


# ---------------------------------------------------------------------------
# Rate limiting
# ---------------------------------------------------------------------------

class TestRateLimiting:

    def _hammer(self, client, times):
        return [
            client.post(
                "/api/auth/login",
                json={"email": "definitely-missing@example.com", "password": "x"},
            ).status_code
            for _ in range(times)
        ]

    def test_limits_disabled_under_testsuite_config(self):
        # conftest sets RATELIMIT_DISABLED=1, which create_app honours.
        app = _make_app()
        assert app.config["RATELIMIT_DISABLED"] == "1"
        client = app.test_client()
        codes = self._hammer(client, 12)
        assert all(code == 404 for code in codes), codes  # never 429
        assert "X-RateLimit-Limit" not in client.get("/api/health").headers

    def test_login_rate_limit_enforced_when_enabled(self):
        app = _make_app(RATELIMIT_DISABLED="")
        client = app.test_client()
        codes = self._hammer(client, 10)
        assert all(code == 404 for code in codes), codes
        resp = client.post(
            "/api/auth/login",
            json={"email": "definitely-missing@example.com", "password": "x"},
        )
        assert resp.status_code == 429
        assert "error" in resp.get_json()

    def test_testing_config_disables_limits(self):
        app = _make_app(TESTING=True, RATELIMIT_DISABLED="")
        client = app.test_client()
        codes = self._hammer(client, 12)
        assert all(code == 404 for code in codes), codes


# ---------------------------------------------------------------------------
# Vercel boot guard for the JWT secret
# ---------------------------------------------------------------------------

class TestVercelJwtGuard:

    def _reload_vercel_config(self):
        env = {
            "VERCEL": "1",
            "DATABASE_URL": "",  # empty => _env() treats as unset
            "JWT_SECRET_KEY": "",
        }
        with patch.dict(os.environ, env, clear=False):
            for key in list(os.environ.keys()):
                if key not in env:
                    del os.environ[key]
            return importlib.reload(config_module).Config

    def test_missing_secrets_surface_in_config_error(self):
        Config = self._reload_vercel_config()
        assert Config.CONFIG_ERROR is not None
        assert "DATABASE_URL" in Config.CONFIG_ERROR
        assert "JWT_SECRET_KEY" in Config.CONFIG_ERROR

    def test_no_forgeable_fallback_secret_on_vercel(self):
        Config = self._reload_vercel_config()
        assert Config.JWT_SECRET_KEY != "dev-only-change-me"

    def test_config_module_restored_afterwards(self):
        # Leave the shared config module in a clean (non-Vercel) state for
        # any tests that run later in the session.
        self._reload_vercel_config()
        with patch.dict(os.environ, {"VERCEL": ""}, clear=False):
            importlib.reload(config_module)
        assert config_module.IS_VERCEL is False


# ---------------------------------------------------------------------------
# JWT configuration
# ---------------------------------------------------------------------------

class TestJwtConfig:

    def test_default_access_token_expiry_is_eight_hours(self):
        from datetime import timedelta
        app = _make_app()
        assert app.config["JWT_ACCESS_TOKEN_EXPIRES"] == timedelta(hours=8)

    def test_tokens_are_header_only(self):
        app = _make_app()
        assert app.config["JWT_TOKEN_LOCATION"] == ["headers"]
