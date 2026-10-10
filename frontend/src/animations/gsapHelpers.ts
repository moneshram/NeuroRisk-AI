/**
 * GSAP animation helpers shared across the app.
 *
 * Rules honoured everywhere:
 *  - every animation lives inside a `gsap.context()` that is reverted on cleanup,
 *  - only `transform` (x/y/scale) and `opacity` are animated,
 *  - durations stay <= 0.7s with power2.out / expo.out easing,
 *  - `prefers-reduced-motion` skips tweens entirely (elements stay visible).
 *
 * Originally from pages/batch/motion.ts (batch feature), generalized and
 * moved into the central animations folder.
 */
import { useEffect, type RefObject } from "react";
import { gsap } from "gsap";

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Cheap button micro-interactions (hover lift / press down) using event
 * delegation on the page root, so buttons rendered later are covered too.
 * Returns a cleanup function that unbinds listeners and resets transforms.
 */
export function bindButtonMotion(root: HTMLElement): () => void {
  if (prefersReducedMotion()) return () => undefined;

  let active: HTMLElement | null = null;

  const targetOf = (event: Event): HTMLElement | null => {
    const node = event.target;
    if (!(node instanceof Element)) return null;
    const button = node.closest<HTMLElement>("button:not(:disabled), [role='button']:not([aria-disabled='true'])");
    return button && root.contains(button) ? button : null;
  };

  const over = (event: Event) => {
    const button = targetOf(event);
    if (!button || button === active) return;
    if (active) {
      gsap.to(active, { scale: 1, duration: 0.18, ease: "power2.out", overwrite: "auto" });
    }
    active = button;
    gsap.to(button, { scale: 1.02, duration: 0.15, ease: "power2.out", overwrite: "auto" });
  };

  const out = (event: MouseEvent) => {
    const button = targetOf(event);
    if (!button || button !== active) return;
    const next = event.relatedTarget;
    if (next instanceof Node && button.contains(next)) return;
    gsap.to(button, { scale: 1, duration: 0.15, ease: "power2.out", overwrite: "auto" });
    active = null;
  };

  const down = (event: Event) => {
    const button = targetOf(event);
    if (!button) return;
    gsap.to(button, { scale: 0.97, duration: 0.1, ease: "power2.out", overwrite: "auto" });
  };

  const up = (event: Event) => {
    const button = targetOf(event);
    if (!button) return;
    gsap.to(button, {
      scale: button === active ? 1.02 : 1,
      duration: 0.12,
      ease: "power2.out",
      overwrite: "auto",
    });
  };

  root.addEventListener("mouseover", over);
  root.addEventListener("mouseout", out);
  root.addEventListener("mousedown", down);
  root.addEventListener("mouseup", up);

  return () => {
    root.removeEventListener("mouseover", over);
    root.removeEventListener("mouseout", out);
    root.removeEventListener("mousedown", down);
    root.removeEventListener("mouseup", up);
    if (active) gsap.set(active, { scale: 1 });
    active = null;
  };
}

export type EntranceOptions = {
  y?: number;
  duration?: number;
  stagger?: number;
  ease?: string;
};

/**
 * Staggered entrance for every element matching `selector` inside `rootRef`.
 * Skipped under reduced motion; cleans up via gsap.context().revert().
 * Pass `deps` to re-run (e.g. [data] after a batch completes).
 */
export function useGsapEntrance(
  rootRef: RefObject<HTMLElement | null>,
  selector: string,
  deps: unknown[],
  opts: EntranceOptions = {},
) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root || prefersReducedMotion()) return;
    const ctx = gsap.context(() => {
      gsap.from(root.querySelectorAll(selector), {
        y: opts.y ?? 16,
        opacity: 0,
        duration: opts.duration ?? 0.5,
        stagger: opts.stagger ?? 0.08,
        ease: opts.ease ?? "power2.out",
        clearProps: "opacity,transform",
      });
    }, root);
    return () => ctx.revert();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
