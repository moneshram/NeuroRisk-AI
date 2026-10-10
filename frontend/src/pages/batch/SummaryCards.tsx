import { useEffect, useMemo, useRef } from "react";
import { gsap } from "gsap";
import { Activity, AlertTriangle, CheckCircle2, Layers } from "lucide-react";
import type { BatchRow, BatchSummary } from "../../lib/batchApi";
import { prefersReducedMotion } from "../../animations/gsapHelpers";
import { CountUp } from "../../animations";

export type RiskFilter = "all" | "High Risk" | "Low Risk";

type Props = {
  summary: BatchSummary;
  results: BatchRow[];
  sourceLabel: string;
  riskFilter: RiskFilter;
  onFilter: (filter: RiskFilter) => void;
  onAverage: () => void;
};

export function SummaryCards({ summary, results, sourceLabel, riskFilter, onFilter, onAverage }: Props) {
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

  /* Group averages + median, derived client-side from the scored rows. */
  const stats = useMemo(() => {
    const avg = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);
    const high: number[] = [];
    const low: number[] = [];
    for (const row of results) {
      if (row.risk_level === "High Risk") high.push(row.stroke_probability);
      else low.push(row.stroke_probability);
    }
    const probs = results.map((row) => row.stroke_probability).sort((a, b) => a - b);
    const median = probs.length
      ? probs.length % 2
        ? probs[(probs.length - 1) / 2]
        : (probs[probs.length / 2 - 1] + probs[probs.length / 2]) / 2
      : 0;
    return { highAvg: avg(high), lowAvg: avg(low), median };
  }, [results]);

  const highActive = riskFilter === "High Risk";
  const lowActive = riskFilter === "Low Risk";

  const cards = [
    {
      key: "total" as const,
      label: "Total rows",
      display: <CountUp value={summary.total} />,
      hint: sourceLabel ? `Records scored · ${sourceLabel}` : "Records scored in this batch",
      Icon: Layers,
      accent: "text-cyan-300",
      active: false,
      onClick: () => onFilter("all"),
      title: "Show all rows",
    },
    {
      key: "high" as const,
      label: "High risk",
      display: <CountUp value={summary.high_risk} />,
      hint: `${summary.total ? ((summary.high_risk / summary.total) * 100).toFixed(1) : "0.0"}% of the batch · avg ${stats.highAvg.toFixed(2)}% in group`,
      Icon: AlertTriangle,
      accent: "text-rose-300",
      active: highActive,
      onClick: () => onFilter(highActive ? "all" : "High Risk"),
      title: "Filter the table to high-risk rows",
      ring: "ring-2 ring-rose-400/50",
    },
    {
      key: "low" as const,
      label: "Low risk",
      display: <CountUp value={summary.low_risk} />,
      hint: `${summary.total ? ((summary.low_risk / summary.total) * 100).toFixed(1) : "0.0"}% of the batch · avg ${stats.lowAvg.toFixed(2)}% in group`,
      Icon: CheckCircle2,
      accent: "text-emerald-300",
      active: lowActive,
      onClick: () => onFilter(lowActive ? "all" : "Low Risk"),
      title: "Filter the table to low-risk rows",
      ring: "ring-2 ring-emerald-400/50",
    },
    {
      key: "average" as const,
      label: "Average probability",
      display: <CountUp value={summary.avg_probability} decimals={2} suffix="%" />,
      hint: `Median ${stats.median.toFixed(2)}% · peak ${summary.max_probability.toFixed(2)}% · ≥4% = high risk`,
      Icon: Activity,
      accent: "text-amber-300",
      active: false,
      onClick: onAverage,
      title: "Jump to the table sorted by probability",
    },
  ];

  return (
    <div ref={ref} className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map(({ key, label, display, hint, Icon, accent, active, onClick, title, ring }) => (
        <button
          key={key}
          type="button"
          data-summary-card
          onClick={onClick}
          title={title}
          aria-pressed={active || undefined}
          className={`glass cursor-pointer rounded-[2rem] p-5 text-left transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60 sm:p-6 ${
            active && ring ? ring : ""
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-[.2em] text-slate-500">
              {label}
            </p>
            <Icon size={18} className={accent} />
          </div>
          <div className="mt-4 text-3xl font-bold tabular-nums tracking-tight sm:text-4xl">
            {display}
          </div>
          <p className="mt-1.5 text-xs text-slate-500">{hint}</p>
        </button>
      ))}
    </div>
  );
}
