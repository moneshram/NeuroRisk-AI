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
# The production model is trained on the real dataset
# ~/Desktop/brain stroke/archive/full_data.csv (4981 rows, 4.98% positive -
# a 19.1:1 imbalance) by train_stroke_model.py. The threshold is chosen from
# OUT-OF-FOLD predictions on the TRAINING split only (the held-out test set is
# never used for threshold selection): it maximises balanced accuracy, i.e.
# Youden's J = sensitivity + specificity - 1, scanning 0.01..0.95 in 0.01
# steps. Ties are broken toward higher sensitivity, then the lower threshold,
# because for a screening tool a false negative (missed high-risk user) is the
# costly error.
#
#   RISK_THRESHOLD = 0.05 -> sensitivity 0.840, specificity 0.743,
#   ROC-AUC 0.846 on the held-out test set (8 false negatives of 50 positives).
#   It flags roughly the top 25% of assessments, close to the point where
#   sensitivity and specificity are balanced (OOF: 0.808 / 0.734 at 0.05;
#   the balanced-accuracy peak is a genuine interior optimum, verified by
#   sweep: 0.04 -> 0.770, 0.05 -> 0.771, 0.06 -> 0.757).
#
# At 0.5 the same model detects ZERO positive cases (all probabilities sit
# below 0.5 because the base rate is ~5%), which is exactly the
# "always LOW RISK" failure this constant exists to prevent.
#
# This is a screening threshold for a preliminary decision-support tool - not
# a diagnosis, and not a clinically validated cut-off.
RISK_THRESHOLD = 0.05

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
