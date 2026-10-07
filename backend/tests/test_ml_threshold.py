"""Regression tests for the ML risk-classification threshold.

The production model is trained on the real archive/full_data.csv dataset
(4981 rows, 4.98% positive = 19.1:1 imbalance) by train_stroke_model.py.
Because the base rate is ~5%, a fixed 0.5 cutoff classifies EVERY input as
LOW RISK - on the held-out test set such a model detects 0 of 50 positive
cases. The threshold is therefore derived from training out-of-fold
predictions (max balanced accuracy / Youden's J) and centralized as
RISK_THRESHOLD = 0.05 in ml/pipeline.py; app.py imports that single value.

These tests pin the behavior so the "always LOW RISK" bug cannot silently
return, and guard the Low/High risk mapping for the two reference cases.
"""
import os

os.environ["DATABASE_URL"] = "sqlite:///:memory:"
os.environ["JWT_SECRET_KEY"] = "test-secret"

from app import create_app
from extensions import db
from models import User
from ml.pipeline import RISK_THRESHOLD


def _make_app():
    app = create_app()
    with app.app_context():
        user = User(name="ML Test", email="mltest@example.com", role="user")
        user.set_password("Password@123")
        db.session.add(user)
        db.session.commit()
    return app


def _auth_headers(client):
    resp = client.post("/api/auth/login", json={
        "email": "mltest@example.com", "password": "Password@123",
    })
    token = resp.get_json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


# 80yo + hypertension + former smoker, glucose 180. Scores ~0.31 with the
# current model: well above RISK_THRESHOLD=0.05, far below 0.5.
HIGH_RISK_CASE = {
    "age": 80, "gender": "Male", "hypertension": 1, "heart_disease": 0,
    "ever_married": "Yes", "work_type": "Govt_job", "residence_type": "Rural",
    "avg_glucose_level": 180, "bmi": 28, "smoking_status": "formerly smoked",
}

# 25yo healthy non-smoker. Scores ~0.004.
LOW_RISK_CASE = {
    "age": 25, "gender": "Female", "hypertension": 0, "heart_disease": 0,
    "ever_married": "No", "work_type": "Private", "residence_type": "Urban",
    "avg_glucose_level": 90, "bmi": 22, "smoking_status": "never smoked",
}


def test_risk_threshold_is_centralized_and_recall_oriented():
    # Derived from OOF balanced-accuracy optimum on the training split
    # (see ml/pipeline.py). Must stay centralized - app.py imports it.
    assert RISK_THRESHOLD == 0.05


def test_high_risk_case_is_flagged_high_risk():
    app = _make_app()
    client = app.test_client()
    headers = _auth_headers(client)
    resp = client.post("/api/predict", json=HIGH_RISK_CASE, headers=headers)
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["risk_level"] == "High Risk"
    assert data["stroke_probability"] >= RISK_THRESHOLD * 100


def test_low_risk_case_is_flagged_low_risk():
    app = _make_app()
    client = app.test_client()
    headers = _auth_headers(client)
    resp = client.post("/api/predict", json=LOW_RISK_CASE, headers=headers)
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["risk_level"] == "Low Risk"
    assert data["stroke_probability"] < RISK_THRESHOLD * 100


def test_dashboard_history_uses_same_threshold():
    app = _make_app()
    client = app.test_client()
    headers = _auth_headers(client)
    client.post("/api/predict", json=HIGH_RISK_CASE, headers=headers)
    client.post("/api/predict", json=LOW_RISK_CASE, headers=headers)
    dash = client.get("/api/user/dashboard", headers=headers).get_json()
    assert dash["prediction_count"] == 2
    assert dash["high_risk_count"] == 1
    levels = [h["risk_level"] for h in dash["history"]]
    # History is ordered ascending by created_at: HIGH was submitted first.
    assert levels == ["High Risk", "Low Risk"]