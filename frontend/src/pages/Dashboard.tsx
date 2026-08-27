import { motion } from "framer-motion";
import { Activity, ArrowRight, History, ShieldCheck, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { useNavigate } from "react-router-dom";
import { api, DashboardResponse } from "../lib/api";
import { Layout } from "../components/Layout";
import { Screen } from "../components/Screen";

export default function Dashboard() {
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [busy, setBusy] = useState(true);

  async function load() {
    try {
      setBusy(true);
      setData(await api<DashboardResponse>("/user/dashboard"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to load dashboard.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { load(); }, []);

  const history = data?.history ?? [];
  const latest = data?.latest_prediction;
  const average = useMemo(
    () => history.length ? history.reduce((sum, item) => sum + item.probability, 0) / history.length : 0,
    [history]
  );

  return (
    <Screen>
      <Layout>
        <motion.div initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} className="mb-7">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.3em] text-cyan-300">
                <Activity size={14} /> Personal workspace
              </div>
              <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl lg:text-4xl">
                Welcome, {data?.user.name || "User"}
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
                Review your previous stroke-risk estimates and the latest assessment.
              </p>
            </div>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: .98 }}
              onClick={() => navigate("/")}
              className="primary-btn w-full px-4 py-2.5 text-sm sm:w-fit"
            >
              New assessment <ArrowRight size={16} />
            </motion.button>
          </div>
        </motion.div>

        <div className="grid gap-4 md:grid-cols-3">
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            whileHover={{ y: -3 }}
            className="glass rounded-[1.75rem] p-5"
          >
            <History size={18} className="text-cyan-300" />
            <div className="mt-4 text-2xl font-bold">{data?.prediction_count ?? 0}</div>
            <div className="mt-1 text-xs text-slate-500">Total assessments</div>
            <motion.button
              whileHover={{ scale: 1.02, boxShadow: "0 0 24px rgba(34,211,238,0.18)" }}
              whileTap={{ scale: 0.97 }}
              onClick={() => navigate("/assessments")}
              className="mt-4 w-full rounded-xl border border-cyan-300/15 bg-cyan-300/[0.06] px-4 py-2.5 text-xs font-semibold text-cyan-300 transition-all duration-300 hover:border-cyan-300/35 hover:bg-cyan-300/[0.1] hover:shadow-[0_0_28px_rgba(34,211,238,0.12)]"
            >
              View All Assessments <ArrowRight size={13} className="ml-1 inline" />
            </motion.button>
          </motion.div>
          {(
            [
              [
                "High-risk results",
                String(data?.high_risk_count ?? 0),
                ShieldCheck,
              ],
              [
                "Average stroke probability",
                `${average.toFixed(2)}%`,
                Activity,
              ],
            ] as [string, string, LucideIcon][]
          ).map(([label, value, Icon], index) => {
            return (
              <motion.div
                key={label}
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: (index + 1) * 0.08 }}
                whileHover={{ y: -3 }}
                className="glass rounded-[1.75rem] p-5"
              >
                <Icon size={18} className="text-cyan-300" />

                <div className="mt-4 text-2xl font-bold">
                  {value}
                </div>

                <div className="mt-1 text-xs text-slate-500">
                  {label}
                </div>
              </motion.div>
            );
          })}
        </div>

        <motion.section
          initial={{ opacity: 0, x: 15 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: .08 }}
          className="glass mt-5 rounded-[2rem] p-6 sm:p-7"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs uppercase tracking-[.25em] text-violet-300">Latest assessment</p>
              <h2 className="mt-1 text-xl font-semibold">Prediction overview</h2>
            </div>
            {latest && <span className={latest.risk_level === "High Risk" ? "text-amber-300" : "text-emerald-300"}>{latest.risk_level}</span>}
          </div>
          {latest ? (
            <div className="mt-6 grid gap-5 sm:grid-cols-[180px_1fr] sm:items-center">
              <div
                className="relative mx-auto grid h-28 w-28 place-items-center rounded-full sm:h-36 sm:w-36"
                style={{ background: `conic-gradient(#22d3ee ${latest.probability}%, var(--dashboard-gauge-track) ${latest.probability}% 100%)` }}
              >
                <div className="grid h-20 w-20 place-items-center rounded-full result-core text-center sm:h-28 sm:w-28">
                  <div>
                    <div className="text-lg font-bold sm:text-2xl">{latest.probability.toFixed(2)}%</div>
                    <div className="text-[8px] uppercase tracking-wider text-slate-500 sm:text-[9px]">stroke probability</div>
                  </div>
                </div>
              </div>
              <div>
                <div className="text-sm text-slate-400">{latest.prediction}</div>
                <div className="mt-2 text-xs text-slate-600">{latest.created_at ? new Date(latest.created_at).toLocaleString() : "—"}</div>
                <button onClick={() => navigate("/results")} className="ghost-btn mt-5 px-3 py-2 text-xs">
                  View full result <ArrowRight size={14}/>
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-7 rounded-2xl border border-white/10 bg-white/[.02] p-6 text-sm text-slate-500">
              Complete your first assessment to see your result here.
            </div>
          )}
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: .15 }}
          className="glass mt-5 rounded-[2rem] p-6 sm:p-7"
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[.25em] text-cyan-300">Prediction history</p>
              <h2 className="mt-1 text-xl font-semibold">Risk trend</h2>
            </div>
            <span className="text-xs text-slate-600">Last {history.length} assessments</span>
          </div>
          {history.length ? (
            <RiskChart history={history}/>
          ) : (
            <div className="mt-6 rounded-2xl border border-white/10 p-8 text-center text-sm text-slate-500">
              Your risk graph will appear after an assessment is calculated.
            </div>
          )}
        </motion.section>

        {busy && <div className="mt-4 text-center text-xs text-slate-600">Loading dashboard…</div>}
      </Layout>
    </Screen>
  );
}

function RiskChart({ history }: { history: DashboardResponse["history"] }) {
  const width = 760, height = 250, pad = 36;
  const max = Math.max(100, ...history.map((h) => h.probability));
  const points = history.map((item, index) => {
    const x = history.length === 1 ? width / 2 : pad + (index * (width - pad * 2)) / (history.length - 1);
    const y = height - pad - (item.probability / max) * (height - pad * 2);
    return { ...item, x, y };
  });
  const path = points.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ");

  return (
    <div className="mt-6 overflow-hidden rounded-2xl border border-white/10 chart-surface p-3" style={{ "--chart-grid": "rgba(255,255,255,.07)", "--chart-label": "rgb(100 116 139)", "--chart-point-fill": "#07111f" } as React.CSSProperties}>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label="Stroke probability trend graph">
        {[0, .25, .5, .75, 1].map((r) => {
          const y = height - pad - r * (height - pad * 2);
          return (
            <g key={r}>
              <line x1={pad} x2={width-pad} y1={y} y2={y} stroke="var(--chart-grid)"/>
              <text x={8} y={y+4} fill="var(--chart-label)" fontSize="10">{Math.round(r*max)}%</text>
            </g>
          );
        })}
        <motion.path
          d={path}
          fill="none"
          stroke="#22d3ee"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 1.2, ease: "easeOut" }}
        />
        {points.map((p) => (
          <g key={p.id}>
            <circle cx={p.x} cy={p.y} r="5" className="dashboard-chart-point" strokeWidth="2"/>
            <text x={p.x} y={height-10} textAnchor="middle" fill="var(--chart-label)" fontSize="9">
              {new Date(p.created_at || Date.now()).toLocaleDateString(undefined,{month:"short",day:"numeric"})}
            </text>
          </g>
        ))}
      </svg>
      <div className="mt-1 text-center text-[11px] text-slate-600">
        Each point represents a completed assessment. This trend is descriptive and not a clinical diagnosis.
      </div>
    </div>
  );
}
