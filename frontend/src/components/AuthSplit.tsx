/**
 * Split-Studio auth layout (Inspo macrostructure): brand story panel on the
 * left, form slot on the right. Decorative only — auth logic stays in pages.
 */
import { motion } from "framer-motion";
import { ArrowLeft, ShieldCheck, Sparkles, Zap } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motionPresets } from "../animations";

/* three.js lives only in this lazy chunk — never in the main bundle. */
const AuthScene3D = lazy(() => import("../animations/AuthScene3D"));

const POINTS = [
  { icon: Zap, text: "Six clinical factors in, calibrated probability out — under a second." },
  { icon: ShieldCheck, text: "Random Forest validated on held-out clinical data (ROC-AUC 0.84)." },
  { icon: Sparkles, text: "Screening support with a transparent threshold — never a black box." },
];

export function AuthSplit({ children }: { children: React.ReactNode }) {
  // Mount the 3D object just after first paint so it never competes with LCP.
  const [sceneReady, setSceneReady] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setSceneReady(true), 250);
    return () => window.clearTimeout(id);
  }, []);

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Left: brand panel (decorative) */}
      <div className="relative isolate hidden flex-col justify-between p-10 lg:flex xl:p-14">
        {/* Subtle 3D icosahedron — floats in the panel's right area, masked */}
        <div
          aria-hidden="true"
          className="auth-scene3d pointer-events-none absolute inset-0 -z-10"
          style={{
            WebkitMaskImage: "radial-gradient(42% 42% at 72% 46%, #000 55%, transparent 100%)",
            maskImage: "radial-gradient(42% 42% at 72% 46%, #000 55%, transparent 100%)",
          }}
        >
          {sceneReady && (
            <Suspense fallback={null}>
              <AuthScene3D />
            </Suspense>
          )}
        </div>
        <Link
          to="/welcome"
          className="inline-flex w-fit items-center gap-1.5 text-base text-slate-400 transition-colors hover:text-white"
        >
          <ArrowLeft size={15} /> Overview
        </Link>
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, ease: motionPresets.EASE, delay: 0.1 }}
        >
          <h2 className="max-w-sm text-3xl font-semibold leading-[1.15] tracking-[-0.02em] xl:text-4xl">
            Stroke risk,{" "}
            <span className="bg-gradient-to-r from-cyan-300 to-sky-400 bg-clip-text text-transparent">
              predicted
            </span>{" "}
            in seconds.
          </h2>
          <ul className="mt-8 space-y-4">
            {POINTS.map((p) => (
              <li key={p.text} className="flex max-w-sm items-start gap-3 text-base leading-relaxed text-slate-400">
                <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-cyan-300/20 bg-cyan-400/10">
                  <p.icon size={14} className="text-cyan-300" />
                </span>
                {p.text}
              </li>
            ))}
          </ul>
        </motion.div>
        <p className="max-w-xs text-sm leading-relaxed text-slate-500">
          Screening support only — not a diagnosis. NeuroRisk AI backs clinical judgement,
          it never replaces it.
        </p>
      </div>

      {/* Right: form slot */}
      <div className="flex items-center justify-center px-4 py-10">
        {children}
      </div>
    </div>
  );
}

export default AuthSplit;
