import { motion } from "framer-motion";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Clock,
  Download,
  FileText,
  History,
  Loader2,
  TrendingDown,
  TrendingUp,
  Minus,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { api, AssessmentRecord, downloadAssessmentReport, downloadComparisonReport } from "../lib/api";
import { Layout } from "../components/Layout";
import { Screen } from "../components/Screen";

export default function AssessmentHistory() {
  const navigate = useNavigate();
  const [records, setRecords] = useState<AssessmentRecord[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [downloadingComparison, setDownloadingComparison] = useState(false);

  async function load() {
    try {
      setBusy(true);
      setError(null);
      setRecords(await api<AssessmentRecord[]>("/user/assessments"));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unable to load assessments.";
      console.error("[AssessmentHistory] Load failed:", msg);
      setError(msg || "Unable to load assessments. Make sure the backend server is running and try again.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const summary = useMemo(() => {
    if (!records.length) return null;
    const probs = records.map((r) => r.probability);
    const lowest = Math.min(...probs);
    const highest = Math.max(...probs);
    const average = probs.reduce((s, p) => s + p, 0) / probs.length;
    let trend: "up" | "down" | "same" | null = null;
    let trendDelta = 0;
    if (records.length >= 2) {
      const latest = records[0].probability;
      const previous = records[1].probability;
      trendDelta = latest - previous;
      if (Math.abs(trendDelta) < 0.01) trend = "same";
      else if (trendDelta > 0) trend = "up";
      else trend = "down";
    }
    return { lowest, highest, average, total: records.length, trend, trendDelta };
  }, [records]);

  function viewResult(record: AssessmentRecord) {
    sessionStorage.setItem("stroke_result", JSON.stringify({
      id: record.id,
      prediction: record.prediction,
      risk_level: record.risk_level,
      stroke_probability: record.probability,
      no_stroke_probability: record.no_stroke_probability,
      risk_breakdown: { stroke: record.probability, no_stroke: record.no_stroke_probability },
      recommendations: [],
    }));
    navigate("/results");
  }

  async function handleDownload(assessmentId: number) {
    try {
      setDownloadingId(assessmentId);
      await downloadAssessmentReport(assessmentId);
      toast.success("Report downloaded successfully.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to download report.";
      toast.error(msg);
    } finally {
      setDownloadingId(null);
    }
  }

  async function handleComparisonDownload() {
    try {
      setDownloadingComparison(true);
      await downloadComparisonReport();
      toast.success("Comparison report downloaded.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to download comparison report.";
      toast.error(msg);
    } finally {
      setDownloadingComparison(false);
    }
  }

  return (
    <Screen>
      <Layout>
        <motion.div
          initial={{ opacity: 0, y: -14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45 }}
          className="mb-7"
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.3em] text-cyan-300">
                <History size={14} />
                Assessment History
              </div>
              <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl lg:text-4xl">
                All assessments
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
                Review and compare your previous stroke-risk assessments.
              </p>
            </div>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => navigate("/")}
              className="primary-btn w-full px-4 py-2.5 text-sm sm:w-fit"
            >
              New assessment <ArrowRight size={16} />
            </motion.button>
          </div>
        </motion.div>

        {busy && (
          <div className="flex items-center justify-center gap-3 py-24 text-sm text-slate-400">
            <Loader2 size={20} className="animate-spin text-cyan-300" />
            Loading your assessments...
          </div>
        )}

        {!busy && error && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass mx-auto max-w-lg rounded-[2rem] p-6 text-center sm:p-8"
          >
            <p className="text-sm text-slate-400">{error}</p>
            <button
              onClick={load}
              className="ghost-btn mt-5 w-full px-5 py-2.5 text-sm sm:w-auto"
            >
              Try Again
            </button>
          </motion.div>
        )}

        {!busy && !error && records.length === 0 && (
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass mx-auto max-w-lg rounded-[2rem] p-8 text-center"
          >
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-cyan-400/10 text-cyan-300">
              <History size={26} />
            </div>
            <h2 className="mt-5 text-xl font-bold">No assessments yet</h2>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              You haven't completed a stroke-risk assessment.
            </p>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => navigate("/")}
              className="primary-btn mt-7 w-full"
            >
              Start New Assessment <ArrowRight size={16} />
            </motion.button>
          </motion.div>
        )}

        {!busy && !error && records.length > 0 && (
          <>
            {summary && summary.trend !== null && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.05 }}
                className="mb-5 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4"
              >
                {summary.trend === "up" ? (
                  <TrendingUp size={18} className="shrink-0 text-amber-300" />
                ) : summary.trend === "down" ? (
                  <TrendingDown size={18} className="shrink-0 text-emerald-300" />
                ) : (
                  <Minus size={18} className="shrink-0 text-slate-400" />
                )}
                <span className="text-sm">
                  <span
                    className={
                      summary.trend === "up"
                        ? "font-semibold text-amber-300"
                        : summary.trend === "down"
                          ? "font-semibold text-emerald-300"
                          : "font-semibold text-slate-300"
                    }
                  >
                    {summary.trend === "up"
                      ? `↑ ${Math.abs(summary.trendDelta).toFixed(2)}%`
                      : summary.trend === "down"
                        ? `↓ ${Math.abs(summary.trendDelta).toFixed(2)}%`
                        : "~ same"}
                  </span>
                  <span className="ml-1 text-slate-400">
                    Risk {summary.trend === "up" ? "increased" : summary.trend === "down" ? "decreased" : " stayed about the same"} compared with your previous assessment
                  </span>
                </span>
              </motion.div>
            )}

            <div className="grid gap-5 lg:grid-cols-[1.1fr_.9fr]">
              <div className="space-y-4">
                {records.map((record, index) => (
                  <motion.div
                    key={record.id}
                    initial={{ opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.04, duration: 0.35 }}
                    whileHover={{ y: -2 }}
                    className="group glass rounded-[1.75rem] p-5 sm:p-6 transition-all duration-300 hover:border-cyan-300/20 hover:shadow-[0_0_30px_rgba(34,211,238,0.06)]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2 text-xs text-slate-500">
                          <Clock size={13} />
                          {record.created_at
                            ? new Date(record.created_at).toLocaleString(undefined, {
                                year: "numeric",
                                month: "short",
                                day: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              })
                            : "—"}
                        </div>
                        <div className="mt-1 text-xs text-slate-600">
                          Assessment #{records.length - index}
                        </div>
                      </div>
                      <span
                        className={
                          record.risk_level === "High Risk"
                            ? "text-amber-300 text-sm font-semibold"
                            : "text-emerald-300 text-sm font-semibold"
                        }
                      >
                        {record.risk_level}
                      </span>
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-3">
                      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                        <div className="text-[11px] text-slate-500">Stroke risk</div>
                        <div className="mt-1 text-lg font-bold text-cyan-300">
                          {record.probability.toFixed(2)}%
                        </div>
                      </div>
                      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                        <div className="text-[11px] text-slate-500">No stroke risk</div>
                        <div className="mt-1 text-lg font-bold">
                          {record.no_stroke_probability.toFixed(2)}%
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
                      <button
                        onClick={() => viewResult(record)}
                        className="ghost-btn px-3 py-2 text-xs transition-all duration-300 hover:border-cyan-300/30 hover:text-cyan-300"
                      >
                        View Result <ArrowRight size={14} />
                      </button>
                      <button
                        onClick={() => handleDownload(record.id)}
                        disabled={downloadingId === record.id}
                        className="ghost-btn flex items-center gap-1.5 px-3 py-2 text-xs transition-all duration-300 hover:border-cyan-300/30 hover:text-cyan-300 disabled:opacity-50"
                      >
                        {downloadingId === record.id ? (
                          <Loader2 size={13} className="animate-spin" />
                        ) : (
                          <Download size={13} />
                        )}
                        Download Report
                      </button>
                    </div>
                  </motion.div>
                ))}
              </div>

              <div className="space-y-5 lg:sticky lg:top-24 lg:self-start">
                {summary && (
                  <>
                    <motion.div
                      initial={{ opacity: 0, x: 15 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.1 }}
                      className="glass rounded-[1.75rem] p-6"
                    >
                      <p className="text-xs uppercase tracking-[0.25em] text-violet-300">
                        Comparison Summary
                      </p>
                      <div className="mt-4 grid grid-cols-2 gap-3">
                        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                          <div className="text-[11px] text-slate-500">Lowest Risk</div>
                          <div className="mt-1 text-lg font-bold text-emerald-300">
                            {summary.lowest.toFixed(2)}%
                          </div>
                        </div>
                        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                          <div className="text-[11px] text-slate-500">Highest Risk</div>
                          <div className="mt-1 text-lg font-bold text-amber-300">
                            {summary.highest.toFixed(2)}%
                          </div>
                        </div>
                        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                          <div className="text-[11px] text-slate-500">Average Risk</div>
                          <div className="mt-1 text-lg font-bold">
                            {summary.average.toFixed(2)}%
                          </div>
                        </div>
                        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                          <div className="text-[11px] text-slate-500">Total Assessments</div>
                          <div className="mt-1 text-lg font-bold">{summary.total}</div>
                        </div>
                      </div>
                    </motion.div>

                    <motion.div
                      initial={{ opacity: 0, x: 15 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.18 }}
                      className="glass rounded-[1.75rem] p-6"
                    >
                      <p className="text-xs uppercase tracking-[0.25em] text-cyan-300">
                        Stroke Risk Trend
                      </p>
                      <ComparisonChart records={records} />
                    </motion.div>

                    <motion.div
                      initial={{ opacity: 0, x: 15 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.25 }}
                      className="glass rounded-[1.75rem] p-6"
                    >
                      <button
                        onClick={handleComparisonDownload}
                        disabled={downloadingComparison}
                        className="primary-btn flex w-full items-center justify-center gap-2 text-sm disabled:opacity-50"
                      >
                        {downloadingComparison ? (
                          <Loader2 size={16} className="animate-spin" />
                        ) : (
                          <FileText size={16} />
                        )}
                        {downloadingComparison ? "Generating Report..." : "Generate Comparison Report"}
                      </button>
                      <p className="mt-2 text-center text-[11px] text-slate-500">
                        Download a PDF with all assessments and statistics
                      </p>
                    </motion.div>
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </Layout>
    </Screen>
  );
}

function ComparisonChart({ records }: { records: AssessmentRecord[] }) {
  const reversed = useMemo(() => [...records].reverse(), [records]);
  const width = 600;
  const height = 220;
  const pad = 40;
  const max = Math.max(100, ...reversed.map((r) => r.probability));

  const points = reversed.map((item, index) => {
    const x =
      reversed.length === 1
        ? width / 2
        : pad + (index * (width - pad * 2)) / (reversed.length - 1);
    const y = height - pad - (item.probability / max) * (height - pad * 2);
    return { ...item, x, y };
  });

  const path = points.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ");

  return (
    <div className="mt-5 overflow-hidden rounded-2xl border border-white/10 chart-surface p-3">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full"
        role="img"
        aria-label="Stroke probability trend"
      >
        {[0, 0.25, 0.5, 0.75, 1].map((r) => {
          const y = height - pad - r * (height - pad * 2);
          return (
            <g key={r}>
              <line
                x1={pad}
                x2={width - pad}
                y1={y}
                y2={y}
                stroke="var(--chart-grid)"
              />
              <text
                x={8}
                y={y + 4}
                fill="var(--chart-label)"
                fontSize="10"
              >
                {Math.round(r * max)}%
              </text>
            </g>
          );
        })}
        <motion.path
          d={path}
          fill="none"
          stroke="#22d3ee"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 1.2, ease: "easeOut" }}
        />
        {points.map((p, i) => (
          <g key={p.id}>
            <circle
              cx={p.x}
              cy={p.y}
              r="4.5"
              className="dashboard-chart-point"
              strokeWidth="2"
            />
            <text
              x={p.x}
              y={height - 8}
              textAnchor="middle"
              fill="var(--chart-label)"
              fontSize="8"
            >
              #{records.length - i}
            </text>
          </g>
        ))}
      </svg>
      <div className="mt-1 text-center text-[10px] text-slate-600">
        Each point represents a completed assessment (newest on the right).
      </div>
    </div>
  );
}
