/**
 * Neural brain — medical-themed 3D particle field for the /welcome landing page.
 *
 * A ~2000-point particle "brain" (two hemispheres split by a longitudinal
 * fissure) with faint synaptic links, in the NeuroRisk teal palette.
 * Motion: slow Y rotation, pointer parallax (±5°), and a full-page
 * scroll-linked EXPANSION — compact brain at the top of the page, particles
 * dispersing outward to fill the viewport as you scroll down, contracting
 * back to the brain form when you scroll up. Additive blending on a
 * transparent canvas so it floats over the liquid-chrome background.
 *
 * This module is the ONLY place that imports three.js / @react-three/fiber.
 * It is lazy-loaded by Welcome.tsx (React.lazy), so the ~150KB gz three
 * runtime never enters the main app bundle.
 *
 * Defensive gate (same doctrine as LiquidChromeLayer.tsx):
 *  - prefers-reduced-motion  -> static SVG fallback, no canvas mounted
 *  - WebGL blocked / stubbed -> static SVG fallback (webglActuallyWorks probe)
 *  - DPR clamped to <= 1.5, updates skipped while document.hidden
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

/* ---------------------------------------------------------------- utils */

function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TEAL = new THREE.Color("#38bdf8");
const TEAL_LIGHT = new THREE.Color("#7dd3fc");
const LINK = new THREE.Color("#0891b2");

/** Build a brain-ish point cloud + colour buffer. */
function buildBrain(count: number) {
  const rand = mulberry32(1337);
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const golden = Math.PI * (3 - Math.sqrt(5));
  const scale = 1.65;

  for (let i = 0; i < count; i++) {
    // Fibonacci sphere -> uniform distribution.
    const y0 = 1 - (i / (count - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y0 * y0));
    const theta = golden * i;
    let x = Math.cos(theta) * r;
    let z = Math.sin(theta) * r;
    let y = y0;

    // Squash into an ellipsoid that reads as a brain silhouette.
    x *= 0.82;
    y *= 0.94;
    z *= 1.06;

    // Longitudinal fissure: nudge points off the midline.
    const fissure = 0.07;
    if (Math.abs(x) < fissure) x += x >= 0 ? fissure : -fissure;

    // Organic jitter.
    x += (rand() - 0.5) * 0.06;
    y += (rand() - 0.5) * 0.06;
    z += (rand() - 0.5) * 0.06;

    positions[i * 3] = x * scale;
    positions[i * 3 + 1] = y * scale;
    positions[i * 3 + 2] = z * scale;

    // Colour: brighter cyan toward the core, deep teal at the rim.
    const depth = Math.min(1, Math.hypot(x, y, z));
    const c = TEAL_LIGHT.clone().lerp(TEAL, depth);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  return { positions, colors };
}

/** Pick short-range pairs to draw as synaptic links. */
function buildLinks(positions: Float32Array, maxLinks: number) {
  const rand = mulberry32(99);
  const n = positions.length / 3;
  const verts: number[] = [];
  const threshold = 0.42;
  let made = 0;
  for (let i = 0; i < n && made < maxLinks; i++) {
    // a few candidate partners per node keeps it O(n)
    for (let k = 0; k < 3 && made < maxLinks; k++) {
      const j = (i + 1 + Math.floor(rand() * 24)) % n;
      const dx = positions[i * 3] - positions[j * 3];
      const dy = positions[i * 3 + 1] - positions[j * 3 + 1];
      const dz = positions[i * 3 + 2] - positions[j * 3 + 2];
      if (Math.hypot(dx, dy, dz) < threshold) {
        verts.push(
          positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2],
          positions[j * 3], positions[j * 3 + 1], positions[j * 3 + 2],
        );
        made++;
      }
    }
  }
  return new Float32Array(verts);
}

/* ------------------------------------------------------------ 3D scene */

type Refs = {
  pointer: React.MutableRefObject<{ x: number; y: number }>;
  scroll: React.MutableRefObject<number>;
};

function Brain({ pointer, scroll }: Refs) {
  const group = useRef<THREE.Group>(null);
  const pointsRef = useRef<THREE.Points>(null);
  const linkMat = useRef<THREE.LineBasicMaterial>(null);
  const pointMat = useRef<THREE.PointsMaterial>(null);
  const { camera } = useThree();

  const POINTS = 2000;
  const { positions, colors } = useMemo(() => buildBrain(POINTS), []);
  const links = useMemo(() => buildLinks(positions, 520), [positions]);
  // Base (compact) positions + per-point dispersal phase, both static.
  const base = useMemo(() => positions.slice(), [positions]);
  const phases = useMemo(() => {
    const rand = mulberry32(4242);
    return Array.from({ length: POINTS }, () => rand() * Math.PI * 2);
  }, []);

  const EXPAND = 3.4; // max radial multiplier at full scroll
  const TURB = 0.28; // per-point dispersal amplitude

  useFrame((state, delta) => {
    if (document.hidden) return;
    const g = group.current;
    if (!g) return;
    const p = scroll.current; // 0 (top) .. 1 (bottom of page)

    // Slow spin (slightly faster as it expands) + pointer parallax tilt.
    g.rotation.y += delta * (0.14 + p * 0.1);
    const ptr = pointer.current;
    g.rotation.x += (ptr.y * 0.18 - g.rotation.x) * Math.min(1, delta * 3);
    g.rotation.z += (-ptr.x * 0.12 - g.rotation.z) * Math.min(1, delta * 3);

    // Camera: mild pull-in as the field expands.
    const targetZ = 6.4 - p * 0.8;
    camera.position.z += (targetZ - camera.position.z) * Math.min(1, delta * 3);
    camera.lookAt(0, 0, 0);

    // Expand: each point moves radially outward (1 + p*EXPAND) with a slow
    // organic wobble so the dispersal feels alive, not a rigid scale.
    const pts = pointsRef.current;
    if (pts) {
      const attr = pts.geometry.attributes.position as THREE.BufferAttribute;
      const arr = attr.array as Float32Array;
      const t = state.clock.elapsedTime;
      const spread = 1 + p * EXPAND;
      for (let i = 0; i < POINTS; i++) {
        const i3 = i * 3;
        const wob = 1 + Math.sin(t * 1.1 + phases[i]) * TURB * p;
        arr[i3] = base[i3] * spread * wob;
        arr[i3 + 1] = base[i3 + 1] * spread * wob;
        arr[i3 + 2] = base[i3 + 2] * spread * wob;
      }
      attr.needsUpdate = true;
    }

    // Links dissolve as the brain disperses; points grow slightly to keep
    // the expanded field from looking sparse.
    if (linkMat.current) linkMat.current.opacity = 0.22 * Math.pow(1 - p, 1.5);
    if (pointMat.current) pointMat.current.size = 0.032 * (1 + p * 0.5);
  });

  return (
    <group ref={group}>
      <points ref={pointsRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
          <bufferAttribute attach="attributes-color" args={[colors, 3]} />
        </bufferGeometry>
        <pointsMaterial
          ref={pointMat}
          size={0.032}
          vertexColors
          transparent
          opacity={0.95}
          sizeAttenuation
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>

      <lineSegments>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[links, 3]} />
        </bufferGeometry>
        <lineBasicMaterial
          ref={linkMat}
          color={LINK}
          transparent
          opacity={0.22}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </lineSegments>
    </group>
  );
}

/* ------------------------------------------------------------ fallback */

/** Static neural-sphere SVG for reduced-motion / no-WebGL clients. */
function NeuralFallback() {
  const nodes = useMemo(() => {
    const rand = mulberry32(7);
    const pts: [number, number][] = [];
    for (let i = 0; i < 42; i++) {
      const a = rand() * Math.PI * 2;
      const r = 40 + rand() * 90;
      pts.push([150 + Math.cos(a) * r, 140 + Math.sin(a) * r * 0.72]);
    }
    return pts;
  }, []);
  const links: [number, number][] = nodes
    .map((_, i) => [i, (i * 7 + 3) % nodes.length] as [number, number])
    .filter(([a, b]) => a !== b)
    .slice(0, 45);
  return (
    <svg viewBox="0 0 300 280" preserveAspectRatio="xMidYMid slice" className="h-full w-full opacity-70" aria-hidden="true">
      {links.map(([a, b], i) => (
        <line
          key={i}
          x1={nodes[a][0]} y1={nodes[a][1]} x2={nodes[b][0]} y2={nodes[b][1]}
          stroke="#0891b2" strokeWidth="0.6" opacity="0.4"
        />
      ))}
      {nodes.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={i % 6 === 0 ? 2.4 : 1.4} fill="#38bdf8" opacity="0.9" />
      ))}
    </svg>
  );
}

/* --------------------------------------------------------------- gate */

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function webglActuallyWorks(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl2") || canvas.getContext("webgl")) as WebGLRenderingContext | null;
    if (!gl) return false;
    gl.clearColor(0.1, 0.9, 0.5, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const px = new Uint8Array(4);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return px[1] > 100;
  } catch {
    return false;
  }
}

export default function NeuralBrain() {
  const pointer = useRef({ x: 0, y: 0 });
  const scroll = useRef(0);
  const [mode, setMode] = useState<"pending" | "webgl" | "fallback">("pending");

  useEffect(() => {
    if (prefersReducedMotion() || !webglActuallyWorks()) {
      setMode("fallback");
      return;
    }
    setMode("webgl");
  }, []);

  useEffect(() => {
    if (mode !== "webgl") return;
    const onPointer = (e: PointerEvent) => {
      pointer.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.current.y = (e.clientY / window.innerHeight) * 2 - 1;
    };
    const onScroll = () => {
      const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      scroll.current = Math.min(1, Math.max(0, window.scrollY / max));
    };
    window.addEventListener("pointermove", onPointer, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => {
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("scroll", onScroll);
    };
  }, [mode]);

  if (mode === "fallback") return <NeuralFallback />;
  if (mode === "pending") return null;

  return (
    <Canvas
      dpr={[1, 1.5]}
      camera={{ position: [0, 0, 6.4], fov: 45 }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      style={{ pointerEvents: "none" }}
    >
      <Brain pointer={pointer} scroll={scroll} />
    </Canvas>
  );
}
