"""Standalone validation of the saved NeuroRisk AI stroke-risk model.

Loads the saved pipeline from disk (exactly as the Flask backend does) and
scores it on the held-out test records that were never used for fitting,
threshold selection, or model selection.

Usage (from the backend/ directory):

    python test_model.py

It reproduces the recorded train/test split from the training metadata
(same dataset, same random_state, same stratified split), so the "unseen"
records are exactly the ones held out during training.

Outputs: sample counts, accuracy, precision, recall, sensitivity, F1,
ROC-AUC, specificity, confusion matrix, false positives/negatives, plus a
quick check that the artifact loads, that the positive-class probability
semantics are not reversed, and that ml/pipeline.py's RISK_THRESHOLD agrees
with the threshold stored in the model metadata.

This is a preliminary risk-classification model - not a medical diagnosis.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)

ROOT = Path(__file__).resolve().parent
ARTIFACT = ROOT / "ml" / "artifacts" / "stroke_pipeline.joblib"
METADATA = ROOT / "ml" / "artifacts" / "model_metadata.json"

sys.path.insert(0, str(ROOT))
from ml.pipeline import FEATURES, RISK_THRESHOLD  # noqa: E402


def main() -> int:
    print("=" * 70)
    print("NeuroRisk AI - saved-model validation")
    print("=" * 70)

    if not ARTIFACT.exists():
        print(f"FAIL: artifact missing: {ARTIFACT}")
        return 1
    pipeline = joblib.load(ARTIFACT)
    print(f"Loaded pipeline: {ARTIFACT}")
    print(f"  steps: {list(pipeline.named_steps)}")
    print(f"  estimator: {type(pipeline.named_steps['classifier']).__name__}")

    if not METADATA.exists():
        print(f"FAIL: metadata missing: {METADATA}")
        return 1
    meta = json.loads(METADATA.read_text())
    print(f"  trained model: {meta['selected_model']}")
    print(f"  metadata threshold: {meta['risk_threshold']}")
    print(f"  ml/pipeline.py threshold: {RISK_THRESHOLD}")
    if abs(float(meta["risk_threshold"]) - RISK_THRESHOLD) > 1e-9:
        print("FAIL: threshold mismatch between metadata and ml/pipeline.py")
        return 1
    print("  OK: thresholds agree")

    ds_path = Path(meta["dataset"]["path"])
    if not ds_path.exists():
        print(f"FAIL: dataset from metadata not found: {ds_path}")
        return 1
    df = pd.read_csv(ds_path).rename(columns=meta["column_rename"])
    print(f"\nDataset: {ds_path} ({len(df)} rows)")

    split = meta["split"]
    from sklearn.model_selection import train_test_split
    X = df[FEATURES]
    y = df[meta["target"]].astype(int).to_numpy()
    _, X_test, _, y_test = train_test_split(
        X, y, test_size=split["test_size"], stratify=y,
        random_state=split["random_state"],
    )
    # Records the model has never seen (never fitted, never threshold-tuned).
    y_proba = pipeline.predict_proba(X_test)[:, 1]
    y_pred = (y_proba >= RISK_THRESHOLD).astype(int)

    cm = confusion_matrix(y_test, y_pred, labels=[0, 1])
    tn, fp, fn, tp = (int(v) for v in cm.ravel())
    n_pos = int((y_test == 1).sum())
    n_neg = int((y_test == 0).sum())

    print("\nHELD-OUT TEST RESULTS")
    print(f"  test samples        : {len(y_test)} ({n_neg} negative / {n_pos} positive)")
    print(f"  accuracy            : {accuracy_score(y_test, y_pred):.4f}")
    print(f"  precision           : {precision_score(y_test, y_pred, zero_division=0):.4f}")
    print(f"  recall / sensitivity: {recall_score(y_test, y_pred, zero_division=0):.4f}")
    print(f"  f1                  : {f1_score(y_test, y_pred, zero_division=0):.4f}")
    print(f"  roc_auc             : {roc_auc_score(y_test, y_proba):.4f}")
    print(f"  specificity         : {tn / (tn + fp):.4f}")
    print(f"  confusion matrix    : [[TN={tn}, FP={fp}], [FN={fn}, TP={tp}]]")
    print(f"  false positives     : {fp}")
    print(f"  false negatives     : {fn}")

    # Metadata consistency: stored test metrics must match a re-computation.
    stored = meta["test_metrics"]
    checks = {
        "recall": abs(stored["recall"] - recall_score(y_test, y_pred, zero_division=0)),
        "roc_auc": abs(stored["roc_auc"] - roc_auc_score(y_test, y_proba)),
        "false_negatives": stored["false_negatives"] - fn,
    }
    ok = all(abs(v) < 1e-9 for v in checks.values())
    print(f"\nRecomputed metrics match training metadata: {'OK' if ok else 'MISMATCH ' + str(checks)}")

    # Positive-class semantics: high-risk examples must score above low-risk
    # ones, and predict_proba[:,1] must be P(stroke=1).
    high = {"age": 82, "gender": "Male", "hypertension": 1, "heart_disease": 1,
            "ever_married": "Yes", "work_type": "Private", "residence_type": "Urban",
            "avg_glucose_level": 250, "bmi": 40, "smoking_status": "smokes"}
    low = {"age": 25, "gender": "Female", "hypertension": 0, "heart_disease": 0,
           "ever_married": "No", "work_type": "Private", "residence_type": "Urban",
           "avg_glucose_level": 90, "bmi": 22, "smoking_status": "never smoked"}
    frame = pd.DataFrame([high, low], columns=FEATURES)
    probs = pipeline.predict_proba(frame)[:, 1]
    print("\nPROBABILITY SEMANTICS (positive class = stroke = 1)")
    print(f"  clearly higher-risk example : {probs[0]:.4f}")
    print(f"  clearly lower-risk example  : {probs[1]:.4f}")
    semantic_ok = probs[0] > probs[1]
    print(f"  not reversed                : {'OK' if semantic_ok else 'FAIL'}")
    print(f"  high example >= threshold({RISK_THRESHOLD}) : {'OK' if probs[0] >= RISK_THRESHOLD else 'FAIL'}")
    print(f"    -> {'High Risk' if probs[0] >= RISK_THRESHOLD else 'Low Risk'}")
    print(f"  low example  <  threshold({RISK_THRESHOLD}) : {'OK' if probs[1] < RISK_THRESHOLD else 'FAIL'}")
    print(f"    -> {'High Risk' if probs[1] >= RISK_THRESHOLD else 'Low Risk'}")

    # Score distribution sanity: probabilities must not be all identical.
    spread = float(np.ptp(y_proba))
    print(f"\n  probability range on test set: [{y_proba.min():.4f}, {y_proba.max():.4f}] "
          f"(spread {spread:.4f})")
    print(f"  flagged as high risk: {int(y_pred.sum())}/{len(y_pred)} "
          f"({y_pred.mean()*100:.1f}%)")

    passed = ok and semantic_ok and probs[0] >= RISK_THRESHOLD and probs[1] < RISK_THRESHOLD
    print("\n" + "=" * 70)
    print("RESULT:", "PASS" if passed else "FAIL")
    print("Preliminary risk classification only - not a medical diagnosis.")
    print("=" * 70)
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
