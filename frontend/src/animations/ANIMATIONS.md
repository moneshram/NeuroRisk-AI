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

## Session 11 — 3D neural brain (Phase A of the 3D upgrade)

| File | What it does | Mounted where |
|---|---|---|
| `Scene3D.tsx` | **Lazy 3D particle brain** (three.js + @react-three/fiber v8): ~2000 Fibonacci-sphere points in a brain ellipsoid with longitudinal fissure, ~520 synaptic links, teal palette, additive blending on transparent canvas. Slow Y spin + pointer parallax (±5°) + scroll-linked camera dolly (z 6.4→4.3). DPR ≤1.5, skips frames while `document.hidden`. Gates: reduced-motion or failed `webglActuallyWorks()` probe → static SVG neural fallback (no canvas). **Only file importing three.js** — lazy chunk `Scene3D-*.js` (~238KB gz), never in main bundle. | `pages/Welcome.tsx` hero (React.lazy + 250ms idle delay + radial mask) |

Rules addition: 3D scenes must stay in lazy chunks (never static-import three into the main bundle), gate on the same `webglActuallyWorks()` probe, and clamp DPR.

## Session 12 — Phase B: subtle 3D icosahedron in auth brand panel

| File | What it does | Mounted where |
|---|---|---|
| `AuthScene3D.tsx` | **Lazy 3D wireframe icosahedron** (three.js + fiber v8): 12 glowing vertex points, teal wireframe at 0.32 opacity, additive vertex glow. Slow Y spin (0.08 rad/s) + pointer parallax tilt (±8°, lerped). **No scroll logic.** Same gates as Scene3D: reduced-motion or failed WebGL probe → static SVG icosahedron wireframe (orthographic projection of the same 12 vertices / 30 edges). Shares the `react-three-fiber` chunk with Scene3D — its own chunk is only ~1.5KB gz. | `components/AuthSplit.tsx` brand panel (lazy + 250ms idle delay + radial mask at 72% 46%, `-z-10`, hidden in light theme via `.auth-scene3d`) |

Note: three.js is now a **shared chunk** (`react-three-fiber.esm-*.js`, ~236KB gz) loaded by whichever of /welcome or an auth page is visited first; the second page reuses it from cache. Deep-linking straight to /login pays the three cost once.

## Session 13 — scroll-linked particle expansion (full-page)

`Scene3D.tsx` reworked: the brain is no longer hero-bound. Mounted as a **fixed full-viewport layer** on /welcome (like the liquid chrome), it stays visible while scrolling the whole page. Scroll progress `p = scrollY / (docHeight - viewportHeight)` drives:
- **Expansion**: each point moves radially outward `base * (1 + p*3.4)` with a slow per-point wobble (`sin(t*1.1 + phase) * 0.28 * p`) — organic dispersal, not a rigid scale. At p=1 the field fills the viewport.
- **Links** dissolve `opacity = 0.22 * (1-p)^1.5`; point size grows `0.032 * (1 + p*0.5)` so the spread field isn't sparse.
- Spin speeds up slightly with p; camera pulls in mildly (6.4→5.6). Fully reversible — scroll up contracts back to the compact brain.
- Fallback SVG now `preserveAspectRatio="xMidYMid slice"` (fills viewport instead of letterboxing).
- Mount moved from hero box to `fixed inset-0 -z-10` with a generous radial mask (90% 90% at 50% 45%) in Welcome.tsx.
