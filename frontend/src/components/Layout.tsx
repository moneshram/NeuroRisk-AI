import { motion } from "framer-motion";
import { Activity, BarChart3, BrainCircuit, LogOut, Settings, ShieldCheck } from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";
import { getUser, logout } from "../lib/api";

export function Layout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const user = getUser();

  return (
    <div className="min-h-screen app-shell text-white">
      <div className="px-2 pt-2 sm:px-4 sm:pt-4">
        <header className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 rounded-3xl border border-white/10 nav-shell px-3 py-2.5 shadow-2xl backdrop-blur-xl sm:flex-nowrap sm:px-5 sm:py-3">
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => navigate("/")}
            className="brand-button flex items-center gap-2.5 bg-transparent sm:gap-3"
          >
            <span className="brand-mark grid h-9 w-9 shrink-0 place-items-center rounded-2xl sm:h-10 sm:w-10">
              <BrainCircuit size={20} />
            </span>

            <span className="brand-copy hidden bg-transparent text-left sm:block">
              <b className="brand-title block text-sm font-semibold">NeuroRisk AI</b>
              <small className="brand-subtitle">Stroke Classification</small>
            </span>
          </motion.button>

          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            {user?.role === "user" && (
              <>
                <motion.button
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => navigate("/dashboard")}
                  className={`ghost-btn px-2.5 py-1.5 text-xs sm:px-3 sm:py-2 ${location.pathname === "/dashboard" ? "nav-active" : ""}`}
                >
                  <BarChart3 size={15} />
                  <span className="hidden sm:inline">Dashboard</span>
                </motion.button>

                <motion.button
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => navigate("/settings")}
                  className={`ghost-btn px-2.5 py-1.5 text-xs sm:px-3 sm:py-2 ${location.pathname === "/settings" ? "nav-active" : ""}`}
                  aria-label="Open account settings"
                >
                  <Settings size={15} />
                  <span className="hidden sm:inline">Settings</span>
                </motion.button>
              </>
            )}

            {user?.role === "admin" && (
              <>
                <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} onClick={() => navigate("/admin")} className={`ghost-btn px-2.5 py-1.5 text-xs sm:px-3 sm:py-2 ${location.pathname === "/admin" ? "nav-active" : ""}`}>
                  <ShieldCheck size={15} /> <span className="hidden sm:inline">Admin</span>
                </motion.button>
                <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} onClick={() => navigate("/admin/settings")} className={`ghost-btn px-2.5 py-1.5 text-xs sm:px-3 sm:py-2 ${location.pathname.startsWith("/admin/settings") ? "nav-active" : ""}`} aria-label="Open administrator settings">
                  <Settings size={15} /> <span className="hidden sm:inline">Settings</span>
                </motion.button>
              </>
            )}

            <motion.button
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => {
                logout();
                navigate("/login");
              }}
              className="ghost-btn px-2.5 py-1.5 text-xs sm:px-3 sm:py-2"
              aria-label="Sign out"
            >
              <LogOut size={15} />
              <span className="hidden sm:inline">Sign out</span>
            </motion.button>
          </div>
        </header>
      </div>

      <main className="relative z-0 mx-auto max-w-6xl px-3 pb-12 pt-5 sm:px-4 sm:pt-8">
        {children}
      </main>

      <footer className="relative z-0 py-8 text-center text-xs text-slate-600">
        <Activity className="mr-1 inline" size={13} />
        Risk estimation aid — not a medical diagnosis.
      </footer>
    </div>
  );
}
