import { useEffect, useMemo, useRef, useState } from "react";
import { gsap } from "gsap";
import { ChevronLeft, ChevronRight, ChevronsUpDown, Table2 } from "lucide-react";
import type { BatchRow } from "../../lib/batchApi";
import { prefersReducedMotion } from "./motion";

type SortKey = keyof BatchRow;
type SortDir = "asc" | "desc";

type Column = {
  key: SortKey;
  label: string;
  numeric?: boolean;
  render: (row: BatchRow) => React.ReactNode;
};

const COLUMNS: Column[] = [
  { key: "age", label: "Age", numeric: true, render: (row) => Math.round(row.age) },
  { key: "gender", label: "Gender", render: (row) => row.gender },
  { key: "hypertension", label: "Hypertension", render: (row) => (row.hypertension ? "Yes" : "No") },
  { key: "heart_disease", label: "Heart disease", render: (row) => (row.heart_disease ? "Yes" : "No") },
  { key: "ever_married", label: "Married", render: (row) => row.ever_married },
  { key: "work_type", label: "Work type", render: (row) => row.work_type },
  { key: "residence_type", label: "Residence", render: (row) => row.residence_type },
  {
    key: "avg_glucose_level",
    label: "Glucose",
    numeric: true,
    render: (row) => row.avg_glucose_level.toFixed(1),
  },
  { key: "bmi", label: "BMI", numeric: true, render: (row) => row.bmi.toFixed(1) },
  { key: "smoking_status", label: "Smoking", render: (row) => row.smoking_status },
  {
    key: "stroke_probability",
    label: "Probability",
    numeric: true,
    render: (row) => (
      <span className="font-semibold tabular-nums text-slate-100">
        {row.stroke_probability.toFixed(2)}%
      </span>
    ),
  },
  { key: "prediction", label: "Pred", numeric: true, render: (row) => row.prediction },
  { key: "risk_level", label: "Risk level", render: (row) => <RiskPill level={row.risk_level} /> },
];

function RiskPill({ level }: { level: string }) {
  const high = level === "High Risk";
  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-semibold ${
        high
          ? "border-rose-400/30 bg-rose-400/10 text-rose-300"
          : "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
      }`}
    >
      {level}
    </span>
  );
}

function compare(a: BatchRow, b: BatchRow, key: SortKey, dir: SortDir): number {
  const left = a[key];
  const right = b[key];
  let result = 0;
  if (typeof left === "number" && typeof right === "number") {
    result = left - right;
  } else {
    result = String(left).localeCompare(String(right));
  }
  return dir === "asc" ? result : -result;
}

export function ResultsTable({ rows }: { rows: BatchRow[] }) {
  const bodyRef = useRef<HTMLTableSectionElement>(null);
  const [sortKey, setSortKey] = useState<SortKey>("stroke_probability");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(0);

  const entries = useMemo(() => rows.map((row, id) => ({ row, id })), [rows]);

  const sorted = useMemo(() => {
    const copy = entries.slice();
    copy.sort((a, b) => compare(a.row, b.row, sortKey, sortDir) || a.id - b.id);
    return copy;
  }, [entries, sortKey, sortDir]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const start = safePage * pageSize;
  const pageEntries = sorted.slice(start, start + pageSize);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(COLUMNS.find((column) => column.key === key)?.numeric ? "desc" : "asc");
    }
    setPage(0);
  }

  /* Quick staggered fade for tbody rows whenever the page or sort changes. */
  useEffect(() => {
    const body = bodyRef.current;
    if (!body || prefersReducedMotion()) return;
    const rowNodes = body.querySelectorAll("tr");
    if (!rowNodes.length) return;
    const ctx = gsap.context(() => {
      gsap.from(rowNodes, {
        opacity: 0,
        y: 8,
        duration: 0.28,
        ease: "power2.out",
        stagger: { amount: 0.35 },
        clearProps: "opacity,transform",
      });
    }, body);
    return () => ctx.revert();
  }, [safePage, sortKey, sortDir, pageSize, rows]);

  const from = sorted.length ? start + 1 : 0;
  const to = Math.min(start + pageSize, sorted.length);

  return (
    <section data-results-entrance className="glass rounded-[2rem] p-5 sm:p-7">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[.25em] text-cyan-300">Row-level results</p>
          <h2 className="mt-1 text-xl font-semibold">Batch predictions</h2>
          <p className="mt-1 text-xs text-slate-500">
            Select a column header to sort · default ordering is probability (high → low)
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded-full border border-white/10 bg-white/[.03] px-3 py-1 text-xs text-slate-500">
            {sorted.length.toLocaleString()} rows
          </span>
          <label className="flex items-center gap-2 text-xs text-slate-500">
            Rows per page
            <select
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value));
                setPage(0);
              }}
              className="rounded-xl border border-white/10 bg-white/[.04] px-3 py-2 text-xs text-white outline-none focus:border-cyan-300/40"
            >
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
          </label>
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-white/[.03] p-8 text-center">
          <Table2 size={22} className="mx-auto text-slate-500" />
          <p className="mt-3 text-sm text-slate-400">No rows were returned for this batch.</p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1160px] text-left text-sm">
              <caption className="sr-only">
                Batch prediction results, sortable by column
              </caption>
              <thead className="text-xs uppercase tracking-wider text-slate-600">
                <tr className="border-b border-white/10">
                  <th scope="col" className="px-3 py-3 text-slate-600">
                    <span className="sr-only">Row number</span>#
                  </th>
                  {COLUMNS.map((column) => {
                    const active = column.key === sortKey;
                    return (
                      <th
                        key={column.key}
                        scope="col"
                        aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                        className="px-3 py-3"
                      >
                        <button
                          type="button"
                          onClick={() => toggleSort(column.key)}
                          className={`flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider transition-colors hover:text-cyan-300 ${
                            active ? "text-cyan-300" : ""
                          }`}
                        >
                          {column.label}
                          <ChevronsUpDown
                            size={12}
                            className={active ? "opacity-90" : "opacity-40"}
                            aria-hidden="true"
                          />
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody ref={bodyRef}>
                {pageEntries.map((entry, index) => (
                  <tr
                    key={entry.id}
                    className="border-b border-white/5 text-slate-300 transition-colors hover:bg-white/[.03]"
                  >
                    <td className="px-3 py-3.5 text-xs tabular-nums text-slate-600">
                      {start + index + 1}
                    </td>
                    {COLUMNS.map((column) => (
                      <td key={column.key} className="px-3 py-3.5">
                        {column.render(entry.row)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-5 flex flex-col items-center justify-between gap-3 sm:flex-row">
            <p className="text-xs text-slate-500">
              Showing <span className="tabular-nums text-slate-300">{from}</span>–
              <span className="tabular-nums text-slate-300">{to}</span> of{" "}
              <span className="tabular-nums text-slate-300">{sorted.length.toLocaleString()}</span>
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPage(Math.max(0, safePage - 1))}
                disabled={safePage === 0}
                className="ghost-btn px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronLeft size={14} /> Previous
              </button>
              <span className="px-2 text-xs tabular-nums text-slate-400">
                Page {safePage + 1} of {pageCount}
              </span>
              <button
                type="button"
                onClick={() => setPage(Math.min(pageCount - 1, safePage + 1))}
                disabled={safePage >= pageCount - 1}
                className="ghost-btn px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
