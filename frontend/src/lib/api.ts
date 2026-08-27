const API = import.meta.env.VITE_API_URL || "http://127.0.0.1:5000/api";

export type User = {
  id: number;
  name: string;
  email: string;
  role: "user" | "admin";
};
export type PredictionResponse = {
  id?: number;
  prediction: string;
  risk_level: string;
  stroke_probability: number;
  no_stroke_probability: number;
  risk_breakdown: { stroke: number; no_stroke: number };
  recommendations: string[];
};

export type DashboardHistory = {
  id: number;
  prediction: string;
  probability: number;
  risk_level: string;
  created_at: string | null;
};

export type DashboardResponse = {
  user: User & { created_at: string | null };
  prediction_count: number;
  high_risk_count: number;
  latest_prediction: DashboardHistory | null;
  history: DashboardHistory[];
};

export type AssessmentRecord = {
  id: number;
  prediction: string;
  probability: number;
  no_stroke_probability: number;
  risk_level: string;
  created_at: string | null;
  patient: Record<string, unknown>;
};

export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = localStorage.getItem("stroke_token");

  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      ...options,
      headers,
    });
  } catch (e) {
    console.error(`[api] Network error ${options.method || "GET"} ${API}${path}:`, e);
    throw new Error(
      "Unable to reach the server. Please check your connection and try again.",
    );
  }

  const body = await response.json().catch(() => ({}));

  if (response.status === 401) {
    logout();
    window.location.href = "/login";
    throw new Error("Session expired. Please sign in again.");
  }

  if (!response.ok) {
    console.error(`[api] ${response.status} ${options.method || "GET"} ${API}${path}:`, body);
    throw new Error(body.error || `Request failed (${response.status}).`);
  }

  return body;
}

export function saveSession(token: string, user: User) {
  localStorage.setItem("stroke_token", token);
  localStorage.setItem("stroke_user", JSON.stringify(user));
}
export function getUser(): User | null {
  const raw = localStorage.getItem("stroke_user");
  return raw ? JSON.parse(raw) : null;
}
export function logout() {
  localStorage.removeItem("stroke_token");
  localStorage.removeItem("stroke_user");
}

async function downloadBlob(path: string, defaultFilename: string) {
  const token = localStorage.getItem("stroke_token");
  const headers = new Headers();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  let response: Response;
  try {
    response = await fetch(`${API}${path}`, { headers });
  } catch (e) {
    console.error("[downloadBlob] Network error:", e);
    throw new Error(
      "Unable to connect to the report service. Make sure the backend server is running and try again.",
    );
  }

  if (response.status === 401) {
    logout();
    window.location.href = "/login";
    throw new Error("Session expired. Please sign in again.");
  }

  if (response.status === 403) {
    throw new Error("You are not authorized to access this report.");
  }

  if (response.status === 404) {
    throw new Error("This assessment was not found. Please refresh and try again.");
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || "Failed to generate the PDF report. Please try again.");
  }

  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength === 0) {
    throw new Error("The server returned an empty report. Please try again.");
  }
  const disposition = response.headers.get("Content-Disposition") || "";
  const match = disposition.match(/filename="?([^";\n]+)"?/);
  const filename = match ? match[1] : defaultFilename;
  const blob = new Blob([arrayBuffer], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 1000);
}

export async function downloadAssessmentReport(assessmentId: number) {
  await downloadBlob(
    `/user/assessments/${assessmentId}/report`,
    `NeuroRisk_Assessment_${assessmentId}.pdf`,
  );
}

export async function downloadComparisonReport() {
  await downloadBlob(
    "/user/assessments/comparison-report",
    "NeuroRisk_Assessment_Comparison_Report.pdf",
  );
}
