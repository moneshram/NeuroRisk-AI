import { motion } from "framer-motion";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Download,
  FileText,
  HeartPulse,
  Loader2,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useMemo, useState } from "react";
import toast from "react-hot-toast";

import { Layout } from "../components/Layout";
import { Screen } from "../components/Screen";
import { PredictionResponse, downloadAssessmentReport } from "../lib/api";

export default function Results() {
  const navigate = useNavigate();
  const [downloading, setDownloading] = useState(false);

  const raw = sessionStorage.getItem("stroke_result");

  const result: PredictionResponse | null = raw ? JSON.parse(raw) : null;

  const assessmentId = result?.id;

  async function handleDownloadReport() {
    if (!assessmentId) return;
    try {
      setDownloading(true);
      await downloadAssessmentReport(assessmentId);
      toast.success("Report downloaded successfully.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to download report.";
      toast.error(msg);
    } finally {
      setDownloading(false);
    }
  }

  if (!result) {
    return (
      <Screen>
        <Layout>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="
              mx-auto
              max-w-xl
              glass
              glow-border
              rounded-[2rem]
              p-8
              text-center
            "
          >
            <div
              className="
              mx-auto
              grid
              h-14
              w-14
              place-items-center
              rounded-2xl
              bg-cyan-400/10
              text-cyan-300
            "
            >
              <Activity size={26} />
            </div>

            <h1 className="mt-5 text-2xl font-bold">No assessment result</h1>

            <p className="mt-2 text-sm leading-6 text-slate-400">
              Complete a patient assessment before viewing the risk analysis.
            </p>

            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => navigate("/")}
              className="primary-btn mt-7 w-full"
            >
              Start assessment
            </motion.button>
          </motion.div>
        </Layout>
      </Screen>
    );
  }

  const highRisk = result.risk_level === "High Risk";

  const probability = Number(result.stroke_probability);

  const noStrokeProbability = Number(result.no_stroke_probability);

  const riskLabel = result.risk_level;

  const riskDescription =
    result.risk_level === "High Risk"
      ? "The model indicates an elevated estimated stroke risk."
      : result.risk_level === "Low Risk"
        ? "The model indicates a lower estimated stroke risk."
        : "The model indicates an estimated stroke risk.";

  return (
    <Screen>
      <Layout>
        {/* Page header */}
        <motion.div
          initial={{ opacity: 0, y: -15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45 }}
          className="mb-7"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div
                className="
                flex
                items-center
                gap-2
                text-xs
                font-semibold
                uppercase
                tracking-[0.3em]
                text-cyan-300
              "
              >
                <Sparkles size={14} />
                Assessment complete
              </div>

              <h1
                className="
                mt-2
                text-2xl
                font-bold
                tracking-tight
                sm:text-3xl
                lg:text-4xl
              "
              >
                Stroke risk analysis
              </h1>

              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
                Review the machine-learning estimate and the personalized
                guidance generated from the submitted patient profile.
              </p>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => navigate("/")}
                className="ghost-btn w-full px-4 py-2.5 text-sm sm:w-fit"
              >
                <ArrowLeft size={16} />
                New assessment
              </motion.button>
              {assessmentId && (
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleDownloadReport}
                  disabled={downloading}
                  className="primary-btn flex w-full items-center justify-center gap-2 px-4 py-2.5 text-sm sm:w-fit disabled:opacity-50"
                >
                  {downloading ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Download size={16} />
                  )}
                  {downloading ? "Generating..." : "Download Report"}
                </motion.button>
              )}
            </div>
          </div>
        </motion.div>

        {/* Main result */}
        <div className="grid gap-5 lg:grid-cols-[1.08fr_.92fr]">
          {/* Risk card */}
          <motion.section
            initial={{
              opacity: 0,
              y: 25,
              scale: 0.98,
            }}
            animate={{
              opacity: 1,
              y: 0,
              scale: 1,
            }}
            transition={{
              duration: 0.55,
              ease: [0.22, 1, 0.36, 1],
            }}
            className="
              glass
              glow-border
              rounded-[2rem]
              p-6
              sm:p-9
              lg:col-start-1
              lg:row-start-1
            "
          >
            {/* Card heading */}
            <div className="flex items-start justify-between gap-4">
              <div>
                <div
                  className="
                  flex
                  items-center
                  gap-2
                  text-sm
                  text-slate-400
                "
                >
                  <HeartPulse size={17} className="text-cyan-300" />
                  Model result
                </div>

                <motion.h2
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.15 }}
                  className="mt-3 text-2xl font-bold sm:text-3xl"
                >
                  {result.risk_level}
                </motion.h2>
              </div>

              <div
                className="
                rounded-full
                border
                border-white/10
                bg-white/[0.03]
                px-3
                py-1.5
                text-[11px]
                font-semibold
                uppercase
                tracking-wider
                text-slate-400
              "
              >
                ML estimate
              </div>
            </div>

            <p className="mt-3 text-sm leading-6 text-slate-400">
              {riskDescription} This is a statistical risk estimate, not a
              diagnosis.
            </p>

            {/* Gauge */}
            <div className="my-9 grid place-items-center">
              <motion.div
                initial={{
                  opacity: 0,
                  scale: 0.8,
                  rotate: -20,
                }}
                animate={{
                  opacity: 1,
                  scale: 1,
                  rotate: 0,
                }}
                transition={{
                  duration: 0.7,
                  delay: 0.15,
                  ease: [0.22, 1, 0.36, 1],
                }}
                className="
                  relative
                  grid
                  h-44
                  w-44
                  place-items-center
                  rounded-full
                  sm:h-56
                  sm:w-56
                  lg:h-64
                  lg:w-64
                "
                style={{
                  background:
                    `conic-gradient(#22d3ee ${probability}%, ` +
                    `rgba(255,255,255,0.07) ${probability}% 100%)`,
                }}
              >
                {/* Outer glow */}
                <div
                  className="
                  pointer-events-none
                  absolute
                  inset-[-8px]
                  rounded-full
                  border
                  border-cyan-300/10
                "
                />

                {/* Inner circle */}
                <div
                  className="
                  grid
                  h-36
                  w-36
                  place-items-center
                  rounded-full
                  bg-[#07111f]
                  shadow-[inset_0_0_40px_rgba(34,211,238,0.05)]
                  sm:h-44
                  sm:w-44
                  lg:h-52
                  lg:w-52
                "
                >
                  <div className="text-center">
                    <motion.div
                      initial={{ opacity: 0, scale: 0.6 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{
                        delay: 0.5,
                        duration: 0.45,
                      }}
                      className="text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl"
                    >
                      {probability.toFixed(2)}%
                    </motion.div>

                    <div
                      className="
                      mt-2
                      text-[11px]
                      font-medium
                      uppercase
                      tracking-[0.2em]
                      text-slate-500
                    "
                    >
                      stroke probability
                    </div>
                  </div>
                </div>
              </motion.div>
            </div>

            {/* Probability cards */}
            <div className="grid grid-cols-2 gap-3">
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.55 }}
                className="
                  rounded-2xl
                  border
                  border-white/10
                  bg-white/[0.03]
                  p-4
                "
              >
                <div className="text-xs text-slate-500">No stroke risk</div>

                <div className="mt-1 text-xl font-bold sm:text-2xl">
                  {noStrokeProbability.toFixed(2)}%
                </div>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.65 }}
                className="
                  rounded-2xl
                  border
                  border-cyan-300/10
                  bg-cyan-300/[0.035]
                  p-4
                "
              >
                <div className="text-xs text-slate-500">Stroke risk</div>

                <div className="mt-1 text-xl font-bold text-cyan-300 sm:text-2xl">
                  {probability.toFixed(2)}%
                </div>
              </motion.div>
            </div>
          </motion.section>

          {/* Probability graph */}
          <motion.section
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.5 }}
            className="glass rounded-[2rem] p-6 sm:p-7 lg:col-span-2 lg:col-start-1 lg:row-start-2"
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.25em] text-cyan-300">Risk visualization</p>
                <h2 className="mt-1 text-xl font-semibold">Prediction probability graph</h2>
                <p className="mt-1 text-sm text-slate-500">A visual comparison of the model's estimated stroke and no-stroke probabilities.</p>
              </div>
              <div className="text-xs text-slate-500">Current assessment</div>
            </div>
            <ProbabilityGraph stroke={probability} noStroke={noStrokeProbability} />
          </motion.section>

          {/* Right column */}
          <div className="space-y-5 lg:col-start-2 lg:row-start-1">
            {/* Risk status */}
            <motion.div
              initial={{ opacity: 0, x: 25 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.15, duration: 0.5 }}
              className="glass rounded-[2rem] p-6 sm:p-7"
            >
              <div className="flex items-start gap-4">
                <div
                  className={`
                    grid
                    h-11
                    w-11
                    shrink-0
                    place-items-center
                    rounded-2xl
                    ${
                      highRisk
                        ? "bg-amber-400/10 text-amber-300"
                        : "bg-emerald-400/10 text-emerald-300"
                    }
                  `}
                >
                  {highRisk ? (
                    <AlertTriangle size={22} />
                  ) : (
                    <CheckCircle2 size={22} />
                  )}
                </div>

                <div>
                  <p
                    className="
                    text-xs
                    font-semibold
                    uppercase
                    tracking-[0.2em]
                    text-slate-500
                  "
                  >
                    Risk classification
                  </p>

                  <h2 className="mt-1 text-xl font-bold">{riskLabel}</h2>

                  <p className="mt-2 text-sm leading-6 text-slate-400">
                    {result.prediction}
                  </p>
                </div>
              </div>
            </motion.div>

            {/* Guidance */}
            <motion.aside
              initial={{ opacity: 0, x: 25 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.25, duration: 0.5 }}
              className="glass rounded-[2rem] p-6 sm:p-7"
            >
              <div className="flex items-center gap-3">
                <div
                  className="
                  grid
                  h-10
                  w-10
                  place-items-center
                  rounded-xl
                  bg-cyan-400/10
                  text-cyan-300
                "
                >
                  <Sparkles size={19} />
                </div>

                <div>
                  <h2 className="text-lg font-semibold">
                    Personalized guidance
                  </h2>

                  <p className="text-xs text-slate-500">
                    Based on the submitted profile
                  </p>
                </div>
              </div>

              <div className="mt-5 space-y-3">
                {result.recommendations.map((recommendation, index) => (
                  <motion.div
                    key={`${recommendation}-${index}`}
                    initial={{
                      opacity: 0,
                      y: 10,
                    }}
                    animate={{
                      opacity: 1,
                      y: 0,
                    }}
                    transition={{
                      delay: 0.35 + index * 0.1,
                      duration: 0.35,
                    }}
                    whileHover={{
                      x: 3,
                    }}
                    className="
                        flex
                        gap-3
                        rounded-2xl
                        border
                        border-white/10
                        bg-white/[0.03]
                        p-4
                        text-sm
                        leading-6
                        text-slate-300
                        transition-colors
                        hover:border-cyan-300/20
                      "
                  >
                    <Check
                      size={17}
                      className="
                          mt-1
                          shrink-0
                          text-cyan-300
                        "
                    />

                    <span>{recommendation}</span>
                  </motion.div>
                ))}
              </div>
            </motion.aside>

            {/* Disclaimer */}
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.55 }}
              className="
                rounded-[2rem]
                border
                border-cyan-300/10
                bg-cyan-300/[0.035]
                p-6
              "
            >
              <div className="flex gap-3">
                <ShieldCheck
                  size={18}
                  className="
                    mt-0.5
                    shrink-0
                    text-cyan-300/70
                  "
                />

                <p
                  className="
                  text-xs
                  leading-5
                  text-slate-500
                "
                >
                  The displayed probability is produced by the configured
                  machine-learning pipeline. This system is for educational and
                  demonstration purposes and is not a medical diagnosis.
                </p>
              </div>
            </motion.div>
          </div>
        </div>
      </Layout>
    </Screen>
  );
}


function ProbabilityGraph({ stroke, noStroke }: { stroke: number; noStroke: number }) {
  const bars = useMemo(() => [
    { label: "Stroke risk", value: stroke },
    { label: "No stroke", value: noStroke },
  ], [stroke, noStroke]);
  return (
    <div className="mt-6 grid gap-5 sm:grid-cols-2">
      {bars.map((bar, index) => (
        <div key={bar.label}>
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="text-slate-400">{bar.label}</span>
            <span className="font-semibold result-probability-value">{bar.value.toFixed(2)}%</span>
          </div>
          <div className="result-probability-track h-3 overflow-hidden rounded-full">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${bar.value}%` }}
              transition={{ duration: 1, delay: 0.15 + index * 0.12, ease: [0.22, 1, 0.36, 1] }}
              className="result-probability-fill h-full rounded-full bg-gradient-to-r from-cyan-400 to-blue-500"
            />
          </div>
        </div>
      ))}
    </div>
  );
}
