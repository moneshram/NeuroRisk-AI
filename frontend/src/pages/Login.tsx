import { motion } from "framer-motion";
import { BrainCircuit, LockKeyhole, Mail, Eye, EyeOff } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useState } from "react";
import toast from "react-hot-toast";
import { saveSession } from "../lib/api";
import { Ambient } from "../components/Ambient";
import { Screen } from "../components/Screen";
import { Field } from "../components/Field";

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string; form?: React.ReactNode }>({});

  function validate(): boolean {
    const errs: typeof errors = {};
    if (!email.trim()) {
      errs.email = "Please enter your email address.";
    } else if (!email.includes("@")) {
      errs.email = "Please enter a valid email address.";
    }
    if (!password) {
      errs.password = "Please enter your password.";
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setBusy(true);
    setErrors({});
    const API = import.meta.env.VITE_API_URL || "http://127.0.0.1:5000/api";
    try {
      let response: Response;
      try {
        response = await fetch(`${API}/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
        });
      } catch {
        setErrors({ form: "Unable to reach the server. Please try again later." });
        return;
      }
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 404 && body.code === "email_not_found") {
          setErrors({
            form: (
              <span>
                {body.error || "No account found with this email."}{" "}
                <Link to="/register" className="font-semibold underline hover:text-white">
                  Create an account
                </Link>
              </span>
            ),
          });
        } else if (response.status === 401 && body.code === "wrong_password") {
          setErrors({ form: body.error || "Incorrect password. Please try again." });
        } else {
          setErrors({ form: body.error || "Unable to sign in. Please try again later." });
        }
        return;
      }
      saveSession(body.access_token, body.user);
      toast.success("Welcome back.");
      navigate("/dashboard");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen>
      <Ambient />
      <div className="flex min-h-screen items-center justify-center px-4 py-8">
        <motion.div
          initial={{ scale: 0.96, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="glass glow-border w-full max-w-md rounded-[2rem] p-6 sm:p-9"
        >
          <div className="mb-8 flex items-center gap-4">
            <div className="auth-brand-mark grid h-14 w-14 place-items-center rounded-2xl"><BrainCircuit size={28}/></div>
            <div>
              <div className="auth-brand-title">NeuroRisk AI</div>
              <div className="auth-brand-subtitle">Stroke Classification</div>
              <h1 className="mt-2 text-2xl font-bold">Sign in</h1>
            </div>
          </div>
          <p className="mb-7 text-sm leading-6 text-slate-400">
            Secure access to the patient stroke-risk assessment workspace.
          </p>

          {errors.form && (
            <div className="mb-5 rounded-2xl border border-rose-400/20 bg-rose-400/[.06] p-4 text-sm leading-6 text-rose-200">
              {errors.form}
            </div>
          )}

          <form noValidate onSubmit={submit} className="space-y-5">
            <Field label="Email" error={errors.email} htmlFor="login-email">
              <div className="relative">
                <Mail
                  className="absolute left-4 top-3.5 text-slate-500"
                  size={17}
                />
                <input
                  id="login-email"
                  type="email"
                  className={`field pl-11 ${errors.email ? "field-error" : ""}`}
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (errors.email) setErrors((prev) => ({ ...prev, email: undefined }));
                  }}
                  aria-invalid={!!errors.email || undefined}
                  aria-describedby={errors.email ? "login-email-error" : undefined}
                />
              </div>
            </Field>
            <Field label="Password" error={errors.password} htmlFor="login-password">
              <div className="relative">
                <LockKeyhole
                  className="absolute left-4 top-3.5 text-slate-500"
                  size={17}
                />

                <input
                  id="login-password"
                  type={showPassword ? "text" : "password"}
                  className={`field pl-11 pr-12 ${errors.password ? "field-error" : ""}`}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (errors.password) setErrors((prev) => ({ ...prev, password: undefined }));
                  }}
                  aria-invalid={!!errors.password || undefined}
                  aria-describedby={errors.password ? "login-password-error" : undefined}
                />

                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 transition hover:text-cyan-300"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff size={19} /> : <Eye size={19} />}
                </button>
              </div>
            </Field>
            <div className="flex justify-end">
              <Link className="text-xs text-cyan-300 hover:text-cyan-200" to="/forgot-password">
                Forgot password?
              </Link>
            </div>
            <motion.button
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.98 }}
              disabled={busy}
              className="primary-btn w-full"
            >
              {busy ? "Authenticating…" : "Sign in"}
            </motion.button>
          </form>
          <div className="mt-7 flex justify-between text-sm">
            <Link className="text-cyan-300 hover:text-cyan-200" to="/register">
              Create account
            </Link>
            <Link className="text-slate-400 hover:text-white" to="/admin-login">
              Administrator gateway
            </Link>
          </div>
        </motion.div>
      </div>
    </Screen>
  );
}
