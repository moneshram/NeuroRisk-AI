import { motion } from "framer-motion";
import {
  Activity,
  AlertCircle,
  Eye,
  Plus,
  RefreshCw,
  ShieldAlert,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import toast from "react-hot-toast";
import { api } from "../lib/api";
import { Layout } from "../components/Layout";
import { Screen } from "../components/Screen";

type AdminUser = {
  id: number;
  name: string;
  email: string;
  role: string;
  created_at: string | null;
  prediction_count: number;
};
type AdminPrediction = {
  id: number;
  user_id: number;
  user_name: string;
  user_email: string;
  prediction: string;
  probability: number;
  risk_level: string;
  created_at: string | null;
  patient?: Record<string, unknown>;
};

const emptyPrediction = {
  user_id: "",
  age: "",
  gender: "Female",
  hypertension: "0",
  heart_disease: "0",
  ever_married: "No",
  work_type: "Private",
  residence_type: "Urban",
  avg_glucose_level: "",
  bmi: "",
  smoking_status: "Unknown",
};

export default function Admin() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [predictions, setPredictions] = useState<AdminPrediction[]>([]);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [viewUser, setViewUser] = useState<AdminUser | null>(null);
  const [viewPrediction, setViewPrediction] = useState<AdminPrediction | null>(null);
  const [confirmUser, setConfirmUser] = useState<AdminUser | null>(null);
  const [deletingUser, setDeletingUser] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(emptyPrediction);
  const [predErrors, setPredErrors] = useState<Record<string, string>>({});

  async function load() {
    setBusy(true);
    setLoadError(null);
    try {
      const [usersResult, predictionsResult] = await Promise.allSettled([
        api<AdminUser[]>("/admin/users"),
        api<AdminPrediction[]>("/admin/predictions"),
      ]);
      const errors: string[] = [];
      if (usersResult.status === "fulfilled") {
        setUsers(usersResult.value);
      } else {
        errors.push("users");
      }
      if (predictionsResult.status === "fulfilled") {
        setPredictions(predictionsResult.value);
      } else {
        errors.push("predictions");
      }
      if (errors.length) {
        const msg = `Unable to load ${errors.join(" and ")} from the server.`;
        setLoadError(msg);
        toast.error(msg);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unable to load admin data.";
      setLoadError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!confirmUser) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !deletingUser) setConfirmUser(null);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [confirmUser, deletingUser]);

  function removeUser(user: AdminUser) {
    setConfirmUser(user);
  }

  async function confirmRemoveUser() {
    if (!confirmUser || deletingUser) return;
    setDeletingUser(true);
    try {
      await api(`/admin/users/${confirmUser.id}`, { method: "DELETE" });
      toast.success(`${confirmUser.name} was removed.`);
      setConfirmUser(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Unable to remove user.");
    } finally {
      setDeletingUser(false);
    }
  }

  async function removePrediction(prediction: AdminPrediction) {
    if (!window.confirm(`Remove prediction #${prediction.id}?`)) return;
    try {
      await api(`/admin/predictions/${prediction.id}`, { method: "DELETE" });
      toast.success("Prediction removed.");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Unable to remove prediction.");
    }
  }

  async function openUser(user: AdminUser) {
    try {
      setViewUser(await api<AdminUser>(`/admin/users/${user.id}`));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Unable to view user.");
    }
  }

  async function openPrediction(prediction: AdminPrediction) {
    try {
      setViewPrediction(await api<AdminPrediction>(`/admin/predictions/${prediction.id}`));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Unable to view prediction.");
    }
  }

  const setField = (key: string, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    if (predErrors[key]) setPredErrors((prev) => { const n = { ...prev }; delete n[key]; return n; });
  };

  async function addPrediction(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!form.user_id) errs.user_id = "Select a user.";
    if (!form.age) errs.age = "Enter age.";
    if (!form.avg_glucose_level) errs.avg_glucose_level = "Enter average glucose.";
    if (!form.bmi) errs.bmi = "Enter BMI.";
    if (Object.keys(errs).length) { setPredErrors(errs); return; }
    setPredErrors({});
    try {
      const result = await api<AdminPrediction>("/admin/predictions", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          user_id: Number(form.user_id),
          age: Number(form.age),
          hypertension: Number(form.hypertension),
          heart_disease: Number(form.heart_disease),
          avg_glucose_level: Number(form.avg_glucose_level),
          bmi: Number(form.bmi),
        }),
      });
      toast.success(`Prediction #${result.id} added.`);
      setShowAdd(false);
      setForm(emptyPrediction);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Unable to add prediction.");
    }
  }

  const cards = [
    ["Registered users", users.length, Users],
    ["Predictions", predictions.length, Activity],
    ["High-risk outputs", predictions.filter((p) => p.risk_level === "High Risk").length, ShieldAlert],
  ] as const;

  return (
    <Screen>
      <Layout>
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[.3em] text-violet-300">System console</p>
            <h1 className="mt-2 text-2xl font-bold sm:text-3xl">Administrator dashboard</h1>
            <p className="mt-2 text-sm text-slate-500">Manage registered users and stored stroke-risk predictions.</p>
          </div>
          <button onClick={load} className="ghost-btn w-full sm:w-auto" disabled={busy}>
            <RefreshCw size={16} className={busy ? "animate-spin" : ""} /> Refresh
          </button>
        </div>

        <div className="grid gap-5 md:grid-cols-3">
          {cards.map(([name, value, Icon], i) => (
            <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }} key={name} className="glass rounded-[2rem] p-5 sm:p-7">
              <Icon className="text-violet-300" />
              <div className="mt-5 text-3xl font-bold sm:mt-7 sm:text-4xl">{value}</div>
              <div className="mt-2 text-sm text-slate-500">{name}</div>
            </motion.div>
          ))}
        </div>

        {loadError && (
          <div className="mt-5 rounded-2xl border border-rose-400/20 bg-rose-400/[.06] p-4 text-sm leading-6 text-rose-200">
            Failed to load admin data: {loadError} — the cards and tables below may be incomplete. Click <strong>Refresh</strong> to try again.
          </div>
        )}

        <section className="glass mt-6 rounded-[2rem] p-5 sm:p-7">
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[.25em] text-cyan-300">Accounts</p>
              <h2 className="mt-1 text-xl font-semibold">Registered users</h2>
            </div>
            <span className="rounded-full border border-white/10 bg-white/[.03] px-3 py-1 text-xs text-slate-500">{users.length} users</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="text-xs uppercase tracking-wider text-slate-600">
                <tr className="border-b border-white/10">
                  <th className="px-3 py-3">User</th><th className="px-3 py-3">Email</th><th className="px-3 py-3">Registered</th><th className="px-3 py-3">Predictions</th><th className="px-3 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id} className="border-b border-white/5 text-slate-300">
                    <td className="px-3 py-4 font-medium">{user.name}</td>
                    <td className="px-3 py-4 text-slate-400">{user.email}</td>
                    <td className="px-3 py-4 text-slate-500">{formatDate(user.created_at)}</td>
                    <td className="px-3 py-4">{user.prediction_count}</td>
                    <td className="px-3 py-4"><div className="flex justify-end gap-2"><button className="ghost-btn px-3 py-2 text-xs" onClick={() => openUser(user)}><Eye size={14}/> View</button><button className="ghost-btn px-3 py-2 text-xs text-rose-300" onClick={() => removeUser(user)}><Trash2 size={14}/> Remove</button></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!users.length && !loadError && <p className="py-8 text-center text-sm text-slate-600">No registered users yet.</p>}
            {!users.length && loadError && <p className="py-8 text-center text-sm text-slate-600">Unable to load users.</p>}
          </div>
        </section>

        <section className="glass mt-6 rounded-[2rem] p-5 sm:p-7">
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[.25em] text-violet-300">Risk records</p>
              <h2 className="mt-1 text-xl font-semibold">Prediction management</h2>
            </div>
            <button className="primary-btn w-full px-4 py-2.5 text-sm sm:w-auto" onClick={() => setShowAdd(true)}><Plus size={16}/> Add prediction</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="text-xs uppercase tracking-wider text-slate-600"><tr className="border-b border-white/10"><th className="px-3 py-3">ID</th><th className="px-3 py-3">User</th><th className="px-3 py-3">Result</th><th className="px-3 py-3">Probability</th><th className="px-3 py-3">Date</th><th className="px-3 py-3 text-right">Actions</th></tr></thead>
              <tbody>
                {predictions.map((prediction) => (
                  <tr key={prediction.id} className="border-b border-white/5 text-slate-300">
                    <td className="px-3 py-4 text-slate-500">#{prediction.id}</td>
                    <td className="px-3 py-4"><div className="font-medium">{prediction.user_name}</div><div className="text-xs text-slate-600">{prediction.user_email}</div></td>
                    <td className="px-3 py-4"><span className={prediction.risk_level === "High Risk" ? "text-amber-300" : "text-emerald-300"}>{prediction.risk_level}</span></td>
                    <td className="px-3 py-4">{prediction.probability.toFixed(2)}%</td>
                    <td className="px-3 py-4 text-slate-500">{formatDate(prediction.created_at)}</td>
                    <td className="px-3 py-4"><div className="flex justify-end gap-2"><button className="ghost-btn px-3 py-2 text-xs" onClick={() => openPrediction(prediction)}><Eye size={14}/> View</button><button className="ghost-btn px-3 py-2 text-xs text-rose-300" onClick={() => removePrediction(prediction)}><Trash2 size={14}/> Remove</button></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!predictions.length && !loadError && <p className="py-8 text-center text-sm text-slate-600">No predictions have been recorded.</p>}
            {!predictions.length && loadError && <p className="py-8 text-center text-sm text-slate-600">Unable to load predictions.</p>}
          </div>
        </section>

        <div className="mt-5 rounded-[2rem] border border-amber-300/10 bg-amber-300/[.03] p-6 text-sm leading-6 text-slate-400">Administrative analytics and predictions are application records for this demonstration system. They are not intended to establish clinical performance or provide medical advice.</div>

        {(viewUser || viewPrediction || confirmUser || showAdd) && createPortal(
          <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm" onMouseDown={(e) => { if (e.target === e.currentTarget && !deletingUser) { setViewUser(null); setViewPrediction(null); setConfirmUser(null); setShowAdd(false); } }}>
            {viewUser && <Modal title="User details" close={() => setViewUser(null)}><Detail label="Name" value={viewUser.name}/><Detail label="Email" value={viewUser.email}/><Detail label="Registered" value={formatDate(viewUser.created_at)}/><Detail label="Predictions" value={String(viewUser.prediction_count)}/></Modal>}
            {viewPrediction && <Modal title={`Prediction #${viewPrediction.id}`} close={() => setViewPrediction(null)}><Detail label="User" value={`${viewPrediction.user_name} (${viewPrediction.user_email})`}/><Detail label="Result" value={viewPrediction.prediction}/><Detail label="Risk level" value={viewPrediction.risk_level}/><Detail label="Stroke probability" value={`${viewPrediction.probability.toFixed(2)}%`}/><Detail label="Created" value={formatDate(viewPrediction.created_at)}/><div className="mt-5"><div className="mb-2 text-xs uppercase tracking-wider text-slate-600">Patient input</div><pre className="max-h-64 overflow-auto break-all whitespace-pre-wrap rounded-2xl border border-white/10 bg-black/20 p-4 text-xs leading-5 text-slate-400">{JSON.stringify(viewPrediction.patient || {}, null, 2)}</pre></div></Modal>}
            {confirmUser && (
              <motion.div initial={{ opacity: 0, scale: .98, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} className="glass w-full max-w-lg rounded-[2rem] p-6 shadow-2xl sm:p-8" role="dialog" aria-modal="true" aria-labelledby="remove-user-title">
                <div className="mb-5 flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs uppercase tracking-[.25em] text-rose-300">Remove account</p>
                    <h2 id="remove-user-title" className="mt-2 text-xl font-semibold">Remove {confirmUser.name}?</h2>
                  </div>
                  <button className="modal-close ghost-btn h-9 w-9 shrink-0 self-start p-0" onClick={() => !deletingUser && setConfirmUser(null)} aria-label="Close dialog" disabled={deletingUser}>
                    <span className="modal-close-x" aria-hidden="true">×</span>
                  </button>
                </div>
                <p className="text-sm leading-6 text-slate-400">This will permanently remove <span className="font-semibold text-slate-200">{confirmUser.name}</span> ({confirmUser.email}) and all of their stored predictions. This action cannot be undone.</p>
                <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                  <button type="button" className="ghost-btn" onClick={() => setConfirmUser(null)} disabled={deletingUser}>Cancel</button>
                  <button type="button" className="rounded-2xl border border-rose-400/30 bg-rose-500/10 px-5 py-3 text-sm font-semibold text-rose-200 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-60" onClick={confirmRemoveUser} disabled={deletingUser}>
                    <Trash2 size={16}/> {deletingUser ? "Removing…" : "Remove user"}
                  </button>
                </div>
              </motion.div>
            )}
            {showAdd && <Modal title="Add prediction" close={() => { setShowAdd(false); setPredErrors({}); }}><form noValidate onSubmit={addPrediction} className="grid gap-4 sm:grid-cols-2"><Field label="Registered user" type="select" value={form.user_id} onChange={(v) => setField("user_id", v)} options={[{v:"",l:"Select user"}, ...users.map((u) => ({v:String(u.id),l:`${u.name} — ${u.email}`}))]} error={predErrors.user_id}/><Field label="Age" value={form.age} onChange={(v) => setField("age", v)} type="number" error={predErrors.age}/><Field label="Gender" type="select" value={form.gender} onChange={(v) => setField("gender", v)} options={opts(["Female","Male","Other"])}/><Field label="Hypertension" type="select" value={form.hypertension} onChange={(v) => setField("hypertension", v)} options={binaryOpts}/><Field label="Heart disease" type="select" value={form.heart_disease} onChange={(v) => setField("heart_disease", v)} options={binaryOpts}/><Field label="Ever married" type="select" value={form.ever_married} onChange={(v) => setField("ever_married", v)} options={opts(["No","Yes"])}/><Field label="Work type" type="select" value={form.work_type} onChange={(v) => setField("work_type", v)} options={opts(["Private","Self-employed","Govt_job","children","Never_worked"])}/><Field label="Residence" type="select" value={form.residence_type} onChange={(v) => setField("residence_type", v)} options={opts(["Urban","Rural"])}/><Field label="Average glucose" value={form.avg_glucose_level} onChange={(v) => setField("avg_glucose_level", v)} type="number" error={predErrors.avg_glucose_level}/><Field label="BMI" value={form.bmi} onChange={(v) => setField("bmi", v)} type="number" error={predErrors.bmi}/><Field label="Smoking status" type="select" value={form.smoking_status} onChange={(v) => setField("smoking_status", v)} options={opts(["Unknown","never smoked","formerly smoked","smokes"])}/><div className="sm:col-span-2"><button className="primary-btn w-full" type="submit"><Plus size={16}/> Calculate & add prediction</button></div></form></Modal>}
          </div>,
          document.body,
        )}
      </Layout>
    </Screen>
  );
}

const binaryOpts = [{v:"0",l:"No"},{v:"1",l:"Yes"}];
const opts = (values: string[]) => values.map((v) => ({v, l: v}));
function formatDate(value: string | null) { return value ? new Date(value).toLocaleString() : "—"; }
function Detail({label,value}:{label:string;value:string}) { return <div className="flex flex-col gap-1 border-b border-white/5 py-3 text-sm sm:flex-row sm:justify-between sm:gap-5"><span className="shrink-0 text-slate-600">{label}</span><span className="min-w-0 break-words text-left text-slate-300 sm:text-right">{value}</span></div>; }
function Modal({title,close,children}:{title:string;close:()=>void;children:React.ReactNode}) { return <motion.div initial={{opacity:0,scale:.98,y:8}} animate={{opacity:1,scale:1,y:0}} className="glass max-h-[90vh] w-full max-w-3xl overflow-auto rounded-[2rem] p-5 shadow-2xl sm:p-8"><div className="mb-6 flex items-center justify-between"><h2 className="text-lg font-semibold sm:text-xl">{title}</h2><button className="modal-close ghost-btn h-9 w-9 p-0" onClick={close} aria-label="Close dialog"><span className="modal-close-x" aria-hidden="true">×</span></button></div>{children}</motion.div>; }
function Field({label,value,onChange,type="text",options=[],error}:{label:string;value:string;onChange:(v:string)=>void;type?:string;options?:{v:string;l:string}[];error?:string}) { return <label className="block"><span className="mb-2 block text-xs uppercase tracking-wider text-slate-500">{label}</span>{type === "select" ? <select value={value} onChange={(e)=>onChange(e.target.value)} className={`w-full rounded-2xl border border-white/10 bg-white/[.04] px-4 py-3 text-sm text-white outline-none focus:border-cyan-300/40 ${error ? "!border-rose-400/50" : ""}`}>{options.map(o=><option key={o.v} value={o.v} className="bg-[#091321]">{o.l}</option>)}</select> : <input type={type} value={value} onChange={(e)=>onChange(e.target.value)} className={`w-full rounded-2xl border border-white/10 bg-white/[.04] px-4 py-3 text-sm text-white outline-none focus:border-cyan-300/40 ${error ? "!border-rose-400/50" : ""}`}/>}{error && <p role="alert" className="mt-2 flex items-center gap-1.5 text-xs text-rose-300"><AlertCircle size={13} className="shrink-0"/>{error}</p>}</label>; }
