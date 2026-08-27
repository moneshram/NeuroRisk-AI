import { motion } from "framer-motion";
import { ReactNode } from "react";

export function Screen({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <motion.main
      initial={{ opacity: 0, y: 18, filter: "blur(8px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      exit={{ opacity: 0, y: -12 }}
      transition={{ duration: .55, ease: [0.22, 1, .36, 1] }}
      className={`relative z-10 min-h-screen ${className}`}
    >
      {children}
    </motion.main>
  );
}
