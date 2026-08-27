import { motion } from "framer-motion";
import { BrainCircuit, ShieldCheck, Lock, Mail } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { api, saveSession, User } from "../lib/api";
import { Screen } from "../components/Screen";

export default function AdminLogin() {
  const nav = useNavigate();
  const [email, setEmail] = useState("admin@stroke.local");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string; form?: string }>({});

  function validate(): boolean {
    const errs: typeof errors = {};
    if (!email.trim()) errs.email = "Please enter your email address.";
    if (!password) errs.password = "Please enter your password.";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setBusy(true);
    setErrors({});
    try {
      const r = await api<{ access_token: string; user: User }>("/auth/admin-login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      saveSession(r.access_token, r.user);
      toast.success("Administrator authenticated.");
      nav("/admin");
    } catch (e) {
      setErrors({ form: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <div className="min-h-screen bg-[radial-gradient(circle_at_50%_30%,rgba(124,58,237,.14),transparent_35%)] px-4 py-12">
        <div className="mx-auto max-w-md">
          <motion.div initial={{ opacity: 0, scale: .96 }} animate={{ opacity: 1, scale: 1 }} className="rounded-[2rem] border border-violet-400/20 bg-[#080912]/90 p-6 shadow-[0_0_80px_rgba(124,58,237,.1)] sm:p-8">
            <div className="mb-8 text-center">
              <div className="flex items-center justify-center gap-3">
                <span className="auth-brand-mark grid h-12 w-12 place-items-center rounded-2xl"><BrainCircuit size={25} /></span>
                <span className="text-left"><span className="auth-brand-title block">NeuroRisk AI</span><span className="auth-brand-subtitle block">Stroke Classification</span></span>
              </div>
              <p className="mt-6 text-xs uppercase tracking-[.35em] text-violet-300">Secure Gateway</p>
              <h1 className="mt-2 text-2xl font-bold sm:text-3xl">Administrator</h1>
              <p className="mt-2 text-sm text-slate-500">Global metrics and system administration</p>
            </div>

            {errors.form && (
              <div className="mb-5 rounded-2xl border border-rose-400/20 bg-rose-400/[.06] p-4 text-sm leading-6 text-rose-200">
                {errors.form}
              </div>
            )}

            <form noValidate onSubmit={submit} className="space-y-5">
              <div>
                <label className="label">Admin email</label>
                <div className="relative">
                  <Mail className="absolute left-4 top-3.5 text-slate-600" size={17} />
                  <input
                    className={`field pl-11 ${errors.email ? "field-error" : ""}`}
                    value={email}
                    onChange={e => { setEmail(e.target.value); if (errors.email) setErrors(prev => ({ ...prev, email: undefined })); }}
                    aria-invalid={!!errors.email || undefined}
                    aria-describedby={errors.email ? "al-email-error" : undefined}
                  />
                </div>
                {errors.email && <p id="al-email-error" role="alert" className="mt-2 flex items-center gap-1.5 text-xs text-rose-300">{errors.email}</p>}
              </div>
              <div>
                <label className="label">Password</label>
                <div className="relative">
                  <Lock className="absolute left-4 top-3.5 text-slate-600" size={17} />
                  <input
                    className={`field pl-11 ${errors.password ? "field-error" : ""}`}
                    type="password"
                    value={password}
                    onChange={e => { setPassword(e.target.value); if (errors.password) setErrors(prev => ({ ...prev, password: undefined })); }}
                    aria-invalid={!!errors.password || undefined}
                    aria-describedby={errors.password ? "al-password-error" : undefined}
                  />
                </div>
                {errors.password && <p id="al-password-error" role="alert" className="mt-2 flex items-center gap-1.5 text-xs text-rose-300">{errors.password}</p>}
              </div>
              <motion.button whileHover={{ scale: 1.01 }} whileTap={{ scale: .98 }} disabled={busy} className="primary-btn w-full from-violet-400 to-indigo-500">
                {busy ? "Verifying…" : "Enter secure console"}
              </motion.button>
            </form>
            <Link className="mt-7 block text-center text-sm text-slate-500 hover:text-white" to="/login">← Return to user login</Link>
          </motion.div>
        </div>
      </div>
    </Screen>
  );
}
