import { motion } from "framer-motion";

export function Ambient() {
  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden">
      {[...Array(5)].map((_, i) => (
        <motion.div
          key={i}
          className="absolute rounded-full border border-cyan-300/10"
          style={{ width: 180 + i * 120, height: 180 + i * 120, left: `${5 + i * 18}%`, top: `${5 + (i % 2) * 50}%` }}
          animate={{ rotate: 360, scale: [1, 1.04, 1], opacity: [.2, .5, .2] }}
          transition={{ duration: 18 + i * 4, repeat: Infinity, ease: "easeInOut" }}
        />
      ))}
      <div className="absolute left-1/2 top-1/3 h-80 w-80 -translate-x-1/2 rounded-full bg-cyan-400/5 blur-3xl" />
      <div className="absolute right-0 top-0 h-96 w-96 rounded-full bg-violet-500/5 blur-3xl" />
    </div>
  );
}
