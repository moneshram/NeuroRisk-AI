import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { BatchChartData, RiskGroup } from "../../lib/batchApi";
import { prefersReducedMotion } from "./motion";

/**
 * One palette reused across every chart on the page:
 * High risk = rose, Low risk = emerald, neutral series = cyan.
 */
const PALETTE = {
  high: "#f43f5e",
  low: "#34d399",
  cyan: "#22d3ee",
};

/** The model scores stroke risk at RISK_THRESHOLD = 0.04 → 4% (Random Forest). */
const RISK_THRESHOLD_PCT = 4;

const AXIS_TICK = { fill: "#64748b", fontSize: 10 } as const;
const AXIS_LINE = { stroke: "rgba(255,255,255,0.12)" } as const;
/** Falls back to white/10-ish when the theme variable is unavailable. */
const GRID_STYLE = { stroke: "rgba(255,255,255,0.09)" } as const;
const TOOLTIP_CURSOR = { fill: "rgba(255,255,255,0.05)" } as const;

type TipEntry = {
  name?: unknown;
  value?: unknown;
  color?: string;
  payload?: Record<string, any>;
};

function formatValue(name: unknown, value: unknown): string {
  const label = String(name ?? "");
  if (typeof value === "number") {
    const text = Number.isInteger(value) ? String(value) : value.toFixed(2);
    return /probabil|rate/i.test(label) ? `${text}%` : text;
  }
  return String(value ?? "");
}

/** Dark-glass tooltip shared by every chart. */
function ChartTooltip(props: { active?: boolean; label?: unknown; payload?: TipEntry[] }) {
  if (!props.active || !props.payload || props.payload.length === 0) return null;
  const extra = props.payload[0]?.payload || {};

  const rows: { key: string; label: string; value: string; color?: string }[] = props.payload
    .filter((entry) => entry.name !== undefined)
    .map((entry, index) => ({
      key: `entry-${index}`,
      label: String(entry.name),
      value: formatValue(entry.name, entry.value),
      color: entry.color,
    }));

  if (extra.age !== undefined) {
    rows.unshift({ key: "age", label: "Age", value: String(extra.age) });
  }
  if (extra.total !== undefined) {
    rows.push({ key: "total", label: "Rows", value: String(extra.total) });
  }
  if (extra.high_risk !== undefined) {
    rows.push({ key: "high", label: "High risk", value: String(extra.high_risk) });
  }

  return (
    <div className="rounded-xl border border-white/10 bg-[#0b1424]/95 px-3 py-2 text-xs shadow-2xl backdrop-blur">
      {props.label !== undefined && props.label !== null && (
        <p className="mb-1 font-semibold text-slate-200">{String(props.label)}</p>
      )}
      <div className="space-y-0.5">
        {rows.map((row) => (
          <div key={row.key} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-slate-400">
              {row.color && (
                <span
                  aria-hidden="true"
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: row.color }}
                />
              )}
              {row.label}
            </span>
            <span className="font-semibold tabular-nums text-slate-100">{row.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ChartCard({
  eyebrow,
  title,
  description,
  ariaLabel,
  height,
  children,
  footer,
}: {
  eyebrow: string;
  title: string;
  description: string;
  ariaLabel: string;
  height: number;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <section data-chart-card className="glass chart-surface rounded-[2rem] p-5 sm:p-6">
      <p className="text-xs uppercase tracking-[.25em] text-slate-500">{eyebrow}</p>
      <h3 className="mt-1 text-base font-semibold sm:text-lg">{title}</h3>
      <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
      <div
        role="img"
        aria-label={ariaLabel}
        className="mt-4 w-full"
        style={{ height }}
      >
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
      {footer}
    </section>
  );
}

function RateBarChart({ rows, title, description }: { rows: RiskGroup[]; title: string; description: string }) {
  const data = rows.map((row) => ({
    ...row,
    label: row.label === "0" ? "No" : row.label === "1" ? "Yes" : row.label,
  }));

  return (
    <ChartCard
      eyebrow="High-risk rate"
      title={title}
      description={description}
      ariaLabel={`${title}: high-risk rate percentage by category`}
      height={230}
    >
      <BarChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 4 }}>
        <CartesianGrid vertical={false} stroke={GRID_STYLE.stroke} style={GRID_STYLE} />
        <XAxis
          dataKey="label"
          angle={-22}
          textAnchor="end"
          height={58}
          interval={0}
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={AXIS_LINE}
        />
        <YAxis
          domain={[0, 100]}
          tick={AXIS_TICK}
          tickLine={false}
          axisLine={false}
          tickFormatter={(value: number) => `${value}%`}
          width={54}
        />
        <Tooltip content={<ChartTooltip />} cursor={TOOLTIP_CURSOR} />
        <Bar
          dataKey="rate"
          name="Rate"
          fill={PALETTE.cyan}
          radius={[6, 6, 0, 0]}
          isAnimationActive={!prefersReducedMotion()}
        />
      </BarChart>
    </ChartCard>
  );
}

export function BatchCharts({ data }: { data: BatchChartData }) {
  const ref = useRef<HTMLDivElement>(null);

  /* Chart containers entrance: fade + slight y, quick stagger. */
  useEffect(() => {
    const scope = ref.current;
    if (!scope || prefersReducedMotion()) return;
    const ctx = gsap.context(() => {
      gsap.from(scope.querySelectorAll("[data-chart-card]"), {
        y: 26,
        opacity: 0,
        duration: 0.55,
        stagger: 0.08,
        ease: "power2.out",
        clearProps: "opacity,transform",
      });
    }, scope);
    return () => ctx.revert();
  }, [data]);

  const reduce = prefersReducedMotion();

  const classification = [
    { name: "Low risk", value: data.classification.low, color: PALETTE.low },
    { name: "High risk", value: data.classification.high, color: PALETTE.high },
  ];

  const histogram = data.probability_histogram.map((bin) => ({
    ...bin,
    label: `${bin.start}–${bin.end}`,
  }));

  const highPoints = data.age_vs_probability.filter((point) => point.risk_level === "High Risk");
  const lowPoints = data.age_vs_probability.filter((point) => point.risk_level !== "High Risk");

  return (
    <div ref={ref} className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-2">
        <ChartCard
          eyebrow="Classification"
          title="Low vs high risk split"
          description="Share of rows in each predicted risk class for this batch."
          ariaLabel={`Classification split: ${data.classification.low} low risk and ${data.classification.high} high risk rows`}
          height={250}
          footer={
            <div className="mt-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
              {classification.map((item) => (
                <span key={item.name} className="flex items-center gap-2 text-xs text-slate-400">
                  <span
                    aria-hidden="true"
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ background: item.color }}
                  />
                  {item.name}
                  <span className="font-semibold tabular-nums text-slate-200">
                    {item.value.toLocaleString()}
                  </span>
                </span>
              ))}
            </div>
          }
        >
          <PieChart>
            <Pie
              data={classification}
              dataKey="value"
              nameKey="name"
              innerRadius={56}
              outerRadius={86}
              paddingAngle={2}
              stroke="none"
              isAnimationActive={!reduce}
            >
              {classification.map((item) => (
                <Cell key={item.name} fill={item.color} />
              ))}
            </Pie>
            <Tooltip content={<ChartTooltip />} />
          </PieChart>
        </ChartCard>

        <ChartCard
          eyebrow="Distribution"
          title="Probability histogram"
          description="Rows per 10-point bin (0–100%). Bins at or above the 4% risk threshold are shown in rose."
          ariaLabel="Histogram of predicted stroke probability in ten-point bins"
          height={250}
          footer={
            <div className="mt-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
              <span className="flex items-center gap-2 text-xs text-slate-400">
                <span
                  aria-hidden="true"
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ background: PALETTE.low }}
                />
                Below {RISK_THRESHOLD_PCT}% (Low risk)
              </span>
              <span className="flex items-center gap-2 text-xs text-slate-400">
                <span
                  aria-hidden="true"
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ background: PALETTE.high }}
                />
                {RISK_THRESHOLD_PCT}% and above (High risk)
              </span>
            </div>
          }
        >
          <BarChart data={histogram} margin={{ top: 8, right: 8, left: -18, bottom: 4 }}>
            <CartesianGrid vertical={false} stroke={GRID_STYLE.stroke} style={GRID_STYLE} />
            <XAxis
              dataKey="label"
              interval={0}
              tick={{ ...AXIS_TICK, fontSize: 9 }}
              tickLine={false}
              axisLine={AXIS_LINE}
            />
            <YAxis
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
              width={54}
            />
            <Tooltip content={<ChartTooltip />} cursor={TOOLTIP_CURSOR} />
            <Bar
              dataKey="count"
              name="Rows"
              radius={[6, 6, 0, 0]}
              isAnimationActive={!reduce}
            >
              {histogram.map((bin) => (
                <Cell
                  key={`${bin.start}-${bin.end}`}
                  fill={bin.start >= RISK_THRESHOLD_PCT ? PALETTE.high : PALETTE.low}
                />
              ))}
            </Bar>
          </BarChart>
        </ChartCard>
      </div>

      <ChartCard
        eyebrow="Correlation"
        title="Age vs predicted probability"
        description="Every scored row, coloured by its predicted risk level."
        ariaLabel="Scatter plot of age against predicted stroke probability, coloured by risk level"
        height={320}
        footer={
          <div className="mt-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
            <span className="flex items-center gap-2 text-xs text-slate-400">
              <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full" style={{ background: PALETTE.high }} />
              High risk
              <span className="font-semibold tabular-nums text-slate-200">{highPoints.length.toLocaleString()}</span>
            </span>
            <span className="flex items-center gap-2 text-xs text-slate-400">
              <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full" style={{ background: PALETTE.low }} />
              Low risk
              <span className="font-semibold tabular-nums text-slate-200">{lowPoints.length.toLocaleString()}</span>
            </span>
          </div>
        }
      >
        <ScatterChart margin={{ top: 8, right: 12, left: -14, bottom: 4 }}>
          <CartesianGrid stroke={GRID_STYLE.stroke} style={GRID_STYLE} />
          <XAxis
            type="number"
            dataKey="age"
            name="Age"
            domain={["auto", "auto"]}
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={AXIS_LINE}
          />
          <YAxis
            type="number"
            dataKey="probability"
            name="Probability"
            domain={[0, "auto"]}
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value: number) => `${value}%`}
            width={54}
          />
          <Tooltip
            content={<ChartTooltip />}
            cursor={{ strokeDasharray: "3 3", stroke: "rgba(255,255,255,0.2)" }}
          />
          <Scatter
            name="High risk"
            data={highPoints}
            fill={PALETTE.high}
            isAnimationActive={!reduce}
          />
          <Scatter
            name="Low risk"
            data={lowPoints}
            fill={PALETTE.low}
            isAnimationActive={!reduce}
          />
        </ScatterChart>
      </ChartCard>

      <div className="grid gap-5 md:grid-cols-3">
        <RateBarChart
          rows={data.risk_by_hypertension}
          title="Risk by hypertension"
          description="High-risk rate for hypertensive vs non-hypertensive rows."
        />
        <RateBarChart
          rows={data.risk_by_smoking}
          title="Risk by smoking status"
          description="High-risk rate grouped by smoking status."
        />
        <RateBarChart
          rows={data.risk_by_work_type}
          title="Risk by work type"
          description="High-risk rate grouped by occupation category."
        />
      </div>
    </div>
  );
}
