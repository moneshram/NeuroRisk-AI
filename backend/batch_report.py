"""PDF builder for the isolated Batch Prediction feature (new file).

Reuses (imports, never edits) the shared styling helpers from ``report.py``:
``_styles``, ``_header_footer``, ``_risk_color``, ``DISCLAIMER`` and the
brand color constants. ``report.py`` is read-only for this feature.

Contract implemented here (see batch.py for the JSON side):

* ``generate_batch_report(payload)`` -> ``io.BytesIO`` containing an
  ``application/pdf`` document.
* Row cap: the detail table shows the TOP ``REPORT_ROW_CAP`` (50) rows by
  ``stroke_probability`` (descending, stable). Summary, chart aggregates and
  histogram cover the FULL payload. The PDF states the cap explicitly.
* All probabilities/rates are printed on the percent scale used by the JSON
  payload (e.g. 19.51%).
* A medical disclaimer is always included: batch prediction is decision
  support, not a diagnosis.
"""

import io
from datetime import datetime, timezone

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.platypus import HRFlowable, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from report import (
    _header_footer,
    _risk_color,
    _styles,
    BRAND_CYAN,
    BRAND_LIGHT_BG,
    BRAND_NAVY,
    BRAND_SLATE_LIGHT,
    BRAND_WHITE,
    DISCLAIMER,
)

REPORT_ROW_CAP = 50

BATCH_DISCLAIMER = (
    "Batch prediction is a decision-support tool for preliminary screening "
    "only - it is not a diagnosis and not a clinical decision. Every flagged "
    "row must be reviewed by a qualified healthcare professional before any "
    "action is taken. Do not use this report to start, stop, or change "
    "treatment."
)


def _percent(value):
    try:
        return f"{float(value):.2f}%"
    except (TypeError, ValueError):
        return "\u2014"


def _number(value, digits=2):
    try:
        return f"{float(value):.{digits}f}"
    except (TypeError, ValueError):
        return "\u2014"


def _stat_table(styles, cells):
    """Row of headline numbers (label above value), mirroring report.py."""
    data = [
        [Paragraph(label, styles["Small"]) for label, _ in cells],
        [
            Paragraph(f'<font color="#22D3EE"><b>{value}</b></font>', styles["BodyBold"])
            for _, value in cells
        ],
    ]
    width = 170 * mm / len(cells)
    table = Table(data, colWidths=[width] * len(cells))
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), BRAND_LIGHT_BG),
        ("BOX", (0, 0), (-1, -1), 0.5, BRAND_SLATE_LIGHT),
        ("INNERGRID", (0, 0), (-1, -1), 0.3, BRAND_SLATE_LIGHT),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    return table


def _grid_table(styles, header, rows, col_widths):
    data = [[Paragraph(cell, styles["Small"]) for cell in header]]
    for row in rows:
        data.append([Paragraph(str(cell), styles["TableCell"]) for cell in row])
    table = Table(data, colWidths=col_widths, repeatRows=1)
    style = [
        ("BACKGROUND", (0, 0), (-1, 0), BRAND_NAVY),
        ("TEXTCOLOR", (0, 0), (-1, 0), BRAND_WHITE),
        ("BOX", (0, 0), (-1, -1), 0.5, BRAND_SLATE_LIGHT),
        ("INNERGRID", (0, 0), (-1, -1), 0.3, BRAND_SLATE_LIGHT),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
    ]
    for index in range(1, len(data)):
        if index % 2 == 0:
            style.append(("BACKGROUND", (0, index), (-1, index), BRAND_LIGHT_BG))
    table.setStyle(TableStyle(style))
    return table


def _group_section(story, styles, heading, series):
    """One 'risk by X' chart series rendered as a small table."""
    if not series:
        return
    story.append(Paragraph(heading, styles["SectionHead"]))
    rows = [
        [
            entry.get("label", "\u2014"),
            entry.get("total", 0),
            entry.get("high_risk", 0),
            _percent(entry.get("rate", 0)),
        ]
        for entry in series
    ]
    story.append(_grid_table(
        styles,
        ["Group", "Records", "High Risk", "High-Risk Rate"],
        rows,
        [55 * mm, 35 * mm, 35 * mm, 45 * mm],
    ))


def _result_sort_key(row):
    try:
        return float(row.get("stroke_probability"))
    except (TypeError, ValueError):
        return -1.0


def generate_batch_report(payload, source_label=None, row_cap=REPORT_ROW_CAP):
    """Build the batch PDF and return an in-memory BytesIO positioned at 0."""
    summary = payload.get("summary") or {}
    results = [row for row in (payload.get("results") or []) if isinstance(row, dict)]
    chart = payload.get("chart_data") or {}

    total = summary.get("total", len(results))
    high_risk = summary.get("high_risk", 0)
    low_risk = summary.get("low_risk", 0)

    ordered = sorted(results, key=_result_sort_key, reverse=True)
    shown = ordered[:row_cap]

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer, pagesize=A4,
        topMargin=30 * mm, bottomMargin=25 * mm,
        leftMargin=20 * mm, rightMargin=20 * mm,
    )
    styles = _styles()
    story = []

    story.append(Spacer(1, 2 * mm))
    story.append(Paragraph("Batch Prediction Report", styles["BrandSubtitle"]))
    story.append(Spacer(1, 2 * mm))
    story.append(HRFlowable(width="100%", thickness=0.5, color=BRAND_CYAN, spaceAfter=8))

    now_str = datetime.now(timezone.utc).strftime("%B %d, %Y at %I:%M %p UTC")
    source_text = str(source_label) if source_label else "\u2014"
    meta_rows = [
        [Paragraph("Report Generated", styles["TableCell"]),
         Paragraph(now_str, styles["TableCellBold"])],
        [Paragraph("Data Source", styles["TableCell"]),
         Paragraph(source_text, styles["TableCellBold"])],
        [Paragraph("Rows Scored", styles["TableCell"]),
         Paragraph(str(total), styles["TableCellBold"])],
    ]
    meta_t = Table(meta_rows, colWidths=[60 * mm, 105 * mm])
    meta_t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, -1), BRAND_LIGHT_BG),
        ("BOX", (0, 0), (-1, -1), 0.5, BRAND_SLATE_LIGHT),
        ("INNERGRID", (0, 0), (-1, -1), 0.3, BRAND_SLATE_LIGHT),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
    ]))
    story.append(Paragraph("Report Information", styles["SectionHead"]))
    story.append(meta_t)

    story.append(Spacer(1, 4 * mm))
    story.append(Paragraph("Batch Summary", styles["SectionHead"]))
    story.append(_stat_table(styles, [
        ("Total Rows", str(total)),
        ("High Risk", str(high_risk)),
        ("Low Risk", str(low_risk)),
        ("Average Probability", _percent(summary.get("avg_probability", 0))),
        ("Maximum Probability", _percent(summary.get("max_probability", 0))),
    ]))
    story.append(Spacer(1, 2 * mm))
    high_share = (100.0 * high_risk / total) if total else 0.0
    story.append(Paragraph(
        f"<b>{high_risk}</b> of <b>{total}</b> rows ({high_share:.2f}%) were "
        f"classified as <b>High Risk</b>; <b>{low_risk}</b> as <b>Low Risk</b> "
        f"using the screening threshold RISK_THRESHOLD = 0.05 "
        f"(probabilities rounded to the percent scale, e.g. 19.51%).",
        styles["Body"],
    ))

    classification = chart.get("classification") or {}
    histogram = chart.get("probability_histogram") or []
    if classification or histogram:
        story.append(Paragraph("Classification & Probability Distribution", styles["SectionHead"]))
        if histogram:
            rows = [
                [f"{bin_.get('start', 0)}% - {bin_.get('end', 0)}%", bin_.get("count", 0)]
                for bin_ in histogram
            ]
            story.append(_grid_table(
                styles, ["Probability Bin", "Rows"], rows, [95 * mm, 75 * mm],
            ))

    _group_section(story, styles, "Risk by Hypertension", chart.get("risk_by_hypertension"))
    _group_section(story, styles, "Risk by Smoking Status", chart.get("risk_by_smoking"))
    _group_section(story, styles, "Risk by Work Type", chart.get("risk_by_work_type"))

    story.append(Paragraph("Highest-Risk Rows", styles["SectionHead"]))
    if shown:
        story.append(Paragraph(
            f"Showing the top <b>{len(shown)}</b> of <b>{total}</b> rows, "
            f"ranked by stroke probability (descending).",
            styles["Small"],
        ))
        story.append(Spacer(1, 2 * mm))
        rows = []
        for index, row in enumerate(shown, start=1):
            risk_level = str(row.get("risk_level", "\u2014"))
            risk_color = _risk_color(risk_level).hexval()
            rows.append([
                str(index),
                _number(row.get("age"), digits=1),
                str(row.get("gender", "\u2014")),
                _number(row.get("avg_glucose_level")),
                _number(row.get("bmi")),
                str(row.get("smoking_status", "\u2014")),
                _percent(row.get("stroke_probability", 0)),
                Paragraph(
                    f'<font color="{risk_color}"><b>{risk_level}</b></font>',
                    styles["TableCell"],
                ),
            ])
        data = [[Paragraph(cell, styles["Small"]) if isinstance(cell, str) else cell
                 for cell in ["#", "Age", "Gender", "Glucose", "BMI",
                              "Smoking", "Stroke Risk", "Level"]]]
        data.extend(rows)
        table = Table(data, colWidths=[9 * mm, 14 * mm, 20 * mm, 23 * mm,
                                       17 * mm, 35 * mm, 26 * mm, 26 * mm],
                      repeatRows=1)
        style = [
            ("BACKGROUND", (0, 0), (-1, 0), BRAND_NAVY),
            ("TEXTCOLOR", (0, 0), (-1, 0), BRAND_WHITE),
            ("BOX", (0, 0), (-1, -1), 0.5, BRAND_SLATE_LIGHT),
            ("INNERGRID", (0, 0), (-1, -1), 0.3, BRAND_SLATE_LIGHT),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("ALIGN", (0, 0), (-1, -1), "CENTER"),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ("LEFTPADDING", (0, 0), (-1, -1), 3),
            ("RIGHTPADDING", (0, 0), (-1, -1), 3),
        ]
        for index in range(1, len(data)):
            if index % 2 == 0:
                style.append(("BACKGROUND", (0, index), (-1, index), BRAND_LIGHT_BG))
        table.setStyle(TableStyle(style))
        story.append(table)
    else:
        story.append(Paragraph("No rows were supplied in this batch payload.", styles["Body"]))

    story.append(Spacer(1, 6 * mm))
    story.append(HRFlowable(width="100%", thickness=0.3, color=BRAND_SLATE_LIGHT, spaceAfter=4))
    story.append(Paragraph("Medical Disclaimer", styles["SectionHead"]))
    story.append(Paragraph(BATCH_DISCLAIMER, styles["Disclaimer"]))
    story.append(Spacer(1, 2 * mm))
    story.append(Paragraph(DISCLAIMER, styles["Disclaimer"]))

    doc.build(story, onFirstPage=_header_footer, onLaterPages=_header_footer)
    buffer.seek(0)
    return buffer
