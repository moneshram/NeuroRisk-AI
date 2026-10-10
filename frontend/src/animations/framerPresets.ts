/**
 * Shared framer-motion presets.
 *
 * New code should import from here instead of re-declaring transition
 * objects inline. Existing pages still carry their own inline motion props
 * (documented in ANIMATIONS.md) and can adopt these incrementively.
 */
import type { Transition, Variants } from "framer-motion";

/** Signature easing used across the app (matches Screen entrance). */
export const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

/** Page-level entrance: fade + rise + deblur (used by components/Screen). */
export const screenEntrance = {
  initial: { opacity: 0, y: 18, filter: "blur(8px)" },
  animate: { opacity: 1, y: 0, filter: "blur(0px)" },
  exit: { opacity: 0, y: -12 },
  transition: { duration: 0.55, ease: EASE },
} as const;

/** Stagger container for cards: pair with cardChild on each child. */
export const cardStagger: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: EASE, staggerChildren: 0.08 },
  },
};

export const cardChild: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: EASE } },
};

/** Subtle hover lift + press for cards. */
export const hoverLift = {
  whileHover: { y: -3 },
  whileTap: { scale: 0.98 },
} as const;

/** Press feedback for buttons. */
export const tapPress = {
  whileTap: { scale: 0.97 },
} as const;

export const standardTransition: Transition = { duration: 0.45, ease: EASE };
