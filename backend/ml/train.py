from pathlib import Path
import numpy as np
import pandas as pd
import joblib
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

ROOT = Path(__file__).resolve().parent
ARTIFACT = ROOT / "artifacts" / "stroke_pipeline.joblib"
ARTIFACT.parent.mkdir(parents=True, exist_ok=True)

FEATURES = [
    "age", "gender", "hypertension", "heart_disease", "ever_married",
    "work_type", "residence_type", "avg_glucose_level", "bmi", "smoking_status"
]
CATEGORICAL = [
    "gender", "ever_married", "work_type", "residence_type", "smoking_status"
]
NUMERIC = [
    "age", "hypertension", "heart_disease", "avg_glucose_level", "bmi"
]

def make_demo_dataset(n=6000, seed=42):
    rng = np.random.default_rng(seed)
    age = rng.uniform(18, 90, n)
    hypertension = rng.binomial(1, np.clip(0.05 + age / 160, 0.05, 0.75), n)
    heart = rng.binomial(1, np.clip(age / 220, 0.03, 0.55), n)
    glucose = np.clip(rng.normal(105 + age * .22 + hypertension * 18, 35, n), 45, 350)
    bmi = np.clip(rng.normal(27, 5, n), 14, 55)
    gender = rng.choice(["Male", "Female", "Other"], n, p=[.49, .49, .02])
    married = np.where(age > 30, rng.choice(["Yes", "No"], n, p=[.87, .13]), "No")
    work = rng.choice(["Private", "Self-employed", "Govt_job", "children", "Never_worked"],
                      n, p=[.55, .15, .15, .1, .05])
    residence = rng.choice(["Urban", "Rural"], n)
    smoking = rng.choice(["formerly smoked", "never smoked", "smokes", "Unknown"],
                         n, p=[.18, .52, .15, .15])

    logit = (
        -8.1 + .065 * age + .0005 * (glucose - 100)
        + .95 * hypertension + .85 * heart + .035 * (bmi - 25)
        + .25 * (smoking == "smokes") + .12 * (smoking == "formerly smoked")
    )
    p = 1 / (1 + np.exp(-logit))
    stroke = rng.binomial(1, np.clip(p, .005, .9))

    return pd.DataFrame({
        "age": age, "gender": gender, "hypertension": hypertension,
        "heart_disease": heart, "ever_married": married, "work_type": work,
        "residence_type": residence, "avg_glucose_level": glucose,
        "bmi": bmi, "smoking_status": smoking, "stroke": stroke
    })

def train():
    df = make_demo_dataset()
    X = df[FEATURES]
    y = df["stroke"]
    x_train, x_test, y_train, y_test = train_test_split(
        X, y, test_size=.2, stratify=y, random_state=42
    )

    numeric = Pipeline([
        ("imputer", SimpleImputer(strategy="median")),
        ("scaler", StandardScaler()),
    ])
    categorical = Pipeline([
        ("imputer", SimpleImputer(strategy="most_frequent")),
        ("onehot", OneHotEncoder(handle_unknown="ignore")),
    ])

    preprocess = ColumnTransformer([
        ("num", numeric, NUMERIC),
        ("cat", categorical, CATEGORICAL),
    ])

    classifier = RandomForestClassifier(
        n_estimators=400, max_depth=10, min_samples_leaf=3,
        class_weight="balanced", random_state=42, n_jobs=-1
    )
    pipe = Pipeline([("preprocess", preprocess), ("classifier", classifier)])
    pipe.fit(x_train, y_train)

    auc = roc_auc_score(y_test, pipe.predict_proba(x_test)[:, 1])
    joblib.dump(pipe, ARTIFACT)
    print(f"Saved {ARTIFACT}")
    print(f"Demo validation ROC-AUC: {auc:.3f}")
    print("IMPORTANT: This demo model is not clinically validated.")

if __name__ == "__main__":
    train()
