import { useEffect, useRef, useState } from "react";
import { gsap } from "gsap";
import toast from "react-hot-toast";
import { Database, FileText, Loader2, UploadCloud } from "lucide-react";
import { MAX_UPLOAD_BYTES, type BatchSource } from "../../lib/batchApi";
import { CSV_TEMPLATE, downloadTextFile } from "./csv";
import { prefersReducedMotion } from "./motion";

type UploadPanelProps = {
  busy: boolean;
  onFile: (file: File) => void;
  onSource: (source: BatchSource) => void;
};

type ZoneVisual = "idle" | "hover" | "drag";

export function UploadPanel({ busy, onFile, onSource }: UploadPanelProps) {
  const zoneRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [visual, setVisual] = useState<ZoneVisual>("idle");

  /* Upload-zone active/hover micro-states: transform + opacity only. */
  useEffect(() => {
    const zone = zoneRef.current;
    const overlay = overlayRef.current;
    if (!zone || !overlay) return;

    const scale = visual === "drag" ? 1.02 : visual === "hover" ? 1.008 : 1;
    const overlayOpacity = visual === "drag" ? 1 : visual === "hover" ? 0.55 : 0;

    if (prefersReducedMotion()) {
      gsap.set(zone, { scale: 1 });
      gsap.set(overlay, { opacity: overlayOpacity });
      return;
    }

    const ctx = gsap.context(() => {
      gsap.to(zone, { scale, duration: 0.3, ease: "power2.out", overwrite: "auto" });
      gsap.to(overlay, { opacity: overlayOpacity, duration: 0.25, ease: "power2.out", overwrite: "auto" });
    }, zone);
    return () => ctx.revert();
  }, [visual]);

  function validate(file: File): boolean {
    if (!file.name.toLowerCase().endsWith(".csv")) {
      toast.error("Only .csv files are supported.");
      return false;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      toast.error("File exceeds the 10 MB upload limit.");
      return false;
    }
    return true;
  }

  function handleFiles(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    if (validate(file)) onFile(file);
  }

  function pickFile() {
    if (busy) return;
    inputRef.current?.click();
  }

  function downloadTemplate() {
    downloadTextFile("neurorisk_batch_template.csv", CSV_TEMPLATE);
    toast.success("CSV template downloaded.");
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1.15fr_.85fr]">
      {/* Option A — upload */}
      <section className="glass rounded-[2rem] p-5 sm:p-7">
        <p className="text-xs uppercase tracking-[.25em] text-cyan-300">Option A — upload</p>
        <h2 className="mt-1 text-xl font-semibold">Score your own CSV</h2>
        <p className="mt-1 text-sm leading-6 text-slate-500">
          Drop a CSV with the 10 model features, or click the zone to pick a file.
        </p>

        <div
          ref={zoneRef}
          role="button"
          tabIndex={busy ? -1 : 0}
          aria-disabled={busy}
          aria-label="Choose a CSV file, or drop one here"
          onClick={pickFile}
          onKeyDown={(event) => {
            if (busy) return;
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              pickFile();
            }
          }}
          onMouseEnter={() => setVisual((v) => (busy ? v : v === "drag" ? v : "hover"))}
          onMouseLeave={() => setVisual((v) => (v === "drag" ? v : "idle"))}
          onDragEnter={(event) => {
            event.preventDefault();
            if (!busy) setVisual("drag");
          }}
          onDragOver={(event) => {
            event.preventDefault();
            if (!busy) setVisual("drag");
          }}
          onDragLeave={(event) => {
            const next = event.relatedTarget;
            if (next instanceof Node && event.currentTarget.contains(next)) return;
            setVisual((v) => (v === "drag" ? "idle" : v));
          }}
          onDrop={(event) => {
            event.preventDefault();
            setVisual("idle");
            if (!busy) handleFiles(event.dataTransfer.files);
          }}
          className={`relative mt-5 cursor-pointer overflow-hidden rounded-[2rem] border border-dashed px-6 py-10 text-center outline-none transition-colors focus-visible:ring-4 focus-visible:ring-cyan-400/20 ${
            visual === "drag"
              ? "border-cyan-300/60 bg-cyan-400/[.06]"
              : "border-white/20 bg-white/[.03] hover:border-white/30"
          } ${busy ? "pointer-events-none opacity-60" : ""}`}
        >
          <div
            ref={overlayRef}
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-cyan-400/[.07] opacity-0"
          />
          <div className="relative z-10 flex flex-col items-center">
            <span className="grid h-14 w-14 place-items-center rounded-2xl bg-cyan-400/10 text-cyan-300">
              <UploadCloud size={26} />
            </span>
            <p className="mt-4 text-sm font-semibold text-slate-200">
              {visual === "drag" ? "Release to score this file" : "Drag & drop your CSV here"}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              .csv only · up to 10 MB · 10 feature columns required
            </p>
            <span className="ghost-btn mt-4 px-4 py-2 text-xs">
              <FileText size={14} /> Browse files
            </span>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            tabIndex={-1}
            aria-hidden="true"
            className="sr-only"
            onChange={(event) => {
              handleFiles(event.target.files);
              event.target.value = "";
            }}
          />
        </div>

        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs leading-5 text-slate-500">
            Not sure about the columns? Generate the exact template the model expects.
          </p>
          <button
            type="button"
            onClick={downloadTemplate}
            disabled={busy}
            className="ghost-btn w-full shrink-0 px-4 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-50 sm:w-fit"
          >
            <FileText size={15} /> Download CSV Template
          </button>
        </div>
      </section>

      {/* Option B — bundled datasets */}
      <section className="glass rounded-[2rem] p-5 sm:p-7">
        <p className="text-xs uppercase tracking-[.25em] text-violet-300">Option B — sample data</p>
        <h2 className="mt-1 text-xl font-semibold">Use a bundled dataset</h2>
        <p className="mt-1 text-sm leading-6 text-slate-500">
          Score the datasets already stored on the server — no upload required.
        </p>

        <div className="mt-5 space-y-3">
          <button
            type="button"
            onClick={() => onSource("full")}
            disabled={busy}
            className="ghost-btn w-full justify-start px-4 py-4 text-left disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Database size={16} className="shrink-0 text-cyan-300" />
            <span className="min-w-0">
              <span className="block text-sm font-semibold">Use full_data.csv (≈ 4981 rows)</span>
              <span className="block text-xs font-normal text-slate-500">
                source = full · complete historical dataset
              </span>
            </span>
          </button>

          <button
            type="button"
            onClick={() => onSource("filled")}
            disabled={busy}
            className="ghost-btn w-full justify-start px-4 py-4 text-left disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Database size={16} className="shrink-0 text-violet-300" />
            <span className="min-w-0">
              <span className="block text-sm font-semibold">
                Use full_filled_stroke_data (≈ 201 rows)
              </span>
              <span className="block text-xs font-normal text-slate-500">
                source = filled · cleaned, gap-free subset
              </span>
            </span>
          </button>
        </div>

        <div
          role="status"
          aria-live="polite"
          className="mt-6 flex min-h-[46px] items-center gap-2 rounded-2xl border border-white/10 bg-white/[.03] px-4 py-3 text-xs text-slate-500"
        >
          {busy ? (
            <>
              <Loader2 size={15} className="animate-spin text-cyan-300" />
              <span>Scoring the batch — large datasets can take a few seconds…</span>
            </>
          ) : (
            <>
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400/70" aria-hidden="true" />
              <span>Ready — pick a file or a bundled dataset to begin.</span>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
