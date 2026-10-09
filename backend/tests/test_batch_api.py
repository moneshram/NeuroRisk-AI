"""Isolated tests for the additive Batch Prediction feature (backend/batch.py).

Style mirrors the existing test modules (tests/test_ml_threshold.py): pin the
test environment at import time, build a fresh app per test, log in for JWTs.

Covered:
* source=full / source=filled happy paths (schema shape + count consistency)
* CSV upload happy path (in-memory file, exercises the Residence_type rename)
* missing required columns -> 400 listing them
* non-numeric value -> 400 naming the column and the offending row
* non-admin user -> 403, unauthenticated -> 401
* >10 000 rows -> 413 (row-count guard)
* invalid source / non-.csv upload -> 400
* batch values identical to the single-prediction route for the same input
* stateless PDF report endpoint (200 application/pdf, 400 on bad payload)
"""
import io
import os

os.environ["DATABASE_URL"] = "sqlite:///:memory:"
os.environ["JWT_SECRET_KEY"] = "test-secret"

from app import create_app
from extensions import db
from models import User

CSV_HEADER = (
    "age,gender,hypertension,heart_disease,ever_married,work_type,"
    "residence_type,avg_glucose_level,bmi,smoking_status\n"
)

# Same reference cases as tests/test_ml_threshold.py.
HIGH_RISK_ROW = {
    "age": 80, "gender": "Male", "hypertension": 1, "heart_disease": 1,
    "ever_married": "Yes", "work_type": "Private", "residence_type": "Urban",
    "avg_glucose_level": 180, "bmi": 28, "smoking_status": "formerly smoked",
}
LOW_RISK_ROW = {
    "age": 25, "gender": "Female", "hypertension": 0, "heart_disease": 0,
    "ever_married": "No", "work_type": "Private", "residence_type": "Rural",
    "avg_glucose_level": 90, "bmi": 22, "smoking_status": "never smoked",
}

RESULT_KEYS = {
    "age", "gender", "hypertension", "heart_disease", "ever_married",
    "work_type", "residence_type", "avg_glucose_level", "bmi", "smoking_status",
    "stroke_probability", "prediction", "risk_level",
}


def _make_app():
    app = create_app()
    with app.app_context():
        user = User(name="Batch Test", email="batchtest@example.com", role="user")
        user.set_password("Password@123")
        db.session.add(user)
        db.session.commit()
    return app


def _login(client, endpoint, email, password):
    resp = client.post(endpoint, json={"email": email, "password": password})
    assert resp.status_code in (200, 201), resp.get_json()
    return {"Authorization": f"Bearer {resp.get_json()['access_token']}"}


def _admin_headers(client):
    return _login(client, "/api/auth/admin-login", "admin@stroke.local", "Admin@12345")


def _user_headers(client):
    return _login(client, "/api/auth/login", "batchtest@example.com", "Password@123")


def _upload(client, headers, csv_text, filename="batch.csv"):
    return client.post(
        "/api/predict/batch",
        headers=headers,
        data={"file": (io.BytesIO(csv_text.encode()), filename)},
        content_type="multipart/form-data",
    )


def _rows_to_csv(rows, residence_header="residence_type"):
    """Serialize rows (dicts keyed by the model features) to CSV text.

    ``residence_header`` renames the residence column in the header only, so
    tests can reproduce the historical `Residence_type` dataset spelling.
    """
    header = ",".join(
        residence_header if key == "residence_type" else key for key in rows[0]
    )
    lines = [header]
    lines += [",".join(str(value) for value in row.values()) for row in rows]
    return "\n".join(lines) + "\n"


def _assert_payload_shape(payload, expected_total):
    """Schema + count consistency shared by every happy-path test."""
    assert set(payload) == {"summary", "chart_data", "results"}

    summary = payload["summary"]
    assert set(summary) == {"total", "high_risk", "low_risk", "avg_probability", "max_probability"}
    assert summary["total"] == expected_total
    assert summary["total"] == len(payload["results"])
    assert summary["high_risk"] + summary["low_risk"] == summary["total"]
    # Percent scale, same as /api/predict (e.g. 19.51).
    assert 0 <= summary["avg_probability"] <= 100
    assert 0 <= summary["max_probability"] <= 100
    assert summary["avg_probability"] <= summary["max_probability"]

    chart = payload["chart_data"]
    assert set(chart) == {
        "classification", "probability_histogram", "age_vs_probability",
        "risk_by_hypertension", "risk_by_smoking", "risk_by_work_type",
    }

    # Classification split mirrors the summary.
    assert chart["classification"] == {
        "low": summary["low_risk"], "high": summary["high_risk"],
    }

    # Histogram: exactly 10 bins of 10 covering 0-100, counts sum to total.
    hist = chart["probability_histogram"]
    assert len(hist) == 10
    for index, bin_ in enumerate(hist):
        assert bin_["start"] == index * 10
        assert bin_["end"] == index * 10 + 10
        assert bin_["count"] >= 0
    assert sum(bin_["count"] for bin_ in hist) == summary["total"]

    assert len(chart["age_vs_probability"]) == summary["total"]
    for point in chart["age_vs_probability"]:
        assert {"age", "probability", "risk_level"} == set(point)
        assert point["risk_level"] in ("High Risk", "Low Risk")

    for series_name, series in (
        ("risk_by_hypertension", chart["risk_by_hypertension"]),
        ("risk_by_smoking", chart["risk_by_smoking"]),
        ("risk_by_work_type", chart["risk_by_work_type"]),
    ):
        assert series, f"{series_name} must not be empty"
        assert sum(entry["total"] for entry in series) == summary["total"]
        assert sum(entry["high_risk"] for entry in series) == summary["high_risk"]
        for entry in series:
            assert set(entry) == {"label", "total", "high_risk", "rate"}
            # rate is a percent: high_risk / total * 100, rounded to 2 decimals.
            expected = round(100.0 * entry["high_risk"] / entry["total"], 2) if entry["total"] else 0.0
            assert entry["rate"] == expected
            assert 0 <= entry["rate"] <= 100

    for row in payload["results"]:
        assert set(row) == RESULT_KEYS
        assert row["risk_level"] in ("High Risk", "Low Risk")
        assert row["prediction"] in (0, 1)
        assert (row["prediction"] == 1) == (row["risk_level"] == "High Risk")
        assert 0 <= row["stroke_probability"] <= 100


def test_source_full_happy_path():
    app = _make_app()
    client = app.test_client()
    headers = _admin_headers(client)

    resp = client.post("/api/predict/batch?source=full", headers=headers)
    assert resp.status_code == 200
    payload = resp.get_json()

    # backend/ml/samples/full_data.csv: 4981 rows, `stroke` label dropped.
    _assert_payload_shape(payload, expected_total=4981)
    # Hypertension axis always carries both groups (0 and 1).
    labels = {entry["label"] for entry in payload["chart_data"]["risk_by_hypertension"]}
    assert labels == {"0", "1"}


def test_source_filled_happy_path():
    app = _make_app()
    client = app.test_client()
    headers = _admin_headers(client)

    resp = client.post("/api/predict/batch", headers=headers, json={"source": "filled"})
    assert resp.status_code == 200
    payload = resp.get_json()

    # backend/ml/samples/full_filled_stroke_data.csv: 201 rows.
    _assert_payload_shape(payload, expected_total=201)
    assert payload["summary"]["high_risk"] + payload["summary"]["low_risk"] == 201


def test_csv_upload_happy_path():
    app = _make_app()
    client = app.test_client()
    headers = _admin_headers(client)

    # Header uses only the historical `Residence_type` spelling (as both
    # bundled sample datasets do); batch.py renames it to residence_type.
    csv_text = _rows_to_csv(
        [HIGH_RISK_ROW, LOW_RISK_ROW], residence_header="Residence_type"
    )
    resp = _upload(client, headers, csv_text, filename="tiny.csv")
    assert resp.status_code == 200
    payload = resp.get_json()

    # The CSV uses the historical `Residence_type` spelling: renamed in place,
    # extra columns (none here) would be dropped silently.
    _assert_payload_shape(payload, expected_total=2)
    assert "Residence_type" not in payload["results"][0]
    assert payload["results"][0]["residence_type"] in ("Urban", "Rural")
    assert payload["summary"]["high_risk"] == 1
    assert payload["results"][0]["risk_level"] == "High Risk"
    assert payload["results"][1]["risk_level"] == "Low Risk"


def test_extra_columns_are_dropped_silently():
    app = _make_app()
    client = app.test_client()
    headers = _admin_headers(client)

    csv_text = "stroke,comment," + CSV_HEADER + "1,hello," + ",".join(
        str(HIGH_RISK_ROW[key]) for key in CSV_HEADER.strip().split(",")
    ) + "\n"
    resp = _upload(client, headers, csv_text)
    assert resp.status_code == 200
    payload = resp.get_json()
    _assert_payload_shape(payload, expected_total=1)
    assert "stroke" not in payload["results"][0]
    assert "comment" not in payload["results"][0]


def test_missing_required_columns_rejected():
    app = _make_app()
    client = app.test_client()
    headers = _admin_headers(client)

    csv_text = (
        "age,gender,hypertension,heart_disease,ever_married,work_type,"
        "residence_type,avg_glucose_level\n"
        "67,Male,0,1,Yes,Private,Urban,120\n"
    )
    resp = _upload(client, headers, csv_text)
    assert resp.status_code == 400
    message = resp.get_json()["error"]
    assert "Missing required columns" in message
    assert "bmi" in message
    assert "smoking_status" in message


def test_non_numeric_value_rejected_with_column_and_row():
    app = _make_app()
    client = app.test_client()
    headers = _admin_headers(client)

    csv_text = _rows_to_csv([
        HIGH_RISK_ROW,
        dict(LOW_RISK_ROW, bmi="not-a-number"),
    ])
    resp = _upload(client, headers, csv_text)
    assert resp.status_code == 400
    message = resp.get_json()["error"]
    assert "bmi" in message
    assert "row 2" in message  # 1-based data row, header not counted


def test_oversize_row_count_rejected():
    app = _make_app()
    client = app.test_client()
    headers = _admin_headers(client)

    row = "50,Male,0,0,Yes,Private,Rural,100,25,never smoked\n"
    csv_text = CSV_HEADER + row * 10_001
    resp = _upload(client, headers, csv_text)
    assert resp.status_code == 413
    assert "10000" in resp.get_json()["error"]


def test_invalid_source_rejected():
    app = _make_app()
    client = app.test_client()
    headers = _admin_headers(client)

    resp = client.post("/api/predict/batch?source=nope", headers=headers)
    assert resp.status_code == 400
    assert "full" in resp.get_json()["error"] and "filled" in resp.get_json()["error"]

    resp = client.post("/api/predict/batch", headers=headers)
    assert resp.status_code == 400
    assert "source" in resp.get_json()["error"]


def test_non_csv_upload_rejected():
    app = _make_app()
    client = app.test_client()
    headers = _admin_headers(client)

    resp = _upload(client, headers, "age,gender\n1,Male\n", filename="data.xlsx")
    assert resp.status_code == 400
    assert "csv" in resp.get_json()["error"].lower()


def test_unauthenticated_rejected_401():
    app = _make_app()
    client = app.test_client()

    resp = client.post("/api/predict/batch?source=filled")
    assert resp.status_code == 401
    resp = client.post("/api/predict/batch/report", json={"summary": {}, "results": []})
    assert resp.status_code == 401


def test_non_admin_user_forbidden_403():
    app = _make_app()
    client = app.test_client()
    headers = _user_headers(client)

    resp = client.post("/api/predict/batch?source=filled", headers=headers)
    assert resp.status_code == 403
    assert resp.get_json()["error"] == "Forbidden"

    resp = client.post("/api/predict/batch/report", headers=headers, json={
        "summary": {"total": 0}, "results": [],
    })
    assert resp.status_code == 403


def test_batch_matches_single_prediction_route():
    """Same input row => identical probability + risk_level on both routes."""
    app = _make_app()
    client = app.test_client()
    admin_headers = _admin_headers(client)
    user_headers = _user_headers(client)

    rows = [HIGH_RISK_ROW, LOW_RISK_ROW]
    resp = _upload(client, admin_headers, _rows_to_csv(rows))
    assert resp.status_code == 200
    batch_rows = resp.get_json()["results"]
    assert len(batch_rows) == 2

    for batch_row, source_row in zip(batch_rows, rows):
        single = client.post("/api/predict", json=source_row, headers=user_headers)
        assert single.status_code == 200
        single_payload = single.get_json()
        assert batch_row["stroke_probability"] == single_payload["stroke_probability"]
        assert batch_row["risk_level"] == single_payload["risk_level"]


def test_report_returns_pdf_and_validates_payload():
    app = _make_app()
    client = app.test_client()
    headers = _admin_headers(client)

    batch = client.post("/api/predict/batch?source=filled", headers=headers)
    assert batch.status_code == 200
    payload = batch.get_json()

    resp = client.post("/api/predict/batch/report", headers=headers, json=payload)
    assert resp.status_code == 200
    assert resp.headers["Content-Type"] == "application/pdf"
    assert resp.data[:5] == b"%PDF-"
    assert len(resp.data) > 1000

    # Stateless endpoint rejects payloads without the required subset.
    resp = client.post("/api/predict/batch/report", headers=headers, json={"results": []})
    assert resp.status_code == 400
    assert "summary" in resp.get_json()["error"]

    resp = client.post("/api/predict/batch/report", headers=headers, json={
        "summary": payload["summary"],
        "results": "nope",
    })
    assert resp.status_code == 400
    assert "results" in resp.get_json()["error"]
