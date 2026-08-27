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

_MODEL = None

def load_pipeline():
    global _MODEL
    if _MODEL is not None:
        return _MODEL
    if not ARTIFACT.exists():
        raise FileNotFoundError(
            "Model artifact not found. Run: python -m ml.train"
        )
    _MODEL = joblib.load(ARTIFACT)
    log.info("Loaded model artifact from %s", ARTIFACT)
    return _MODEL

def predict(payload):
    model = load_pipeline()
    frame = pd.DataFrame([payload], columns=FEATURES)
    probability = float(model.predict_proba(frame)[0][1])
    label = int(probability >= 0.5)
    return label, probability
