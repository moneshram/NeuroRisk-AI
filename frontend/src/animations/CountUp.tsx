import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { prefersReducedMotion } from "./gsapHelpers";

/**
 * Numeric counter that counts from the previous value up to the new one
 * (skipped under reduced motion — jumps straight to the final value).
 */
export function CountUp({ value, decimals = 0, suffix = "" }: { value: number; decimals?: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const prevRef = useRef(0);
  const fmt = (v: number) => (decimals > 0 ? v.toFixed(decimals) : Math.round(v).toLocaleString()) + suffix;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const from = prevRef.current;
    prevRef.current = value;
    if (prefersReducedMotion() || from === value) {
      el.textContent = fmt(value);
      return;
    }
    const proxy = { v: from };
    const tween = gsap.to(proxy, {
      v: value,
      duration: 0.7,
      ease: "power2.out",
      onUpdate: () => {
        el.textContent = fmt(proxy.v);
      },
      onComplete: () => {
        el.textContent = fmt(value);
      },
    });
    return () => {
      tween.kill();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return <span ref={ref}>{fmt(value)}</span>;
}

export default CountUp;
