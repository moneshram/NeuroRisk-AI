/**
 * API helpers for the admin-only Batch Analysis endpoints.
 *
 * The base-URL derivation, the `stroke_token` Bearer header, the 401 handling
 * and the blob-download flow are intentionally mirrored from `src/lib/api.ts`
 * (which is read-only for this feature — nothing in it is edited).
 *
 *   POST {base}/predict/batch         FormData("file"=CSV) | JSON {source}
 *   POST {base}/predict/batch/report  JSON batch payload    -> application/pdf
 */
import { logout } from "./api";

const API = import.meta.env.VITE_API_URL || "http://127.0.0.1:5000/api";

/** Same guard the backend enforces (10 MB CSV uploads). */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export type BatchSource = "full" | "filled";

export type BatchSummary = {
  total: number;
  high_risk: number;
  low_risk: number;
  avg_probability: number;
  max_probability: number;
};

export type HistogramBin = { start: number; end: number; count: number };

export type AgePoint = { age: number; probability: number; risk_level: string };

export type RiskGroup = { label: string; total: number; high_risk: number; rate: number };

export type BatchChartData = {
  classification: { low: number; high: number };
  probability_histogram: HistogramBin[];
  age_vs_probability: AgePoint[];
  risk_by_hypertension: RiskGroup[];
  risk_by_smoking: RiskGroup[];
  risk_by_work_type: RiskGroup[];
};

export type BatchRow = {
  age: number;
  gender: string;
  hypertension: number;
  heart_disease: number;
  ever_married: string;
  work_type: string;
  residence_type: string;
  avg_glucose_level: number;
  bmi: number;
  smoking_status: string;
  stroke_probability: number;
  prediction: number;
  risk_level: string;
};

export type BatchResponse = {
  summary: BatchSummary;
  chart_data: BatchChartData;
  results: BatchRow[];
};

/** The 10 model features, in the order the backend expects them. */
export const BATCH_FEATURES = [
  "age",
  "gender",
  "hypertension",
  "heart_disease",
  "ever_married",
  "work_type",
  "residence_type",
  "avg_glucose_level",
  "bmi",
  "smoking_status",
] as const;

function authHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  const token = localStorage.getItem("stroke_token");
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return headers;
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      ...init,
      headers: authHeaders(init.headers),
    });
  } catch (e) {
    console.error(`[batchApi] Network error ${init.method || "GET"} ${API}${path}:`, e);
    throw new Error(
      "Unable to reach the server. Please check your connection and try again.",
    );
  }

  if (response.status === 401) {
    logout();
    window.location.href = "/login";
    throw new Error("Session expired. Please sign in again.");
  }

  return response;
}

async function errorFrom(response: Response): Promise<Error> {
  const body = await response.json().catch(() => ({}));
  console.error(`[batchApi] ${response.status}`, body);
  if (response.status === 403) {
    return new Error("You are not authorized to run batch analysis.");
  }
  const message = (body as { error?: string }).error;
  return new Error(message || `Request failed (${response.status}).`);
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw await errorFrom(response);
  return (await response.json()) as T;
}

/** POST a CSV to /predict/batch using a multipart FormData `file` field. */
export function runBatchFromFile(file: File): Promise<BatchResponse> {
  const form = new FormData();
  form.append("file", file);
  return request("/predict/batch", { method: "POST", body: form }).then(
    async (response) => {
      if (!response.ok) throw await errorFrom(response);
      return (await response.json()) as BatchResponse;
    },
  );
}

/** POST a bundled dataset reference to /predict/batch ({source: full|filled}). */
export function runBatchFromSource(source: BatchSource): Promise<BatchResponse> {
  return postJson<BatchResponse>("/predict/batch", { source });
}

/**
 * POST the computed batch payload to /predict/batch/report and trigger the
 * resulting PDF download (mirrors the blob flow in src/lib/api.ts).
 */
export async function downloadBatchReport(payload: BatchResponse): Promise<void> {
  const response = await request("/predict/batch/report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) throw await errorFrom(response);

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength === 0) {
    throw new Error("The server returned an empty report. Please try again.");
  }

  const disposition = response.headers.get("Content-Disposition") || "";
  const match = disposition.match(/filename="?([^";\n]+)"?/);
  const filename = match ? match[1] : "NeuroRisk_Batch_Report.pdf";

  const blob = new Blob([buffer], { type: "application/pdf" });
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
