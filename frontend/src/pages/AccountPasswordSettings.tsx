import { motion } from "framer-motion";
import { ArrowLeft, KeyRound, Save } from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";
import { useNavigate } from "react-router-dom";
import { Layout } from "../components/Layout";
import { Screen } from "../components/Screen";
import { Field } from "../components/Field";
import { api } from "../lib/api";

export default function AccountPasswordSettings() {
  const nav = useNavigate();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<{ current?: string; next?: string; confirm?: string; form?: string }>({});

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: typeof errors = {};
    if (!current) { errs.current = "Please enter your current password."; }
    if (next.length < 8) { errs.next = "New password must be at least 8 characters."; }
    if (next !== confirm) { errs.confirm = "New password and confirmation do not match."; }
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setBusy(true);
    setErrors({});
    try {
      await api<{ message: string }>("/user/password", {
        method: "PUT",
        body: JSON.stringify({ current_password: current, new_password: next }),
      });
      toast.success("Password updated successfully.");
      nav("/settings");
    } catch (error) {
      setErrors({ form: error instanceof Error ? error.message : "Unable to update password." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Layout>
        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="mx-auto max-w-2xl">
          <div className="mb-7">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.3em] text-violet-300"><KeyRound size={15} />Security</div>
            <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">Change password</h1>
            <p className="mt-2 text-sm leading-6 text-slate-400">Use your current password to set a new patient account password.</p>
          </div>
          <section className="glass rounded-[2rem] p-6 sm:p-8">
            {errors.form && (
              <div className="mb-5 rounded-2xl border border-rose-400/20 bg-rose-400/[.06] p-4 text-sm leading-6 text-rose-200">
                {errors.form}
              </div>
            )}
            <form noValidate onSubmit={submit} className="space-y-5">
              <Field label="Current password" error={errors.current} htmlFor="aps-current">
                <input id="aps-current" className={`field ${errors.current ? "field-error" : ""}`} type="password" value={current} onChange={e => { setCurrent(e.target.value); if (errors.current) setErrors(prev => ({ ...prev, current: undefined })); }} autoComplete="current-password" aria-invalid={!!errors.current || undefined} aria-describedby={errors.current ? "aps-current-error" : undefined} />
              </Field>
              <Field label="New password" error={errors.next} htmlFor="aps-new">
                <input id="aps-new" className={`field ${errors.next ? "field-error" : ""}`} type="password" value={next} onChange={e => { setNext(e.target.value); if (errors.next) setErrors(prev => ({ ...prev, next: undefined })); }} autoComplete="new-password" aria-invalid={!!errors.next || undefined} aria-describedby={errors.next ? "aps-new-error" : undefined} />
              </Field>
              <Field label="Confirm new password" error={errors.confirm} htmlFor="aps-confirm">
                <input id="aps-confirm" className={`field ${errors.confirm ? "field-error" : ""}`} type="password" value={confirm} onChange={e => { setConfirm(e.target.value); if (errors.confirm) setErrors(prev => ({ ...prev, confirm: undefined })); }} autoComplete="new-password" aria-invalid={!!errors.confirm || undefined} aria-describedby={errors.confirm ? "aps-confirm-error" : undefined} />
              </Field>
              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <button type="button" className="ghost-btn px-4 py-3 text-sm" onClick={() => nav("/settings")}><ArrowLeft size={16} /> Back to settings</button>
                <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: .98 }} disabled={busy} className="primary-btn px-5 py-3 text-sm"><Save size={16} />{busy ? "Updating…" : "Update password"}</motion.button>
              </div>
            </form>
          </section>
        </motion.div>
      </Layout>
    </Screen>
  );
}
