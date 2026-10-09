import { useEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import toast from "react-hot-toast";
import { Download, FileDown, Layers, RefreshCw, ShieldCheck } from "lucide-react";

import { Layout } from "../components/Layout";
import { Screen } from "../components/Screen";
import {
  downloadBatchReport,
  runBatchFromFile,
  runBatchFromSource,
  type BatchResponse,
  type BatchSource,
} from "../lib/batchApi";
import { UploadPanel } from "./batch/UploadPanel";
import { SummaryCards, type RiskFilter } from "./batch/SummaryCards";
import { BatchCharts } from "./batch/BatchCharts";
import { ResultsTable, type SortRequest } from "./batch/ResultsTable";
import { buildResultsCsv, downloadTextFile } from "./batch/csv";
import { bindButtonMotion, prefersReducedMotion } from "./batch/motion";

export default function Batch() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<BatchResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [riskFilter, setRiskFilter] = useState<RiskFilter>("all");
  const [sortRequest, setSortRequest] = useState<SortRequest | null>(null);
  const [sourceLabel, setSourceLabel] = useState("");

  /* Page entrance + delegated button micro-interactions (transform/opacity only). */
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return () => undefined;
    const unbind = bindButtonMotion(root);
    if (prefersReducedMotion()) return unbind;

    const ctx = gsap.context(() => {
      gsap.from("[data-entrance]", {
        y: 16,
        opacity: 0,
        duration: 0.5,
        stagger: 0.08,
        ease: "power2.out",
        clearProps: "opacity,transform",
      });
    }, root);
    return () => {
      ctx.revert();
      unbind();
    };
  }, []);

  /* Results header, table and disclaimer fade in once a batch completes. */
  useEffect(() => {
    if (!data) return;
    const root = rootRef.current;
    if (!root || prefersReducedMotion()) return;

    const ctx = gsap.context(() => {
      gsap.from("[data-results-entrance]", {
        y: 18,
        opacity: 0,
        duration: 0.5,
        stagger: 0.08,
        ease: "expo.out",
        clearProps: "opacity,transform",
      });
    }, root);
    return () => ctx.revert();
  }, [data]);

  async function startBatch(run: () => Promise<BatchResponse>) {
    if (busy) return;
    setBusy(true);
    try {
      const result = await run();
      setData(result);
      setRiskFilter("all");
      setSortRequest(null);
      const total = result.summary.total;
      toast.success(
        `Batch complete — ${total.toLocaleString()} row${total === 1 ? "" : "s"} scored.`,
      );
      window.scrollTo({
        top: 0,
        behavior: prefersReducedMotion() ? "auto" : "smooth",
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Batch analysis failed.");
    } finally {
      setBusy(false);
    }
  }

  const handleFile = (file: File) => {
    setSourceLabel(file.name);
    return startBatch(() => runBatchFromFile(file));
  };
  const handleSource = (source: BatchSource) => {
    setSourceLabel(source === "full" ? "full_data.csv" : "full_filled_stroke_data.csv");
    return startBatch(() => runBatchFromSource(source));
  };

  function scrollToResults() {
    document.getElementById("batch-results")?.scrollIntoView({
      behavior: prefersReducedMotion() ? "auto" : "smooth",
      block: "start",
    });
  }

  function handleFilterChange(next: RiskFilter) {
    setRiskFilter(next);
    if (next !== "all") scrollToResults();
  }

  function handleAverageClick() {
    setSortRequest({ key: "stroke_probability", dir: "desc", nonce: Date.now() });
    scrollToResults();
  }

  function downloadCsv() {
    if (!data) return;
    downloadTextFile("neurorisk_batch_results.csv", buildResultsCsv(data.results));
    toast.success("Results CSV downloaded.");
  }

  async function handleReport() {
    if (!data || reporting) return;
    setReporting(true);
    try {
      await downloadBatchReport(data);
      toast.success("PDF report downloaded.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to generate the PDF report.");
    } finally {
      setReporting(false);
    }
  }

  function reset() {
    setData(null);
    setRiskFilter("all");
    setSortRequest(null);
    setSourceLabel("");
    window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }

  return (
    <Screen>
      <Layout>
        <div ref={rootRef} aria-busy={busy || reporting}>
          {/* Page header */}
          <div
            data-entrance
            className="mb-7 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"
          >
            <div>
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.3em] text-violet-300">
                <Layers size={14} /> Admin tool
              </p>
              <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">
                Batch stroke-risk analysis
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
                Score an entire dataset in one run, review the aggregate charts, and export the
                results as CSV or a PDF report.
              </p>
            </div>
            {data && (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <button
                  type="button"
                  onClick={downloadCsv}
                  disabled={busy || reporting}
                  className="ghost-btn w-full px-4 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-50 sm:w-fit"
                >
                  <Download size={16} /> Download Results CSV
                </button>
                <button
                  type="button"
                  onClick={handleReport}
                  disabled={busy || reporting}
                  className="primary-btn w-full px-4 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-50 sm:w-fit"
                >
                  {reporting ? (
                    <>
                      <RefreshCw size={16} className="animate-spin" /> Generating…
                    </>
                  ) : (
                    <>
                      <FileDown size={16} /> Download PDF Report
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={reset}
                  disabled={busy || reporting}
                  className="ghost-btn w-full px-4 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-50 sm:w-fit"
                >
                  <RefreshCw size={16} /> Run Another Batch
                </button>
              </div>
            )}
          </div>

          {!data ? (
            <div data-entrance>
              <UploadPanel busy={busy} onFile={handleFile} onSource={handleSource} />
            </div>
          ) : (
            <>
              <SummaryCards
                summary={data.summary}
                results={data.results}
                sourceLabel={sourceLabel}
                riskFilter={riskFilter}
                onFilter={handleFilterChange}
                onAverage={handleAverageClick}
              />

              <div className="mt-5">
                <BatchCharts data={data.chart_data} />
              </div>

              <div className="mt-5" id="batch-results">
                <ResultsTable
                  rows={data.results}
                  riskFilter={riskFilter}
                  onClearFilter={() => setRiskFilter("all")}
                  sortRequest={sortRequest}
                />
              </div>

              {/* Disclaimer — wording reused verbatim from Results.tsx / Assessment.tsx */}
              <div
                data-results-entrance
                className="mt-5 rounded-[2rem] border border-cyan-300/10 bg-cyan-300/[0.035] p-6"
              >
                <div className="flex gap-3">
                  <ShieldCheck size={18} className="mt-0.5 shrink-0 text-cyan-300/70" />
                  <div className="space-y-3">
                    <p className="text-xs leading-5 text-slate-500">
                      {"The displayed probability is produced by the configured machine-learning pipeline. This system is for educational and demonstration purposes and is not a medical diagnosis."}
                    </p>
                    <p className="text-xs leading-5 text-slate-500">
                      {"This tool uses demographic and clinical attributes only. No CT scans or medical images are uploaded or processed. The resulting estimate is intended for educational and demonstration purposes and is not a medical diagnosis."}
                    </p>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </Layout>
    </Screen>
  );
}
