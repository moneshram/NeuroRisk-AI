# Animations — manifest

Every animation in the NeuroRisk AI frontend, where it lives, and how it
behaves under `prefers-reduced-motion`. **New animation code goes in this
folder** (`src/animations/`); pages import from it via `index.ts`.

## Modules in this folder

| File | What it is | Used by |
|---|---|---|
| `LiquidChrome.tsx` + `.css` | WebGL liquid-metal background shader (React Bits, MIT; window-level mouse ripple). Brand tint #0E2A33, speed 0.72 | `LiquidChromeLayer` |
| `LiquidChromeLayer.tsx` | App-wide background layer: fixed `-z-10`, `pointer-events:none`, skipped on reduced motion, hidden in light theme | `App.tsx` (all routes) |
| `Ambient.tsx` | Rotating cyan rings + glow blobs (framer-motion) | Login, Register, ResetPassword, ForgotPassword |
| `gsapHelpers.ts` | `prefersReducedMotion()`, `bindButtonMotion()` (delegated hover/press), `useGsapEntrance()` stagger hook | Batch pages |
| `CountUp.tsx` | GSAP number counter (summary card stats) | `pages/batch/SummaryCards.tsx` |
| `framerPresets.ts` | Shared presets: `screenEntrance`, `cardStagger`/`cardChild`, `hoverLift`, `tapPress`, `EASE` | New code (existing pages adopt incrementally) |

## Animations elsewhere (inline, documented for future extraction)

| Location | Animation | Reduced motion |
|---|---|---|
| `components/Screen.tsx` | Page entrance: fade + rise + deblur (0.55s) | framer-motion auto-respects via CSS? No — kept as-is; subtle enough |
| `components/Layout.tsx` | Nav bar button whileHover/whileTap (22 props) | inline |
| `pages/Assessment.tsx` | Heaviest page: 47 motion props (question transitions, option taps) | inline |
| `pages/Results.tsx` | 40 motion props (score reveal, staggered cards) | inline |
| `pages/Register.tsx` | 33 motion props (step transitions) | inline |
| `pages/AssessmentHistory.tsx` | 26 motion props (list stagger) | inline |
| `pages/Dashboard.tsx` | 21 motion props (stat cards) | inline |
| `pages/Batch.tsx` | GSAP entrance `[data-entrance]` + `[data-results-entrance]`, `bindButtonMotion` | guarded (`prefersReducedMotion()` skip) |
| `pages/batch/ResultsTable.tsx` | GSAP row stagger (0.28s, amount 0.35) | guarded |
| `pages/batch/SummaryCards.tsx` | GSAP card stagger + `CountUp` | guarded |
| `pages/batch/BatchCharts.tsx` | GSAP chart entrance + Recharts `isAnimationActive={!prefersReducedMotion()}` | guarded |
| `index.css:117` | `@keyframes dropdownIn` (180ms) for select dropdowns | n/a (CSS, tiny) |
| Remaining pages (Settings/Admin*, auth) | Small whileHover/whileTap + field focus transitions | inline |

## Rules

1. New animation code lives in this folder, not inline in pages.
2. GSAP: always inside `gsap.context()`, transform/opacity only, ≤0.7s, power2/expo out.
3. Every animation must honour `prefers-reduced-motion` (skip or jump to end state).
4. Background layers: `pointer-events:none` + `-z-10` — never block UI interaction.
