/**
 * Shared framer-motion presets.
 *
 * New code should import from here instead of re-declaring transition
 * objects inline. Existing pages still carry their own inline motion props
 * (documented in ANIMATIONS.md) and can adopt these incrementively.
 */

/** Signature easing used across the app (matches Screen entrance). */
export const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];
