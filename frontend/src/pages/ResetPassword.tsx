import { motion } from "framer-motion";
import { BrainCircuit, CheckCircle2, LockKeyhole } from "lucide-react";
import { Link, useNavigate, useLocation, useSearchParams } from "react-router-dom";
import { useState } from "react";
import toast from "react-hot-toast";
import { api } from "../lib/api";
import { Screen } from "../components/Screen";
import { Ambient } from "../components/Ambient";
import { Field } from "../components/Field";

interface OtpState {
  email: string;
  otp: string;
  returnTo?: string;
}

export default function ResetPassword() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const otpState = (location.state as OtpState | null) || null;
  const returnTo = otpState?.returnTo;

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [errors, setErrors] = useState<{ password?: string; confirm?: string; form?: string }>({});

  const isOtpFlow = !!(otpState?.email && otpState?.otp);
  const isTokenFlow = !!token;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: typeof errors = {};
    if (password.length < 8) { errs.password = "Password must be at least 8 characters."; }
    if (password !== confirm) { errs.confirm = "Passwords do not match."; }
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setBusy(true);
    setErrors({});
    try {
      if (isOtpFlow) {
        await api("/auth/reset-password", {
          method: "POST",
          body: JSON.stringify({ email: otpState.email, otp: otpState.otp, password }),
        });
      } else if (isTokenFlow) {
        await api("/auth/reset-password", {
          method: "POST",
          body: JSON.stringify({ token, password }),
        });
      } else {
        setErrors({ form: "Reset session is invalid. Please start over." });
        setBusy(false);
        return;
      }
      toast.success("Password reset successfully.");
      setDone(true);
    } catch (e) {
      setErrors({ form: e instanceof Error ? e.message : "Unable to reset password. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Screen>
        <Ambient />
        <div className="flex min-h-screen items-center justify-center px-4 py-8">
          <motion.div
            initial={{ scale: .96, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="glass glow-border w-full max-w-md rounded-[2rem] p-7 sm:p-9 text-center"
          >
            <div className="mx-auto mb-6 grid h-16 w-16 place-items-center rounded-full bg-emerald-400/15 text-emerald-300">
              <CheckCircle2 size={32} />
            </div>
            <h1 className="text-2xl font-bold">Password reset successfully</h1>
            <p className="mt-3 text-sm leading-6 text-slate-400">
              Your password has been updated. You can now sign in with your new password.
            </p>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: .98 }}
              className="primary-btn mt-7 w-full"
              onClick={() => navigate(returnTo || "/login", { replace: true })}
            >
              {returnTo ? "Continue to Settings" : "Continue to Sign In"}
            </motion.button>
          </motion.div>
        </div>
      </Screen>
    );
  }

  if (!isOtpFlow && !isTokenFlow) {
    return (
      <Screen>
        <Ambient />
        <div className="flex min-h-screen items-center justify-center px-4 py-8">
          <motion.div
            initial={{ scale: .96, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="glass glow-border w-full max-w-md rounded-[2rem] p-7 sm:p-9"
          >
            <div className="mb-8 flex items-center gap-4">
              <div className="grid h-14 w-14 place-items-center rounded-2xl bg-cyan-400/10 text-cyan-300">
                <BrainCircuit size={28} />
              </div>
              <div>
                <p className="text-xs uppercase tracking-[.3em] text-cyan-300">NeuroRisk AI</p>
                <h1 className="mt-1 text-2xl font-bold">Reset password</h1>
              </div>
            </div>
            <p className="text-sm text-slate-400">
              This reset session is invalid or has expired.
            </p>
            <Link className="mt-6 inline-block text-sm text-cyan-300" to="/forgot-password">
              Request a new code
            </Link>
            <div className="mt-7 text-center text-sm">
              <Link className="text-cyan-300 hover:text-cyan-200" to={returnTo || "/login"}>{returnTo ? "Back to settings" : "Back to sign in"}</Link>
            </div>
          </motion.div>
        </div>
      </Screen>
    );
  }

  return (
    <Screen>
      <Ambient />
      <div className="flex min-h-screen items-center justify-center px-4 py-8">
        <motion.div
          initial={{ scale: .96, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="glass glow-border w-full max-w-md rounded-[2rem] p-7 sm:p-9"
        >
          <div className="mb-8 flex items-center gap-4">
            <div className="grid h-14 w-14 place-items-center rounded-2xl bg-cyan-400/10 text-cyan-300">
              <BrainCircuit size={28} />
            </div>
            <div>
              <p className="text-xs uppercase tracking-[.3em] text-cyan-300">NeuroRisk AI</p>
              <h1 className="mt-1 text-2xl font-bold">Reset password</h1>
            </div>
          </div>

          <form noValidate onSubmit={submit} className="space-y-5">
            {errors.form && (
              <div className="rounded-2xl border border-rose-400/20 bg-rose-400/[.06] p-4 text-sm leading-6 text-rose-200">
                {errors.form}
              </div>
            )}
            <Field label="New password" error={errors.password} htmlFor="rp-new-password">
              <div className="relative">
                <LockKeyhole className="absolute left-4 top-3.5 text-slate-500" size={17} />
                <input
                  id="rp-new-password"
                  type="password"
                  className={`field pl-11 ${errors.password ? "field-error" : ""}`}
                  value={password}
                  onChange={e => { setPassword(e.target.value); if (errors.password) setErrors(prev => ({ ...prev, password: undefined })); }}
                  placeholder="At least 8 characters"
                  aria-invalid={!!errors.password || undefined}
                  aria-describedby={errors.password ? "rp-new-password-error" : undefined}
                />
              </div>
            </Field>
            <Field label="Confirm password" error={errors.confirm} htmlFor="rp-confirm-password">
              <div className="relative">
                <LockKeyhole className="absolute left-4 top-3.5 text-slate-500" size={17} />
                <input
                  id="rp-confirm-password"
                  type="password"
                  className={`field pl-11 ${errors.confirm ? "field-error" : ""}`}
                  value={confirm}
                  onChange={e => { setConfirm(e.target.value); if (errors.confirm) setErrors(prev => ({ ...prev, confirm: undefined })); }}
                  placeholder="Re-enter password"
                  aria-invalid={!!errors.confirm || undefined}
                  aria-describedby={errors.confirm ? "rp-confirm-password-error" : undefined}
                />
              </div>
            </Field>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: .98 }}
              disabled={busy}
              className="primary-btn w-full"
            >
              {busy ? "Updating\u2026" : "Reset password"}
            </motion.button>
          </form>

          <div className="mt-7 text-center text-sm">
            <Link className="text-cyan-300 hover:text-cyan-200" to={returnTo || "/login"}>{returnTo ? "Back to settings" : "Back to sign in"}</Link>
          </div>
        </motion.div>
      </div>
    </Screen>
  );
}
