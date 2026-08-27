import { motion } from "framer-motion";
import { BrainCircuit, Mail } from "lucide-react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useEffect, useState, useRef, useCallback } from "react";
import toast from "react-hot-toast";
import { api } from "../lib/api";
import { Screen } from "../components/Screen";
import { Ambient } from "../components/Ambient";
import { Field } from "../components/Field";

const RESEND_COOLDOWN = 60;

export default function ForgotPassword() {
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo = (location.state as { returnTo?: string } | null)?.returnTo;
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState<"email" | "otp">("email");
  const [busy, setBusy] = useState(false);
  const [mailConfigured, setMailConfigured] = useState<boolean | null>(null);
  const [errors, setErrors] = useState<{ email?: string; otp?: string; form?: string }>({});

  const [cooldown, setCooldown] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startCooldown = useCallback(() => {
    setCooldown(RESEND_COOLDOWN);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setCooldown((prev) => {
        if (prev <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          timerRef.current = null;
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  useEffect(() => {
    api<{ configured: boolean }>("/auth/mail-status")
      .then((r) => setMailConfigured(r.configured))
      .catch(() => setMailConfigured(null));
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  async function sendOtp(e: React.FormEvent) {
    e.preventDefault();
    const errs: typeof errors = {};
    if (!email.trim()) errs.email = "Please enter your email address.";
    else if (!email.includes("@")) errs.email = "Please enter a valid email address.";
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setBusy(true);
    setErrors({});
    try {
      await api("/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email: email.trim().toLowerCase(), method: "otp" }),
      });
      toast.success("Verification code sent.");
      setStep("otp");
      startCooldown();
    } catch (e) {
      setErrors({ form: e instanceof Error ? e.message : "Unable to send the verification code. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  async function verifyOtp(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{6}$/.test(otp)) { setErrors({ otp: "Enter the 6-digit verification code." }); return; }
    setBusy(true);
    setErrors({});
    try {
      await api("/auth/verify-otp", {
        method: "POST",
        body: JSON.stringify({ email: email.trim().toLowerCase(), otp }),
      });
      toast.success("Verification code confirmed.");
      navigate("/reset-password", { state: { email: email.trim().toLowerCase(), otp, ...(returnTo ? { returnTo } : {}) } });
    } catch (e) {
      setErrors({ form: e instanceof Error ? e.message : "Invalid or expired verification code." });
    } finally {
      setBusy(false);
    }
  }

  async function resendOtp() {
    if (cooldown > 0 || busy) return;
    setErrors({});
    setBusy(true);
    try {
      await api("/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email: email.trim().toLowerCase(), method: "otp" }),
      });
      toast.success("A new verification code was sent.");
      setOtp("");
      startCooldown();
    } catch (e) {
      setErrors({ form: e instanceof Error ? e.message : "Unable to resend the verification code. Please try again." });
    } finally {
      setBusy(false);
    }
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
              <h1 className="mt-1 text-2xl font-bold">
                {step === "email" && "Reset your password"}
                {step === "otp" && "Verify OTP"}
              </h1>
            </div>
          </div>

          {step === "email" && (
            <>
              <p className="mb-6 text-sm leading-6 text-slate-400">
                Enter your registered email address and we'll send you a verification code.
              </p>

              {mailConfigured === false && (
                <div className="mb-5 rounded-2xl border border-amber-300/20 bg-amber-300/[.06] p-4 text-sm leading-6 text-amber-200">
                  Password reset email service is temporarily unavailable. Please try again later.
                </div>
              )}

              <form noValidate onSubmit={sendOtp} className="space-y-5">
                {errors.form && (
                  <div className="rounded-2xl border border-rose-400/20 bg-rose-400/[.06] p-4 text-sm leading-6 text-rose-200">
                    {errors.form}
                  </div>
                )}
                <Field label="Email" error={errors.email} htmlFor="fp-email">
                  <div className="relative">
                    <Mail className="absolute left-4 top-3.5 text-slate-500" size={17} />
                    <input
                      id="fp-email"
                      type="email"
                      className={`field pl-11 ${errors.email ? "field-error" : ""}`}
                      placeholder="you@example.com"
                      value={email}
                      onChange={e => { setEmail(e.target.value); if (errors.email) setErrors(prev => ({ ...prev, email: undefined })); }}
                      aria-invalid={!!errors.email || undefined}
                      aria-describedby={errors.email ? "fp-email-error" : undefined}
                    />
                  </div>
                </Field>
                <button disabled={busy} className="primary-btn w-full">
                  {busy ? "Sending\u2026" : "Send OTP"}
                </button>
              </form>
            </>
          )}

          {step === "otp" && (
            <div className="space-y-5">
              <div className="rounded-2xl border border-cyan-300/15 bg-cyan-300/[.035] p-4 text-sm leading-6 text-slate-400">
                A 6-digit verification code was sent to <strong className="text-cyan-300">{email}</strong>. It expires in <strong className="text-cyan-300">10 minutes</strong>.
              </div>

              <form noValidate onSubmit={verifyOtp} className="space-y-5">
                {errors.form && (
                  <div className="rounded-2xl border border-rose-400/20 bg-rose-400/[.06] p-4 text-sm leading-6 text-rose-200">
                    {errors.form}
                  </div>
                )}
                <Field label="Verification code" error={errors.otp} htmlFor="fp-otp">
                  <input
                    id="fp-otp"
                    autoFocus
                    inputMode="numeric"
                    maxLength={6}
                    className={`field tracking-[.35em] ${errors.otp ? "field-error" : ""}`}
                    placeholder="000000"
                    value={otp}
                    onChange={e => { setOtp(e.target.value.replace(/\D/g, "").slice(0, 6)); if (errors.otp) setErrors(prev => ({ ...prev, otp: undefined })); }}
                    aria-invalid={!!errors.otp || undefined}
                    aria-describedby={errors.otp ? "fp-otp-error" : undefined}
                  />
                </Field>
                <div className="flex gap-3">
                  <button
                    type="button"
                    className="ghost-btn flex-1"
                    onClick={() => { setStep("email"); setOtp(""); setErrors({}); }}
                  >
                    Back
                  </button>
                  <button disabled={busy || otp.length !== 6} className="primary-btn flex-1">
                    {busy ? "Verifying\u2026" : "Verify OTP"}
                  </button>
                </div>
                <div className="text-center">
                  <button
                    type="button"
                    disabled={cooldown > 0 || busy}
                    className={`text-xs ${cooldown > 0 ? "text-slate-600 cursor-not-allowed" : "text-cyan-300 hover:text-cyan-200 cursor-pointer"}`}
                    onClick={resendOtp}
                  >
                    {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend verification code"}
                  </button>
                </div>
              </form>
            </div>
          )}

          <div className="mt-7 text-center text-sm">
            <Link className="text-cyan-300 hover:text-cyan-200" to={returnTo || "/login"}>{returnTo ? "Back to settings" : "Back to sign in"}</Link>
          </div>
        </motion.div>
      </div>
    </Screen>
  );
}
