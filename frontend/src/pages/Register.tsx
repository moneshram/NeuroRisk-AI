import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  BrainCircuit,
  Check,
  Eye,
  EyeOff,
  LockKeyhole,
  Mail,
  User,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";

import { api } from "../lib/api";
import { Ambient } from "../components/Ambient";
import { Screen } from "../components/Screen";
import { FieldError } from "../components/FieldError";

type Step = 1 | 2 | 3 | 4;

export default function Register() {
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>(1);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const [fieldError, setFieldError] = useState("");

  const passwordChecks = useMemo(
    () => ({
      length: password.length >= 8,
      uppercase: /[A-Z]/.test(password),
      lowercase: /[a-z]/.test(password),
      number: /[0-9]/.test(password),
      special: /[^A-Za-z0-9]/.test(password),
    }),
    [password],
  );

  const passwordScore = useMemo(
    () => Object.values(passwordChecks).filter(Boolean).length,
    [passwordChecks],
  );

  const passwordStrength = useMemo(() => {
    if (password.length === 0) return null;
    if (passwordScore <= 2) return "weak";
    if (passwordScore <= 4) return "medium";
    return "strong";
  }, [passwordScore, password.length]);

  const allRequirementsMet = passwordScore === 5;

  const progress = (step / 4) * 100;

  function nextStep() {
    setFieldError("");

    if (step === 1) {
      if (name.trim().length < 2) {
        setFieldError("Please enter your full name.");
        return;
      }
      setStep(2);
      return;
    }

    if (step === 2) {
      const trimmed = email.trim();
      if (!trimmed) {
        setFieldError("Please enter your email address.");
        return;
      }
      if (!/^[A-Za-z0-9._%+-]+@gmail\.com$/.test(trimmed)) {
        setFieldError("Please enter a valid Gmail address.");
        return;
      }
      setStep(3);
      return;
    }

    if (step === 3) {
      if (!passwordChecks.length) {
        setFieldError("Password must be at least 8 characters.");
        return;
      }
      if (!passwordChecks.uppercase) {
        setFieldError("Please include an uppercase letter.");
        return;
      }
      if (!passwordChecks.lowercase) {
        setFieldError("Please include a lowercase letter.");
        return;
      }
      if (!passwordChecks.number) {
        setFieldError("Please include a number.");
        return;
      }
      if (!passwordChecks.special) {
        setFieldError("Please include a special character.");
        return;
      }
      setStep(4);
      return;
    }
  }

  function previousStep() {
    setFieldError("");
    if (step > 1) {
      setStep((step - 1) as Step);
    }
  }

  async function createAccount() {
    setFieldError("");

    if (password !== confirm) {
      setFieldError("Passwords do not match.");
      return;
    }

    if (!allRequirementsMet) {
      setFieldError("Password does not meet all requirements.");
      return;
    }

    setBusy(true);

    try {
      await api("/auth/register", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim().toLowerCase(),
          password,
        }),
      });

      toast.success("Account created successfully.");

      setTimeout(() => {
        navigate("/login");
      }, 700);
    } catch (error) {
      setFieldError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Ambient />

      <div className="flex min-h-screen items-center justify-center px-4 py-8 sm:px-6">
        <motion.div
          initial={{
            opacity: 0,
            y: 25,
            scale: 0.97,
          }}
          animate={{
            opacity: 1,
            y: 0,
            scale: 1,
          }}
          transition={{
            duration: 0.55,
            ease: [0.22, 1, 0.36, 1],
          }}
          className="
            glass
            glow-border
            w-full
            max-w-[500px]
            rounded-[28px]
            p-7
            sm:p-9
          "
        >
          {/* Header */}
          <div className="mb-8 flex items-center gap-4">
            <motion.div
              whileHover={{
                scale: 1.05,
                rotate: 2,
              }}
              className="
                flex
                h-14
                w-14
                shrink-0
                items-center
                justify-center
                rounded-2xl
                bg-violet-400/10
                text-violet-300
              "
            >
              <BrainCircuit size={29} />
            </motion.div>

            <div>
              <p
                className="
                text-[11px]
                font-semibold
                uppercase
                tracking-[0.35em]
                text-violet-300
              "
              >
                NeuroRisk AI
              </p>

              <h1
                className="
                mt-1
                text-3xl
                font-bold
                tracking-tight
                text-white
              "
              >
                Create account
              </h1>
            </div>
          </div>

          {/* Progress */}
          <div className="mb-8">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-widest text-slate-500">
                Registration
              </span>

              <span className="text-xs font-semibold text-violet-300">
                Step {step} of 4
              </span>
            </div>

            <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
              <motion.div
                className="
                  h-full
                  rounded-full
                  bg-gradient-to-r
                  from-violet-400
                  to-cyan-400
                "
                animate={{
                  width: `${progress}%`,
                }}
                transition={{
                  duration: 0.4,
                }}
              />
            </div>

            <div className="mt-4 grid grid-cols-4 gap-2">
              {[1, 2, 3, 4].map((item) => (
                <div
                  key={item}
                  className={`
                    h-1 rounded-full transition-all duration-300
                    ${item <= step ? "bg-violet-400" : "bg-white/10"}
                  `}
                />
              ))}
            </div>
          </div>

          {/* Step Content */}
          <div className="min-h-[270px]">
            <AnimatePresence mode="wait">
              {/* STEP 1 */}
              {step === 1 && (
                <motion.div
                  key="step-name"
                  initial={{
                    opacity: 0,
                    x: 25,
                  }}
                  animate={{
                    opacity: 1,
                    x: 0,
                  }}
                  exit={{
                    opacity: 0,
                    x: -25,
                  }}
                  transition={{
                    duration: 0.3,
                  }}
                >
                  <p className="text-xs uppercase tracking-[0.25em] text-violet-300">
                    Step 1
                  </p>

                  <h2 className="mt-2 text-2xl font-bold">
                    What should we call you?
                  </h2>

                  <p className="mt-2 text-sm leading-6 text-slate-400">
                    Enter your full name to personalize your workspace.
                  </p>

                  <div className="mt-8">
                    <label className="mb-2 block text-xs font-semibold uppercase tracking-widest text-slate-400">
                      Full name
                    </label>

                    <div className="relative">
                      <User
                        size={18}
                        className="
                          pointer-events-none
                          absolute
                          left-4
                          top-1/2
                          z-10
                          -translate-y-1/2
                          text-slate-500
                        "
                      />

                      <input
                        autoFocus
                        type="text"
                        value={name}
                        onChange={(e) => {
                          setName(e.target.value);
                          if (fieldError) setFieldError("");
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            nextStep();
                          }
                        }}
                        placeholder="Jane Doe"
                        aria-invalid={!!fieldError || undefined}
                        aria-describedby={fieldError ? "reg-name-error" : undefined}
                        className={`
                          field
                          !h-[54px]
                          !pl-12
                          ${fieldError ? "field-error" : ""}
                        `}
                      />
                    </div>
                    <FieldError id="reg-name-error" error={fieldError} />
                  </div>
                </motion.div>
              )}

              {/* STEP 2 */}
              {step === 2 && (
                <motion.div
                  key="step-email"
                  initial={{
                    opacity: 0,
                    x: 25,
                  }}
                  animate={{
                    opacity: 1,
                    x: 0,
                  }}
                  exit={{
                    opacity: 0,
                    x: -25,
                  }}
                  transition={{
                    duration: 0.3,
                  }}
                >
                  <p className="text-xs uppercase tracking-[0.25em] text-violet-300">
                    Step 2
                  </p>

                  <h2 className="mt-2 text-2xl font-bold">
                    Where can we reach you?
                  </h2>

                  <p className="mt-2 text-sm leading-6 text-slate-400">
                    Use an email address that you can access.
                  </p>

                  <div className="mt-8">
                    <label className="mb-2 block text-xs font-semibold uppercase tracking-widest text-slate-400">
                      Email address
                    </label>

                    <div className="relative">
                      <Mail
                        size={18}
                        className="
                          pointer-events-none
                          absolute
                          left-4
                          top-1/2
                          z-10
                          -translate-y-1/2
                          text-slate-500
                        "
                      />

                      <input
                        autoFocus
                        type="text"
                        inputMode="email"
                        autoComplete="email"
                        value={email}
                        onChange={(e) => {
                          setEmail(e.target.value);
                          if (fieldError) setFieldError("");
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            nextStep();
                          }
                        }}
                        placeholder="jane@example.com"
                        aria-invalid={!!fieldError || undefined}
                        aria-describedby={fieldError ? "reg-email-error" : undefined}
                        className={`
                          field
                          !h-[54px]
                          !pl-12
                          ${fieldError ? "field-error" : ""}
                        `}
                      />
                    </div>
                    <FieldError id="reg-email-error" error={fieldError} />
                  </div>
                </motion.div>
              )}

              {/* STEP 3 */}
              {step === 3 && (
                <motion.div
                  key="step-password"
                  initial={{
                    opacity: 0,
                    x: 25,
                  }}
                  animate={{
                    opacity: 1,
                    x: 0,
                  }}
                  exit={{
                    opacity: 0,
                    x: -25,
                  }}
                  transition={{
                    duration: 0.3,
                  }}
                >
                  <p className="text-xs uppercase tracking-[0.25em] text-violet-300">
                    Step 3
                  </p>

                  <h2 className="mt-2 text-2xl font-bold">
                    Secure your account
                  </h2>

                  <p className="mt-2 text-sm leading-6 text-slate-400">
                    Create a password with at least 8 characters.
                  </p>

                  <div className="mt-8">
                    <label className="mb-2 block text-xs font-semibold uppercase tracking-widest text-slate-400">
                      Password
                    </label>

                    <div className="relative">
                      <LockKeyhole
                        size={18}
                        className="
                          pointer-events-none
                          absolute
                          left-4
                          top-1/2
                          z-10
                          -translate-y-1/2
                          text-slate-500
                        "
                      />

                      <input
                        autoFocus
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={(e) => {
                          setPassword(e.target.value);
                          if (fieldError) setFieldError("");
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            nextStep();
                          }
                        }}
                        placeholder="At least 8 characters"
                        aria-invalid={!!fieldError || undefined}
                        aria-describedby="reg-password-strength reg-password-requirements"
                        className={`
                          field
                          !h-[54px]
                          !pl-12
                          !pr-12
                          ${fieldError ? "field-error" : ""}
                        `}
                      />

                      <button
                        type="button"
                        onClick={() => setShowPassword((current) => !current)}
                        className="
                          absolute
                          right-4
                          top-1/2
                          -translate-y-1/2
                          text-slate-500
                          transition
                          hover:text-white
                        "
                      >
                        {showPassword ? (
                          <EyeOff size={18} />
                        ) : (
                          <Eye size={18} />
                        )}
                      </button>
                    </div>

                    {/* Strength indicator */}
                    {password.length > 0 && (
                      <motion.div
                        id="reg-password-strength"
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="mt-4"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-slate-400">
                            Password strength:{" "}
                            <span
                              className={
                                passwordStrength === "strong"
                                  ? "font-semibold text-emerald-400"
                                  : passwordStrength === "medium"
                                    ? "font-semibold text-amber-400"
                                    : "font-semibold text-rose-400"
                              }
                            >
                              {passwordStrength === "strong"
                                ? "Strong"
                                : passwordStrength === "medium"
                                  ? "Medium"
                                  : "Weak"}
                            </span>
                          </span>
                        </div>

                        <div className="mt-2 flex gap-1.5">
                          {[1, 2, 3, 4, 5].map((i) => (
                            <div
                              key={i}
                              className={`
                                h-1.5 flex-1 rounded-full transition-all duration-300
                                ${
                                  i <= passwordScore
                                    ? passwordStrength === "strong"
                                      ? "bg-emerald-400"
                                      : passwordStrength === "medium"
                                        ? "bg-amber-400"
                                        : "bg-rose-400"
                                    : "bg-white/10"
                                }
                              `}
                            />
                          ))}
                        </div>
                      </motion.div>
                    )}

                    {/* Requirements list */}
                    <div
                      id="reg-password-requirements"
                      className="mt-4 space-y-2"
                    >
                      {(
                        [
                          ["length", "At least 8 characters"],
                          ["uppercase", "Uppercase letter"],
                          ["lowercase", "Lowercase letter"],
                          ["number", "Number"],
                          ["special", "Special character"],
                        ] as const
                      ).map(([key, label]) => {
                        const met = passwordChecks[key];
                        return (
                          <div
                            key={key}
                            className={`
                              flex items-center gap-2 text-xs transition-colors duration-200
                              ${password.length === 0 ? "text-slate-500" : met ? "text-emerald-400" : "text-slate-500"}
                            `}
                          >
                            <div
                              className={`
                                flex h-4 w-4 shrink-0 items-center justify-center rounded-full transition-all duration-200
                                ${
                                  met
                                    ? "bg-emerald-400/15 text-emerald-400"
                                    : "bg-white/5 text-slate-500"
                                }
                              `}
                            >
                              {met ? (
                                <Check size={10} strokeWidth={3} />
                              ) : (
                                <span className="h-1.5 w-1.5 rounded-full bg-current" />
                              )}
                            </div>
                            {label}
                          </div>
                        );
                      })}
                    </div>

                    <FieldError id="reg-password-error" error={fieldError} />
                  </div>
                </motion.div>
              )}

              {/* STEP 4 */}
              {step === 4 && (
                <motion.div
                  key="step-confirm"
                  initial={{
                    opacity: 0,
                    x: 25,
                  }}
                  animate={{
                    opacity: 1,
                    x: 0,
                  }}
                  exit={{
                    opacity: 0,
                    x: -25,
                  }}
                  transition={{
                    duration: 0.3,
                  }}
                >
                  <p className="text-xs uppercase tracking-[0.25em] text-violet-300">
                    Step 4
                  </p>

                  <h2 className="mt-2 text-2xl font-bold">
                    Confirm your password
                  </h2>

                  <p className="mt-2 text-sm leading-6 text-slate-400">
                    One final check before creating your account.
                  </p>

                  <div className="mt-8">
                    <label className="mb-2 block text-xs font-semibold uppercase tracking-widest text-slate-400">
                      Confirm password
                    </label>

                    <div className="relative">
                      <LockKeyhole
                        size={18}
                        className="
                          pointer-events-none
                          absolute
                          left-4
                          top-1/2
                          z-10
                          -translate-y-1/2
                          text-slate-500
                        "
                      />

                      <input
                        autoFocus
                        type={showConfirm ? "text" : "password"}
                        value={confirm}
                        onChange={(e) => {
                          setConfirm(e.target.value);
                          if (fieldError) setFieldError("");
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            createAccount();
                          }
                        }}
                        placeholder="Repeat your password"
                        aria-invalid={!!fieldError || undefined}
                        aria-describedby={fieldError ? "reg-confirm-error" : undefined}
                        className={`
                          field
                          !h-[54px]
                          !pl-12
                          !pr-12
                          ${
                            fieldError
                              ? "field-error"
                              : confirm && confirm !== password
                                ? "!border-rose-400/50"
                                : ""
                          }
                        `}
                      />

                      <button
                        type="button"
                        onClick={() => setShowConfirm((current) => !current)}
                        className="
                          absolute
                          right-4
                          top-1/2
                          -translate-y-1/2
                          text-slate-500
                          transition
                          hover:text-white
                        "
                      >
                        {showConfirm ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>

                    {confirm && confirm === password && !fieldError && (
                      <motion.div
                        initial={{
                          opacity: 0,
                          y: -5,
                        }}
                        animate={{
                          opacity: 1,
                          y: 0,
                        }}
                        className="
                          mt-3
                          flex
                          items-center
                          gap-2
                          text-xs
                          text-emerald-300
                        "
                      >
                        <Check size={15} />
                        Passwords match
                      </motion.div>
                    )}

                    {confirm && confirm !== password && !fieldError && (
                      <p className="mt-3 text-xs text-rose-300">
                        Passwords do not match.
                      </p>
                    )}

                    <FieldError id="reg-confirm-error" error={fieldError} />
                  </div>
                </motion.div>
              )}

            </AnimatePresence>
          </div>

          {/* Navigation */}
          <div className="mt-6 flex gap-3">
            {step > 1 && (
              <motion.button
                type="button"
                whileHover={{
                  scale: 1.02,
                }}
                whileTap={{
                  scale: 0.98,
                }}
                onClick={previousStep}
                className="
                  ghost-btn
                  h-[54px]
                  flex-1
                "
              >
                <ArrowLeft size={17} />
                Back
              </motion.button>
            )}

            {step < 4 ? (
              <motion.button
                type="button"
                whileHover={{
                  scale: 1.02,
                }}
                whileTap={{
                  scale: 0.98,
                }}
                onClick={nextStep}
                className="
                  primary-btn
                  h-[54px]
                  flex-1
                "
              >
                Continue
                <ArrowRight size={17} />
              </motion.button>
            ) : (
              <motion.button
                type="button"
                whileHover={{
                  scale: 1.02,
                }}
                whileTap={{
                  scale: 0.98,
                }}
                onClick={createAccount}
                disabled={busy}
                className="
                  primary-btn
                  h-[54px]
                  flex-1
                "
              >
                {busy ? (
                  "Creating account..."
                ) : (
                  <>
                    Create account
                    <Check size={17} />
                  </>
                )}
              </motion.button>
            )}
          </div>

          {/* Login link */}
          <div
            className="
            mt-7
            border-t
            border-white/10
            pt-6
            text-center
            text-sm
            text-slate-400
          "
          >
            Already have an account?{" "}
            <Link
              to="/login"
              className="
                font-medium
                text-cyan-300
                transition
                hover:text-cyan-200
              "
            >
              Sign in
            </Link>
          </div>
        </motion.div>
      </div>
    </Screen>
  );
}
