# Threshold Analysis - NeuroRisk AI production model

- Generated: 2026-10-06T14:17:30+00:00
- Model: `stroke_pipeline.joblib` (LogisticRegression + none) - **loaded as-is, not retrained, not replaced**
- Dataset: `/home/monesh/Desktop/brain stroke/archive/full_data.csv` (4981 rows, sha256 `c6580041b7920459…`)
- Evaluation set: held-out test split (997 records: 947 negative / 50 positive) - reproduced from `model_metadata.json` (test_size=0.2, random_state=42, stratified)
- ROC-AUC (threshold-independent): **0.846**
- Current production threshold: **0.05** (`ml/pipeline.py::RISK_THRESHOLD`, read-only in this analysis)
- Consistency check vs training-time metrics at 0.05: **PASS** (identical accuracy/recall/specificity/FP/FN)
- Training-time record (`metrics.json`) at 0.05: recall 0.840, specificity 0.743, FN 8, FP 243 - matches this analysis.

## Probability distribution (held-out set)

- min 0.0014 | p25 0.0046 | median 0.0169 | p75 0.0615 | p95 0.1891 | max 0.4698
- share of records below 0.05: 71.4%  (base rate of positives: 5.0%)

## Comparison table

| Threshold | Accuracy | Precision | Recall | F1 | Specificity | FP | FN | High Risk |
|---|---|---|---|---|---|---|---|---|
| 0.01 | 0.454 | 0.084 | 1.000 | 0.155 | 0.426 | 544 | 0 | 594 (59.6%) |
| 0.02 | 0.578 | 0.101 | 0.940 | 0.183 | 0.559 | 418 | 3 | 465 (46.6%) |
| 0.05 | 0.748 | 0.147 | 0.840 | 0.251 | 0.743 | 243 | 8 | 285 (28.6%) |
| 0.10 | 0.839 | 0.168 | 0.560 | 0.258 | 0.853 | 139 | 22 | 167 (16.8%) |
| 0.15 | 0.900 | 0.202 | 0.340 | 0.254 | 0.929 | 67 | 33 | 84 (8.4%) |
| 0.20 | 0.923 | 0.186 | 0.160 | 0.172 | 0.963 | 35 | 42 | 43 (4.3%) |
| 0.25 | 0.940 | 0.273 | 0.120 | 0.167 | 0.983 | 16 | 44 | 22 (2.2%) |
| 0.30 | 0.944 | 0.250 | 0.060 | 0.097 | 0.990 | 9 | 47 | 12 (1.2%) |

*All rows: ROC-AUC 0.846 (unchanged by threshold); test set = 997 records. CSV: `ml/artifacts/evaluation/threshold_comparison.csv`.*

## Analysis against the current 0.05 threshold

Current (0.05): recall **0.840**, specificity **0.743**, precision 0.147, **FN 8**, FP 243, flags 285/997 (28.6%) as High Risk.

- **vs 0.02**: recall 0.940 (3 FN, 5 fewer misses) but specificity drops to 0.559 (FP 418), and 46.6% of ALL users would be flagged High Risk - more than 1.6x the current load, diluting what 'High Risk' means.
- **vs 0.10**: specificity improves to 0.853 (FP 139) and only 16.8% flagged, but FN rises to 22 - 14 extra missed high-risk cases, the costliest error for screening.
- **<= 0.01**: recall looks best on paper but flags roughly half the user base; a screen that flags ~50% of people has little discriminating value and would not be actionable.
- **>= 0.15**: FN grows fast (missed positives) while precision stays low (~0.2-0.4) - accuracy improves only because positives are rare; accuracy is explicitly NOT the selection criterion here.

## Recommended threshold

**RECOMMENDED THRESHOLD: 0.05 (0.05) - i.e. KEEP the current value.**

Reasoning (screening priorities, not accuracy):

1. **False negatives**: 0.05 catches 84% of true positives (FN 8/50). Only 0.02/0.01 do better, at a disproportionate cost (see 2-3).
2. **High-risk rate**: 0.05 flags 29% of assessments - a workable screening volume. 0.02 would flag 47% and 0.01 roughly half of all users, which erodes the meaning of the label and is impractical to act on.
3. **Specificity**: 0.743 at 0.05 keeps false alarms to 243 of 947 negatives; lower thresholds push FP above 350-450.
4. **Precision stays low at every threshold** (max 0.27 anywhere in the sweep) - an inherent consequence of the 5% base rate, not a threshold-fixable property. Low precision is acceptable for a first-stage screen whose purpose is to not miss people.
5. **Methodology**: 0.05 was originally selected as the argmax of balanced accuracy (Youden's J) on TRAINING out-of-fold predictions - the methodologically correct place to pick a threshold. This test-set sweep is a sensitivity/confirmation analysis: 0.05 sits at the knee of the recall-specificity trade-off on unseen data as well (balanced accuracy at 0.05 = 0.792), and no alternative in the sweep dominates it on the screening criteria.

Borderline alternative worth noting: **0.02** would reduce FN from 8 to 3 if the project decides misses matter far more than false alarms - but it flags 47% of users. **0.10** if flag volume must be cut (17%) at the price of 22 misses.

## Comparison with current production setting

| | Current (0.05) | Recommended |
|---|---|---|
| Threshold | 0.05 | **0.05 (unchanged)** |
| Recall | 0.840 | 0.840 |
| Specificity | 0.743 | 0.743 |
| FN | 8 | 8 |
| High Risk % | 28.6% | 28.6% |

## Caveats

- Data-driven engineering recommendation for a preliminary risk-classification / decision-support tool. NOT a medically validated threshold, not a diagnostic cut-off.
- Thresholds were inspected on the held-out test split; choosing a NEW threshold from this table would make the test set part of selection. If the project approves a change, re-derive it on training out-of-fold predictions and re-validate.
- Selection criterion here is screening-oriented (recall, FN, high-risk rate, specificity) - explicitly NOT accuracy.
- **No production change was made**: `RISK_THRESHOLD` remains 0.05 and `stroke_pipeline.joblib` was not touched.
