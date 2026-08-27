import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

type Option = {
  label: string;
  value: string;
};

type SelectFieldProps = {
  label?: string;
  value: string | number;
  onChange: (value: string) => void;
  options: Option[];
  placeholder?: string;
  error?: string;
  ariaDescribedBy?: string;
};

export default function SelectField({
  value,
  onChange,
  options,
  placeholder = "Select an option",
  error,
  ariaDescribedBy,
}: SelectFieldProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = options.find(
    (option) => String(option.value) === String(value),
  );

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  return (
    <div ref={containerRef} className="relative w-full">
      {/* Main select button */}
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={`
          field
          flex
          w-full
          items-center
          justify-between
          text-left
          cursor-pointer
          select-none
          ${open ? "border-cyan-300/50 bg-white/[0.07] ring-4 ring-cyan-400/10" : ""}
          ${error ? "!border-rose-400/50" : ""}
        `}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-invalid={!!error || undefined}
        aria-describedby={ariaDescribedBy}
      >
        <span className={`select-trigger-value ${selected ? "has-value" : ""}`}>
          {selected?.label ?? placeholder}
        </span>

        <ChevronDown
          size={18}
          className={`
            shrink-0
            text-slate-400
            transition-transform
            duration-300
            ${open ? "rotate-180 text-cyan-300" : ""}
          `}
        />
      </button>

      {/* Custom dropdown */}
      {open && (
        <div
          className="
                select-menu
                absolute
                left-0
                right-0
                top-[calc(100%+0.5rem)]
                z-[9999]
                overflow-hidden
                rounded-2xl
                border
                border-cyan-300/20
                bg-[#0b1220]
                p-1.5
                shadow-2xl
                shadow-black/50
                backdrop-blur-none
                animate-dropdown
            "
        >
          {options.map((option) => {
            const isSelected = String(option.value) === String(value);

            return (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                className={`
                  group
                  flex
                  w-full
                  items-center
                  justify-between
                  rounded-xl
                  px-4
                  py-3
                  text-left
                  text-sm
                  transition-all
                  duration-200
                  ${
                    isSelected
                      ? "select-option-selected bg-cyan-400/15 text-cyan-300"
                      : "select-option text-slate-300 hover:bg-white/[0.08] hover:text-white"
                  }
                `}
                role="option"
                aria-selected={isSelected}
              >
                <span>{option.label}</span>

                {isSelected && <Check size={17} className="text-cyan-300" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
