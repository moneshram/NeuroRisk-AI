"""DEPRECATED shim - the synthetic demo trainer has been replaced.

Historically `python -m ml.train` generated a SYNTHETIC demo dataset
(make_demo_dataset) and wrote it to ml/artifacts/stroke_pipeline.joblib -
the same path the production model uses. After the introduction of the real
dataset (~/Desktop/brain stroke/archive/full_data.csv) that would silently
overwrite the production model with a model trained on fake data.

Training now lives in train_stroke_model.py:

    python train_stroke_model.py

This module is kept only so existing imports (`from ml.train import train`
in tests/test_api.py) keep working; calling train() simply delegates to the
real trainer. The original file is backed up in ml/artifacts/backup/.
"""

from __future__ import annotations


def train():
    """Delegate to the real, dataset-based trainer."""
    import sys
    from pathlib import Path

    backend = Path(__file__).resolve().parent.parent
    if str(backend) not in sys.path:
        sys.path.insert(0, str(backend))
    from train_stroke_model import main

    print(
        "ml.train is deprecated - delegating to train_stroke_model.py.\n"
        "Run: python train_stroke_model.py"
    )
    return main([])


# Kept for backwards compatibility with older imports/attributes.
def make_demo_dataset(*_args, **_kwargs):  # pragma: no cover - removed on purpose
    raise RuntimeError(
        "The synthetic demo generator was removed. The model is now trained "
        "from a real CSV: run `python train_stroke_model.py` "
        "(dataset path via STROKE_DATASET_PATH or --dataset)."
    )


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(train())
