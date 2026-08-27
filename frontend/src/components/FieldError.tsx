import { AlertCircle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export function FieldError({ id, error }: { id?: string; error?: string }) {
  return (
    <AnimatePresence>
      {error && (
        <motion.p
          id={id}
          role="alert"
          initial={{ opacity: 0, y: -4, height: 0 }}
          animate={{ opacity: 1, y: 0, height: "auto" }}
          exit={{ opacity: 0, y: -4, height: 0 }}
          transition={{ duration: 0.2 }}
          className="mt-2 flex items-center gap-1.5 text-xs text-rose-300"
        >
          <AlertCircle size={13} className="shrink-0" />
          {error}
        </motion.p>
      )}
    </AnimatePresence>
  );
}
