from pathlib import Path
import logging
import joblib
import pandas as pd

log = logging.getLogger(__name__)

ARTIFACT = Path(__file__).resolve().parent / "artifacts" / "stroke_pipeline.joblib"

FEATURES = [
    "age", "gender", "hypertension", "heart_disease", "ever_married",
    "work_type", "residence_type", "avg_glucose_level", "bmi", "smoking_status"
]

# Decision threshold for the HIGH-risk class.
#
# The production model is a RANDOM FOREST (RandomForest + none:
# n_estimators=400, max_depth=10, min_samples_leaf=3) trained on the real
# dataset ~/Desktop/brain stroke/archive/full_data.csv (4981 rows, 4.98%
# positive - a 19.1:1 imbalance) by train_stroke_model.py with
# `--only "RandomForest + none"` (user directive: Random Forest only).
# The threshold is chosen from OUT-OF-FOLD predictions on the TRAINING split
# only (the held-out test set is never used for threshold selection): it
# maximises balanced accuracy, i.e. Youden's J = sensitivity + specificity -
# 1, scanning 0.01..0.95 in 0.01 steps. Ties are broken toward higher
# sensitivity, then the lower threshold, because for a screening tool a false
# negative (missed high-risk user) is the costly error.
#
#   RISK_THRESHOLD = 0.04 -> sensitivity 0.860, specificity 0.678,
#   ROC-AUC 0.838 on the held-out test set (7 false negatives of 50
#   positives). OOF: F2=0.382, ROC-AUC=0.819, Brier=0.044 (well-calibrated).
#
# At 0.5 the model detects ZERO positive cases (all probabilities sit far
# below 0.5 because the base rate is ~5%), which is exactly the
# "always LOW RISK" failure this constant exists to prevent.
#
# This is a screening threshold for a preliminary decision-support tool - not
# a diagnosis, and not a clinically validated cut-off.
#
# Previous model (Logistic Regression, threshold 0.05) is backed up in
# ml/artifacts/backup/ along with its metadata.
RISK_THRESHOLD = 0.04

_MODEL = None

def load_pipeline():
    global _MODEL
    if _MODEL is not None:
        return _MODEL
    if not ARTIFACT.exists():
        raise FileNotFoundError(
            "Model artifact not found. Run: python train_stroke_model.py"
        )
    _MODEL = joblib.load(ARTIFACT)
    log.info("Loaded model artifact from %s", ARTIFACT)
    # Guard against threshold/metadata drift between training and serving.
    metadata = ARTIFACT.parent / "model_metadata.json"
    if metadata.exists():
        try:
            import json
            trained = json.loads(metadata.read_text()).get("risk_threshold")
            if trained is not None and abs(float(trained) - RISK_THRESHOLD) > 1e-9:
                log.warning(
                    "RISK_THRESHOLD (%s) differs from the threshold stored with "
                    "the trained model (%s) - retrain or sync ml/pipeline.py.",
                    RISK_THRESHOLD, trained,
                )
        except Exception:  # pragma: no cover - metadata is advisory only
            log.debug("Could not read model metadata", exc_info=True)
    return _MODEL

def predict(payload):
    """Transform one assessment and score it with the trained pipeline.

    Returns (label, probability) where probability is P(stroke=1) taken from
    predict_proba[:, 1] (positive class index 1 == stroke == High Risk) and
    label = 1 when probability >= RISK_THRESHOLD.
    """
    model = load_pipeline()
    frame = pd.DataFrame([payload], columns=FEATURES)
    probability = float(model.predict_proba(frame)[0][1])
    label = int(probability >= RISK_THRESHOLD)
    return label, probability
