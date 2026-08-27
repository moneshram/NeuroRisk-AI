import { motion, Variants } from "framer-motion";
import SelectField from "../components/SelectField";
import {
  Activity,
  ArrowRight,
  Brain,
  Check,
  HeartPulse,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";
import { useNavigate } from "react-router-dom";

import { api, PredictionResponse } from "../lib/api";
import { Screen } from "../components/Screen";
import { Layout } from "../components/Layout";
import { Field } from "../components/Field";
import { FieldError } from "../components/FieldError";

type AssessmentForm = {
  age: string | number;
  gender: string;
  hypertension: string | number;
  heart_disease: string | number;
  ever_married: string;
  work_type: string;
  residence_type: string;
  avg_glucose_level: string | number;
  bmi: string | number;
  smoking_status: string;
};

const defaults: AssessmentForm = {
  age: "",
  gender: "",
  hypertension: "",
  heart_disease: "",
  ever_married: "",
  work_type: "",
  residence_type: "",
  avg_glucose_level: "",
  bmi: "",
  smoking_status: "",
};

type AssessmentErrors = {
  age?: string;
  gender?: string;
  hypertension?: string;
  heart_disease?: string;
  ever_married?: string;
  work_type?: string;
  residence_type?: string;
  avg_glucose_level?: string;
  bmi?: string;
  smoking_status?: string;
  form?: string;
};

const sectionVariants: Variants = {
  hidden: {
    opacity: 0,
    y: 24,
  },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.5,
      ease: [0.22, 1, 0.36, 1],
    },
  },
};

const itemVariants: Variants = {
  hidden: {
    opacity: 0,
    y: 10,
  },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.35,
    },
  },
};

export default function Assessment() {
  const nav = useNavigate();

  const [form, setForm] = useState(defaults);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<AssessmentErrors>({});

  const progressKeys = [
    "age",
    "gender",
    "hypertension",
    "heart_disease",
    "ever_married",
    "work_type",
    "residence_type",
    "avg_glucose_level",
    "bmi",
    "smoking_status",
  ] as const;

  const completedFields = progressKeys.filter((key) => {
    const value = form[key];
    return value !== "" && value !== null && value !== undefined;
  }).length;

  const progress = (completedFields / progressKeys.length) * 100;

  const set = (key: string, value: string | number) => {
    setForm((current) => ({
      ...current,
      [key]: value,
    }));
    if (errors[key as keyof AssessmentErrors]) {
      setErrors((prev) => ({ ...prev, [key]: undefined }));
    }
  };

  function validate(): boolean {
    const errs: AssessmentErrors = {};
    const missing: string[] = [];

    if (form.age === "" || form.age === null || form.age === undefined) missing.push("age");
    if (form.gender === "") missing.push("gender");
    if (form.hypertension === "" || form.hypertension === null || form.hypertension === undefined) missing.push("hypertension");
    if (form.heart_disease === "" || form.heart_disease === null || form.heart_disease === undefined) missing.push("heart_disease");
    if (form.ever_married === "") missing.push("ever_married");
    if (form.work_type === "") missing.push("work_type");
    if (form.residence_type === "") missing.push("residence_type");
    if (form.avg_glucose_level === "" || form.avg_glucose_level === null || form.avg_glucose_level === undefined) missing.push("avg_glucose_level");
    if (form.bmi === "" || form.bmi === null || form.bmi === undefined) missing.push("bmi");
    if (form.smoking_status === "") missing.push("smoking_status");

    if (missing.length > 0) {
      const labelMap: Record<string, string> = {
        age: "Age",
        gender: "Gender",
        hypertension: "Hypertension",
        heart_disease: "Heart disease",
        ever_married: "Ever married",
        work_type: "Work type",
        residence_type: "Residence type",
        avg_glucose_level: "Average glucose",
        bmi: "BMI",
        smoking_status: "Smoking status",
      };
      for (const key of missing) {
        errs[key as keyof AssessmentErrors] = `${labelMap[key]} is required.`;
      }
      errs.form = `Complete all 10 clinical fields before calculating risk (${completedFields}/10 filled).`;
    }

    if (Number(form.age) <= 0 || Number(form.age) > 120) {
      errs.age = "Enter a valid age between 1 and 120.";
    }

    if (Number(form.avg_glucose_level) <= 0) {
      errs.avg_glucose_level = "Enter a valid average glucose level.";
    }

    if (Number(form.bmi) <= 0 || Number(form.bmi) > 100) {
      errs.bmi = "Enter a valid BMI.";
    }

    setErrors(errs);
    return Object.keys(errs).filter(k => k !== "form").length === 0;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    setBusy(true);

    try {
      const result = await api<PredictionResponse>("/predict", {
        method: "POST",
        body: JSON.stringify(form),
      });

      sessionStorage.setItem("stroke_result", JSON.stringify(result));

      toast.success("Assessment completed.");

      nav("/results");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to calculate risk.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Layout>
        {/* Ambient page decoration */}
        <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
          <motion.div
            animate={{
              x: [0, 30, 0],
              y: [0, -20, 0],
              scale: [1, 1.08, 1],
            }}
            transition={{
              duration: 12,
              repeat: Infinity,
              ease: "easeInOut",
            }}
            className="
              absolute
              left-[5%]
              top-[20%]
              h-72
              w-72
              rounded-full
              bg-cyan-400/[0.035]
              blur-3xl
            "
          />

          <motion.div
            animate={{
              x: [0, -35, 0],
              y: [0, 25, 0],
              scale: [1, 1.12, 1],
            }}
            transition={{
              duration: 15,
              repeat: Infinity,
              ease: "easeInOut",
            }}
            className="
              absolute
              right-[5%]
              top-[30%]
              h-80
              w-80
              rounded-full
              bg-violet-500/[0.035]
              blur-3xl
            "
          />
        </div>

        {/* Page heading */}
        <motion.div
          initial={{ opacity: 0, y: -18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="mb-7"
        >
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
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
                Clinical assessment
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
                Patient risk profile
              </h1>

              <p
                className="
                mt-2
                max-w-2xl
                text-sm
                leading-6
                text-slate-400
              "
              >
                Enter demographic and clinical attributes to generate a
                machine-learning stroke-risk estimate.
              </p>
            </div>

            {/* Status badges */}
            <div className="flex flex-wrap gap-2">
              <motion.span
                whileHover={{ scale: 1.03 }}
                className="
                  flex
                  items-center
                  gap-1.5
                  rounded-full
                  border
                  border-cyan-300/10
                  bg-cyan-300/[0.035]
                  px-3
                  py-1.5
                  text-xs
                  text-slate-400
                "
              >
                <ShieldCheck size={13} className="text-cyan-300" />
                Tabular data only
              </motion.span>

              <motion.span
                whileHover={{ scale: 1.03 }}
                className="
                  flex
                  items-center
                  gap-1.5
                  rounded-full
                  border
                  border-violet-300/10
                  bg-violet-300/[0.035]
                  px-3
                  py-1.5
                  text-xs
                  text-slate-400
                "
              >
                <Brain size={13} className="text-violet-300" />
                AI estimate
              </motion.span>
            </div>
          </div>
        </motion.div>

        {/* Progress */}
        <div className="mb-6">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-slate-400">
              Patient information
            </span>

            <span className="text-slate-600">
              {completedFields}/10 clinical attributes
            </span>
          </div>

          <div
            className="
            mt-2
            h-1.5
            overflow-hidden
            rounded-full
            bg-white/[0.06]
          "
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={10}
            aria-valuenow={completedFields}
            aria-label="Patient information completion"
          >
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.35, ease: "easeOut" }}
              className="
                h-full
                rounded-full
                bg-gradient-to-r
                from-cyan-400
                via-cyan-300
                to-violet-400
              "
            />
          </div>
        </div>

        {errors.form && (
          <div className="mb-5 rounded-2xl border border-rose-400/20 bg-rose-400/[.06] p-4 text-sm leading-6 text-rose-200">
            {errors.form}
          </div>
        )}

        <form noValidate onSubmit={submit} className="space-y-5">
          {/* DEMOGRAPHICS */}
          <motion.section
            variants={sectionVariants}
            initial="hidden"
            animate="visible"
            className="
              glass
              glow-border
              rounded-[2rem]
              p-6
              sm:p-8
              relative
              z-20
            "
          >
            <div className="mb-7 flex items-start gap-3">
              <div
                className="
                grid
                h-11
                w-11
                shrink-0
                place-items-center
                rounded-2xl
                bg-cyan-400/10
                text-cyan-300
              "
              >
                <Brain size={21} />
              </div>

              <div>
                <div className="flex items-center gap-2">
                  <h2 className="font-semibold">Demographics</h2>

                  <span
                    className="
                    rounded-full
                    bg-cyan-400/10
                    px-2
                    py-0.5
                    text-[10px]
                    font-semibold
                    uppercase
                    tracking-wider
                    text-cyan-300
                  "
                  >
                    Step 1
                  </span>
                </div>

                <p className="mt-1 text-xs text-slate-500">
                  Core patient attributes
                </p>
              </div>
            </div>

            <motion.div
              variants={{
                visible: {
                  transition: {
                    staggerChildren: 0.06,
                  },
                },
              }}
              initial="hidden"
              animate="visible"
              className="
                grid
                gap-5
                md:grid-cols-2
                lg:grid-cols-3
              "
            >
              <motion.div variants={itemVariants}>
                <Field label="Age" error={errors.age} htmlFor="assess-age">
                  <input
                    id="assess-age"
                    className={`field ${errors.age ? "field-error" : ""}`}
                    type="number"
                    min="1"
                    max="120"
                    inputMode="numeric"
                    placeholder="e.g. 55"
                    value={form.age || ""}
                    onChange={(e) => set("age", Number(e.target.value))}
                    aria-invalid={!!errors.age || undefined}
                    aria-describedby={errors.age ? "assess-age-error" : undefined}
                  />
                </Field>
              </motion.div>

              <motion.div variants={itemVariants}>
                <Field label="Gender" error={errors.gender} htmlFor="assess-gender">
                  <SelectField
                    value={form.gender}
                    onChange={(value) => set("gender", value)}
                    error={errors.gender}
                    ariaDescribedBy={errors.gender ? "assess-gender-error" : undefined}
                    options={[
                      { label: "Male", value: "Male" },
                      { label: "Female", value: "Female" },
                      { label: "Other", value: "Other" },
                    ]}
                  />
                </Field>
              </motion.div>

              <motion.div variants={itemVariants}>
                <Field label="Ever married" error={errors.ever_married} htmlFor="assess-ever-married">
                  <SelectField
                    value={form.ever_married}
                    onChange={(value) => set("ever_married", value)}
                    error={errors.ever_married}
                    ariaDescribedBy={errors.ever_married ? "assess-ever-married-error" : undefined}
                    options={[
                      { label: "Yes", value: "Yes" },
                      { label: "No", value: "No" },
                    ]}
                  />
                </Field>
              </motion.div>

              <motion.div variants={itemVariants}>
                <Field label="Work type" error={errors.work_type} htmlFor="assess-work-type">
                  <SelectField
                    value={form.work_type}
                    onChange={(value) => set("work_type", value)}
                    error={errors.work_type}
                    ariaDescribedBy={errors.work_type ? "assess-work-type-error" : undefined}
                    options={[
                      { label: "Private", value: "Private" },
                      { label: "Self-employed", value: "Self-employed" },
                      { label: "Government job", value: "Govt_job" },
                      { label: "Children", value: "children" },
                      { label: "Never worked", value: "Never_worked" },
                    ]}
                  />
                </Field>
              </motion.div>

              <motion.div variants={itemVariants}>
                <Field label="Residence type" error={errors.residence_type} htmlFor="assess-residence">
                  <SelectField
                    value={form.residence_type}
                    onChange={(value) => set("residence_type", value)}
                    error={errors.residence_type}
                    ariaDescribedBy={errors.residence_type ? "assess-residence-error" : undefined}
                    options={[
                      { label: "Urban", value: "Urban" },
                      { label: "Rural", value: "Rural" },
                    ]}
                  />
                </Field>
              </motion.div>
            </motion.div>
          </motion.section>

          {/* CLINICAL FACTORS */}
          <motion.section
            variants={sectionVariants}
            initial="hidden"
            animate="visible"
            transition={{ delay: 0.12 }}
            className="
              glass
              glow-border
              rounded-[2rem]
              p-6
              sm:p-8
              relative
              z-10
            "
          >
            <div className="mb-7 flex items-start gap-3">
              <div
                className="
                grid
                h-11
                w-11
                shrink-0
                place-items-center
                rounded-2xl
                bg-rose-400/10
                text-rose-300
              "
              >
                <HeartPulse size={21} />
              </div>

              <div>
                <div className="flex items-center gap-2">
                  <h2 className="font-semibold">Clinical factors</h2>

                  <span
                    className="
                    rounded-full
                    bg-rose-400/10
                    px-2
                    py-0.5
                    text-[10px]
                    font-semibold
                    uppercase
                    tracking-wider
                    text-rose-300
                  "
                  >
                    Step 2
                  </span>
                </div>

                <p className="mt-1 text-xs text-slate-500">
                  Cardiometabolic and lifestyle inputs
                </p>
              </div>
            </div>

            <motion.div
              variants={{
                visible: {
                  transition: {
                    staggerChildren: 0.06,
                  },
                },
              }}
              initial="hidden"
              animate="visible"
              className="
                grid
                gap-5
                md:grid-cols-2
                lg:grid-cols-3
              "
            >
              <motion.div variants={itemVariants}>
                <Field label="Hypertension" error={errors.hypertension} htmlFor="assess-hypertension">
                  <SelectField
                    value={form.hypertension}
                    onChange={(value) => set("hypertension", Number(value))}
                    error={errors.hypertension}
                    ariaDescribedBy={errors.hypertension ? "assess-hypertension-error" : undefined}
                    options={[
                      { label: "No", value: "0" },
                      { label: "Yes", value: "1" },
                    ]}
                  />
                </Field>
              </motion.div>

              <motion.div variants={itemVariants}>
                <Field label="Heart disease" error={errors.heart_disease} htmlFor="assess-heart-disease">
                  <SelectField
                    value={form.heart_disease}
                    onChange={(value) => set("heart_disease", Number(value))}
                    error={errors.heart_disease}
                    ariaDescribedBy={errors.heart_disease ? "assess-heart-disease-error" : undefined}
                    options={[
                      { label: "No", value: "0" },
                      { label: "Yes", value: "1" },
                    ]}
                  />
                </Field>
              </motion.div>

              <motion.div variants={itemVariants}>
                <Field label="Average glucose (mg/dL)" error={errors.avg_glucose_level} htmlFor="assess-glucose">
                  <input
                    id="assess-glucose"
                    className={`field ${errors.avg_glucose_level ? "field-error" : ""}`}
                    type="number"
                    min="1"
                    max="1000"
                    step="0.1"
                    inputMode="decimal"
                    placeholder="e.g. 110.5"
                    value={form.avg_glucose_level || ""}
                    onChange={(e) => set("avg_glucose_level", Number(e.target.value))}
                    aria-invalid={!!errors.avg_glucose_level || undefined}
                    aria-describedby={errors.avg_glucose_level ? "assess-glucose-error" : undefined}
                  />
                </Field>
              </motion.div>

              <motion.div variants={itemVariants}>
                <Field label="BMI" error={errors.bmi} htmlFor="assess-bmi">
                  <input
                    id="assess-bmi"
                    className={`field ${errors.bmi ? "field-error" : ""}`}
                    type="number"
                    min="1"
                    max="100"
                    step="0.1"
                    inputMode="decimal"
                    placeholder="e.g. 24.8"
                    value={form.bmi || ""}
                    onChange={(e) => set("bmi", Number(e.target.value))}
                    aria-invalid={!!errors.bmi || undefined}
                    aria-describedby={errors.bmi ? "assess-bmi-error" : undefined}
                  />
                </Field>
              </motion.div>

              <motion.div variants={itemVariants}>
                <Field label="Smoking status" error={errors.smoking_status} htmlFor="assess-smoking">
                  <SelectField
                    value={form.smoking_status}
                    onChange={(value) => set("smoking_status", value)}
                    error={errors.smoking_status}
                    ariaDescribedBy={errors.smoking_status ? "assess-smoking-error" : undefined}
                    options={[
                      { label: "Unknown", value: "Unknown" },
                      { label: "Never smoked", value: "never smoked" },
                      { label: "Formerly smoked", value: "formerly smoked" },
                      { label: "Smokes", value: "smokes" },
                    ]}
                  />
                </Field>
              </motion.div>
            </motion.div>
          </motion.section>

          {/* Bottom action area */}
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              delay: 0.35,
              duration: 0.45,
            }}
            className="
              flex
              flex-col
              gap-4
              rounded-[2rem]
              border
              border-white/10
              bg-white/[0.02]
              p-5
              sm:flex-row
              sm:items-center
              sm:justify-between
              sm:p-6
            "
          >
            <div className="flex items-start gap-3">
              <div
                className="
                mt-0.5
                grid
                h-9
                w-9
                shrink-0
                place-items-center
                rounded-xl
                bg-emerald-400/10
                text-emerald-300
              "
              >
                <Check size={17} />
              </div>

              <div>
                <p className="text-sm font-medium">Ready for analysis</p>

                <p
                  className="
                  mt-1
                  max-w-md
                  text-xs
                  leading-5
                  text-slate-500
                "
                >
                  Review the information before running the machine-learning
                  risk estimate.
                </p>
              </div>
            </div>

            <motion.button
              type="submit"
              whileHover={{
                scale: busy ? 1 : 1.02,
              }}
              whileTap={{
                scale: busy ? 1 : 0.98,
              }}
              disabled={busy}
              className="
                primary-btn
                min-h-12
                w-full
                sm:w-auto
                sm:min-w-56
                disabled:cursor-not-allowed
                disabled:opacity-60
              "
            >
              {busy ? (
                <>
                  <Activity size={18} className="animate-pulse" />
                  Analyzing profile…
                </>
              ) : (
                <>
                  Calculate risk
                  <ArrowRight size={18} />
                </>
              )}
            </motion.button>
          </motion.div>

          {/* Educational disclaimer */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
            className="
              flex
              gap-3
              rounded-2xl
              border
              border-cyan-300/10
              bg-cyan-300/[0.025]
              p-4
              text-xs
              leading-5
              text-slate-500
            "
          >
            <ShieldCheck
              size={16}
              className="
                mt-0.5
                shrink-0
                text-cyan-300/70
              "
            />

            <p>
              This tool uses demographic and clinical attributes only. No CT
              scans or medical images are uploaded or processed. The resulting
              estimate is intended for educational and demonstration purposes
              and is not a medical diagnosis.
            </p>
          </motion.div>
        </form>
      </Layout>
    </Screen>
  );
}
