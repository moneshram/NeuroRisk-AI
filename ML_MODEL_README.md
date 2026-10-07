# NeuroRisk AI — ML Model Documentation

**Status:** preliminary risk-classification / decision-support model.
**Not** a medical diagnosis, **not** clinically validated, **not** a replacement
for a clinician. See [Limitations](#limitations).

---

## 1. Dataset

| Item | Value |
|---|---|
| File | `~/Desktop/brain stroke/archive/full_data.csv` (read-only; never modified) |
| Selected because | Larger of the two CSVs (4,981 vs 201 rows), zero missing values, real class distribution |
| Not used | `archive/full_filled_stroke_data (1).csv` — 201 rows, every row matches `full_data.csv` on all columns except an imputed `bmi` (15-decimal values) → a derived/imputed subset, redundant for training |
| Rows × columns | **4,981 × 11** (10 features + 1 target) |
| SHA-256 | `c6580041b7920459…` (full hash in `ml/artifacts/model_metadata.json`) |
| Missing values | **0** |
| Duplicate rows | **0** (also 0 duplicate feature-vectors, 0 conflicting labels) |

### Columns
`gender, age, hypertension, heart_disease, ever_married, work_type,
Residence_type, avg_glucose_level, bmi, smoking_status, stroke`

`Residence_type` → renamed to `residence_type` at load time to match the
application schema (`COLUMN_RENAME` in `train_stroke_model.py`).

### Target column: `stroke`
Selected (not assumed): it is the only outcome-like column; all others are
risk factors/demographics recorded before any outcome. It is binary and
complete, and its rates behave as clinically expected:

- stroke rate by hypertension: 0 → **4.0 %**, 1 → **13.8 %**
- stroke rate by heart disease: 0 → **4.3 %**, 1 → **17.1 %**
- stroke rate by age band: 0–18 → 0.2 %, 18–40 → 0.5 %, 40–60 → 4.2 %,
  60–80 → 13.1 %, 80+ → 19.8 %

### Class distribution (imbalance)
| Class | Count | Share |
|---|---|---|
| 0 (no stroke / Low Risk) | 4,733 | **95.02 %** |
| 1 (stroke / High Risk) | 248 | **4.98 %** |

Ratio **19.1 : 1 → severely imbalanced.**

---

## 2. Data quality (documented decisions)

| Check | Result | Decision |
|---|---|---|
| Missing values | 0 | Imputers (median / most-frequent) still kept in the pipeline for robustness |
| Duplicates / conflicting labels | 0 / 0 | Nothing to remove |
| Out-of-range age/BMI/glucose | 0 / 0 / 0 | — |
| IQR outliers | glucose 602 (12.1 %), bmi 43 (0.9 %) | **Kept** — high glucose/BMI are clinically meaningful, not errors |
| `smoking_status = "Unknown"` | 1,500 (30 %) | **Kept as its own category** — a real value in this dataset, not missing |
| Rows removed | **0** | No silent deletion of data |

---

## 3. Preprocessing (leakage-safe)

- **Split first**: stratified 80/20, `random_state=42` → 3,984 train / 997 test.
  Nothing is fitted before the split.
- `ColumnTransformer`:
  - numeric (`age, hypertension, heart_disease, avg_glucose_level, bmi`):
    `SimpleImputer(median)` → `StandardScaler`
  - categorical (`gender, ever_married, work_type, residence_type,
    smoking_status`): `SimpleImputer(most_frequent)` →
    `OneHotEncoder(handle_unknown="ignore")`
- Inside 5-fold CV, the preprocessor is fitted **on each fold's training part
  only**; fold validation and the final test set are only transformed.
- SMOTE / random oversampling (where used) is applied **only to training
  matrices** — the test set is never resampled.
- The risk threshold is selected from **out-of-fold predictions on the
  training set**, so the test set is not used for selection either.
- Everything is bundled in **one sklearn `Pipeline`** (`preprocess` +
  `classifier`) → identical transformation at training and inference time.

---

## 4. Imbalance handling

Four strategies compared (train-only):

1. `none` — plain model
2. `class_weight_balanced` — sklearn `class_weight="balanced"` (or balanced
   `sample_weight` for GradientBoosting, which has no `class_weight`)
3. `random_oversample` — minority duplicated to 1:1 (implemented with numpy)
4. `smote` — minority synthesized to 1:1 via k-NN interpolation (implemented
   with numpy; `imblearn` is not installed in this environment)

**Finding:** oversampling raised recall but destroyed probability
**calibration** (out-of-fold Brier 0.168–0.172 vs 0.043 for the plain model;
probabilities inflated toward an artificial 50/50 prior). Because the app
*displays* the probability to the user, calibration is part of the selection
rule (tie-break), and the calibrated plain model won.

---

## 5. Models tested (19 configurations)

Logistic Regression, Random Forest, Gradient Boosting, SVM (RBF), KNN ×
{none, class_weight_balanced, random_oversample, smote} (KNN has no class
weight → 3 variants), each with 5-fold stratified CV on training data.

Full table: `ml/artifacts/evaluation/model_comparison.csv`.
Top rows (held-out test set, each model at its own training-selected threshold):

| Model + imbalance | Acc | Prec | Recall | F1 | ROC-AUC | Spec | FN | FP | Thr |
|---|---|---|---|---|---|---|---|---|---|
| GradientBoosting + none | 0.726 | 0.144 | 0.900 | 0.248 | 0.852 | 0.717 | 5 | 268 | 0.04 |
| **LogisticRegression + none** | **0.748** | **0.147** | **0.840** | **0.251** | **0.846** | **0.743** | **8** | **243** | **0.05** |
| LogisticRegression + random_oversample | 0.704 | 0.134 | 0.900 | 0.234 | 0.842 | 0.694 | 5 | 290 | 0.41 |
| LogisticRegression + class_weight_balanced | 0.707 | 0.133 | 0.880 | 0.232 | 0.841 | 0.698 | 6 | 286 | 0.41 |
| LogisticRegression + smote | 0.740 | 0.138 | 0.800 | 0.236 | 0.840 | 0.737 | 10 | 249 | 0.48 |
| GradientBoosting + class_weight_balanced | 0.678 | 0.125 | 0.900 | 0.219 | 0.835 | 0.666 | 5 | 316 | 0.26 |
| RandomForest + random_oversample | 0.688 | 0.126 | 0.880 | 0.221 | 0.828 | 0.678 | 6 | 305 | 0.24 |
| SVM-RBF + class_weight_balanced | 0.675 | 0.122 | 0.880 | 0.214 | 0.800 | 0.664 | 6 | 318 | 0.04 |
| RandomForest + none | 0.687 | 0.124 | 0.860 | 0.216 | 0.838 | 0.678 | 7 | 305 | 0.04 |
| KNN + none | 0.652 | 0.098 | 0.720 | 0.172 | 0.714 | 0.648 | 14 | 333 | 0.04 |

At the default 0.5 threshold **every unweighted model detects 0 of 50
positives** — the classic "always LOW RISK" failure this system already
fought once; the tuned threshold exists to prevent it.

**XGBoost / imblearn / matplotlib are not installed** in this environment and
were not added (no new dependencies). GradientBoosting covers the gradient-
boosting requirement; ROC/PR curves are written as pure-Python SVG.

---

## 6. Selection strategy (documented)

1. **Discrimination guard** — only configs whose out-of-fold ROC-AUC is within
   0.02 of the best observed (0.837) are eligible.
2. **Rank by out-of-fold F2** (β=2 weights sensitivity 4× precision — for a
   screening tool a false negative is the costly error), grouped to 3 decimals.
3. **Tie-break: lower out-of-fold Brier** (the probability is shown to users,
   so an uncalibrated model cannot win a tie).
4. Further ties: higher recall, then higher ROC-AUC.

**Winner: `LogisticRegression + none`** (OOF F2 0.409, OOF ROC-AUC 0.837,
OOF Brier 0.0434).

Why not the others:
- **GradientBoosting + none** had the highest single test F2 (0.439) but its
  OOF ROC-AUC (0.812) fell outside the eligibility guard — selecting it would
  mean trusting one lucky test split (test-set selection bias).
- **SMOTE/ROS variants** tie on F2 but are 4× worse calibrated → would show
  users inflated stroke probabilities.
- **RandomForest** (the previous production model) was consistently worse on
  real data (test ROC-AUC 0.81–0.84 with much lower recall at comparable
  specificity).

### Decision threshold — how the risk category is determined

```
probability = predict_proba(frame)[0][1]      # P(stroke = 1)
label       = 1 if probability >= RISK_THRESHOLD else 0
risk_level  = "High Risk" if probability >= RISK_THRESHOLD else "Low Risk"
RISK_THRESHOLD = 0.05
```

- Selected by maximising **balanced accuracy (Youden's J)** over thresholds
  0.01–0.95 on **training out-of-fold** probabilities; ties → higher
  sensitivity → lower threshold.
- Verified as a genuine interior optimum: 0.04 → 0.770, **0.05 → 0.771**,
  0.06 → 0.757 (not a sweep-floor artifact).
- It is a **single binary cut-off**, not an invented 0–30/31–60/61–100 band
  scheme; the app keeps its existing two categories (Low Risk / High Risk).
- Effect: flags ≈ 25–29 % of assessments for follow-up (test: 285/997), the
  price of sensitivity 0.84 for a screening tool.

---

## 7. Final model performance (held-out test set, 997 unseen records)

| Metric | Value |
|---|---|
| Accuracy | 0.748 |
| Precision | 0.147 |
| **Recall / Sensitivity** | **0.840** (42/50 positives found) |
| F1 | 0.251 |
| **ROC-AUC** | **0.846** |
| **Specificity** | **0.743** (704/947 negatives) |
| **False negatives** | **8** |
| False positives | 243 |
| Confusion matrix `[[TN, FP], [FN, TP]]` | `[[704, 243], [8, 42]]` |

Curves: `ml/artifacts/evaluation/roc_curve.svg`,
`precision_recall_curve.svg` (+ raw coordinates in
`roc_pr_coordinates.json`).

### Feature importance (logistic coefficients, signed)

| Feature | Coefficient |
|---|---|
| age | **+1.58** |
| work_type = children | +0.65 |
| work_type = Govt_job | −0.32 |
| work_type = Self-employed | −0.29 |
| avg_glucose_level | **+0.21** |
| smoking_status = never smoked | −0.20 |
| smoking_status = smokes | +0.16 |
| hypertension | **+0.16** |
| ever_married = No | +0.08 |
| bmi | +0.08 |
| smoking_status = formerly smoked | +0.07 |
| heart_disease | +0.05 |

Direction and ranking match clinical expectations (age, glucose, hypertension,
smoking ↑ risk; the `children` coefficient mainly reflects that children have
essentially zero stroke rate in this data).

---

## 8. Files

```
backend/
  train_stroke_model.py          # full training script (inspect → validate →
                                 # split → preprocess → imbalance → CV → compare
                                 # → select → save → report)
  test_model.py                  # standalone validation of the saved artifact
  ml/
    pipeline.py                  # serving: RISK_THRESHOLD + cached model load
    train.py                     # DEPRECATED shim → delegates to the trainer
    artifacts/
      stroke_pipeline.joblib     # production pipeline (preprocess + classifier)
      model_metadata.json        # features, threshold, split, metrics, dataset hash
      evaluation/
        metrics.json             # full metrics for all 19 configurations
        model_comparison.csv     # comparison table
        feature_importance.csv
        roc_curve.svg  precision_recall_curve.svg  roc_pr_coordinates.json
      backup/                    # pre-replacement backups (old RF model, code)
```

### Retrain
```bash
cd backend
python train_stroke_model.py
# or with an explicit dataset:
STROKE_DATASET_PATH=/path/to/full_data.csv python train_stroke_model.py
```
≈ 5 minutes. After a retrain, **sync `RISK_THRESHOLD` in `ml/pipeline.py`**
(the script prints the new value; `load_pipeline()` logs a warning if the two
disagree). The old artifact is auto-backed-up to `ml/artifacts/backup/`.

### Test
```bash
cd backend
python test_model.py             # artifact loads, metrics, probability semantics
python -m pytest tests/ -q       # 4 ML tests + API tests
```

---

## 9. How the Flask API uses the model

```
Frontend Assessment form (10 fields)
   → POST /api/predict  (JWT)
   → schemas.validate_payload()        # type/range/category validation
   → ml.pipeline.predict(payload)      # builds one-row DataFrame in FEATURES order
   → cached pipeline.transform + predict_proba[:, 1]
   → label  = prob >= RISK_THRESHOLD   # app.py imports the same constant
   → saved to `prediction` table, response returns risk_level,
     stroke_probability / no_stroke_probability, recommendations
   → existing Results page, history, dashboard, reports, comparison, admin
```

- The model is **loaded once and cached** in a module global
  (`ml.pipeline._MODEL`); it is **never retrained at request time**.
- `app.py` imports `RISK_THRESHOLD` from `ml.pipeline` (single source of
  truth) — used by predict, dashboard, assessments, comparison, admin metrics,
  serialization, and recommendation text.
- Probability semantics: `predict_proba[:, 1]` = P(stroke=1) = high-risk
  probability; `stroke_probability + no_stroke_probability = 100`.

### Frontend field → dataset feature mapping (1:1, no UI changes needed)

| Frontend field | Backend field | Dataset column | Model feature |
|---|---|---|---|
| Age | `age` | `age` | `age` |
| Gender | `gender` | `gender` | `gender` |
| Hypertension | `hypertension` | `hypertension` | `hypertension` |
| Heart disease | `heart_disease` | `heart_disease` | `heart_disease` |
| Ever married | `ever_married` | `ever_married` | `ever_married` |
| Work type | `work_type` | `work_type` | `work_type` |
| Residence type | `residence_type` | `Residence_type` (renamed) | `residence_type` |
| Average glucose | `avg_glucose_level` | `avg_glucose_level` | `avg_glucose_level` |
| BMI | `bmi` | `bmi` | `bmi` |
| Smoking status | `smoking_status` | `smoking_status` | `smoking_status` |

Notes:
- The form's extra options **`gender = Other`** and **`work_type =
  Never_worked`** are *not* present in this dataset. `handle_unknown="ignore"`
  maps them to all-zero one-hot columns (reference level) — accepted, no crash,
  but their scores are effectively "unseen category" scores.
- No dataset feature is missing from the form, and no form field is missing
  from the dataset → **no UI or API changes were required**.

---

## 10. Limitations

- **Not a medical device.** Preliminary statistical risk classification for
  decision support only — no diagnosis, no clinical validation, no guarantee.
- Only ~5 % of rows are positive (248 events) → recall estimates carry real
  uncertainty (50 positive test cases: 8 misses ⇒ Wilson 95 % CI 0.72–0.92).
- Threshold 0.05 trades precision for sensitivity: ~25 % of users are flagged
  "High Risk" though most will not have a stroke (precision 0.15).
- Dataset provenance/representativeness (population, sampling, time period) is
  not documented in the CSV; results may not transfer to other populations.
- The form's `Other` / `Never_worked` categories were never seen in training.
- No external validation cohort; single 80/20 split plus 5-fold CV.
- `smoking_status = Unknown` (30 %) limits what the model can learn from
  smoking history.

---

## 11. Change log for this retraining (2026-10-06)

- Retrained from the real dataset (was: synthetic demo data).
- Model: RandomForest(400, depth 10) → **LogisticRegression**.
- `RISK_THRESHOLD` **0.25 → 0.05** in `ml/pipeline.py` (re-derived; old value
  was tuned for the demo model — with the new model at 0.25, recall would be
  ~0.12, at 0.5 exactly 0).
- Artifact size 10.4 MB → 5.5 KB.
- Backups of the previous artifact and ML code:
  `ml/artifacts/backup/*-20261006-*` (previous model restored by copying a
  backup over `stroke_pipeline.joblib`).
- `ml/train.py` (synthetic trainer) neutered into a delegating shim so
  `python -m ml.train` can no longer overwrite the production model with a
  model trained on fake data.
- `tests/test_ml_threshold.py` updated to the new threshold/reference cases.
- **No frontend, auth, OTP, dashboard, history, report, comparison, theme or
  admin changes.**
