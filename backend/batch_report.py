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
* Every chart shown on the batch dashboard is reproduced at the bottom of the
  report ("Report Graphs"): the low-vs-high risk split donut, the probability
  histogram (with legend), the age-vs-probability scatter, and the three
  high-risk-rate bar charts (hypertension, smoking status, work type).
* All probabilities/rates are printed on the percent scale used by the JSON
  payload (e.g. 19.51%).
* A medical disclaimer is always included: batch prediction is decision
  support, not a diagnosis.
"""

import io
import math
from datetime import datetime, timezone

from reportlab.graphics.shapes import Circle, Drawing, Line, Rect, String, Wedge
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.platypus import HRFlowable, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from ml.pipeline import RISK_THRESHOLD
from report import (
    _header_footer,
    _risk_color,
    _styles,
    BRAND_AMBER,
    BRAND_CYAN,
    BRAND_EMERALD,
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


def _model_display_name() -> str:
    """Human-friendly production model name from the saved training metadata."""
    try:
        import json
        from ml.pipeline import ARTIFACT

        meta = json.loads((ARTIFACT.parent / "model_metadata.json").read_text())
        raw = str(meta.get("model_type") or "")
        friendly = {
            "RandomForestClassifier": "Random Forest",
            "LogisticRegression": "Logistic Regression",
        }.get(raw)
        if friendly:
            return friendly
        cleaned = raw.replace("Classifier", "").replace("Regression", " Regression")
        return cleaned.strip() or "Model"
    except Exception:  # pragma: no cover - metadata is advisory only
        return "Model"


def _legend_inline(drawing, x, y, items, font_size=7.0, swatch=7.0, gap=12.0):
    """Horizontal swatch+label legend. ``items`` = [(color, text), ...] where
    color is a reportlab color or the string ``"dash"`` for a dashed-line
    swatch. Returns the cursor x after the last label."""
    cursor = x
    for index, (color, text) in enumerate(items):
        if color == "dash":
            drawing.add(Line(cursor, y + swatch / 2.0, cursor + swatch, y + swatch / 2.0,
                             strokeColor=BRAND_AMBER, strokeWidth=1.1,
                             strokeDashArray=[2, 1.5]))
        else:
            drawing.add(Rect(cursor, y, swatch, swatch, fillColor=color,
                             strokeColor=BRAND_SLATE_LIGHT, strokeWidth=0.3))
        drawing.add(String(cursor + swatch + 3.5, y + 1.2, text,
                           fontName="Helvetica", fontSize=font_size,
                           fillColor=BRAND_NAVY))
        cursor += swatch + 3.5 + stringWidth(text, "Helvetica", font_size)
        if index < len(items) - 1:
            cursor += gap
    return cursor


def _distribution_graph(chart, model_name):
    """Vector histogram of stroke probabilities, drawn at the report bottom.

    Uses reportlab's own graphics (no image library): bars per 10-point bin,
    amber for bins at/above the production threshold (High Risk), emerald
    below it, plus a dashed threshold marker. Returns None when the payload
    carries no histogram.
    """
    histogram = chart.get("probability_histogram") or []
    if not histogram:
        return None

    width, height = 170 * mm, 76 * mm
    drawing = Drawing(width, height)
    left, bottom = 34.0, 44.0
    plot_w = width - left - 14.0
    plot_h = height - bottom - 58.0
    thr_pct = RISK_THRESHOLD * 100

    amber = _risk_color("High Risk")
    emerald = _risk_color("Low Risk")
    slate = BRAND_SLATE_LIGHT
    navy = BRAND_NAVY

    drawing.add(String(4, height - 13, "Stroke Probability Distribution",
                       fontName="Helvetica-Bold", fontSize=10.5, fillColor=navy))
    drawing.add(String(
        4, height - 25,
        f"Rows per 10-point bin (0\u2013100%) \u00b7 {model_name} \u00b7 "
        f"bins at or above the {thr_pct:g}% threshold are shown in amber.",
        fontName="Helvetica", fontSize=7.5, fillColor=slate))
    # Axis titles: what the numbers on each axis mean
    drawing.add(String(4, height - 42, "Number of rows",
                       fontName="Helvetica-Bold", fontSize=6.5, fillColor=slate))

    counts = [max(0, int(b.get("count") or 0)) for b in histogram]
    y_max = max(max(counts), 1)
    step = max(1, int(math.ceil(y_max / 3)))

    # Horizontal grid + y labels (0, step, 2*step, ... <= y_max scaled)
    ticks = sorted({0, int(math.ceil(y_max / 2)), y_max})
    for tick in ticks:
        y = bottom + (plot_h * tick / y_max)
        drawing.add(Line(left, y, left + plot_w, y,
                         strokeColor=slate, strokeWidth=0.3))
        drawing.add(String(left - 5, y - 2.5, str(tick), fontName="Helvetica",
                           fontSize=6.5, fillColor=slate, textAnchor="end"))
    _ = step

    # Axes
    drawing.add(Line(left, bottom, left, bottom + plot_h, strokeColor=navy, strokeWidth=0.8))
    drawing.add(Line(left, bottom, left + plot_w, bottom, strokeColor=navy, strokeWidth=0.8))

    n = len(histogram)
    slot = plot_w / n
    bar_w = slot * 0.64
    for index, bin_ in enumerate(histogram):
        count = counts[index]
        x = left + slot * index + (slot - bar_w) / 2.0
        bar_h = plot_h * count / y_max
        start = bin_.get("start", index * 10)
        above = float(start) >= thr_pct
        drawing.add(Rect(x, bottom, bar_w, max(bar_h, 0.6),
                         fillColor=amber if above else emerald, strokeColor=None))
        if count:
            drawing.add(String(x + bar_w / 2.0, bottom + bar_h + 3.5, str(count),
                               fontName="Helvetica", fontSize=6.5, fillColor=navy,
                               textAnchor="middle"))
        label = f"{start}\u2013{bin_.get('end', start + 10)}"
        drawing.add(String(x + bar_w / 2.0, bottom - 11, label,
                           fontName="Helvetica", fontSize=6.2, fillColor=slate,
                           textAnchor="middle"))

    # X-axis title: what the 0-10 / 10-20 numbers represent
    drawing.add(String(
        left + plot_w / 2.0, bottom - 24,
        "Predicted stroke probability bin (%) \u2014 e.g. 10\u201320 = 10% to 20%",
        fontName="Helvetica", fontSize=6.5, fillColor=slate,
        textAnchor="middle"))

    # Dashed threshold marker
    tx = left + plot_w * RISK_THRESHOLD
    marker = Line(tx, bottom, tx, bottom + plot_h + 5)
    marker.strokeColor = amber
    marker.strokeWidth = 1.1
    marker.strokeDashArray = [3, 2]
    drawing.add(marker)
    drawing.add(String(tx + 3, bottom + plot_h + 6, f"{thr_pct:g}% threshold",
                       fontName="Helvetica-Bold", fontSize=6.5, fillColor=amber))

    # Legend: what the bar colors and marker represent
    _legend_inline(drawing, 4.0, 4.0, [
        (emerald, f"Low-risk bins (below {thr_pct:g}%)"),
        (amber, f"High-risk bins ({thr_pct:g}% and above)"),
        ("dash", f"{thr_pct:g}% decision threshold"),
    ], font_size=7.0)
    return drawing


def _classification_donut(classification, model_name, thr_pct):
    """Donut of the low vs high risk split (dashboard card "Low vs high risk
    split"), with an explicit legend of counts and shares."""
    low = int((classification or {}).get("low") or 0)
    high = int((classification or {}).get("high") or 0)
    total = low + high
    if total <= 0:
        return None

    width, height = 170 * mm, 66 * mm
    drawing = Drawing(width, height)
    drawing.add(String(4, height - 13, "Low vs High Risk Split",
                       fontName="Helvetica-Bold", fontSize=10.5, fillColor=BRAND_NAVY))
    drawing.add(String(
        4, height - 25,
        f"Share of rows in each predicted risk class for this batch \u00b7 "
        f"{model_name} \u00b7 High Risk = probability \u2265 {thr_pct:g}%.",
        fontName="Helvetica", fontSize=7.5, fillColor=BRAND_SLATE_LIGHT))

    cx, cy, r_out, r_in = 58.0, (height - 34.0) / 2.0 + 2.0, 42.0, 24.0
    e_low = 360.0 * low / total
    e_high = 360.0 * high / total
    if e_low > 0:
        drawing.add(Wedge(cx, cy, r_out, 90.0, e_low, fillColor=BRAND_EMERALD,
                          strokeColor=BRAND_WHITE, strokeWidth=1.0))
    if e_high > 0:
        drawing.add(Wedge(cx, cy, r_out, 90.0 + e_low, e_high,
                          fillColor=BRAND_AMBER, strokeColor=BRAND_WHITE,
                          strokeWidth=1.0))
    drawing.add(Circle(cx, cy, r_in, fillColor=BRAND_WHITE, strokeColor=None))
    drawing.add(String(cx, cy + 2.0, str(total), fontName="Helvetica-Bold",
                       fontSize=15, fillColor=BRAND_NAVY, textAnchor="middle"))
    drawing.add(String(cx, cy - 10.0, "rows", fontName="Helvetica", fontSize=7,
                       fillColor=BRAND_SLATE_LIGHT, textAnchor="middle"))

    lx, ly = cx + r_out + 24.0, cy + 24.0
    drawing.add(String(lx, ly + 14.0, "LEGEND", fontName="Helvetica-Bold",
                       fontSize=6.5, fillColor=BRAND_SLATE_LIGHT))
    items = [
        (BRAND_EMERALD, f"Low risk: {low} rows ({100.0 * low / total:.2f}%)"),
        (BRAND_AMBER, f"High risk: {high} rows ({100.0 * high / total:.2f}%)"),
    ]
    for offset, (color, text) in enumerate(items):
        y = ly - offset * 16.0
        drawing.add(Rect(lx, y, 8.0, 8.0, fillColor=color,
                         strokeColor=BRAND_SLATE_LIGHT, strokeWidth=0.3))
        drawing.add(String(lx + 12.0, y + 1.5, text, fontName="Helvetica",
                           fontSize=8, fillColor=BRAND_NAVY))
    return drawing


def _age_probability_scatter(series, model_name, thr_pct):
    """Age vs predicted probability scatter (dashboard card), colored by risk."""
    points = [p for p in (series or []) if isinstance(p, dict)]
    if not points:
        return None

    width, height = 170 * mm, 66 * mm
    drawing = Drawing(width, height)
    drawing.add(String(4, height - 13, "Age vs Predicted Probability",
                       fontName="Helvetica-Bold", fontSize=10.5, fillColor=BRAND_NAVY))
    drawing.add(String(
        4, height - 25,
        f"One dot per scored row, colored by risk class \u00b7 {model_name} \u00b7 "
        f"High Risk \u2265 {thr_pct:g}%.",
        fontName="Helvetica", fontSize=7.5, fillColor=BRAND_SLATE_LIGHT))

    ages, probs = [], []
    for point in points:
        try:
            ages.append(float(point.get("age")))
            probs.append(float(point.get("probability")))
        except (TypeError, ValueError):
            continue
    if not ages:
        return None

    left, bottom = 44.0, 34.0
    plot_w = width - left - 16.0
    plot_h = height - bottom - 46.0
    plot_top = bottom + plot_h
    # Y-axis title: what the vertical percentages mean
    drawing.add(String(4, plot_top + 6, "Predicted stroke probability (%)",
                       fontName="Helvetica-Bold", fontSize=6.5,
                       fillColor=BRAND_SLATE_LIGHT))
    age_min, age_max = min(ages), max(ages)
    if age_max <= age_min:
        age_max = age_min + 1.0
    y_top = max(10.0, math.ceil(max(max(probs), thr_pct) / 10.0) * 10.0)

    for tick in sorted({0.0, y_top / 2.0, y_top}):
        y = bottom + plot_h * tick / y_top
        drawing.add(Line(left, y, left + plot_w, y,
                         strokeColor=BRAND_SLATE_LIGHT, strokeWidth=0.3))
        drawing.add(String(left - 5, y - 2.5, f"{tick:g}%",
                           fontName="Helvetica", fontSize=6.5,
                           fillColor=BRAND_SLATE_LIGHT, textAnchor="end"))

    if thr_pct < y_top:
        ty = bottom + plot_h * thr_pct / y_top
        marker = Line(left, ty, left + plot_w, ty)
        marker.strokeColor = BRAND_AMBER
        marker.strokeWidth = 1.0
        marker.strokeDashArray = [3, 2]
        drawing.add(marker)
        drawing.add(String(left + plot_w - 2, ty + 3, f"{thr_pct:g}% threshold",
                           fontName="Helvetica-Bold", fontSize=6,
                           fillColor=BRAND_AMBER, textAnchor="end"))

    drawing.add(Line(left, bottom, left, bottom + plot_h,
                     strokeColor=BRAND_NAVY, strokeWidth=0.8))
    drawing.add(Line(left, bottom, left + plot_w, bottom,
                     strokeColor=BRAND_NAVY, strokeWidth=0.8))

    for tick in sorted({age_min, (age_min + age_max) / 2.0, age_max}):
        x = left + plot_w * (tick - age_min) / (age_max - age_min)
        drawing.add(Line(x, bottom, x, bottom - 3,
                         strokeColor=BRAND_SLATE_LIGHT, strokeWidth=0.5))
        drawing.add(String(x, bottom - 11, f"{tick:g}", fontName="Helvetica",
                           fontSize=6.5, fillColor=BRAND_SLATE_LIGHT,
                           textAnchor="middle"))
    drawing.add(String(left + plot_w / 2.0, bottom - 22, "Age (years)",
                       fontName="Helvetica", fontSize=6.5,
                       fillColor=BRAND_SLATE_LIGHT, textAnchor="middle"))

    for point in points:
        try:
            age = float(point.get("age"))
            prob = float(point.get("probability"))
        except (TypeError, ValueError):
            continue
        x = left + plot_w * (age - age_min) / (age_max - age_min)
        y = bottom + plot_h * prob / y_top
        drawing.add(Circle(x, y, 1.7,
                           fillColor=_risk_color(str(point.get("risk_level", ""))),
                           strokeColor=None))

    _legend_inline(drawing, left + plot_w - 118.0, bottom + plot_h + 7.0, [
        (BRAND_EMERALD, "Low risk"),
        (BRAND_AMBER, "High risk"),
    ], font_size=6.5)
    return drawing


def _group_rate_chart(series, heading, model_name, thr_pct, label_map=None,
                      x_title=None):
    """Horizontal bar chart of the high-risk rate per group (dashboard cards
    "Risk by hypertension / smoking status / work type")."""
    if not series:
        return None
    label_map = label_map or {}

    width = 170 * mm
    row_h = 9.0 * mm
    base_y, top_pad = 30.0, 46.0
    height = top_pad + len(series) * row_h + base_y
    drawing = Drawing(width, height)
    drawing.add(String(4, height - 13, heading,
                       fontName="Helvetica-Bold", fontSize=10.5,
                       fillColor=BRAND_NAVY))
    drawing.add(String(
        4, height - 25,
        f"High-risk rate per group (% of rows at or above the {thr_pct:g}% "
        f"threshold) \u00b7 {model_name}.",
        fontName="Helvetica", fontSize=7.5, fillColor=BRAND_SLATE_LIGHT))
    # Axis titles: what the numbers/categories on each axis mean
    drawing.add(String(4, height - top_pad + 5, "High-risk rate (%)",
                       fontName="Helvetica-Bold", fontSize=6.5,
                       fillColor=BRAND_SLATE_LIGHT))

    left, right = 132.0, 68.0
    plot_w = width - left - right
    plot_top = height - top_pad

    for pct in (0, 25, 50, 75, 100):
        x = left + plot_w * pct / 100.0
        drawing.add(Line(x, base_y, x, plot_top,
                         strokeColor=BRAND_SLATE_LIGHT, strokeWidth=0.3))
        drawing.add(String(x, base_y - 10, f"{pct}%", fontName="Helvetica",
                           fontSize=6.5, fillColor=BRAND_SLATE_LIGHT,
                           textAnchor="middle"))
    drawing.add(Line(left, base_y, left, plot_top,
                     strokeColor=BRAND_NAVY, strokeWidth=0.8))
    if x_title:
        drawing.add(String(left + plot_w / 2.0, base_y - 24, x_title,
                           fontName="Helvetica-Bold", fontSize=6.5,
                           fillColor=BRAND_SLATE_LIGHT, textAnchor="middle"))

    slot = (plot_top - base_y) / len(series)
    bar_h = slot * 0.5
    for index, entry in enumerate(series):
        label = label_map.get(str(entry.get("label", "")),
                              str(entry.get("label", "\u2014")))
        try:
            rate = min(max(float(entry.get("rate") or 0.0), 0.0), 100.0)
        except (TypeError, ValueError):
            rate = 0.0
        count = int(entry.get("total") or 0)
        high = int(entry.get("high_risk") or 0)
        y_mid = plot_top - slot * (index + 0.5)
        drawing.add(String(left - 6, y_mid - 2.4, label,
                           fontName="Helvetica", fontSize=7,
                           fillColor=BRAND_NAVY, textAnchor="end"))
        bar_w = plot_w * rate / 100.0
        drawing.add(Rect(left, y_mid - bar_h / 2.0, max(bar_w, 0.6), bar_h,
                         fillColor=BRAND_CYAN, strokeColor=None))
        drawing.add(String(left + bar_w + 4, y_mid - 2.4,
                           f"{rate:.1f}%  ({high}/{count} rows)",
                           fontName="Helvetica", fontSize=6.5,
                           fillColor=BRAND_NAVY))
    return drawing


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
    model_name = _model_display_name()
    thr_pct = RISK_THRESHOLD * 100
    meta_rows = [
        [Paragraph("Report Generated", styles["TableCell"]),
         Paragraph(now_str, styles["TableCellBold"])],
        [Paragraph("Data Source", styles["TableCell"]),
         Paragraph(source_text, styles["TableCellBold"])],
        [Paragraph("Model", styles["TableCell"]),
         Paragraph(model_name, styles["TableCellBold"])],
        [Paragraph("Decision Threshold", styles["TableCell"]),
         Paragraph(f"High Risk if \u2265 {thr_pct:g}% (RISK_THRESHOLD = {RISK_THRESHOLD:g})",
                   styles["TableCellBold"])],
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
        f"using the screening threshold RISK_THRESHOLD = {RISK_THRESHOLD:g} "
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

    # ---- Graphs attached at the bottom of every report -----------------
    # Reproduces every chart from the batch dashboard: risk-split donut,
    # probability histogram (with legend), age-vs-probability scatter and the
    # three high-risk-rate bar charts. Each drawing carries its own title,
    # subtitle and legend; captions below explain how to read it.
    story.append(Spacer(1, 5 * mm))
    story.append(Paragraph("Report Graphs", styles["SectionHead"]))
    story.append(Paragraph(
        f"All charts shown on the batch dashboard, reproduced for this report "
        f"(&#8226; model {model_name} &#8226; High Risk \u2265 {thr_pct:g}% "
        f"&#8226; every graph includes a legend).",
        styles["Small"],
    ))

    donut = _classification_donut(chart.get("classification"), model_name, thr_pct)
    if donut is not None:
        story.append(Spacer(1, 2 * mm))
        story.append(donut)
        story.append(Spacer(1, 1 * mm))
        story.append(Paragraph(
            f"<b>Low vs high risk split</b> &#8212; the ring divides all "
            f"<b>{total}</b> scored rows by predicted class: emerald = Low risk, "
            f"amber = High risk (probability \u2265 {thr_pct:g}%); the legend "
            f"shows each class's row count and share of the batch.",
            styles["Small"],
        ))

    graph = _distribution_graph(chart, model_name)
    if graph is not None:
        story.append(Spacer(1, 4 * mm))
        story.append(Paragraph("Risk Distribution Graph", styles["SectionHead"]))
        story.append(graph)
        story.append(Spacer(1, 1 * mm))
        story.append(Paragraph(
            f"<b>Probability histogram</b> &#8212; how to read: each bar counts "
            f"the rows whose predicted stroke probability falls in that "
            f"10-point bin, across all <b>{total}</b> scored rows. Legend under "
            f"the axis: emerald bar = bin below the {thr_pct:g}% threshold "
            f"(Low Risk territory), amber bar = bin at or above it (High Risk "
            f"territory), dashed amber line = the {thr_pct:g}% decision "
            f"threshold under the {model_name} model.",
            styles["Small"],
        ))

    scatter = _age_probability_scatter(
        chart.get("age_vs_probability"), model_name, thr_pct)
    if scatter is not None:
        story.append(Spacer(1, 4 * mm))
        story.append(scatter)
        story.append(Spacer(1, 1 * mm))
        story.append(Paragraph(
            f"<b>Age vs predicted probability</b> &#8212; how to read: one dot "
            f"per scored row; horizontal axis = patient age, vertical axis = "
            f"predicted stroke probability. Dot color = final risk class "
            f"(emerald = Low risk, amber = High risk); the dashed line marks "
            f"the {thr_pct:g}% threshold.",
            styles["Small"],
        ))

    group_charts = (
        ("Risk by Hypertension", chart.get("risk_by_hypertension"),
         {"0": "No", "1": "Yes"}, "Hypertension status (No / Yes)"),
        ("Risk by Smoking Status", chart.get("risk_by_smoking"), None,
         "Smoking status category"),
        ("Risk by Work Type", chart.get("risk_by_work_type"), None,
         "Work type (occupation)"),
    )
    for heading, series, label_map, x_title in group_charts:
        rate_chart = _group_rate_chart(series, heading, model_name, thr_pct,
                                       label_map=label_map, x_title=x_title)
        if rate_chart is None:
            continue
        story.append(Spacer(1, 4 * mm))
        story.append(rate_chart)
        story.append(Spacer(1, 1 * mm))
        story.append(Paragraph(
            f"<b>{heading}</b> &#8212; how to read: each cyan bar is the share "
            f"of rows in that group classified High Risk (rows \u2265 "
            f"{thr_pct:g}% probability); the value after each bar shows the "
            f"rate and the exact count as (high-risk / total) rows.",
            styles["Small"],
        ))

    story.append(Spacer(1, 6 * mm))
    story.append(HRFlowable(width="100%", thickness=0.3, color=BRAND_SLATE_LIGHT, spaceAfter=4))
    story.append(Paragraph("Medical Disclaimer", styles["SectionHead"]))
    story.append(Paragraph(BATCH_DISCLAIMER, styles["Disclaimer"]))
    story.append(Spacer(1, 2 * mm))
    story.append(Paragraph(DISCLAIMER, styles["Disclaimer"]))

    doc.build(story, onFirstPage=_header_footer, onLaterPages=_header_footer)
    buffer.seek(0)
    return buffer
