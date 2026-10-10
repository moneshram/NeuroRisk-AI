"""Isolated Batch Prediction feature (additive module).

This file is part of a strictly additive feature: the ONLY edit to existing
code is the two-line blueprint registration inside ``app.py::create_app``.
No existing route, model, schema, or test is touched.

Endpoints (JWT + admin, using the same ``@roles_required("admin")`` decorator
pattern as the existing ``/api/admin/*`` routes - it performs the JWT check
itself):

* ``POST /api/predict/batch``        - score a CSV (upload) or a bundled sample
* ``POST /api/predict/batch/report`` - render a stateless PDF of batch results

Design decisions / conventions (documented in the endpoint contract):

* Probabilities are reported on the SAME PERCENT scale and with the SAME
  rounding as the single-prediction route (``/api/predict``):  ``round(p*100, 2)``
  where ``p = model.predict_proba(...)[:, 1]`` from the cached pipeline in
  ``ml/pipeline.py`` (``load_pipeline()`` - joblib-load once, never ``.fit``).
* ``risk_level`` uses the same mapping as the single route:
  ``"High Risk" if p >= RISK_THRESHOLD else "Low Risk"`` (RISK_THRESHOLD = 0.04).
* ``prediction`` in batch rows is the integer label ``int(p >= RISK_THRESHOLD)``
  (0/1) as required by the batch contract; the single route uses the textual
  "Stroke Risk"/"No Stroke Risk" for its own field.
* ``rate`` in every ``risk_by_*`` chart series is a PERCENT (0-100) rounded to
  2 decimals, so every numeric risk value in the payload shares one scale.
* The probability histogram has exactly 10 bins of width 10 over 0-100:
  ``[0,10), [10,20) ... [90,100]`` (the final bin is closed so a 100% score
  is never dropped).
* Uploads and sample datasets are processed fully in memory
  (``io.BytesIO``/``pandas.read_csv``); nothing is written to disk or DB.
"""

import io
import logging
from pathlib import Path

import pandas as pd
from flask import Blueprint, jsonify, request, send_file

from auth import roles_required
from ml.pipeline import FEATURES, RISK_THRESHOLD, load_pipeline

log = logging.getLogger(__name__)

batch_bp = Blueprint("batch", __name__, url_prefix="/api/predict")

# Input guards (enforced with 400/413 responses, see routes below).
MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB
MAX_ROWS = 10_000
REPORT_MAX_ROWS = 10_000  # same guard for the stateless report endpoint

# Columns that must parse as numbers; everything else is passed through as-is.
NUMERIC_COLUMNS = ("age", "avg_glucose_level", "bmi", "hypertension", "heart_disease")
# ... of which these are integer flags in the schema (mirrors schemas.py).
INTEGER_COLUMNS = ("hypertension", "heart_disease")

# Historical dataset spelling -> application feature name (mirrors the rename
# train_stroke_model.py applies before training).
COLUMN_RENAMES = {"Residence_type": "residence_type"}

# Bundled sample datasets (copies - originals in ~/Desktop/brain stroke/archive
# are never touched).
SAMPLES_DIR = Path(__file__).resolve().parent / "ml" / "samples"
SAMPLE_SOURCES = {"full": "full_data.csv", "filled": "full_filled_stroke_data.csv"}

# Probability histogram: 0-100 in bins of 10.
HISTOGRAM_EDGES = tuple(range(0, 101, 10))


def _native(value):
    """Convert numpy scalars to plain Python types so jsonify() never fails."""
    return value.item() if hasattr(value, "item") else value


# ---------------------------------------------------------------------------
# Input loading (all in memory)
# ---------------------------------------------------------------------------

def _parse_csv_bytes(raw):
    """Parse CSV bytes into a DataFrame; returns (frame, error_response)."""
    if not raw or not raw.strip():
        return None, (jsonify({"error": "The CSV file is empty."}), 400)
    try:
        frame = pd.read_csv(io.BytesIO(raw))
    except Exception:
        return None, (jsonify({"error": "Unable to parse the CSV file. Check that it is valid CSV."}), 400)
    return frame, None


def _read_upload(file_storage):
    filename = (file_storage.filename or "").strip()
    if not filename.lower().endswith(".csv"):
        return None, (jsonify({"error": "Only .csv files are supported."}), 400)
    # Read at most limit+1 bytes so the size guard triggers before anything else.
    raw = file_storage.stream.read(MAX_UPLOAD_BYTES + 1)
    if len(raw) > MAX_UPLOAD_BYTES:
        return None, (jsonify({"error": "File exceeds the 10 MB upload limit."}), 413)
    return _parse_csv_bytes(raw)


def _read_source(source):
    key = str(source).strip().lower()
    if key not in SAMPLE_SOURCES:
        return None, (jsonify({"error": "Invalid source. Use 'full' or 'filled'."}), 400)
    path = SAMPLES_DIR / SAMPLE_SOURCES[key]
    if not path.exists():
        return None, (jsonify({"error": "Sample dataset is not available on this server."}), 503)
    try:
        frame = pd.read_csv(path)
    except FileNotFoundError:
        # Do not echo the server path back to the client.
        return None, (jsonify({"error": "Sample dataset is not available on this server."}), 503)
    except Exception:
        log.exception("Failed to read bundled sample dataset %s", path)
        return None, (jsonify({"error": "Unable to read the sample dataset."}), 500)
    return frame, None


def _resolve_frame():
    """Pick the input: an uploaded file wins, otherwise the `source` parameter.

    `source` is accepted from the query string, a multipart form field, or a
    JSON body.
    """
    upload = request.files.get("file")
    if upload is not None and (upload.filename or "").strip():
        return _read_upload(upload)

    source = request.values.get("source")  # query string + form fields
    if source is None:
        payload = request.get_json(silent=True)
        if isinstance(payload, dict):
            source = payload.get("source")
    if source is None or str(source).strip() == "":
        return None, (jsonify({
            "error": "Provide a CSV file in the 'file' field or a 'source' parameter (full|filled)."
        }), 400)
    return _read_source(source)


def _source_label():
    """Human-readable data-source label for the PDF's 'Data Source' row.

    Mirrors _resolve_frame's precedence: an uploaded file wins, otherwise
    the bundled source parameter. Returns None when neither is present.
    """
    upload = request.files.get("file")
    if upload is not None and (upload.filename or "").strip():
        return f"Uploaded CSV: {upload.filename.strip()}"

    source = request.values.get("source")
    if source is None:
        payload = request.get_json(silent=True)
        if isinstance(payload, dict):
            source = payload.get("source")
    if source is not None and str(source).strip():
        return f"Bundled dataset ({str(source).strip().lower()})"
    return None


# ---------------------------------------------------------------------------
# Frame validation / preparation
# ---------------------------------------------------------------------------

def _prepare_frame(frame):
    """Rename, validate, coerce and trim to exactly the 10 model features.

    Returns (prepared_frame, None) or (None, (response, status)).
    """
    frame = frame.rename(columns=COLUMN_RENAMES)

    # A file carrying both `residence_type` and `Residence_type` would create
    # a duplicate label after renaming - reject it with a clear message
    # instead of surfacing an sklearn "feature names" error.
    duplicated = frame.columns[frame.columns.duplicated()].tolist()
    if duplicated:
        return None, (jsonify({
            "error": f"Duplicate columns: {', '.join(sorted(set(duplicated)))}"
        }), 400)

    missing = [column for column in FEATURES if column not in frame.columns]
    if missing:
        return None, (jsonify({"error": f"Missing required columns: {', '.join(missing)}"}), 400)

    # Keep exactly the 10 features in the model's order; extra columns (e.g.
    # the `stroke` label or any metadata) are dropped silently.
    prepared = frame.loc[:, FEATURES].copy()

    if len(prepared) == 0:
        return None, (jsonify({"error": "The dataset contains no data rows."}), 400)
    if len(prepared) > MAX_ROWS:
        return None, (jsonify({
            "error": f"Too many rows: {len(prepared)}. The batch endpoint accepts at most {MAX_ROWS} rows."
        }), 413)

    for column in NUMERIC_COLUMNS:
        coerced = pd.to_numeric(prepared[column], errors="coerce")
        bad = coerced.isna().to_numpy().nonzero()[0]
        if bad.size:
            row_number = int(bad[0]) + 1  # 1-based data row, header not counted
            return None, (jsonify({
                "error": (
                    f"Column '{column}' contains a value that is not a number "
                    f"at row {row_number}."
                )
            }), 400)
        prepared[column] = coerced

    # Mirror the single-prediction schema: the flag columns are ints.
    for column in INTEGER_COLUMNS:
        if (prepared[column] % 1 == 0).all():
            prepared[column] = prepared[column].astype(int)

    return prepared, None


# ---------------------------------------------------------------------------
# Scoring + payload building
# ---------------------------------------------------------------------------

def _score(prepared):
    """Score every row with the existing cached pipeline (no retraining)."""
    model = load_pipeline()
    probabilities = model.predict_proba(prepared[FEATURES])[:, 1]
    return probabilities


def _risk_group(prepared, results, column, force_labels=()):
    """Aggregate a categorical column into chart series rows.

    ``rate`` is high_risk/total as a PERCENT (0-100), rounded to 2 decimals.
    """
    groups = {}
    labels = []
    for value, result in zip(prepared[column].tolist(), results):
        label = str(_native(value))
        if label not in groups:
            groups[label] = {"label": label, "total": 0, "high_risk": 0}
            labels.append(label)
        entry = groups[label]
        entry["total"] += 1
        if result["prediction"] == 1:
            entry["high_risk"] += 1
    for label in force_labels:  # keep fixed axes complete (e.g. hypertension 0/1)
        if label not in groups:
            groups[label] = {"label": label, "total": 0, "high_risk": 0}
            labels.append(label)

    rows = []
    for label in sorted(labels):
        entry = groups[label]
        total = entry["total"]
        entry["rate"] = round(100.0 * entry["high_risk"] / total, 2) if total else 0.0
        rows.append(entry)
    return rows


def _build_payload(prepared, probabilities):
    percent = [round(float(p) * 100, 2) for p in probabilities]

    results = []
    for record, p, pct in zip(prepared.to_dict(orient="records"), probabilities, percent):
        prediction = int(float(p) >= RISK_THRESHOLD)
        row = {key: _native(value) for key, value in record.items()}
        row["stroke_probability"] = pct
        row["prediction"] = prediction
        row["risk_level"] = "High Risk" if prediction else "Low Risk"
        results.append(row)

    total = len(results)
    high_risk = sum(row["prediction"] for row in results)

    # Probability histogram: 10 bins of 10 over 0-100 percent.
    buckets = (pd.Series([float(p) for p in probabilities]) * 100 // 10)
    buckets = buckets.clip(upper=(len(HISTOGRAM_EDGES) - 2)).astype(int)
    counts = buckets.value_counts()
    histogram = [
        {
            "start": HISTOGRAM_EDGES[i],
            "end": HISTOGRAM_EDGES[i + 1],
            "count": int(counts.get(i, 0)),
        }
        for i in range(len(HISTOGRAM_EDGES) - 1)
    ]

    age_vs_probability = [
        {
            "age": row["age"],
            "probability": row["stroke_probability"],
            "risk_level": row["risk_level"],
        }
        for row in results
    ]

    return {
        "summary": {
            "total": total,
            "high_risk": high_risk,
            "low_risk": total - high_risk,
            "avg_probability": round(float(pd.Series([float(p) for p in probabilities]).mean()) * 100, 2),
            "max_probability": round(max(float(p) for p in probabilities) * 100, 2),
        },
        "chart_data": {
            "classification": {"low": total - high_risk, "high": high_risk},
            "probability_histogram": histogram,
            "age_vs_probability": age_vs_probability,
            "risk_by_hypertension": _risk_group(
                prepared, results, "hypertension", force_labels=("0", "1")
            ),
            "risk_by_smoking": _risk_group(prepared, results, "smoking_status"),
            "risk_by_work_type": _risk_group(prepared, results, "work_type"),
        },
        "results": results,
    }


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@batch_bp.post("/batch")
@roles_required("admin")  # existing admin-route pattern: JWT + role in one decorator
def batch_predict():
    frame, error = _resolve_frame()
    if error is not None:
        return error

    prepared, error = _prepare_frame(frame)
    if error is not None:
        return error

    try:
        probabilities = _score(prepared)
    except FileNotFoundError as exc:
        return jsonify({"error": str(exc)}), 503
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        log.exception("Batch prediction failed: %s", exc)
        return jsonify({"error": "Batch prediction failed. Please try again."}), 500

    payload = _build_payload(prepared, probabilities)
    # Carried into the PDF export as the "Data Source" row (frontend forwards
    # the whole response verbatim to /batch/report).
    source_label = _source_label()
    if source_label:
        payload["source"] = source_label
    return jsonify(payload)


@batch_bp.post("/batch/report")
@roles_required("admin")
def batch_report():
    """Stateless PDF export of an already-computed batch payload.

    Contract: JSON body must contain ``summary`` (object) and ``results``
    (array); ``chart_data`` and ``source`` are optional. ``source`` (a label
    like "Uploaded CSV: rows.csv", set by /batch) renders as the PDF's
    "Data Source" row. The PDF shows the summary, the chart aggregates and
    the TOP 50 rows by ``stroke_probability`` (see batch_report.REPORT_ROW_CAP).
    """
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return jsonify({"error": "Request body must be a JSON object containing the batch results payload."}), 400
    if not isinstance(body.get("summary"), dict):
        return jsonify({"error": "Missing 'summary' object in the batch payload."}), 400
    results = body.get("results")
    if not isinstance(results, list):
        return jsonify({"error": "Missing 'results' array in the batch payload."}), 400
    if len(results) > REPORT_MAX_ROWS:
        return jsonify({"error": f"Too many rows: {len(results)}. At most {REPORT_MAX_ROWS} rows are accepted."}), 413
    if any(not isinstance(row, dict) for row in results):
        return jsonify({"error": "Each entry in 'results' must be an object."}), 400

    try:
        from batch_report import generate_batch_report  # local import keeps startup light
        source_label = body.get("source") or body.get("source_label")
        buffer = generate_batch_report(body, source_label=source_label)
    except Exception as exc:
        log.exception("Batch report generation failed: %s", exc)
        return jsonify({"error": "Batch report generation failed. Please try again."}), 500

    return send_file(
        buffer,
        mimetype="application/pdf",
        as_attachment=True,
        download_name="neurorisk_batch_report.pdf",
    )
