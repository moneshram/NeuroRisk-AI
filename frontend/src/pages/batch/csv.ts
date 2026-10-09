/**
 * Client-side CSV helpers for the Batch Analysis page (no server round trip):
 *  - the upload template (exact 10 feature headers used by the model),
 *  - the downloadable results CSV,
 *  - a small blob download utility.
 */
import { BATCH_FEATURES, type BatchRow } from "../../lib/batchApi";

export const CSV_HEADERS = [
  ...BATCH_FEATURES,
  "stroke_probability",
  "prediction",
  "risk_level",
] as const;

const TEMPLATE_HEADERS = [...BATCH_FEATURES];

/** One plausible sample row so the template can be scored immediately. */
const TEMPLATE_ROW = [
  "67",
  "Male",
  "1",
  "0",
  "Yes",
  "Private",
  "Urban",
  "228.69",
  "36.6",
  "formerly smoked",
];

export const CSV_TEMPLATE = `${TEMPLATE_HEADERS.join(",")}\n${TEMPLATE_ROW.join(",")}\n`;

function escapeCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function buildResultsCsv(rows: BatchRow[]): string {
  const lines = [CSV_HEADERS.join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.age,
        row.gender,
        row.hypertension,
        row.heart_disease,
        row.ever_married,
        row.work_type,
        row.residence_type,
        row.avg_glucose_level,
        row.bmi,
        row.smoking_status,
        row.stroke_probability,
        row.prediction,
        row.risk_level,
      ]
        .map(escapeCell)
        .join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

export function downloadTextFile(filename: string, text: string, mime = "text/csv;charset=utf-8") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  setTimeout(() => {
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }, 1000);
}
