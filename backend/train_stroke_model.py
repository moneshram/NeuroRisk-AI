"""NeuroRisk AI - stroke-risk model training script.

Retrains the risk-classification model from a real CSV dataset, compares
several classifiers under several class-imbalance strategies, selects the
best one using a documented (recall-oriented) rule, and saves the COMPLETE
preprocessing + model pipeline consumed by the Flask backend.

Usage (from the backend/ directory):

    python train_stroke_model.py

Dataset location (training only - never used by the prediction code):

    STROKE_DATASET_PATH=/path/to/full_data.csv python train_stroke_model.py

If the variable is unset the script falls back to STROKE_DATASET_DEFAULT
below (override with --dataset).

Safety properties
-----------------
* The dataset is only read. It is never modified, moved or overwritten.
* Train/test split happens BEFORE any preprocessing is fitted.
* Imputers / scalers / encoders are fitted on training data only
  (and, inside cross-validation, on each fold's training part only).
* SMOTE / random oversampling is applied ONLY to training data.
* The held-out test set is never used for fitting, threshold selection or
  model selection - only for the final report.
* The risk threshold is chosen from out-of-fold predictions on the TRAINING
  set, so the test set stays untouched.

This is a preliminary risk-classification / decision-support model. It is NOT
a medical diagnosis and must not be described as clinically validated.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.base import clone
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import GradientBoostingClassifier, RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    brier_score_loss,
    confusion_matrix,
    f1_score,
    fbeta_score,
    precision_score,
    recall_score,
    roc_auc_score,
    roc_curve,
    precision_recall_curve,
    average_precision_score,
)
from sklearn.model_selection import StratifiedKFold, train_test_split
from sklearn.neighbors import KNeighborsClassifier
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from sklearn.svm import SVC

# --------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------

ROOT = Path(__file__).resolve().parent
ARTIFACT_DIR = ROOT / "ml" / "artifacts"
EVAL_DIR = ARTIFACT_DIR / "evaluation"
BACKUP_DIR = ARTIFACT_DIR / "backup"
ARTIFACT = ARTIFACT_DIR / "stroke_pipeline.joblib"
METADATA_JSON = ARTIFACT_DIR / "model_metadata.json"
METRICS_JSON = EVAL_DIR / "metrics.json"

# Default dataset location. Overridable so no machine-specific path has to be
# baked into production code (the Flask prediction path never reads a CSV).
STROKE_DATASET_DEFAULT = Path.home() / "Desktop" / "brain stroke" / "archive" / "full_data.csv"

# Column order must match ml/pipeline.py::FEATURES exactly.
FEATURES = [
    "age", "gender", "hypertension", "heart_disease", "ever_married",
    "work_type", "residence_type", "avg_glucose_level", "bmi", "smoking_status",
]
CATEGORICAL = [
    "gender", "ever_married", "work_type", "residence_type", "smoking_status",
]
NUMERIC = ["age", "hypertension", "heart_disease", "avg_glucose_level", "bmi"]
TARGET = "stroke"

# Dataset column name -> application column name.
COLUMN_RENAME = {"Residence_type": "residence_type"}

RANDOM_STATE = 42
TEST_SIZE = 0.20
N_FOLDS = 5

DISCLAIMER = (
    "Preliminary machine-learning risk classification for decision support. "
    "Not a medical diagnosis, not clinically validated, not a replacement "
    "for a clinician's assessment."
)


# --------------------------------------------------------------------------
# Dataset inspection (Steps 1-2)
# --------------------------------------------------------------------------

def resolve_dataset_path(cli_path: str | None) -> Path:
    if cli_path:
        path = Path(cli_path).expanduser()
    elif os.environ.get("STROKE_DATASET_PATH"):
        path = Path(os.environ["STROKE_DATASET_PATH"]).expanduser()
    else:
        path = STROKE_DATASET_DEFAULT.expanduser()
    if not path.exists():
        raise SystemExit(
            f"Dataset not found: {path}\n"
            "Set STROKE_DATASET_PATH or pass --dataset /path/to/file.csv"
        )
    return path


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def inspect_dataset(df: pd.DataFrame, path: Path) -> dict:
    """Print the dataset summary (Step 1) and return it as a dict."""
    line = "=" * 74
    print(line)
    print(f"DATASET: {path}")
    print(f"rows={len(df)}  columns={len(df.columns)}")
    print(line)
    print("Columns:", list(df.columns))
    print("\nData types:")
    print(df.dtypes.to_string())

    missing = df.isna().sum()
    print("\nMissing values per column:")
    print((missing[missing > 0].to_string() if missing.sum() else "  none"))
    print(f"  total missing cells: {int(missing.sum())}")

    dupes = int(df.duplicated().sum())
    print(f"\nExact duplicate rows: {dupes}")

    print("\nCategorical columns (unique values):")
    cat_summary = {}
    for col in df.select_dtypes(include="object").columns:
        counts = df[col].value_counts(dropna=False)
        cat_summary[col] = {str(k): int(v) for k, v in counts.items()}
        print(f"  {col} ({df[col].nunique()}): {dict(counts)}")

    print("\nNumeric ranges:")
    num_summary = {}
    for col in df.select_dtypes(include="number").columns:
        desc = df[col].describe()
        num_summary[col] = {k: float(v) for k, v in desc.items()}
        print(
            f"  {col:<19} min={desc['min']:<8.2f} max={desc['max']:<8.2f} "
            f"mean={desc['mean']:<8.2f} median={df[col].median():.2f}"
        )

    if TARGET not in df.columns:
        raise SystemExit(f"Target column '{TARGET}' not found.")

    counts = df[TARGET].value_counts(dropna=False).sort_index()
    total = int(counts.sum())
    print("\nTARGET COLUMN:", TARGET)
    print("  value counts:")
    for value, count in counts.items():
        print(f"    {value}: {count}  ({count / total * 100:.2f}%)")
    if len(counts) == 2:
        neg, pos = int(counts.iloc[0]), int(counts.iloc[1])
        print(f"  class ratio: {neg / pos:.1f} : 1  -> "
              f"{'IMBALANCED' if neg / pos > 3 else 'balanced'}")

    return {
        "path": str(path),
        "sha256": sha256_of(path),
        "rows": int(len(df)),
        "columns": list(df.columns),
        "dtypes": {c: str(t) for c, t in df.dtypes.items()},
        "missing_per_column": {k: int(v) for k, v in missing.items() if v},
        "duplicate_rows": dupes,
        "categorical_values": cat_summary,
        "numeric_summary": num_summary,
        "target": TARGET,
        "target_counts": {str(k): int(v) for k, v in counts.items()},
        "target_percent": {str(k): round(v / total * 100, 2)
                           for k, v in counts.items()},
    }


def data_quality_checks(df: pd.DataFrame) -> dict:
    """Documented quality checks (Step 2) - report only, no silent removal."""
    checks: dict[str, object] = {}

    for col in (TARGET, "hypertension", "heart_disease"):
        checks[f"{col}_values"] = sorted(pd.unique(df[col]).tolist())
        if col != TARGET and not set(df[col].unique()) <= {0, 1}:
            raise SystemExit(f"{col} must be 0/1, got {df[col].unique()}")
    if not set(df[TARGET].unique()) <= {0, 1}:
        raise SystemExit(f"{TARGET} must be binary 0/1.")

    checks["age_out_of_range"] = int(((df.age < 0) | (df.age > 120)).sum())
    checks["bmi_out_of_range"] = int(((df.bmi < 5) | (df.bmi > 100)).sum())
    checks["glucose_out_of_range"] = int(
        ((df.avg_glucose_level < 20) | (df.avg_glucose_level > 600)).sum()
    )
    if any(checks[k] for k in ("age_out_of_range", "bmi_out_of_range",
                               "glucose_out_of_range")):
        print("WARNING: out-of-range values found (kept, imputer/scaler fitted "
              "on train only):", checks)

    # Rows sharing identical features but opposite labels = noisy/contradictory.
    feats = [c for c in df.columns if c != TARGET]
    grouped = df.groupby(feats, dropna=False)[TARGET].nunique()
    checks["conflicting_feature_groups"] = int((grouped > 1).sum())
    checks["duplicate_feature_rows"] = int(df.duplicated(subset=feats).sum())

    # IQR outlier counts (informational - outliers are clinically plausible
    # glucose/BMI values and are NOT removed).
    outliers = {}
    for col in ("age", "avg_glucose_level", "bmi"):
        q1, q3 = df[col].quantile([0.25, 0.75])
        iqr = q3 - q1
        lo, hi = q1 - 1.5 * iqr, q3 + 1.5 * iqr
        outliers[col] = int(((df[col] < lo) | (df[col] > hi)).sum())
    checks["iqr_outliers"] = outliers

    checks["unknown_smoking_status"] = int((df.smoking_status == "Unknown").sum())

    print("\nDATA QUALITY CHECKS")
    for key, value in checks.items():
        print(f"  {key}: {value}")
    print("  NOTE: no rows removed - missing/unknown categories are handled "
          "inside the fitted pipeline (imputer / one-hot 'Unknown' level).")
    print()
    return checks


def justify_target(df: pd.DataFrame) -> str:
    """Explain why 'stroke' is the target rather than assuming it."""
    rates = {
        "hypertension": df.groupby("hypertension")[TARGET].mean().round(3).to_dict(),
        "heart_disease": df.groupby("heart_disease")[TARGET].mean().round(3).to_dict(),
        "age_band": df.groupby(pd.cut(df.age, [0, 18, 40, 60, 80, 100]),
                               observed=True)[TARGET].mean().round(3).to_dict(),
    }
    justification = (
        "Target selected: 'stroke' (binary 0/1).\n"
        "  * It is the only outcome/label-like column: every other column is a "
        "risk factor or demographic attribute recorded before any outcome.\n"
        "  * It is binary and complete (no missing values).\n"
        "  * Its rates behave as clinically expected, i.e. it carries real "
        "signal rather than being an ID/artifact column:\n"
        f"      stroke rate by hypertension: {rates['hypertension']}\n"
        f"      stroke rate by heart_disease: {rates['heart_disease']}\n"
        f"      stroke rate by age band: { {str(k): v for k, v in rates['age_band'].items()} }\n"
        "  * No other candidate column (age, bmi, ...) is an outcome; using one "
        "of them as target would be meaningless for this task."
    )
    print("TARGET SELECTION\n" + justification + "\n")
    return justification


# --------------------------------------------------------------------------
# Preprocessing + models
# --------------------------------------------------------------------------

def build_preprocessor() -> ColumnTransformer:
    numeric = Pipeline([
        ("imputer", SimpleImputer(strategy="median")),
        ("scaler", StandardScaler()),
    ])
    categorical = Pipeline([
        ("imputer", SimpleImputer(strategy="most_frequent")),
        ("onehot", OneHotEncoder(handle_unknown="ignore")),
    ])
    return ColumnTransformer([
        ("num", numeric, NUMERIC),
        ("cat", categorical, CATEGORICAL),
    ])


def make_configs() -> list[dict]:
    """Model x imbalance-strategy combinations to compare."""
    configs: list[dict] = []
    for name, maker in [
        ("LogisticRegression",
         lambda w: LogisticRegression(max_iter=2000, class_weight=w,
                                      random_state=RANDOM_STATE)),
        ("RandomForest",
         lambda w: RandomForestClassifier(n_estimators=400, max_depth=10,
                                          min_samples_leaf=3, class_weight=w,
                                          random_state=RANDOM_STATE,
                                          n_jobs=-1)),
    ]:
        configs.append({"model": name, "imbalance": "none", "make": lambda m=maker: m(None)})
        configs.append({"model": name, "imbalance": "class_weight_balanced",
                        "make": lambda m=maker: m("balanced")})

    configs.append({
        "model": "GradientBoosting", "imbalance": "none",
        "make": lambda: GradientBoostingClassifier(random_state=RANDOM_STATE),
    })
    configs.append({
        "model": "GradientBoosting", "imbalance": "class_weight_balanced",
        "make": lambda: GradientBoostingClassifier(random_state=RANDOM_STATE),
        "use_sample_weight": True,
    })

    configs.append({
        "model": "SVM-RBF", "imbalance": "none",
        "make": lambda: SVC(kernel="rbf", probability=True,
                            random_state=RANDOM_STATE),
    })
    configs.append({
        "model": "SVM-RBF", "imbalance": "class_weight_balanced",
        "make": lambda: SVC(kernel="rbf", probability=True, class_weight="balanced",
                            random_state=RANDOM_STATE),
    })

    configs.append({
        "model": "KNN", "imbalance": "none",
        "make": lambda: KNeighborsClassifier(n_neighbors=15, weights="distance"),
    })

    # Oversampling variants (applied to transformed TRAINING data only).
    for model in ("LogisticRegression", "RandomForest", "GradientBoosting",
                  "SVM-RBF", "KNN"):
        for strategy in ("random_oversample", "smote"):
            if model == "LogisticRegression":
                make = lambda: LogisticRegression(max_iter=2000,
                                                  random_state=RANDOM_STATE)
            elif model == "RandomForest":
                make = lambda: RandomForestClassifier(
                    n_estimators=400, max_depth=10, min_samples_leaf=3,
                    random_state=RANDOM_STATE, n_jobs=-1)
            elif model == "GradientBoosting":
                make = lambda: GradientBoostingClassifier(random_state=RANDOM_STATE)
            elif model == "SVM-RBF":
                make = lambda: SVC(kernel="rbf", probability=True,
                                   random_state=RANDOM_STATE)
            else:
                make = lambda: KNeighborsClassifier(n_neighbors=15,
                                                    weights="distance")
            configs.append({"model": model, "imbalance": strategy,
                            "make": lambda m=make: m()})
    return configs


# --------------------------------------------------------------------------
# Oversampling helpers (train-only; no external dependency)
# --------------------------------------------------------------------------

def random_oversample(X: np.ndarray, y: np.ndarray,
                      random_state: int = RANDOM_STATE) -> tuple[np.ndarray, np.ndarray]:
    """Duplicate minority-class rows until classes are balanced."""
    rng = np.random.default_rng(random_state)
    counts = np.bincount(y.astype(int))
    target = counts.max()
    parts_x, parts_y = [X], [y]
    for cls in (0, 1):
        need = target - counts[cls]
        if need > 0:
            idx = rng.choice(np.flatnonzero(y == cls), size=need, replace=True)
            parts_x.append(X[idx])
            parts_y.append(y[idx])
    return np.vstack(parts_x), np.concatenate(parts_y)


def smote_oversample(X: np.ndarray, y: np.ndarray, k: int = 5,
                     random_state: int = RANDOM_STATE) -> tuple[np.ndarray, np.ndarray]:
    """Minimal SMOTE: interpolate minority samples toward their k nearest
    minority neighbours until the classes are balanced."""
    rng = np.random.default_rng(random_state)
    counts = np.bincount(y.astype(int))
    maj, mino = int(counts.argmax()), int(counts.argmin())
    X_min, need = X[y == mino], int(counts[maj] - counts[mino])
    if need <= 0 or len(X_min) < 2:
        return X, y
    k = min(k, len(X_min) - 1)

    # Chunked pairwise distances to stay within memory bounds.
    neighbours = []
    step = 1024
    for start in range(0, len(X_min), step):
        block = X_min[start:start + step]
        dist = np.linalg.norm(block[:, None, :] - X_min[None, :, :], axis=2)
        neighbours.append(np.argsort(dist, axis=1)[:, 1:k + 1])
    neighbours = np.vstack(neighbours)

    synth = np.empty((need, X_min.shape[1]), dtype=X_min.dtype)
    for i in range(need):
        src = int(rng.integers(0, len(X_min)))
        nn = int(rng.choice(neighbours[src]))
        gap = rng.random()
        synth[i] = X_min[src] + gap * (X_min[nn] - X_min[src])
    return np.vstack([X, synth]), np.concatenate([y, np.full(need, mino, dtype=y.dtype)])


def apply_strategy(strategy: str, X: np.ndarray, y: np.ndarray):
    if strategy == "random_oversample":
        return random_oversample(X, y)
    if strategy == "smote":
        return smote_oversample(X, y)
    return X, y


# --------------------------------------------------------------------------
# Metrics
# --------------------------------------------------------------------------

def compute_metrics(y_true, y_pred, y_proba) -> dict:
    cm = confusion_matrix(y_true, y_pred, labels=[0, 1])
    tn, fp, fn, tp = (int(v) for v in cm.ravel())
    specificity = tn / (tn + fp) if (tn + fp) else 0.0
    return {
        "accuracy": float(accuracy_score(y_true, y_pred)),
        "precision": float(precision_score(y_true, y_pred, zero_division=0)),
        "recall": float(recall_score(y_true, y_pred, zero_division=0)),
        "f1": float(f1_score(y_true, y_pred, zero_division=0)),
        "f2": float(fbeta_score(y_true, y_pred, beta=2, zero_division=0)),
        "roc_auc": float(roc_auc_score(y_true, y_proba)),
        "specificity": float(specificity),
        "confusion_matrix": [[tn, fp], [fn, tp]],
        "true_negatives": tn, "false_positives": fp,
        "false_negatives": fn, "true_positives": tp,
    }


def predict_at(proba: np.ndarray, threshold: float) -> np.ndarray:
    return (proba >= threshold).astype(int)


def choose_threshold(y_true, proba) -> tuple[float, dict]:
    """Pick the decision threshold from TRAINING out-of-fold probabilities.

    Rule (documented, screening-oriented):
      1. candidate thresholds 0.01 .. 0.95 (step 0.01);
      2. maximise balanced accuracy (= mean of sensitivity and specificity);
      3. ties -> higher sensitivity (fewer false negatives);
      4. further ties -> lower threshold (conservative for screening).
    """
    best = (None, None)
    for thr in np.arange(0.01, 0.951, 0.01):
        m = compute_metrics(y_true, predict_at(proba, thr), proba)
        key = (round(m["specificity"], 6) + round(m["recall"], 6),
               round(m["recall"], 6), -thr)
        if best[1] is None or key > best[1]:
            best = (float(round(thr, 2)), key)
    threshold = best[0]
    return threshold, compute_metrics(y_true, predict_at(proba, threshold), proba)


# --------------------------------------------------------------------------
# SVG curve plotting (no matplotlib in this environment)
# --------------------------------------------------------------------------

def _svg_polyline(points, color, width=2.5):
    pts = " ".join(f"{x:.2f},{y:.2f}" for x, y in points)
    return f'<polyline points="{pts}" fill="none" stroke="{color}" stroke-width="{width}"/>'


def write_curve_svg(path: Path, curves: list[dict], title: str,
                    x_label: str, y_label: str, diagonal=False, w=520, h=420):
    """curves: [{"label","points":[(x,y)...], "color"}] in data coords 0..1."""
    ml, mr, mt, mb = 62, 18, 44, 52
    pw, ph = w - ml - mr, h - mt - mb

    def sx(x):
        return ml + x * pw

    def sy(y):
        return mt + (1 - y) * ph

    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" '
        f'viewBox="0 0 {w} {h}" font-family="sans-serif">',
        f'<rect width="{w}" height="{h}" fill="#ffffff"/>',
        f'<text x="{w/2}" y="24" text-anchor="middle" font-size="15" '
        f'font-weight="bold" fill="#111">{title}</text>',
    ]
    for i in range(6):
        v = i / 5
        gx, gy = sx(v), sy(v)
        parts.append(f'<line x1="{ml}" y1="{gy:.2f}" x2="{ml+pw}" y2="{gy:.2f}" '
                     f'stroke="#e5e7eb" stroke-width="1"/>')
        parts.append(f'<line x1="{gx:.2f}" y1="{mt}" x2="{gx:.2f}" y2="{mt+ph}" '
                     f'stroke="#e5e7eb" stroke-width="1"/>')
        parts.append(f'<text x="{ml-8}" y="{gy+4:.2f}" text-anchor="end" '
                     f'font-size="11" fill="#555">{v:.1f}</text>')
        parts.append(f'<text x="{gx:.2f}" y="{mt+ph+18}" text-anchor="middle" '
                     f'font-size="11" fill="#555">{v:.1f}</text>')
    parts.append(f'<rect x="{ml}" y="{mt}" width="{pw}" height="{ph}" '
                 f'fill="none" stroke="#999"/>')
    if diagonal:
        parts.append(f'<line x1="{sx(0)}" y1="{sy(0)}" x2="{sx(1)}" y2="{sy(1)}" '
                     f'stroke="#9ca3af" stroke-dasharray="5,4" stroke-width="1.5"/>')
    for curve in curves:
        pts = [(sx(x), sy(y)) for x, y in curve["points"]]
        parts.append(_svg_polyline(pts, curve["color"]))
    parts.append(f'<text x="{ml+pw/2}" y="{h-14}" text-anchor="middle" '
                 f'font-size="12" fill="#333">{x_label}</text>')
    parts.append(f'<text x="16" y="{mt+ph/2}" text-anchor="middle" font-size="12" '
                 f'fill="#333" transform="rotate(-90 16 {mt+ph/2})">{y_label}</text>')
    lx, ly = ml + 14, mt + 18
    for i, curve in enumerate(curves):
        parts.append(f'<line x1="{lx}" y1="{ly + i*18}" x2="{lx+26}" '
                     f'y2="{ly + i*18}" stroke="{curve["color"]}" stroke-width="3"/>')
        parts.append(f'<text x="{lx+32}" y="{ly + i*18 + 4}" font-size="11" '
                     f'fill="#333">{curve["label"]}</text>')
    parts.append("</svg>")
    path.write_text("\n".join(parts))
    return path


# --------------------------------------------------------------------------
# Cross-validated out-of-fold evaluation (leakage-safe)
# --------------------------------------------------------------------------

def oof_evaluate(config: dict, X: pd.DataFrame, y: np.ndarray) -> tuple[np.ndarray, dict]:
    """5-fold OOF probabilities on the TRAINING set.

    Per fold: preprocess fit on fold-train, oversample fold-train only,
    score fold-validation. The fold-validation part is never resampled.
    """
    skf = StratifiedKFold(n_splits=N_FOLDS, shuffle=True, random_state=RANDOM_STATE)
    oof = np.zeros(len(y), dtype=float)
    fold_rows = []
    for fold, (tr, va) in enumerate(skf.split(X, y), 1):
        pre = build_preprocessor()
        Xtr = pre.fit_transform(X.iloc[tr])
        Xva = pre.transform(X.iloc[va])
        ytr = y[tr]

        Xtr_s, ytr_s = apply_strategy(config["imbalance"], Xtr, ytr)

        clf = config["make"]()
        fit_params = {}
        if config.get("use_sample_weight"):
            w = np.where(ytr_s == 1,
                         len(ytr_s) / (2 * max((ytr_s == 1).sum(), 1)),
                         len(ytr_s) / (2 * max((ytr_s == 0).sum(), 1)))
            fit_params["sample_weight"] = w
        clf.fit(Xtr_s, ytr_s, **fit_params)
        oof[va] = clf.predict_proba(Xva)[:, 1]

        pred = predict_at(oof[va], 0.5)
        fold_rows.append(compute_metrics(y[va], pred, oof[va])["recall"])
    summary = {"oof_recall_at_0.5_mean": float(np.mean(fold_rows)),
               "oof_recall_at_0.5_std": float(np.std(fold_rows))}
    return oof, summary


def final_fit(config: dict, pre, X: np.ndarray, y: np.ndarray):
    """Fit the final classifier on the full (pre-fitted) training matrix."""
    Xs, ys = apply_strategy(config["imbalance"], X, y)
    clf = config["make"]()
    fit_params = {}
    if config.get("use_sample_weight"):
        w = np.where(ys == 1, len(ys) / (2 * max((ys == 1).sum(), 1)),
                     len(ys) / (2 * max((ys == 0).sum(), 1)))
        fit_params["sample_weight"] = w
    clf.fit(Xs, ys, **fit_params)
    _ = pre
    return clf


# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------

def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", help="CSV path (or set STROKE_DATASET_PATH)")
    parser.add_argument("--skip-backup", action="store_true",
                        help="Do not copy the current artifact to backup/")
    parser.add_argument(
        "--only", metavar="FILTER",
        help="Train ONLY configs matching this filter - either a model name "
             "(e.g. 'RandomForest') or an exact config label "
             "(e.g. 'RandomForest + none'). Cross-model selection is then "
             "applied within the filtered set only.")
    args = parser.parse_args(argv)

    started = time.time()
    EVAL_DIR.mkdir(parents=True, exist_ok=True)
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    dataset_path = resolve_dataset_path(args.dataset)
    print(f"Loading {dataset_path} ...")
    df = pd.read_csv(dataset_path)

    # ---- Steps 1-2: inspect + validate -------------------------------
    dataset_info = inspect_dataset(df, dataset_path)
    quality = data_quality_checks(df)
    justification = justify_target(df)

    df = df.rename(columns=COLUMN_RENAME)
    missing_features = [f for f in FEATURES + [TARGET] if f not in df.columns]
    if missing_features:
        raise SystemExit(f"Dataset is missing required columns: {missing_features}")
    extra = [c for c in df.columns if c not in FEATURES + [TARGET]]
    if extra:
        print(f"Ignoring columns not used as features: {extra}")

    # 'Unknown' smoking status is a legitimate category in this dataset
    # (30% of rows); it is kept as its own level, not imputed away.

    work_df = df[FEATURES + [TARGET]].copy()
    X = work_df[FEATURES]
    y = work_df[TARGET].astype(int).to_numpy()

    # ---- Step 3: split BEFORE any fitted transformation --------------
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=TEST_SIZE, stratify=y, random_state=RANDOM_STATE
    )
    print(f"\nSplit: train={len(X_train)}  test={len(X_test)}  "
          f"test_size={TEST_SIZE}  random_state={RANDOM_STATE}  stratified")
    print(f"  train positive rate: {y_train.mean()*100:.2f}%  "
          f"test positive rate: {y_test.mean()*100:.2f}%")
    print("  Preprocessing (imputer/scaler/one-hot) is fitted on TRAINING data "
          "only, inside each CV fold and once more for the final model.\n")

    # ---- Steps 6-7: train + compare ----------------------------------
    configs = make_configs()
    if args.only:
        needle = args.only.strip().lower()
        configs = [
            c for c in configs
            if needle in (c["model"].lower(),
                          f"{c['model']} + {c['imbalance']}".lower())
        ]
        if not configs:
            known = sorted({f"{c['model']} + {c['imbalance']}" for c in make_configs()})
            raise SystemExit(f"--only {args.only!r} matched no configuration. Known: {known}")
    results = []
    oof_cache = {}
    print(f"Running {len(configs)} model x imbalance configurations "
          f"({N_FOLDS}-fold leakage-safe CV on the training set) ...")
    for i, config in enumerate(configs, 1):
        label = f"{config['model']} + {config['imbalance']}"
        t0 = time.time()
        oof, fold_summary = oof_evaluate(config, X_train, y_train)
        oof_brier = float(brier_score_loss(y_train, oof))
        thr, oof_tuned = choose_threshold(y_train, oof)
        oof_at_05 = compute_metrics(y_train, predict_at(oof, 0.5), oof)
        oof_cache[label] = oof

        results.append({
            "label": label,
            "model": config["model"],
            "imbalance": config["imbalance"],
            "oof_threshold": thr,
            "oof_brier": oof_brier,
            "oof_at_0.5": oof_at_05,
            "oof_tuned": oof_tuned,
            "cv": fold_summary,
            "seconds": round(time.time() - t0, 1),
            "config": config,
        })
        print(f"  [{i:>2}/{len(configs)}] {label:<48} "
              f"OOF AUC={oof_at_05['roc_auc']:.3f} "
              f"OOF F2@{thr:.2f}={oof_tuned['f2']:.3f} "
              f"recall={oof_tuned['recall']:.3f} ({fold_summary['oof_recall_at_0.5_std']:.3f}s)")

    # ---- Selection rule (documented) ---------------------------------
    # Selection strategy (documented, training-data only):
    #   1. Discrimination guard: only configs whose OOF ROC-AUC is within
    #      0.02 of the best observed OOF ROC-AUC are eligible.
    #   2. Primary ranking: OOF F2 (beta=2 weights sensitivity 4x precision -
    #      false negatives are the clinical concern for a screening tool),
    #      rounded to 3 decimals so near-ties are treated as ties.
    #   3. Tie-break: LOWER out-of-fold Brier score (probability calibration).
    #      The application displays the predicted probability to the user, so
    #      a badly calibrated model (e.g. one trained on oversampled data,
    #      whose probabilities are inflated toward the artificial 50/50 prior)
    #      is rejected when discrimination is equivalent.
    #   4. Further ties: higher recall, then higher ROC-AUC.
    best_auc = max(r["oof_tuned"]["roc_auc"] for r in results)
    eligible = [r for r in results
                if r["oof_tuned"]["roc_auc"] >= best_auc - 0.02]
    eligible.sort(key=lambda r: (round(r["oof_tuned"]["f2"], 3),
                                 -r["oof_brier"],
                                 r["oof_tuned"]["recall"],
                                 r["oof_tuned"]["roc_auc"]), reverse=True)
    winner = eligible[0]
    selection_note = (
        f"Eligible = OOF ROC-AUC within 0.02 of the best ({best_auc:.3f}); "
        f"ranked by OOF F2 (beta=2, 3-dp tie grouping), ties broken by lower "
        f"OOF Brier (calibration), then recall, then ROC-AUC. "
        f"Winner: {winner['label']} "
        f"(F2={winner['oof_tuned']['f2']:.3f}, "
        f"ROC-AUC={winner['oof_tuned']['roc_auc']:.3f}, "
        f"Brier={winner['oof_brier']:.4f})."
    )

    # Final test evaluation for every configuration (test set untouched so far).
    print("\nFinal held-out TEST evaluation ...")
    for r in results:
        pre = build_preprocessor()
        Xtr = pre.fit_transform(X_train)          # fit on train only
        Xte = pre.transform(X_test)               # transform test (never fitted)
        clf = final_fit(r["config"], pre, Xtr, y_train)
        proba = clf.predict_proba(Xte)[:, 1]
        r["test_at_0.5"] = compute_metrics(y_test, predict_at(proba, 0.5), proba)
        r["test_tuned"] = compute_metrics(
            y_test, predict_at(proba, r["oof_threshold"]), proba)
        r["_proba_test"] = proba
        r["_pipeline"] = Pipeline([("preprocess", pre), ("classifier", clf)])
        _ = Xtr

    # ---- Comparison table (Step 7) -----------------------------------
    header = (f"{'Model + imbalance strategy':<48} {'Acc':>6} {'Prec':>6} "
              f"{'Recall':>7} {'F1':>6} {'F2':>6} {'ROC-AUC':>8} {'Spec':>6} "
              f"{'FN':>5} {'FP':>5} {'Thr':>5}")
    print("\n" + "=" * len(header))
    print("COMPARISON TABLE - held-out TEST set, each model at its own "
          "training-selected threshold")
    print("=" * len(header))
    print(header)
    print("-" * len(header))
    rows_for_csv = []
    for r in sorted(results, key=lambda r: r["test_tuned"]["f2"], reverse=True):
        m = r["test_tuned"]
        line = (f"{r['label']:<48} {m['accuracy']:>6.3f} {m['precision']:>6.3f} "
                f"{m['recall']:>7.3f} {m['f1']:>6.3f} {m['f2']:>6.3f} "
                f"{m['roc_auc']:>8.3f} {m['specificity']:>6.3f} "
                f"{m['false_negatives']:>5} {m['false_positives']:>5} "
                f"{r['oof_threshold']:>5.2f}")
        print(line)
        rows_for_csv.append({
            "model": r["model"], "imbalance": r["imbalance"],
            "threshold": r["oof_threshold"],
            **{k: round(m[k], 4) for k in
               ("accuracy", "precision", "recall", "f1", "f2", "roc_auc",
                "specificity")},
            "false_negatives": m["false_negatives"],
            "false_positives": m["false_positives"],
            "confusion_matrix": str(m["confusion_matrix"]),
            "oof_f2": round(r["oof_tuned"]["f2"], 4),
            "oof_roc_auc": round(r["oof_tuned"]["roc_auc"], 4),
            "oof_brier": round(r["oof_brier"], 4),
        })
    print("-" * len(header))
    print("Same table at the default 0.5 threshold (for reference):")
    for r in sorted(results, key=lambda r: r["test_at_0.5"]["f2"], reverse=True):
        m = r["test_at_0.5"]
        print(f"  {r['label']:<48} rec={m['recall']:.3f} spec={m['specificity']:.3f} "
              f"F1={m['f1']:.3f} AUC={m['roc_auc']:.3f} FN={m['false_negatives']}")

    pd.DataFrame(rows_for_csv).to_csv(EVAL_DIR / "model_comparison.csv",
                                      index=False)

    # ---- Step 8: winner ----------------------------------------------
    win = winner
    thr = win["oof_threshold"]
    m_test = win["test_tuned"]
    m_test_05 = win["test_at_0.5"]
    print("\n" + "=" * 74)
    print(f"SELECTED MODEL: {win['label']}")
    print("  Selection strategy:", selection_note)
    print(f"  Decision threshold (from TRAINING out-of-fold probabilities): {thr}")
    print(f"  TEST @ {thr:.2f}: accuracy={m_test['accuracy']:.3f} "
          f"precision={m_test['precision']:.3f} recall={m_test['recall']:.3f} "
          f"f1={m_test['f1']:.3f} f2={m_test['f2']:.3f} "
          f"roc_auc={m_test['roc_auc']:.3f} specificity={m_test['specificity']:.3f}")
    print(f"  TEST @ 0.50     : recall={m_test_05['recall']:.3f} "
          f"specificity={m_test_05['specificity']:.3f} "
          f"roc_auc={m_test_05['roc_auc']:.3f}")
    print(f"  Confusion matrix [[TN, FP], [FN, TP]]: {m_test['confusion_matrix']}")
    print(f"  False negatives={m_test['false_negatives']}  "
          f"false positives={m_test['false_positives']}")
    print("  Strengths / weaknesses are written to ML_MODEL_README.md.")
    print("  " + DISCLAIMER)

    # ---- Step 9: save everything -------------------------------------
    EVAL_DIR.mkdir(parents=True, exist_ok=True)
    if not args.skip_backup and ARTIFACT.exists():
        BACKUP_DIR.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
        backup = BACKUP_DIR / f"stroke_pipeline.joblib.bak-{stamp}"
        backup.write_bytes(ARTIFACT.read_bytes())
        print(f"\nPrevious artifact backed up to {backup}")

    pipeline = win["_pipeline"]
    joblib.dump(pipeline, ARTIFACT)

    feature_names = list(pipeline.named_steps["preprocess"].get_feature_names_out())
    importances = None
    clf = pipeline.named_steps["classifier"]
    if hasattr(clf, "feature_importances_"):
        importances = dict(zip(feature_names,
                               [float(v) for v in clf.feature_importances_]))
        kind = "impurity-based feature importance"
    elif hasattr(clf, "coef_"):
        coef = np.asarray(clf.coef_).ravel()
        importances = dict(zip(feature_names, [float(v) for v in coef]))
        kind = "logistic regression coefficient (signed)"
    if importances:
        pd.Series(importances, name="value").sort_values(
            key=lambda s: s.abs(), ascending=False
        ).to_csv(EVAL_DIR / "feature_importance.csv")
        print(f"\nFeature importance saved ({kind}) -> evaluation/feature_importance.csv")
        top = sorted(importances.items(), key=lambda kv: abs(kv[1]), reverse=True)[:8]
        for name, value in top:
            print(f"    {name:<40} {value:+.4f}")
    else:
        (EVAL_DIR / "feature_importance.csv").write_text(
            "note\nNo native feature importance for this estimator.\n")

    # Curves for every model, SVG + raw coordinates (JSON).
    curves_report = {}
    for r in results:
        y_score = r["_proba_test"]
        fpr, tpr, _ = roc_curve(y_test, y_score)
        prec, rec, _ = precision_recall_curve(y_test, y_score)
        ap = float(average_precision_score(y_test, y_score))
        curves_report[r["label"]] = {
            "roc": [[float(a), float(b)] for a, b in zip(fpr, tpr)],
            "pr": [[float(a), float(b)] for a, b in zip(rec, prec)],
            "average_precision": ap,
        }
    write_curve_svg(
        EVAL_DIR / "roc_curve.svg",
        [{"label": f"{r['label']} (AUC={r['test_tuned']['roc_auc']:.3f})",
          "points": curves_report[r["label"]]["roc"],
          "color": color}
         for r, color in zip(sorted(results, key=lambda r: r["test_tuned"]["roc_auc"],
                                    reverse=True)[:4],
                             ["#2563eb", "#dc2626", "#16a34a", "#9333ea"])],
        "ROC curves - held-out test set (top 4 models)", "False positive rate",
        "True positive rate", diagonal=True,
    )
    write_curve_svg(
        EVAL_DIR / "precision_recall_curve.svg",
        [{"label": f"{r['label']} (AP={curves_report[r['label']]['average_precision']:.3f})",
          "points": [[y, x] for x, y in curves_report[r["label"]]["pr"]],
          "color": color}
         for r, color in zip(sorted(results,
                                    key=lambda r: curves_report[r["label"]]["average_precision"],
                                    reverse=True)[:4],
                             ["#2563eb", "#dc2626", "#16a34a", "#9333ea"])],
        "Precision-Recall curves - held-out test set (top 4 models)",
        "Recall", "Precision",
    )
    (EVAL_DIR / "roc_pr_coordinates.json").write_text(json.dumps(curves_report))

    metrics_payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "disclaimer": DISCLAIMER,
        "dataset": dataset_info,
        "data_quality": quality,
        "target_justification": justification,
        "split": {"test_size": TEST_SIZE, "random_state": RANDOM_STATE,
                  "stratified": True, "n_train": int(len(X_train)),
                  "n_test": int(len(X_test)),
                  "cv": f"StratifiedKFold({N_FOLDS}, shuffle=True, "
                        f"random_state={RANDOM_STATE})"},
        "selection_rule": selection_note,
        "selected_model": win["label"],
        "risk_threshold": thr,
        "threshold_rule": (
            "maximised balanced accuracy on TRAINING out-of-fold probabilities; "
            "ties broken by higher sensitivity, then lower threshold"),
        "test_metrics_at_selected_threshold": m_test,
        "test_metrics_at_0.5": m_test_05,
        "all_models": [
            {k: v for k, v in r.items()
             if k in ("label", "model", "imbalance", "oof_threshold",
                      "oof_brier", "test_at_0.5", "test_tuned", "oof_tuned",
                      "cv")}
            for r in results
        ],
        "environment": {
            "python": platform.python_version(),
            "numpy": np.__version__,
            "pandas": pd.__version__,
            "sklearn": __import__("sklearn").__version__,
            "joblib": joblib.__version__,
        },
        "training_seconds": round(time.time() - started, 1),
    }
    METRICS_JSON.write_text(json.dumps(metrics_payload, indent=2, default=str))

    metadata = {
        "model_file": ARTIFACT.name,
        "created_utc": metrics_payload["generated_at"],
        "selected_model": win["label"],
        "model_type": type(clf).__name__,
        "risk_threshold": thr,
        "features": FEATURES,
        "numeric_features": NUMERIC,
        "categorical_features": CATEGORICAL,
        "target": TARGET,
        "target_mapping": {"0": "No Stroke Risk / Low Risk",
                           "1": "Stroke Risk / High Risk"},
        "positive_class_index": 1,
        "probability_semantics":
            "predict_proba[:,1] = P(stroke=1) = high-risk probability",
        "column_rename": COLUMN_RENAME,
        "dataset": {"path": str(dataset_path), "sha256": dataset_info["sha256"],
                    "rows": dataset_info["rows"],
                    "target_counts": dataset_info["target_counts"],
                    "target_percent": dataset_info["target_percent"]},
        "split": metrics_payload["split"],
        "test_metrics": m_test,
        "disclaimer": DISCLAIMER,
    }
    METADATA_JSON.write_text(json.dumps(metadata, indent=2, default=str))

    # Threshold for ml/pipeline.py - printed so the value can be synced.
    print("\n" + "=" * 74)
    print(f"SAVED: {ARTIFACT}")
    print(f"SAVED: {METADATA_JSON}")
    print(f"SAVED: {METRICS_JSON}")
    print(f"SAVED: {EVAL_DIR}/roc_curve.svg, precision_recall_curve.svg, "
          f"roc_pr_coordinates.json, model_comparison.csv, feature_importance.csv")
    print(f"\nACTION REQUIRED: set RISK_THRESHOLD = {thr} in ml/pipeline.py "
          f"(currently a different value).")
    print(f"Training finished in {metrics_payload['training_seconds']}s.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
