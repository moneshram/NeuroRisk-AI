
import os
import sys
import threading
import time

import pytest

# backend/ is the import root used by the project.
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from extensions import db
import app as app_module
from app import create_app
from models import User, MailJob


def test_50_concurrent_otp_requests_are_queued_and_delivered(tmp_path, monkeypatch):
    db_path = tmp_path / "concurrency.sqlite"
    os.environ["DATABASE_URL"] = f"sqlite:///{db_path}"
    os.environ["JWT_SECRET_KEY"] = "test-secret"

    application = create_app()
    application.config.update(
        SMTP_HOST="smtp.test",
        SMTP_PORT=587,
        SMTP_USERNAME="sender@example.com",
        SMTP_PASSWORD="password",
        MAIL_FROM="sender@example.com",
        MAIL_WORKERS=8,
        MAIL_MAX_ATTEMPTS=2,
        MAIL_RETRY_DELAY_SECONDS=1,
    )

    delivered = []
    delivered_lock = threading.Lock()

    def fake_send(app, recipient, subject, body):
        # Simulate SMTP work without making network calls.
        time.sleep(0.01)
        with delivered_lock:
            delivered.append(recipient)

    monkeypatch.setattr(app_module, "send_password_reset_email", fake_send)

    with application.app_context():
        for i in range(50):
            user = User(
                name=f"User {i}",
                email=f"user{i}@example.com",
                role="user",
            )
            user.set_password("Password@123")
            db.session.add(user)
        db.session.commit()

    client_results = [None] * 50

    def request_otp(index):
        with application.test_client() as client:
            response = client.post(
                "/api/auth/forgot-password",
                json={
                    "email": f"user{index}@example.com",
                    "method": "otp",
                },
            )
            client_results[index] = response.status_code

    threads = [threading.Thread(target=request_otp, args=(i,)) for i in range(50)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert client_results == [200] * 50

    deadline = time.time() + 10
    while time.time() < deadline:
        with application.app_context():
            sent = MailJob.query.filter_by(status="sent").count()
        if sent == 50:
            break
        time.sleep(0.05)

    with application.app_context():
        assert MailJob.query.count() == 50
        assert MailJob.query.filter_by(status="sent").count() == 50
        assert len(delivered) == 50
        assert set(delivered) == {f"user{i}@example.com" for i in range(50)}
