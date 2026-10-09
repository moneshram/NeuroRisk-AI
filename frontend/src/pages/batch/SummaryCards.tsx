import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { Activity, AlertTriangle, CheckCircle2, Layers } from "lucide-react";
import type { BatchSummary } from "../../lib/batchApi";
import { prefersReducedMotion } from "./motion";

export function SummaryCards({ summary }: { summary: BatchSummary }) {
  const ref = useRef<HTMLDivElement>(null);

  /* Staggered entrance for the four summary cards. */
  useEffect(() => {
    const scope = ref.current;
    if (!scope || prefersReducedMotion()) return;
    const ctx = gsap.context(() => {
      gsap.from(scope.querySelectorAll("[data-summary-card]"), {
        y: 22,
        opacity: 0,
        duration: 0.5,
        stagger: 0.08,
        ease: "power2.out",
        clearProps: "opacity,transform",
      });
    }, scope);
    return () => ctx.revert();
  }, [summary]);

  const cards = [
    {
      label: "Total rows",
      value: summary.total.toLocaleString(),
      hint: "Records scored in this batch",
      Icon: Layers,
      accent: "text-cyan-300",
    },
    {
      label: "High risk",
      value: summary.high_risk.toLocaleString(),
      hint: `${summary.total ? ((summary.high_risk / summary.total) * 100).toFixed(1) : "0.0"}% of the batch`,
      Icon: AlertTriangle,
      accent: "text-rose-300",
    },
    {
      label: "Low risk",
      value: summary.low_risk.toLocaleString(),
      hint: `${summary.total ? ((summary.low_risk / summary.total) * 100).toFixed(1) : "0.0"}% of the batch`,
      Icon: CheckCircle2,
      accent: "text-emerald-300",
    },
    {
      label: "Average probability",
      value: `${summary.avg_probability.toFixed(2)}%`,
      hint: `Peak ${summary.max_probability.toFixed(2)}%`,
      Icon: Activity,
      accent: "text-amber-300",
    },
  ];

  return (
    <div ref={ref} className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map(({ label, value, hint, Icon, accent }) => (
        <div
          key={label}
          data-summary-card
          className="glass rounded-[2rem] p-5 sm:p-6"
        >
          <div className="flex items-start justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-[.2em] text-slate-500">
              {label}
            </p>
            <Icon size={18} className={accent} />
          </div>
          <div className="mt-4 text-3xl font-bold tabular-nums tracking-tight sm:text-4xl">
            {value}
          </div>
          <p className="mt-1.5 text-xs text-slate-500">{hint}</p>
        </div>
      ))}
    </div>
  );
}
