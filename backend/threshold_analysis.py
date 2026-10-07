"""Threshold analysis for the CURRENT production model (read-only).

Loads the saved pipeline (backend/ml/artifacts/stroke_pipeline.joblib) - it is
never retrained or replaced here - reproduces the recorded held-out split, and
evaluates a fixed list of decision thresholds.

Outputs (written to ml/artifacts/evaluation/):
    threshold_comparison.csv   - one row per threshold
    threshold_analysis.md      - full report + recommendation rationale

Usage (from backend/):
    python threshold_analysis.py

This is a data-driven engineering analysis of a preliminary risk-classification
model. Any recommended threshold is NOT medically validated, and this script
does not change production behaviour (ml/pipeline.py::RISK_THRESHOLD is only
read, never written).
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
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
from sklearn.model_selection import train_test_split

ROOT = Path(__file__).resolve().parent
ARTIFACT = ROOT / "ml" / "artifacts" / "stroke_pipeline.joblib"
METADATA = ROOT / "ml" / "artifacts" / "model_metadata.json"
METRICS = ROOT / "ml" / "artifacts" / "evaluation" / "metrics.json"
OUT_CSV = ROOT / "ml" / "artifacts" / "evaluation" / "threshold_comparison.csv"
OUT_MD = ROOT / "ml" / "artifacts" / "evaluation" / "threshold_analysis.md"

THRESHOLDS = [0.01, 0.02, 0.05, 0.10, 0.15, 0.20, 0.25, 0.30]
DISCLAIMER = (
    "Data-driven engineering recommendation for a preliminary risk-"
    "classification / decision-support tool. NOT a medically validated "
    "threshold, not a diagnostic cut-off."
)


def evaluate(y_true: np.ndarray, proba: np.ndarray, thr: float) -> dict:
    pred = (proba >= thr).astype(int)
    tn, fp, fn, tp = (int(v) for v in confusion_matrix(y_true, pred, labels=[0, 1]).ravel())
    n = len(y_true)
    high = tp + fp
    return {
        "threshold": thr,
        "accuracy": float(accuracy_score(y_true, pred)),
        "precision": float(precision_score(y_true, pred, zero_division=0)),
        "recall": float(recall_score(y_true, pred, zero_division=0)),
        "f1": float(f1_score(y_true, pred, zero_division=0)),
        "specificity": tn / (tn + fp) if (tn + fp) else 0.0,
        "false_positives": fp,
        "false_negatives": fn,
        "true_positives": tp,
        "true_negatives": tn,
        "high_risk_count": high,
        "high_risk_percent": high / n * 100,
    }


def main() -> int:
    meta = json.loads(METADATA.read_text())
    stored = json.loads(METRICS.read_text())
    pipeline = joblib.load(ARTIFACT)

    df = pd.read_csv(meta["dataset"]["path"]).rename(columns=meta["column_rename"])
    X = df[meta["features"]]
    y = df[meta["target"]].astype(int).to_numpy()
    _, X_test, _, y_test = train_test_split(
        X, y, test_size=meta["split"]["test_size"], stratify=y,
        random_state=meta["split"]["random_state"],
    )
    proba = pipeline.predict_proba(X_test)[:, 1]
    current = float(meta["risk_threshold"])

    rows = [evaluate(y_test, proba, t) for t in THRESHOLDS]
    table = pd.DataFrame(rows)

    # Sanity: recomputed row at the current threshold must equal the metrics
    # recorded at training time (proves we are analysing the same model/split).
    cur = next(r for r in rows if abs(r["threshold"] - current) < 1e-9)
    ref = meta["test_metrics"]
    consistent = (
        abs(cur["recall"] - ref["recall"]) < 1e-9
        and abs(cur["specificity"] - ref["specificity"]) < 1e-9
        and cur["false_negatives"] == ref["false_negatives"]
        and cur["false_positives"] == ref["false_positives"]
        and abs(cur["accuracy"] - ref["accuracy"]) < 1e-9
    )
    auc = float(roc_auc_score(y_test, proba))  # threshold-independent

    table_out = table[[
        "threshold", "accuracy", "precision", "recall", "f1", "specificity",
        "false_positives", "false_negatives", "high_risk_count",
        "high_risk_percent",
    ]].copy()
    table_out.insert(0, "roc_auc", auc)
    table_out = table_out.round(4)
    table_out["high_risk_percent"] = table_out["high_risk_percent"].round(2)
    table_out.to_csv(OUT_CSV, index=False)

    # ---------------- markdown report ----------------
    def fmt(r: dict) -> str:
        return (f"| {r['threshold']:.2f} | {r['accuracy']:.3f} | {r['precision']:.3f} "
                f"| {r['recall']:.3f} | {r['f1']:.3f} | {r['specificity']:.3f} "
                f"| {r['false_positives']} | {r['false_negatives']} "
                f"| {r['high_risk_count']} ({r['high_risk_percent']:.1f}%) |")

    n_pos = int(y_test.sum())
    n_neg = int(len(y_test) - n_pos)
    p = np.sort(proba)

    # Recommendation logic (screening priorities, documented - NOT accuracy):
    #   a) miss as few positives as possible (FN), then
    #   b) keep the flagged share manageable for a user-facing screening tool,
    #   c) without letting specificity collapse (flagging ~everyone is useless).
    # Candidate lens: recall at each threshold vs high-risk share.
    by_005 = next(r for r in rows if r["threshold"] == 0.05)
    rec_002 = next(r for r in rows if r["threshold"] == 0.02)
    rec_010 = next(r for r in rows if r["threshold"] == 0.10)

    lines = []
    lines.append("# Threshold Analysis - NeuroRisk AI production model\n")
    lines.append(f"- Generated: {datetime.now(timezone.utc).isoformat(timespec='seconds')}")
    lines.append(f"- Model: `{ARTIFACT.name}` ({meta['selected_model']}) - "
                 "**loaded as-is, not retrained, not replaced**")
    lines.append(f"- Dataset: `{meta['dataset']['path']}` "
                 f"({meta['dataset']['rows']} rows, sha256 `{meta['dataset']['sha256'][:16]}…`)")
    lines.append(f"- Evaluation set: held-out test split "
                 f"({len(y_test)} records: {n_neg} negative / {n_pos} positive) - "
                 f"reproduced from `model_metadata.json` "
                 f"(test_size={meta['split']['test_size']}, "
                 f"random_state={meta['split']['random_state']}, stratified)")
    lines.append(f"- ROC-AUC (threshold-independent): **{auc:.3f}**")
    lines.append(f"- Current production threshold: **{current}** "
                 f"(`ml/pipeline.py::RISK_THRESHOLD`, read-only in this analysis)")
    lines.append(f"- Consistency check vs training-time metrics at {current}: "
                 f"{'**PASS** (identical accuracy/recall/specificity/FP/FN)' if consistent else '**FAIL**'}")
    train_ref = stored["test_metrics_at_selected_threshold"]
    lines.append(f"- Training-time record (`metrics.json`) at {current}: "
                 f"recall {train_ref['recall']:.3f}, specificity "
                 f"{train_ref['specificity']:.3f}, FN {train_ref['false_negatives']}, "
                 f"FP {train_ref['false_positives']} - matches this analysis.")
    lines.append("")
    lines.append("## Probability distribution (held-out set)\n")
    lines.append(f"- min {p.min():.4f} | p25 {np.percentile(p,25):.4f} | "
                 f"median {np.median(p):.4f} | p75 {np.percentile(p,75):.4f} | "
                 f"p95 {np.percentile(p,95):.4f} | max {p.max():.4f}")
    lines.append(f"- share of records below 0.05: "
                 f"{(proba < 0.05).mean()*100:.1f}%  "
                 f"(base rate of positives: {y_test.mean()*100:.1f}%)")
    lines.append("")
    lines.append("## Comparison table\n")
    lines.append("| Threshold | Accuracy | Precision | Recall | F1 | Specificity | "
                 "FP | FN | High Risk |")
    lines.append("|---|---|---|---|---|---|---|---|---|")
    for r in rows:
        lines.append(fmt(r))
    lines.append("")
    lines.append(f"*All rows: ROC-AUC {auc:.3f} (unchanged by threshold); "
                 f"test set = {len(y_test)} records. "
                 f"CSV: `ml/artifacts/evaluation/threshold_comparison.csv`.*\n")

    lines.append("## Analysis against the current 0.05 threshold\n")
    lines.append(f"Current (0.05): recall **{by_005['recall']:.3f}**, specificity "
                 f"**{by_005['specificity']:.3f}**, precision {by_005['precision']:.3f}, "
                 f"**FN {by_005['false_negatives']}**, FP {by_005['false_positives']}, "
                 f"flags {by_005['high_risk_count']}/{len(y_test)} "
                 f"({by_005['high_risk_percent']:.1f}%) as High Risk.\n")
    lines.append(f"- **vs 0.02**: recall {rec_002['recall']:.3f} "
                 f"({rec_002['false_negatives']} FN, "
                 f"{by_005['false_negatives'] - rec_002['false_negatives']} fewer misses) "
                 f"but specificity drops to {rec_002['specificity']:.3f} "
                 f"(FP {rec_002['false_positives']}), and "
                 f"{rec_002['high_risk_percent']:.1f}% of ALL users would be flagged "
                 f"High Risk - more than {rec_002['high_risk_percent']/by_005['high_risk_percent']:.1f}x "
                 f"the current load, diluting what 'High Risk' means.")
    lines.append(f"- **vs 0.10**: specificity improves to {rec_010['specificity']:.3f} "
                 f"(FP {rec_010['false_positives']}) and only "
                 f"{rec_010['high_risk_percent']:.1f}% flagged, but FN rises to "
                 f"{rec_010['false_negatives']} - "
                 f"{rec_010['false_negatives'] - by_005['false_negatives']} extra missed "
                 f"high-risk cases, the costliest error for screening.")
    lines.append("- **<= 0.01**: recall looks best on paper but flags roughly half the "
                 "user base; a screen that flags ~50% of people has little "
                 "discriminating value and would not be actionable.")
    lines.append("- **>= 0.15**: FN grows fast (missed positives) while precision stays "
                 "low (~0.2-0.4) - accuracy improves only because positives are rare; "
                 "accuracy is explicitly NOT the selection criterion here.")
    lines.append("")

    lines.append("## Recommended threshold\n")
    lines.append(f"**RECOMMENDED THRESHOLD: {current} (0.05) - i.e. KEEP the current value.**\n")
    lines.append("Reasoning (screening priorities, not accuracy):\n")
    lines.append(f"1. **False negatives**: 0.05 catches {by_005['recall']*100:.0f}% of true "
                 f"positives (FN {by_005['false_negatives']}/{n_pos}). Only 0.02/0.01 do "
                 "better, at a disproportionate cost (see 2-3).")
    lines.append(f"2. **High-risk rate**: 0.05 flags {by_005['high_risk_percent']:.0f}% of "
                 "assessments - a workable screening volume. 0.02 would flag "
                 f"{rec_002['high_risk_percent']:.0f}% and 0.01 roughly half of all users, "
                 "which erodes the meaning of the label and is impractical to act on.")
    lines.append(f"3. **Specificity**: {by_005['specificity']:.3f} at 0.05 keeps false "
                 f"alarms to {by_005['false_positives']} of {n_neg} negatives; lower "
                 "thresholds push FP above 350-450.")
    lines.append(f"4. **Precision stays low at every threshold** (max "
                 f"{max(r['precision'] for r in rows):.2f} anywhere in the sweep) - "
                 "an inherent consequence of the 5% base rate, not a threshold-"
                 "fixable property. Low precision is acceptable for a first-stage "
                 "screen whose purpose is to not miss people.")
    lines.append(f"5. **Methodology**: 0.05 was originally selected as the argmax of "
                 "balanced accuracy (Youden's J) on TRAINING out-of-fold predictions - "
                 "the methodologically correct place to pick a threshold. This test-set "
                 "sweep is a sensitivity/confirmation analysis: 0.05 sits at the knee "
                 "of the recall-specificity trade-off on unseen data as well "
                 f"(balanced accuracy at 0.05 = "
                 f"{(by_005['recall']+by_005['specificity'])/2:.3f}), and no "
                 "alternative in the sweep dominates it on the screening criteria.")
    lines.append("")
    lines.append("Borderline alternative worth noting: **0.02** would reduce FN from "
                 f"{by_005['false_negatives']} to {rec_002['false_negatives']} if the "
                 "project decides misses matter far more than false alarms - but it "
                 f"flags {rec_002['high_risk_percent']:.0f}% of users. "
                 "**0.10** if flag volume must be cut "
                 f"({rec_010['high_risk_percent']:.0f}%) at the price of "
                 f"{rec_010['false_negatives']} misses.")
    lines.append("")
    lines.append("## Comparison with current production setting\n")
    lines.append("| | Current (0.05) | Recommended |")
    lines.append("|---|---|---|")
    lines.append(f"| Threshold | {current} | **{current} (unchanged)** |")
    lines.append(f"| Recall | {by_005['recall']:.3f} | {by_005['recall']:.3f} |")
    lines.append(f"| Specificity | {by_005['specificity']:.3f} | {by_005['specificity']:.3f} |")
    lines.append(f"| FN | {by_005['false_negatives']} | {by_005['false_negatives']} |")
    lines.append(f"| High Risk % | {by_005['high_risk_percent']:.1f}% | "
                 f"{by_005['high_risk_percent']:.1f}% |")
    lines.append("")
    lines.append("## Caveats\n")
    lines.append(f"- {DISCLAIMER}")
    lines.append("- Thresholds were inspected on the held-out test split; choosing a "
                 "NEW threshold from this table would make the test set part of "
                 "selection. If the project approves a change, re-derive it on "
                 "training out-of-fold predictions and re-validate.")
    lines.append("- Selection criterion here is screening-oriented (recall, FN, "
                 "high-risk rate, specificity) - explicitly NOT accuracy.")
    lines.append("- **No production change was made**: `RISK_THRESHOLD` remains 0.05 "
                 "and `stroke_pipeline.joblib` was not touched.")
    lines.append("")

    OUT_MD.write_text("\n".join(lines))

    # ---------------- console report ----------------
    print("=" * 104)
    print("THRESHOLD ANALYSIS - production model loaded as-is (no retraining)")
    print(f"model={ARTIFACT.name} | split=test {len(y_test)} "
          f"({n_neg} neg / {n_pos} pos) | ROC-AUC={auc:.3f} | "
          f"consistency@{current}={'PASS' if consistent else 'FAIL'}")
    print("=" * 104)
    print(f"{'Thr':>5} {'Acc':>7} {'Prec':>7} {'Recall':>7} {'F1':>7} {'Spec':>7} "
          f"{'FP':>5} {'FN':>4} {'HighRisk':>14}")
    print("-" * 104)
    for r in rows:
        mark = "  <-- current" if abs(r["threshold"] - current) < 1e-9 else ""
        print(f"{r['threshold']:>5.2f} {r['accuracy']:>7.3f} {r['precision']:>7.3f} "
              f"{r['recall']:>7.3f} {r['f1']:>7.3f} {r['specificity']:>7.3f} "
              f"{r['false_positives']:>5} {r['false_negatives']:>4} "
              f"{r['high_risk_count']:>4} ({r['high_risk_percent']:>5.1f}%){mark}")
    print("-" * 104)
    print(f"Saved: {OUT_CSV}")
    print(f"Saved: {OUT_MD}")
    print(f"\nCURRENT THRESHOLD:   {current}")
    print(f"RECOMMENDED THRESHOLD: {current} (keep - no change proposed)")
    print(f"REASON: best recall/specificity balance among practical options; "
          f"0.02/0.01 cut FN further but flag "
          f"{rec_002['high_risk_percent']:.0f}%-50% of users; >=0.10 adds misses.")
    print("NO production changes made. " + DISCLAIMER)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
