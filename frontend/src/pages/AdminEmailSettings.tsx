import { motion } from "framer-motion";
import { ArrowLeft, Mail, Save } from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";
import { useNavigate } from "react-router-dom";
import { Layout } from "../components/Layout";
import { Screen } from "../components/Screen";
import { Field } from "../components/Field";
import { api, getUser, saveSession, User } from "../lib/api";

export default function AdminEmailSettings() {
  const nav = useNavigate();
  const user = getUser();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; form?: string }>({});

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: typeof errors = {};
    if (!email.trim()) {
      errs.email = "Please enter your email address.";
    } else if (!email.includes("@")) {
      errs.email = "Please enter a valid email address.";
    }
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setBusy(true);
    setErrors({});
    try {
      const r = await api<{ user: User }>("/admin/profile", {
        method: "PUT",
        body: JSON.stringify({ name: user?.name || "System Administrator", email }),
      });
      const token = localStorage.getItem("stroke_token");
      if (token) saveSession(token, r.user);
      toast.success("Administrator email updated.");
      nav("/admin/settings");
    } catch (error) {
      setErrors({ form: error instanceof Error ? error.message : "Unable to update administrator email." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Layout>
        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="mx-auto max-w-2xl">
          <div className="mb-7">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.3em] text-violet-300"><Mail size={15} />Email address</div>
            <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">Change admin email address</h1>
            <p className="mt-2 text-sm leading-6 text-slate-400">Update the email address used to access the administrator console.</p>
          </div>
          <section className="glass rounded-[2rem] p-6 sm:p-8">
            {errors.form && (
              <div className="mb-5 rounded-2xl border border-rose-400/20 bg-rose-400/[.06] p-4 text-sm leading-6 text-rose-200">
                {errors.form}
              </div>
            )}
            <form noValidate onSubmit={submit} className="space-y-5">
              <Field label="Current email address"><input className="field" value={user?.email || ""} readOnly /></Field>
              <Field label="New email address" error={errors.email} htmlFor="ae-admin-email">
                <input id="ae-admin-email" className={`field ${errors.email ? "field-error" : ""}`} type="email" value={email} onChange={e => { setEmail(e.target.value); if (errors.email) setErrors(prev => ({ ...prev, email: undefined })); }} autoComplete="email" aria-invalid={!!errors.email || undefined} aria-describedby={errors.email ? "ae-admin-email-error" : undefined} />
              </Field>
              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <button type="button" className="ghost-btn px-4 py-3 text-sm" onClick={() => nav("/admin/settings")}><ArrowLeft size={16} /> Back to settings</button>
                <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: .98 }} disabled={busy} className="primary-btn px-5 py-3 text-sm"><Save size={16} />{busy ? "Updating…" : "Update email address"}</motion.button>
              </div>
            </form>
          </section>
        </motion.div>
      </Layout>
    </Screen>
  );
}
