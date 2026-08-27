import { motion } from "framer-motion";
import { Check, ChevronRight, KeyRound, Mail, Moon, Palette, Save, ShieldCheck, Sun, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { useNavigate } from "react-router-dom";
import { Layout } from "../components/Layout";
import { Screen } from "../components/Screen";
import { Field } from "../components/Field";
import { api, getUser, saveSession, User } from "../lib/api";
import { applyTheme, getTheme, Theme } from "../lib/theme";

export default function AdminSettings() {
  const nav = useNavigate();
  const user = getUser();
  const [name, setName] = useState(user?.name || "");
  const [email, setEmail] = useState(user?.email || "");
  const [theme, setTheme] = useState<Theme>(getTheme());
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; form?: string }>({});

  useEffect(() => { applyTheme(theme); }, [theme]);

  async function saveAccount(e: React.FormEvent) {
    e.preventDefault();
    const errs: typeof errors = {};
    if (!name.trim()) { errs.name = "Please enter your name."; }
    else if (name.trim().length < 2) { errs.name = "Name must be at least 2 characters."; }
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setBusy(true);
    setErrors({});
    try {
      const r = await api<{ user: User }>("/admin/profile", {
        method: "PUT",
        body: JSON.stringify({ name, email }),
      });
      const token = localStorage.getItem("stroke_token");
      if (token) saveSession(token, r.user);
      setName(r.user.name);
      setEmail(r.user.email);
      toast.success("Administrator account details updated.");
    } catch (error) {
      setErrors({ form: error instanceof Error ? error.message : "Unable to update administrator account." });
    } finally {
      setBusy(false);
    }
  }

  function choose(next: Theme) {
    setTheme(next);
    applyTheme(next);
    toast.success(`${next === "light" ? "Light" : "Dark"} theme enabled.`);
  }

  return (
    <Screen>
      <Layout>
        <motion.div initial={{ opacity: 0, y: -14 }} animate={{ opacity: 1, y: 0 }} className="mb-7">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.3em] text-violet-300"><ShieldCheck size={14} />Administrator settings</div>
          <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl lg:text-4xl">Settings</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">Manage administrator account information, security and console appearance.</p>
        </motion.div>
        <div className="grid gap-5 lg:grid-cols-[1.1fr_.9fr]">
          <motion.section initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }} className="glass rounded-[2rem] p-6 sm:p-8">
            <div className="flex items-start gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-violet-400/10 text-violet-300"><UserRound size={20} /></span>
              <div>
                <p className="text-xs uppercase tracking-[.25em] text-violet-300">Account</p>
                <h2 className="mt-1 text-xl font-semibold">Account details</h2>
                <p className="mt-1 text-sm text-slate-500">Administrator account information is kept up to date here.</p>
              </div>
            </div>

            {errors.form && (
              <div className="mt-5 rounded-2xl border border-rose-400/20 bg-rose-400/[.06] p-4 text-sm leading-6 text-rose-200">
                {errors.form}
              </div>
            )}

            <form noValidate onSubmit={saveAccount} className="mt-7 space-y-5">
              <Field label="Name" error={errors.name} htmlFor="admin-settings-name">
                <input id="admin-settings-name" className={`field ${errors.name ? "field-error" : ""}`} value={name} onChange={e => { setName(e.target.value); if (errors.name) setErrors(prev => ({ ...prev, name: undefined })); }} aria-invalid={!!errors.name || undefined} aria-describedby={errors.name ? "admin-settings-name-error" : undefined} />
              </Field>
              <Field label="Email address"><input className="field" value={email} readOnly /></Field>
              <div className="flex flex-col gap-3 pt-1 sm:flex-row sm:justify-end">
                <button type="button" className="ghost-btn px-4 py-3 text-sm" onClick={() => nav("/admin/settings/email")}><Mail size={16} /> Change email <ChevronRight size={15} /></button>
                <button type="button" className="ghost-btn px-4 py-3 text-sm" onClick={() => nav("/admin/settings/password")}><KeyRound size={16} /> Change password <ChevronRight size={15} /></button>
                <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: .98 }} type="submit" disabled={busy} className="primary-btn px-5 py-3 text-sm"><Save size={16} />{busy ? "Saving…" : "Save account details"}</motion.button>
              </div>
            </form>
          </motion.section>
          <motion.section initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} className="glass self-start rounded-[2rem] p-6 sm:p-8">
            <div className="flex items-start gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-violet-400/10 text-violet-300"><Palette size={20} /></span>
              <div>
                <p className="text-xs uppercase tracking-[.25em] text-violet-300">Appearance</p>
                <h2 className="mt-1 text-xl font-semibold">Theme</h2>
                <p className="mt-1 text-sm text-slate-500">Choose light or dark mode. Your choice is saved automatically.</p>
              </div>
            </div>
            <div className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              <ThemeOption icon={<Sun size={19} />} title="Light" description="Bright and clean" active={theme === "light"} onClick={() => choose("light")} />
              <ThemeOption icon={<Moon size={19} />} title="Dark" description="Original dark interface" active={theme === "dark"} onClick={() => choose("dark")} />
            </div>
            <div className="mt-4 rounded-2xl border border-white/10 bg-white/[.03] p-4 text-sm text-slate-400">
              <div className="flex items-center gap-2"><Check size={15} className="text-emerald-400" />Current theme: <b className="text-white">{theme === "light" ? "Light" : "Dark"}</b></div>
              <p className="mt-1 pl-6 text-xs text-slate-500">The selected theme remains active after refresh.</p>
            </div>
          </motion.section>
        </div>
      </Layout>
    </Screen>
  );
}

function ThemeOption({ icon, title, description, active, onClick }: { icon: React.ReactNode; title: string; description: string; active: boolean; onClick: () => void }) {
  return <motion.button whileHover={{ y: -2 }} whileTap={{ scale: .985 }} type="button" onClick={onClick} className={`theme-option ${active ? "theme-option-active" : ""}`} aria-pressed={active}><span className="theme-option-icon grid h-10 w-10 shrink-0 place-items-center rounded-2xl">{icon}</span><span className="min-w-0 flex-1 text-left"><span className="theme-option-title block text-sm font-semibold">{title}</span><span className="mt-1 block text-xs text-slate-500">{description}</span></span><span className={`theme-option-radio grid h-5 w-5 shrink-0 place-items-center rounded-full border ${active ? "theme-option-radio-active" : ""}`}>{active && <Check size={13} />}</span></motion.button>;
}
