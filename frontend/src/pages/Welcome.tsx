/**
 * Public landing page (/welcome) — first impression for visitors who are
 * not signed in. Marquee-hero macrostructure (Inspo recommend):
 * big type over the liquid-chrome bg, credibility strip, how-it-works,
 * model evidence, trust + footer. Zero logic coupling: CTAs link to
 * /register and /login only.
 */
import { motion } from "framer-motion";
import { Activity, ArrowRight, BarChart3, BrainCircuit, FileText, Lock, ShieldCheck, Sparkles } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motionPresets } from "../animations";

const { EASE } = motionPresets;

/* three.js lives only in this lazy chunk — never in the main bundle. */
const NeuralBrain = lazy(() => import("../animations/Scene3D"));

const fadeUp = {
  initial: { opacity: 0, y: 22 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-80px" },
  transition: { duration: 0.55, ease: EASE },
};

const STATS = [
  { value: "0.84", label: "ROC-AUC", note: "held-out test set" },
  { value: "86%", label: "Recall", note: "high-risk detection" },
  { value: "6", label: "Clinical factors", note: "age, glucose, BMI, hypertension, heart disease, smoking" },
  { value: "<1s", label: "Prediction time", note: "instant risk band" },
];

const STEPS = [
  {
    icon: Activity,
    title: "Answer a short assessment",
    body: "Six clinically relevant factors — age, average glucose, BMI, hypertension, heart disease and smoking status. No paperwork, no waiting rooms.",
  },
  {
    icon: BrainCircuit,
    title: "The model scores your risk",
    body: "A production Random Forest, trained and validated on clinical stroke data, converts your profile into a calibrated probability in under a second.",
  },
  {
    icon: ShieldCheck,
    title: "Get an instant risk band",
    body: "A clear Low or High risk result with the probability behind it, plus guidance on what to do next — built for screening, not diagnosis.",
  },
];

export default function Welcome() {
  const navigate = useNavigate();
  // Mount the 3D scene just after first paint so it never competes with LCP.
  const [sceneReady, setSceneReady] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setSceneReady(true), 250);
    return () => window.clearTimeout(id);
  }, []);

  return (
    <div className="relative min-h-screen text-white">
      {/* 3D particle brain — fixed full-page layer. Compact behind the hero,
          expands outward to fill the viewport as you scroll down, contracts
          back on scroll up. */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 -z-10 opacity-90"
        style={{
          WebkitMaskImage: "radial-gradient(90% 90% at 50% 45%, #000 60%, transparent 100%)",
          maskImage: "radial-gradient(90% 90% at 50% 45%, #000 60%, transparent 100%)",
        }}
      >
        {sceneReady && (
          <Suspense fallback={null}>
            <NeuralBrain />
          </Suspense>
        )}
      </div>

      {/* ---------- Nav ---------- */}
      <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-5 pt-6">
        <button onClick={() => navigate("/welcome")} className="flex items-center gap-3 bg-transparent">
          <span className="grid h-12 w-12 place-items-center rounded-xl border border-cyan-300/25 bg-cyan-400/10">
            <BrainCircuit size={24} className="text-cyan-300" />
          </span>
          <span className="text-left">
            <b className="block text-xl font-semibold tracking-tight">NeuroRisk AI</b>
            <small className="block text-sm text-slate-400">Stroke Classification</small>
          </span>
        </button>
        <nav className="flex items-center gap-2.5">
          <button
            onClick={() => navigate("/login")}
            className="blob-glow rounded-xl border border-white/10 bg-white/[0.04] px-5 py-2.5 text-base text-slate-300 transition-colors hover:text-white"
          >
            Sign in
          </button>
          <button
            onClick={() => navigate("/register")}
            className="rounded-xl brand-cta px-5 py-2.5 text-base font-semibold transition-transform hover:scale-[1.03]"
          >
            Get started
          </button>
        </nav>
      </header>

      {/* ---------- Hero ---------- */}
      <section className="relative z-10 mx-auto max-w-6xl px-5 pb-24 pt-20 text-center sm:pt-28">
        <motion.p
          {...fadeUp}
          transition={{ ...fadeUp.transition, delay: 0 }}
          className="mx-auto mb-5 inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-400/5 px-4 py-1.5 text-sm font-semibold uppercase tracking-[0.25em] text-cyan-300"
        >
          <Sparkles size={13} /> Clinical-grade stroke risk screening
        </motion.p>
        <motion.h1
          {...fadeUp}
          transition={{ ...fadeUp.transition, delay: 0.07 }}
          className="mx-auto max-w-3xl text-4xl font-semibold leading-[1.05] tracking-[-0.02em] sm:text-6xl"
        >
          Stroke risk, <span className="bg-gradient-to-r from-cyan-300 to-sky-400 bg-clip-text text-transparent">predicted</span> in seconds.
        </motion.h1>
        <motion.p
          {...fadeUp}
          transition={{ ...fadeUp.transition, delay: 0.14 }}
          className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-slate-400"
        >
          Answer six clinical questions. A validated machine-learning model returns an
          instant, calibrated risk probability — so you and your clinician can act earlier.
        </motion.p>
        <motion.div
          {...fadeUp}
          transition={{ ...fadeUp.transition, delay: 0.21 }}
          className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row"
        >
          <button
            onClick={() => navigate("/register")}
            className="group flex items-center gap-2 rounded-2xl brand-cta px-7 py-3.5 text-base font-semibold transition-transform hover:scale-[1.03]"
          >
            Start free assessment
            <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
          </button>
          <button
            onClick={() => navigate("/login")}
            className="blob-glow rounded-2xl border border-white/10 bg-white/[0.04] px-7 py-3.5 text-base font-medium text-slate-200 backdrop-blur-xl transition-colors hover:bg-white/[0.07]"
          >
            I already have an account
          </button>
        </motion.div>

        {/* credibility strip */}
        <motion.dl
          {...fadeUp}
          transition={{ ...fadeUp.transition, delay: 0.28 }}
          className="mx-auto mt-16 grid max-w-4xl grid-cols-2 gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-xl sm:grid-cols-4"
        >
          {STATS.map((s) => (
            <div key={s.label} className="bg-transparent px-5 py-6 text-center">
              <dt className="text-2xl font-semibold tracking-tight text-cyan-300 sm:text-3xl">{s.value}</dt>
              <dd className="mt-1 text-sm font-medium uppercase tracking-wider text-slate-400">{s.label}</dd>
              <dd className="mx-auto mt-1.5 max-w-[10rem] text-xs leading-snug text-slate-500">{s.note}</dd>
            </div>
          ))}
        </motion.dl>
      </section>

      {/* ---------- How it works ---------- */}
      <section className="relative z-10 mx-auto max-w-6xl px-5 pb-24">
        <motion.h2
          {...fadeUp}
          className="text-center text-2xl font-semibold tracking-tight sm:text-3xl"
        >
          How it works
        </motion.h2>
        <motion.p {...fadeUp} transition={{ ...fadeUp.transition, delay: 0.06 }} className="mx-auto mt-3 max-w-md text-center text-sm text-slate-400">
          Three steps, under a minute, no appointment needed.
        </motion.p>
        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {STEPS.map((step, i) => (
            <motion.div
              key={step.title}
              {...fadeUp}
              transition={{ ...fadeUp.transition, delay: 0.08 * i }}
              className="glass rounded-3xl p-7"
            >
              <span className="grid h-11 w-11 place-items-center rounded-2xl border border-cyan-300/20 bg-cyan-400/10">
                <step.icon size={19} className="text-cyan-300" />
              </span>
              <h3 className="mt-5 text-base font-semibold tracking-tight">
                <span className="mr-2 text-slate-500">0{i + 1}</span>
                {step.title}
              </h3>
              <p className="mt-2.5 text-sm leading-relaxed text-slate-400">{step.body}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ---------- Model evidence + trust ---------- */}
      <section className="relative z-10 mx-auto max-w-6xl px-5 pb-24">
        <motion.div {...fadeUp} className="glass grid items-center gap-8 rounded-3xl p-8 md:grid-cols-2 md:p-10">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              A model you can audit, not just trust
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-slate-400">
              NeuroRisk AI runs a Random Forest classifier trained on clinical stroke data and
              validated on a held-out test set. Every report states the model, the decision
              threshold and the metrics — because medical AI should show its work.
            </p>
            <ul className="mt-6 space-y-2.5 text-sm text-slate-300">
              {[
                [BarChart3, "Transparent metrics: ROC-AUC 0.838, recall 0.860"],
                [FileText, "Every prediction report includes model + threshold"],
                [Lock, "Assessments are private to your account"],
              ].map(([Icon, text]) => {
                const I = Icon as typeof BarChart3;
                return (
                  <li key={String(text)} className="flex items-center gap-2.5">
                    <I size={15} className="shrink-0 text-cyan-300" />
                    {text as string}
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="rounded-2xl border border-white/10 bg-[#07204f]/80 p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Decision rule</p>
            <p className="mt-3 text-lg font-semibold text-white">
              High Risk if probability ≥ 4%
            </p>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">
              A deliberately low screening threshold: the model is tuned to catch high-risk
              profiles (86% recall) rather than over-reassure.
            </p>
            <div className="mt-5 flex items-center gap-2 rounded-xl border border-amber-300/20 bg-amber-400/5 px-4 py-3 text-xs leading-relaxed text-amber-200/90">
              <ShieldCheck size={14} className="shrink-0" />
              Screening support only — not a diagnosis. Always consult a clinician.
            </div>
          </div>
        </motion.div>
      </section>

      {/* ---------- Final CTA ---------- */}
      <section className="relative z-10 mx-auto max-w-6xl px-5 pb-24 text-center">
        <motion.h2 {...fadeUp} className="mx-auto max-w-xl text-2xl font-semibold tracking-tight sm:text-3xl">
          Know your risk in the next 60 seconds
        </motion.h2>
        <motion.button
          {...fadeUp}
          transition={{ ...fadeUp.transition, delay: 0.07 }}
          onClick={() => navigate("/register")}
          className="mt-7 rounded-2xl brand-cta px-8 py-3.5 text-base font-semibold transition-transform hover:scale-[1.03]"
        >
          Create your free account
        </motion.button>
      </section>

      {/* ---------- Footer ---------- */}
      <footer className="relative z-10 border-t border-white/[0.06] py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-5 text-xs text-slate-500 sm:flex-row">
          <span>© 2026 NeuroRisk AI · Stroke risk screening support</span>
          <span className="max-w-md text-center sm:text-right">
            Not a medical device. Predictions support clinical judgement and never replace it.
          </span>
        </div>
      </footer>
    </div>
  );
}
