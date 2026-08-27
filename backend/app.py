import json
import hashlib
import logging
import os
import secrets
import smtplib
import queue
import threading
import time
from email.utils import formataddr
from email.message import EmailMessage
from datetime import datetime, timedelta, timezone
from flask import Flask, jsonify, request
from flask_cors import CORS
from flask_jwt_extended import create_access_token, jwt_required, get_jwt_identity
from config import Config
from extensions import db, jwt
from werkzeug.security import generate_password_hash
from models import User, Prediction, PasswordReset, MailJob, PendingRegistration
from schemas import validate_payload
from auth import roles_required
from ml.pipeline import predict

logger = logging.getLogger(__name__)

def create_app():
    app = Flask(__name__)
    app.config.from_object(Config)
    db.init_app(app)
    jwt.init_app(app)
    CORS(app, resources={r"/api/*": {"origins": app.config["FRONTEND_ORIGINS"]}})

    with app.app_context():
        db.create_all()
        seed_admin()

    db_uri = app.config.get("SQLALCHEMY_DATABASE_URI", "")
    db_kind = "postgresql" if "postgresql" in db_uri else "sqlite"
    logger.info("NeuroRisk AI backend started — database: %s", db_kind)

    smtp_host = app.config.get("SMTP_HOST") or os.environ.get("SMTP_HOST", "")
    smtp_user = app.config.get("SMTP_USERNAME") or os.environ.get("SMTP_USERNAME", "")
    smtp_pass = app.config.get("SMTP_PASSWORD") or os.environ.get("SMTP_PASSWORD", "")
    smtp_from = app.config.get("MAIL_FROM") or os.environ.get("MAIL_FROM", "")
    logger.info(
        "SMTP config — host_set: %s, username_set: %s, password_set: %s, "
        "mail_from_set: %s, configured: %s",
        bool(smtp_host),
        bool(smtp_user),
        bool(smtp_pass),
        bool(smtp_from or smtp_user),
        smtp_is_configured(app),
    )

    # Email delivery is decoupled from HTTP requests. Password-reset requests
    # write a durable outbox row and return immediately; background workers
    # deliver the messages independently. This prevents SMTP from blocking
    # other users when 50+ users request OTPs at the same time.
    #
    # On Vercel serverless, background threads are killed when the HTTP
    # response is returned, so the async dispatcher never gets a chance to
    # deliver.  Emails are instead sent synchronously inside the request
    # (see the forgot_password handler below).  We still start the
    # dispatcher for non-Vercel environments so pending jobs survive a
    # local restart.
    if not os.getenv("VERCEL"):
        start_mail_dispatcher(app)

    @app.get("/api/health")
    def health():
        return jsonify({"status": "ok"})

    @app.get("/api/auth/mail-status")
    def mail_status():
        configured = smtp_is_configured(app)
        return jsonify({"configured": configured})

    @app.post("/api/auth/forgot-password")
    def forgot_password():
        data = request.get_json(silent=True) or {}
        email = str(data.get("email", "")).strip().lower()
        method = str(data.get("method", "link")).strip().lower()
        if method not in {"link", "otp"}:
            return jsonify({"error": "Choose either an email reset link or a one-time password."}), 400

        # The submitted address is the recipient. SMTP_USERNAME/MAIL_FROM are
        # the application's sender account and must NOT be replaced with the
        # recipient's email address. This allows every registered user to
        # receive their own reset message while the app authenticates once
        # with its configured mail account.
        user = User.query.filter_by(email=email, role="user").first()
        response = {
            "message": "If an account exists for this email, the requested password-reset instructions have been sent.",
            "method": method,
        }
        if not user:
            return jsonify(response)

        # Rate-limit: allow at most 3 reset requests per user within 10 minutes.
        cutoff = datetime.now(timezone.utc) - timedelta(minutes=10)
        recent = PasswordReset.query.filter(
            PasswordReset.user_id == user.id,
            PasswordReset.created_at >= cutoff,
        ).count()
        if recent >= 3:
            app.logger.warning("Rate limit hit for password reset: user %s", user.id)
            return jsonify({"error": "Too many requests. Please try again in a few minutes."}), 429

        if not smtp_is_configured(app):
            app.logger.warning("Password reset requested while SMTP is not configured")
            return jsonify({"error": "Password reset email service is currently unavailable. Please try again later."}), 503

        now = datetime.now(timezone.utc)

        if method == "otp":
            raw_token = f"{secrets.randbelow(1000000):06d}"
            expires_at = now + timedelta(minutes=10)
            subject = "NeuroRisk AI — Your one-time password"
            body = (
                f"Hello {user.name},\n\n"
                f"Your NeuroRisk AI password-reset one-time password is: {raw_token}\n\n"
                "This code is valid for 10 minutes and can be used only once.\n\n"
                "If you did not request this, you can ignore this email.\n"
            )
        else:
            raw_token = secrets.token_urlsafe(32)
            expires_at = now + timedelta(minutes=30)
            reset_url = f"{app.config['FRONTEND_ORIGIN'].rstrip('/')}/reset-password?token={raw_token}"
            subject = "NeuroRisk AI — Password reset link"
            body = (
                f"Hello {user.name},\n\n"
                "Use the secure link below to reset your NeuroRisk AI password:\n\n"
                f"{reset_url}\n\n"
                "This link is valid for 30 minutes and can be used only once.\n\n"
                "If you did not request this, you can ignore this email.\n"
            )

        # Keep the existing unique token_hash index, but namespace OTP hashes
        # by user. A 6-digit OTP is allowed to be the same for two different
        # users; globally hashing the raw 6 digits would create a rare but real
        # UNIQUE constraint collision when many users request OTPs together.
        token_hash = (
            hashlib.sha256(f"otp:{user.id}:{raw_token}".encode()).hexdigest()
            if method == "otp"
            else hashlib.sha256(f"link:{raw_token}".encode()).hexdigest()
        )

        reset = PasswordReset(
            user_id=user.id,
            token_hash=token_hash,
            expires_at=expires_at,
        )
        db.session.add(reset)

        try:
            # One short DB transaction for the reset credential and durable
            # mail outbox entry. No SMTP/network call is made while SQLite is
            # holding its write transaction.
            db.session.flush()
            job = MailJob(
                user_id=user.id,
                reset_id=reset.id,
                recipient=user.email,
                subject=subject,
                body=body,
                status="pending",
                attempts=0,
                next_attempt_at=now,
            )
            db.session.add(job)
            job_id = job.id
            db.session.commit()
        except Exception as exc:
            db.session.rollback()
            app.logger.exception("Unable to queue password reset email: %s", exc)
            return jsonify({"error": "Failed to process password reset request. Please try again later."}), 500

        if os.getenv("VERCEL"):
            # Vercel serverless kills daemon threads once the HTTP response is
            # returned, so the async MailDispatcher never gets a chance to
            # deliver. Send synchronously inside the request to guarantee the
            # email actually goes out.
            try:
                send_password_reset_email(app, user.email, subject, body)
                job.status = "sent"
                job.sent_at = datetime.now(timezone.utc)
                job.last_error = None
                db.session.commit()
            except Exception as exc:
                job.status = "failed"
                job.last_error = str(exc)[:1000]
                job.attempts += 1
                reset.used_at = datetime.now(timezone.utc)
                db.session.commit()
                app.logger.error("Synchronous password-reset email failed: %s", exc)
                return jsonify({"error": "Password reset email could not be sent. Please try again later."}), 503
        else:
            # Queue only the durable job ID. If the process restarts, pending
            # jobs are recovered from the database by start_mail_dispatcher().
            enqueue_mail_job(app, job_id)

        return jsonify(response), 200

    @app.post("/api/auth/verify-otp")
    def verify_otp():
        """Verify a password-reset OTP without consuming it.

        The OTP remains single-use because /auth/reset-password marks the
        matching PasswordReset record as used only after the new password is
        successfully saved. This lets the UI use a clear two-step flow:
        enter OTP -> verify -> enter the new password.
        """
        data = request.get_json(silent=True) or {}
        email = str(data.get("email", "")).strip().lower()
        otp = str(data.get("otp", "")).strip()
        if not email or not otp or not otp.isdigit() or len(otp) != 6:
            return jsonify({"error": "Enter your registered email and the 6-digit one-time password."}), 400

        user = User.query.filter_by(email=email, role="user").first()
        if not user:
            return jsonify({"error": "This one-time password is invalid or has expired."}), 400

        otp_hash = hashlib.sha256(f"otp:{user.id}:{otp}".encode()).hexdigest()
        reset = PasswordReset.query.filter_by(
            user_id=user.id,
            token_hash=otp_hash,
            used_at=None
        ).first()
        if not reset:
            return jsonify({"error": "This one-time password is invalid or has expired."}), 400

        expires_at = reset.expires_at
        if expires_at and expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if not expires_at or expires_at <= datetime.now(timezone.utc):
            return jsonify({"error": "This one-time password is invalid or has expired."}), 400

        return jsonify({"message": "One-time password verified."})

    @app.post("/api/auth/reset-password")
    def reset_password():
        data = request.get_json(silent=True) or {}
        email = str(data.get("email", "")).strip().lower()
        token = str(data.get("token", "")).strip()
        otp = str(data.get("otp", "")).strip()
        password = str(data.get("password", ""))
        credential = otp or token
        if len(password) < 8:
            return jsonify({"error": "Password must be at least 8 characters."}), 400
        if not credential:
            return jsonify({"error": "A reset link token or one-time password is required."}), 400

        if otp:
            user = User.query.filter_by(email=email, role="user").first() if email else None
            if not user:
                return jsonify({"error": "This password-reset code or link is invalid or has expired."}), 400
            credential_hash = hashlib.sha256(f"otp:{user.id}:{otp}".encode()).hexdigest()
            reset_query = PasswordReset.query.filter_by(
                user_id=user.id,
                token_hash=credential_hash,
                used_at=None
            )
        else:
            credential_hash = hashlib.sha256(f"link:{token}".encode()).hexdigest()
            reset_query = PasswordReset.query.filter_by(
                token_hash=credential_hash,
                used_at=None
            )
        reset = reset_query.first()
        if not reset:
            return jsonify({"error": "This password-reset code or link is invalid or has expired."}), 400
        expires_at = reset.expires_at
        if expires_at and expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if not expires_at or expires_at <= datetime.now(timezone.utc):
            return jsonify({"error": "This password-reset code or link is invalid or has expired."}), 400

        user = db.session.get(User, reset.user_id)
        if not user:
            return jsonify({"error": "Account not found."}), 404

        user.set_password(password)
        reset.used_at = datetime.now(timezone.utc)
        db.session.commit()
        return jsonify({"message": "Password reset successfully."})

    @app.get("/api/auth/google-config")
    def google_config():
        # OAuth client IDs are public identifiers, not secrets. Exposing the
        # configured client ID lets the frontend use one backend setting and
        # avoids duplicating it in frontend/.env.
        return jsonify({"configured": bool(app.config.get("GOOGLE_CLIENT_ID")), "client_id": app.config.get("GOOGLE_CLIENT_ID", "")})

    @app.post("/api/auth/google")
    def google_login():
        data = request.get_json(silent=True) or {}
        credential = str(data.get("credential", "")).strip()
        if not credential:
            return jsonify({"error": "Google sign-in credential is missing."}), 400
        client_id = app.config.get("GOOGLE_CLIENT_ID", "")
        if not client_id:
            return jsonify({"error": "Google sign-in is not configured. Add GOOGLE_CLIENT_ID to backend/.env."}), 503
        try:
            from google.oauth2 import id_token
            from google.auth.transport import requests as google_requests
            claims = id_token.verify_oauth2_token(credential, google_requests.Request(), client_id)
        except Exception as exc:
            app.logger.warning("Google token verification failed: %s", exc)
            return jsonify({"error": "The Google sign-in token is invalid or expired."}), 401
        if not claims.get("email_verified"):
            return jsonify({"error": "Your Google email address is not verified."}), 403
        email = str(claims.get("email", "")).strip().lower()
        name = str(claims.get("name") or claims.get("given_name") or "Google User").strip()
        if not email:
            return jsonify({"error": "Google did not provide an email address."}), 400
        user = User.query.filter_by(email=email).first()
        if user and user.role != "user":
            return jsonify({"error": "This Google account cannot access the patient workspace."}), 403
        if not user:
            user = User(name=name[:120] or "Google User", email=email, role="user")
            user.set_password(secrets.token_urlsafe(32))
            db.session.add(user)
            db.session.commit()
        token = create_access_token(identity=str(user.id))
        return jsonify({"access_token": token, "user": {"id": user.id, "name": user.name, "email": user.email, "role": user.role}})

    @app.post("/api/auth/register/send-otp")
    def register_send_otp():
        data = request.get_json(silent=True) or {}
        name = str(data.get("name", "")).strip()
        email = str(data.get("email", "")).strip().lower()
        password = str(data.get("password", ""))

        if len(name) < 2:
            return jsonify({"error": "Please enter your full name."}), 400
        if not email or "@" not in email:
            return jsonify({"error": "Please enter a valid email address."}), 400
        if len(password) < 8:
            return jsonify({"error": "Password must be at least 8 characters."}), 400

        if User.query.filter_by(email=email).first():
            return jsonify({"error": "An account with this email already exists. Please sign in."}), 409

        now = datetime.now(timezone.utc)
        raw_otp = f"{secrets.randbelow(1000000):06d}"
        otp_hash = hashlib.sha256(f"reg-otp:{email}:{raw_otp}".encode()).hexdigest()
        expires_at = now + timedelta(minutes=5)

        existing = PendingRegistration.query.filter_by(email=email).first()
        if existing:
            existing.name = name
            existing.password_hash = generate_password_hash(password, method="pbkdf2:sha256")
            existing.otp_hash = otp_hash
            existing.otp_expires_at = expires_at
            existing.attempts = 0
            existing.last_otp_at = now
            pending = existing
        else:
            pending = PendingRegistration(
                name=name,
                email=email,
                password_hash=generate_password_hash(password, method="pbkdf2:sha256"),
                otp_hash=otp_hash,
                otp_expires_at=expires_at,
                attempts=0,
                last_otp_at=now,
            )
            db.session.add(pending)

        try:
            db.session.commit()
        except Exception as exc:
            db.session.rollback()
            app.logger.exception("Unable to save pending registration: %s", exc)
            return jsonify({"error": "Unable to process registration. Please try again."}), 500

        subject = "NeuroRisk AI — Your Email Verification Code"
        body = (
            f"Hello {name},\n\n"
            "Thank you for registering with NeuroRisk AI.\n\n"
            f"Your email verification code is: {raw_otp}\n\n"
            "This code will expire in 5 minutes.\n\n"
            "If you did not request this verification code, please ignore this email.\n\n"
            "Regards,\n"
            "NeuroRisk AI\n"
            "Stroke Classification System"
        )
        if smtp_is_configured(app):
            try:
                send_password_reset_email(app, email, subject, body)
            except Exception as exc:
                app.logger.exception("Unable to send registration OTP email: %s", exc)

        return jsonify({
            "message": "Verification code sent.",
            "email": email,
        }), 200

    @app.post("/api/auth/register/verify-otp")
    def register_verify_otp():
        data = request.get_json(silent=True) or {}
        email = str(data.get("email", "")).strip().lower()
        otp = str(data.get("otp", "")).strip()

        if not email:
            return jsonify({"error": "Email is required."}), 400
        if not otp or not otp.isdigit() or len(otp) != 6:
            return jsonify({"error": "Please enter the 6-digit OTP."}), 400

        pending = PendingRegistration.query.filter_by(email=email).first()
        if not pending:
            return jsonify({"error": "No pending registration found. Please start over."}), 400

        now = datetime.now(timezone.utc)
        expires_at = pending.otp_expires_at
        if expires_at and expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if not expires_at or expires_at <= now:
            return jsonify({"error": "OTP has expired. Please request a new code."}), 400

        if pending.attempts >= 5:
            return jsonify({"error": "Too many incorrect attempts. Please request a new OTP."}), 429

        otp_hash = hashlib.sha256(f"reg-otp:{email}:{otp}".encode()).hexdigest()
        if otp_hash != pending.otp_hash:
            pending.attempts += 1
            db.session.commit()
            remaining = 5 - pending.attempts
            if remaining <= 0:
                return jsonify({"error": "Too many incorrect attempts. Please request a new OTP."}), 429
            return jsonify({"error": f"Invalid OTP. Please try again. ({remaining} attempts remaining)"}), 400

        user = User(name=pending.name, email=pending.email, role="user")
        user.password_hash = pending.password_hash
        db.session.add(user)
        db.session.delete(pending)
        db.session.commit()

        return jsonify({"message": "Email verified. Account created successfully."}), 201

    @app.post("/api/auth/register/resend-otp")
    def register_resend_otp():
        data = request.get_json(silent=True) or {}
        email = str(data.get("email", "")).strip().lower()

        if not email:
            return jsonify({"error": "Email is required."}), 400

        pending = PendingRegistration.query.filter_by(email=email).first()
        if not pending:
            return jsonify({"error": "No pending registration found. Please start over."}), 400

        now = datetime.now(timezone.utc)
        if pending.last_otp_at:
            last_otp = pending.last_otp_at
            if last_otp.tzinfo is None:
                last_otp = last_otp.replace(tzinfo=timezone.utc)
            cooldown_remaining = 60 - (now - last_otp).total_seconds()
            if cooldown_remaining > 0:
                return jsonify({"error": f"Please wait {int(cooldown_remaining)} seconds before resending."}), 429

        raw_otp = f"{secrets.randbelow(1000000):06d}"
        otp_hash = hashlib.sha256(f"reg-otp:{email}:{raw_otp}".encode()).hexdigest()
        expires_at = now + timedelta(minutes=5)

        pending.otp_hash = otp_hash
        pending.otp_expires_at = expires_at
        pending.attempts = 0
        pending.last_otp_at = now

        try:
            db.session.commit()
        except Exception as exc:
            db.session.rollback()
            app.logger.exception("Unable to save resend OTP: %s", exc)
            return jsonify({"error": "Unable to send verification code. Please try again."}), 500

        subject = "NeuroRisk AI — Your Email Verification Code"
        body = (
            f"Hello {pending.name},\n\n"
            "Thank you for registering with NeuroRisk AI.\n\n"
            f"Your email verification code is: {raw_otp}\n\n"
            "This code will expire in 5 minutes.\n\n"
            "If you did not request this verification code, please ignore this email.\n\n"
            "Regards,\n"
            "NeuroRisk AI\n"
            "Stroke Classification System"
        )
        if smtp_is_configured(app):
            try:
                send_password_reset_email(app, email, subject, body)
            except Exception as exc:
                app.logger.exception("Unable to send resend OTP email: %s", exc)

        return jsonify({"message": "New verification code sent."}), 200

    @app.errorhandler(500)
    def handle_500(exc):
        app.logger.exception("Unhandled server error: %s", exc)
        return jsonify({"error": "An internal server error occurred. Please try again."}), 500

    @app.post("/api/auth/register")
    def register():
        try:
            data = request.get_json(silent=True) or {}
            name = str(data.get("name", "")).strip()
            email = str(data.get("email", "")).strip().lower()
            password = str(data.get("password", ""))

            app.logger.info("Registration attempt for email=%s", email)

            if len(name) < 2 or "@" not in email or len(password) < 8:
                return jsonify({"error": "Name, valid email and password of at least 8 characters are required."}), 400
            if User.query.filter_by(email=email).first():
                return jsonify({"error": "An account with this email already exists."}), 409

            user = User(name=name, email=email, role="user")
            user.set_password(password)
            db.session.add(user)
            db.session.commit()
            app.logger.info("Registration successful for email=%s", email)
            return jsonify({"message": "Registration successful."}), 201
        except Exception as exc:
            db.session.rollback()
            app.logger.exception("Registration failed: %s", exc)
            return jsonify({"error": "Unable to register your account. Please try again."}), 500

    @app.post("/api/auth/login")
    def login():
        data = request.get_json(silent=True) or {}
        email = str(data.get("email", "")).strip().lower()
        password = str(data.get("password", ""))

        user = User.query.filter_by(email=email).first()

        if not user:
            return jsonify({
                "error": "No account found with this email. Please register first.",
                "code": "email_not_found",
            }), 404

        if not user.check_password(password) or user.role != "user":
            return jsonify({
                "error": "Incorrect password. Please try again or use Forgot password.",
                "code": "wrong_password",
            }), 401

        token = create_access_token(identity=str(user.id), additional_claims={
            "role": user.role, "name": user.name, "email": user.email
        })
        return jsonify({
            "access_token": token,
            "user": {"id": user.id, "name": user.name, "email": user.email, "role": user.role}
        })

    @app.post("/api/auth/admin-login")
    def admin_login():
        return issue_token(role="admin")

    @app.get("/api/user/dashboard")
    @jwt_required()
    def user_dashboard():
        user_id = int(get_jwt_identity())
        user = User.query.filter_by(id=user_id, role="user").first()
        if not user:
            return jsonify({"error": "User not found."}), 404
        records = Prediction.query.filter_by(user_id=user.id).order_by(Prediction.created_at.asc()).all()
        history = [
            {
                "id": record.id,
                "prediction": record.prediction,
                "probability": round(record.probability * 100, 2),
                "risk_level": "High Risk" if record.probability >= .5 else "Low Risk",
                "created_at": record.created_at.isoformat() if record.created_at else None,
            }
            for record in records[-12:]
        ]
        latest = history[-1] if history else None
        return jsonify({
            "user": {
                "id": user.id,
                "name": user.name,
                "email": user.email,
                "role": user.role,
                "created_at": user.created_at.isoformat() if user.created_at else None,
            },
            "prediction_count": len(records),
            "high_risk_count": sum(1 for record in records if record.probability >= .5),
            "latest_prediction": latest,
            "history": history,
        })

    @app.get("/api/user/assessments")
    @jwt_required()
    def user_assessments():
        user_id = int(get_jwt_identity())
        user = User.query.filter_by(id=user_id, role="user").first()
        if not user:
            return jsonify({"error": "User not found."}), 404
        records = (
            Prediction.query
            .filter_by(user_id=user.id)
            .order_by(Prediction.created_at.desc())
            .all()
        )
        assessments = []
        for record in records:
            try:
                payload = json.loads(record.payload_json) if record.payload_json else {}
            except (TypeError, json.JSONDecodeError):
                payload = {}
            stroke_p = round(record.probability * 100, 2)
            assessments.append({
                "id": record.id,
                "prediction": record.prediction,
                "probability": stroke_p,
                "no_stroke_probability": round((1 - record.probability) * 100, 2),
                "risk_level": "High Risk" if record.probability >= .5 else "Low Risk",
                "created_at": record.created_at.isoformat() if record.created_at else None,
                "patient": payload,
            })
        return jsonify(assessments)

    @app.get("/api/user/assessments/comparison-report")
    @jwt_required()
    def user_comparison_report():
        user_id = int(get_jwt_identity())
        user = User.query.filter_by(id=user_id, role="user").first()
        if not user:
            return jsonify({"error": "User not found."}), 404
        records = (
            Prediction.query
            .filter_by(user_id=user.id)
            .order_by(Prediction.created_at.desc())
            .all()
        )
        if not records:
            return jsonify({"error": "No assessments available to generate a comparison report."}), 404
        from report import generate_comparison_report
        assessments = []
        for record in records:
            try:
                payload = json.loads(record.payload_json) if record.payload_json else {}
            except (TypeError, json.JSONDecodeError):
                payload = {}
            stroke_p = round(record.probability * 100, 2)
            assessments.append({
                "id": record.id,
                "prediction": record.prediction,
                "probability": stroke_p,
                "no_stroke_probability": round((1 - record.probability) * 100, 2),
                "risk_level": "High Risk" if record.probability >= .5 else "Low Risk",
                "created_at": record.created_at.isoformat() if record.created_at else None,
                "patient": payload,
            })
        user_data = {"name": user.name, "email": user.email}
        pdf_buffer = generate_comparison_report(user_data, assessments)
        from flask import send_file
        return send_file(
            pdf_buffer,
            mimetype="application/pdf",
            as_attachment=True,
            download_name="NeuroRisk_Assessment_Comparison_Report.pdf",
        )

    @app.get("/api/user/assessments/<int:assessment_id>/report")
    @jwt_required()
    def user_assessment_report(assessment_id):
        user_id = int(get_jwt_identity())
        user = User.query.filter_by(id=user_id, role="user").first()
        if not user:
            return jsonify({"error": "User not found."}), 404
        record = db.session.get(Prediction, assessment_id)
        if not record:
            return jsonify({"error": "Assessment not found."}), 404
        if record.user_id != user.id:
            return jsonify({"error": "You do not have access to this assessment."}), 403
        try:
            payload = json.loads(record.payload_json) if record.payload_json else {}
        except (TypeError, json.JSONDecodeError):
            payload = {}
        stroke_p = round(record.probability * 100, 2)
        assessment = {
            "id": record.id,
            "prediction": record.prediction,
            "probability": stroke_p,
            "no_stroke_probability": round((1 - record.probability) * 100, 2),
            "risk_level": "High Risk" if record.probability >= .5 else "Low Risk",
            "created_at": record.created_at.isoformat() if record.created_at else None,
            "patient": payload,
        }
        all_records = (
            Prediction.query
            .filter_by(user_id=user.id)
            .order_by(Prediction.created_at.desc())
            .all()
        )
        assessment_index = None
        for idx, r in enumerate(all_records, 1):
            if r.id == record.id:
                assessment_index = idx
                break
        from report import generate_assessment_report
        user_data = {"name": user.name, "email": user.email}
        pdf_buffer = generate_assessment_report(user_data, assessment, assessment_index)
        from flask import send_file
        return send_file(
            pdf_buffer,
            mimetype="application/pdf",
            as_attachment=True,
            download_name=f"NeuroRisk_Assessment_{assessment_id}.pdf",
        )

    @app.put("/api/user/profile")
    @jwt_required()
    def update_user_profile():
        user_id = int(get_jwt_identity())
        user = User.query.filter_by(id=user_id, role="user").first()
        if not user:
            return jsonify({"error": "User not found."}), 404
        data = request.get_json(silent=True) or {}
        name = str(data.get("name", "")).strip()
        email = str(data.get("email", "")).strip().lower()
        if len(name) < 2 or "@" not in email:
            return jsonify({"error": "Enter a valid name and email."}), 400
        existing = User.query.filter(User.email == email, User.id != user.id).first()
        if existing:
            return jsonify({"error": "That email is already registered."}), 409
        user.name = name
        user.email = email
        db.session.commit()
        return jsonify({
            "message": "Profile updated successfully.",
            "user": {"id": user.id, "name": user.name, "email": user.email, "role": user.role}
        })

    @app.put("/api/user/password")
    @jwt_required()
    def update_user_password():
        user_id = int(get_jwt_identity())
        user = User.query.filter_by(id=user_id, role="user").first()
        if not user:
            return jsonify({"error": "User not found."}), 404

        data = request.get_json(silent=True) or {}
        current_password = str(data.get("current_password", ""))
        new_password = str(data.get("new_password", ""))

        if not current_password or not new_password:
            return jsonify({"error": "Current password and new password are required."}), 400
        if not user.check_password(current_password):
            return jsonify({"error": "Current password is incorrect."}), 400
        if len(new_password) < 8:
            return jsonify({"error": "New password must be at least 8 characters."}), 400
        if current_password == new_password:
            return jsonify({"error": "New password must be different from the current password."}), 400

        user.set_password(new_password)
        db.session.commit()
        return jsonify({"message": "Password updated successfully."})

    @app.put("/api/admin/profile")
    @roles_required("admin")
    def update_admin_profile():
        admin_id = int(get_jwt_identity())
        admin = User.query.filter_by(id=admin_id, role="admin").first()
        if not admin:
            return jsonify({"error": "Administrator not found."}), 404
        data = request.get_json(silent=True) or {}
        name = str(data.get("name", "")).strip()
        email = str(data.get("email", "")).strip().lower()
        if len(name) < 2 or "@" not in email:
            return jsonify({"error": "Enter a valid administrator name and email."}), 400
        existing = User.query.filter(User.email == email, User.id != admin.id).first()
        if existing:
            return jsonify({"error": "That email is already registered."}), 409
        admin.name = name
        admin.email = email
        db.session.commit()
        return jsonify({"message":"Administrator profile updated successfully.","user":{"id":admin.id,"name":admin.name,"email":admin.email,"role":admin.role}})

    @app.put("/api/admin/password")
    @roles_required("admin")
    def update_admin_password():
        admin_id = int(get_jwt_identity())
        admin = User.query.filter_by(id=admin_id, role="admin").first()
        if not admin:
            return jsonify({"error": "Administrator not found."}), 404
        data = request.get_json(silent=True) or {}
        current_password = str(data.get("current_password", ""))
        new_password = str(data.get("new_password", ""))
        if not current_password or not new_password:
            return jsonify({"error":"Current password and new password are required."}), 400
        if not admin.check_password(current_password):
            return jsonify({"error":"Current password is incorrect."}), 400
        if len(new_password) < 8:
            return jsonify({"error":"New password must be at least 8 characters."}), 400
        if current_password == new_password:
            return jsonify({"error":"New password must be different from the current password."}), 400
        admin.set_password(new_password)
        db.session.commit()
        return jsonify({"message":"Administrator password updated successfully."})

    @app.get("/api/admin/metrics")
    @roles_required("admin")
    def metrics():
        return jsonify({
            "users": User.query.filter_by(role="user").count(),
            "predictions": Prediction.query.count(),
            "high_risk": Prediction.query.filter(Prediction.probability >= .5).count(),
        })

    @app.get("/api/admin/users")
    @roles_required("admin")
    def admin_users():
        users = User.query.filter_by(role="user").order_by(User.created_at.desc()).all()
        return jsonify([
            {
                "id": user.id,
                "name": user.name,
                "email": user.email,
                "role": user.role,
                "created_at": user.created_at.isoformat() if user.created_at else None,
                "prediction_count": len(user.predictions),
            }
            for user in users
        ])

    @app.get("/api/admin/users/<int:user_id>")
    @roles_required("admin")
    def admin_user_detail(user_id):
        user = User.query.filter_by(id=user_id, role="user").first()
        if not user:
            return jsonify({"error": "User not found."}), 404
        return jsonify({
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "role": user.role,
            "created_at": user.created_at.isoformat() if user.created_at else None,
            "prediction_count": len(user.predictions),
        })

    @app.delete("/api/admin/users/<int:user_id>")
    @roles_required("admin")
    def admin_delete_user(user_id):
        user = User.query.filter_by(id=user_id, role="user").first()
        if not user:
            return jsonify({"error": "User not found."}), 404
        # Remove dependent records first. Password-reset records are linked to
        # the user as well as predictions; deleting them explicitly prevents
        # a foreign-key/relationship error from turning a successful removal
        # request into a 500 response.
        MailJob.query.filter_by(user_id=user.id).delete(synchronize_session=False)
        PasswordReset.query.filter_by(user_id=user.id).delete(synchronize_session=False)
        Prediction.query.filter_by(user_id=user.id).delete(synchronize_session=False)
        db.session.delete(user)
        db.session.commit()
        return jsonify({"message": "User and associated predictions removed."})

    @app.get("/api/admin/predictions")
    @roles_required("admin")
    def admin_predictions():
        predictions = Prediction.query.order_by(Prediction.created_at.desc()).all()
        return jsonify([serialize_prediction(record) for record in predictions])

    @app.get("/api/admin/predictions/<int:prediction_id>")
    @roles_required("admin")
    def admin_prediction_detail(prediction_id):
        record = db.session.get(Prediction, prediction_id)
        if not record:
            return jsonify({"error": "Prediction not found."}), 404
        return jsonify(serialize_prediction(record, include_payload=True))

    @app.delete("/api/admin/predictions/<int:prediction_id>")
    @roles_required("admin")
    def admin_delete_prediction(prediction_id):
        record = db.session.get(Prediction, prediction_id)
        if not record:
            return jsonify({"error": "Prediction not found."}), 404
        db.session.delete(record)
        db.session.commit()
        return jsonify({"message": "Prediction removed."})

    @app.post("/api/admin/predictions")
    @roles_required("admin")
    def admin_create_prediction():
        data = request.get_json(silent=True) or {}
        try:
            user_id = int(data.get("user_id"))
        except (TypeError, ValueError):
            return jsonify({"error": "A valid registered user is required."}), 400

        user = User.query.filter_by(id=user_id, role="user").first()
        if not user:
            return jsonify({"error": "Registered user not found."}), 404

        try:
            patient = validate_payload(data)
            payload = patient.__dict__
            label, probability = predict(payload)
        except FileNotFoundError as exc:
            return jsonify({"error": str(exc)}), 503
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400

        record = Prediction(
            user_id=user.id,
            payload_json=json.dumps(payload),
            prediction="Stroke Risk" if label else "No Stroke Risk",
            probability=probability,
        )
        db.session.add(record)
        db.session.commit()
        return jsonify(serialize_prediction(record, include_payload=True)), 201

    @app.post("/api/predict")
    @jwt_required()
    def prediction():
        data = request.get_json(silent=True) or {}
        try:
            patient = validate_payload(data)
            payload = patient.__dict__
            label, probability = predict(payload)
        except FileNotFoundError as exc:
            return jsonify({"error": str(exc)}), 503
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400
        except Exception as exc:
            app.logger.exception("Prediction failed: %s", exc)
            return jsonify({"error": "Prediction failed. Please try again."}), 500

        risk = "High Risk" if probability >= .5 else "Low Risk"
        recommendations = build_recommendations(patient, probability)

        record = Prediction(
            user_id=int(get_jwt_identity()),
            payload_json=json.dumps(payload),
            prediction="Stroke Risk" if label else "No Stroke Risk",
            probability=probability,
        )
        db.session.add(record)
        db.session.commit()

        return jsonify({
            "id": record.id,
            "prediction": record.prediction,
            "risk_level": risk,
            "stroke_probability": round(probability * 100, 2),
            "no_stroke_probability": round((1 - probability) * 100, 2),
            "risk_breakdown": {
                "stroke": round(probability * 100, 2),
                "no_stroke": round((1 - probability) * 100, 2)
            },
            "recommendations": recommendations
        })

    return app

def serialize_prediction(record, include_payload=False):
    data = {
        "id": record.id,
        "user_id": record.user_id,
        "user_name": record.user.name if record.user else "Unknown",
        "user_email": record.user.email if record.user else "Unknown",
        "prediction": record.prediction,
        "probability": round(record.probability * 100, 2),
        "risk_level": "High Risk" if record.probability >= .5 else "Low Risk",
        "created_at": record.created_at.isoformat() if record.created_at else None,
    }
    if include_payload:
        try:
            data["patient"] = json.loads(record.payload_json)
        except (TypeError, json.JSONDecodeError):
            data["patient"] = {}
    return data

# ---------------------------------------------------------------------------
# Asynchronous password-reset mail delivery
# ---------------------------------------------------------------------------

def smtp_is_configured(app):
    host = (
        app.config.get("SMTP_HOST")
        or os.environ.get("SMTP_HOST")
        or "smtp.gmail.com"
    )
    username = (
        app.config.get("SMTP_USERNAME")
        or os.environ.get("SMTP_USERNAME")
        or ""
    )
    password = (
        app.config.get("SMTP_PASSWORD")
        or os.environ.get("SMTP_PASSWORD")
        or ""
    )
    mail_from = (
        app.config.get("MAIL_FROM")
        or os.environ.get("MAIL_FROM")
        or username
    )
    configured = bool(host and username and password and mail_from)
    logger.info(
        "SMTP diagnostic — host_set: %s, username_set: %s, password_set: %s, "
        "mail_from_set: %s, configured: %s",
        bool(host),
        bool(username),
        bool(password),
        bool(mail_from),
        configured,
    )
    return configured


_mail_queues = {}
_mail_queues_lock = threading.Lock()


class MailDispatcher:
    """Small durable outbox dispatcher for password-reset messages.

    Requests never wait for SMTP. Jobs are stored in MailJob first and then
    handed to a bounded worker pool. The database record means queued emails
    survive a backend restart.
    """

    def __init__(self, app):
        self.app = app
        self.worker_count = max(1, int(app.config.get("MAIL_WORKERS", 4)))
        self.max_attempts = max(1, int(app.config.get("MAIL_MAX_ATTEMPTS", 5)))
        self.retry_delay = max(1, int(app.config.get("MAIL_RETRY_DELAY_SECONDS", 5)))
        self.queue = queue.Queue()
        self.stop_event = threading.Event()
        self.started = False

    def start(self):
        if self.started:
            return
        self.started = True

        # Recover jobs that were committed before a previous process stopped.
        with self.app.app_context():
            pending = MailJob.query.filter(
                MailJob.status.in_(("pending", "sending"))
            ).order_by(MailJob.id.asc()).all()
            pending_ids = [job.id for job in pending]
            for job in pending:
                job.status = "pending"
            if pending:
                db.session.commit()

        for job_id in pending_ids:
            self.queue.put(job_id)

        for index in range(self.worker_count):
            thread = threading.Thread(
                target=self._worker,
                name=f"password-mail-worker-{index + 1}",
                daemon=True,
            )
            thread.start()

        self.app.logger.info(
            "Password-reset mail dispatcher started with %s workers; recovered %s queued jobs.",
            self.worker_count,
            len(pending_ids),
        )

    def enqueue(self, job_id):
        self.queue.put(job_id)

    def _worker(self):
        while not self.stop_event.is_set():
            try:
                job_id = self.queue.get(timeout=1)
            except queue.Empty:
                continue

            try:
                self._deliver(job_id)
            except Exception:
                self.app.logger.exception("Unexpected password-reset mail worker error for job %s", job_id)
            finally:
                self.queue.task_done()

    def _deliver(self, job_id):
        with self.app.app_context():
            job = db.session.get(MailJob, job_id)
            if not job or job.status == "sent":
                return

            if job.status == "failed":
                return

            # A job can be requeued after a transient error. Do not deliver
            # before its retry time.
            now = datetime.now(timezone.utc)
            next_attempt = job.next_attempt_at
            if next_attempt and next_attempt.tzinfo is None:
                next_attempt = next_attempt.replace(tzinfo=timezone.utc)
            if next_attempt and next_attempt > now:
                delay = (next_attempt - now).total_seconds()
                time.sleep(min(max(delay, 0), 60))

            # Atomically claim the job. This prevents duplicate delivery if
            # multiple backend processes/containers recover the same outbox.
            claimed = (
                db.session.query(MailJob)
                .filter(
                    MailJob.id == job_id,
                    MailJob.status == "pending",
                )
                .update(
                    {
                        MailJob.status: "sending",
                        MailJob.attempts: MailJob.attempts + 1,
                    },
                    synchronize_session=False,
                )
            )
            db.session.commit()
            if claimed != 1:
                return

            job = db.session.get(MailJob, job_id)
            if not job:
                return

            try:
                send_password_reset_email(
                    self.app,
                    job.recipient,
                    job.subject,
                    job.body,
                )
            except Exception as exc:
                db.session.rollback()
                job = db.session.get(MailJob, job_id)
                if not job:
                    return

                if job.attempts >= self.max_attempts:
                    job.status = "failed"
                    job.last_error = str(exc)[:1000]
                    reset = db.session.get(PasswordReset, job.reset_id)
                    if reset and reset.used_at is None:
                        reset.used_at = datetime.now(timezone.utc)
                    db.session.commit()
                    self.app.logger.error(
                        "Password reset mail job %s permanently failed after %s attempts: %s",
                        job.id, job.attempts, exc,
                    )
                    return

                delay = self.retry_delay * (2 ** max(job.attempts - 1, 0))
                job.status = "pending"
                job.last_error = str(exc)[:1000]
                job.next_attempt_at = datetime.now(timezone.utc) + timedelta(seconds=delay)
                db.session.commit()
                self.app.logger.warning(
                    "Password reset mail job %s failed (attempt %s/%s); retrying in %ss: %s",
                    job.id, job.attempts, self.max_attempts, delay, exc,
                )
                time.sleep(delay)
                self.enqueue(job.id)
                return

            job = db.session.get(MailJob, job_id)
            if job:
                job.status = "sent"
                job.sent_at = datetime.now(timezone.utc)
                job.last_error = None
                db.session.commit()


def start_mail_dispatcher(app):
    key = id(app)
    with _mail_queues_lock:
        dispatcher = _mail_queues.get(key)
        if dispatcher is None:
            dispatcher = MailDispatcher(app)
            _mail_queues[key] = dispatcher
            dispatcher.start()
    app.extensions["mail_dispatcher"] = dispatcher


def enqueue_mail_job(app, job_id):
    dispatcher = app.extensions.get("mail_dispatcher")
    if dispatcher is None:
        start_mail_dispatcher(app)
        dispatcher = app.extensions["mail_dispatcher"]
    dispatcher.enqueue(job_id)


def send_password_reset_email(app, recipient, subject, body):
    # `recipient` always comes from the registered User record. SMTP_USERNAME /
    # MAIL_FROM are the application's sender credentials.
    host = (
        app.config.get("SMTP_HOST")
        or os.environ.get("SMTP_HOST")
        or "smtp.gmail.com"
    )
    username = (
        app.config.get("SMTP_USERNAME")
        or os.environ.get("SMTP_USERNAME")
        or ""
    )
    password = (
        app.config.get("SMTP_PASSWORD")
        or os.environ.get("SMTP_PASSWORD")
        or ""
    )
    use_tls = app.config.get("SMTP_USE_TLS", True)
    port = app.config.get("SMTP_PORT", 587)
    timeout = app.config.get("SMTP_TIMEOUT", 20)
    mail_from = (
        app.config.get("MAIL_FROM")
        or os.environ.get("MAIL_FROM")
        or username
    )

    if not (username and password and mail_from):
        raise RuntimeError(
            "SMTP is not configured. Set SMTP_USERNAME, SMTP_PASSWORD, and "
            "MAIL_FROM in your environment variables."
        )

    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = formataddr(("NeuroRisk AI", mail_from))
    message["To"] = recipient
    message.set_content(body)

    with smtplib.SMTP(host, port, timeout=timeout) as server:
        if use_tls:
            server.starttls()
        server.login(username, password)
        server.send_message(message)


def seed_admin():
    admin = User.query.filter_by(email="admin@stroke.local").first()
    if not admin:
        admin = User(name="System Administrator", email="admin@stroke.local", role="admin")
        admin.set_password("Admin@12345")
        db.session.add(admin)
        db.session.commit()

def issue_token(role):
    data = request.get_json(silent=True) or {}
    email = str(data.get("email", "")).strip().lower()
    password = str(data.get("password", ""))
    user = User.query.filter_by(email=email).first()

    if not user or not user.check_password(password) or user.role != role:
        return jsonify({"error": "Invalid credentials."}), 401

    token = create_access_token(identity=str(user.id), additional_claims={
        "role": user.role, "name": user.name, "email": user.email
    })
    return jsonify({
        "access_token": token,
        "user": {"id": user.id, "name": user.name, "email": user.email, "role": user.role}
    })

def build_recommendations(patient, probability):
    out = []
    if patient.hypertension:
        out.append("Maintain regular blood-pressure monitoring and discuss control targets with a clinician.")
    if patient.heart_disease:
        out.append("Keep cardiovascular conditions under regular clinical review.")
    if patient.avg_glucose_level >= 140:
        out.append("Consider prompt clinical review of elevated glucose.")
    if patient.bmi >= 30:
        out.append("Discuss sustainable weight and activity goals with a qualified professional.")
    if patient.smoking_status in {"smokes", "formerly smoked"}:
        out.append("Avoid tobacco exposure and seek evidence-based cessation support if needed.")
    if not out:
        out.append("Continue routine preventive care, physical activity, and healthy lifestyle habits.")
    if probability >= .5:
        out.insert(0, "This model estimates elevated risk; it is not a diagnosis. Seek professional medical evaluation.")
    return out

app = create_app()

if __name__ == "__main__":
    app.run(debug=True)
