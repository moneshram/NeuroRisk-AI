import { motion } from "framer-motion";
import { FieldError } from "./FieldError";

type FieldProps = {
  label: string;
  children: React.ReactNode;
  error?: string;
  htmlFor?: string;
};

export function Field({ label, children, error, htmlFor }: FieldProps) {
  const errorId = htmlFor ? `${htmlFor}-error` : undefined;
  return (
    <motion.label
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="block"
      htmlFor={htmlFor}
    >
      <span className="label">{label}</span>
      {children}
      <FieldError id={errorId} error={error} />
    </motion.label>
  );
}
