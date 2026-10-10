/**
 * Subtle 3D object for the auth brand panel (AuthSplit left column).
 *
 * A slowly rotating wireframe icosahedron with glowing vertex points —
 * reads as a "neural node", matching the /welcome particle brain in the
 * same teal palette. Mouse-reactive parallax only (no scroll logic).
 *
 * Same doctrine as Scene3D.tsx:
 *  - lazy-loaded (three.js never in the main bundle),
 *  - reduced-motion OR failed WebGL probe -> static SVG wireframe fallback,
 *  - DPR <= 1.5, frames skipped while document.hidden,
 *  - transparent canvas, pointer-events:none.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";

/* ---------------------------------------------------------------- utils */

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

/** Icosahedron vertices (unit sphere) + the 30 edges, shared by 3D + SVG. */
function icosahedron() {
  const phi = (1 + Math.sqrt(5)) / 2;
  const raw: [number, number, number][] = [
    [0, 1, phi], [0, -1, phi], [0, 1, -phi], [0, -1, -phi],
    [1, phi, 0], [-1, phi, 0], [1, -phi, 0], [-1, -phi, 0],
    [phi, 0, 1], [-phi, 0, 1], [phi, 0, -1], [-phi, 0, -1],
  ];
  const verts = raw.map(([x, y, z]) => {
    const len = Math.hypot(x, y, z);
    return [x / len, y / len, z / len] as [number, number, number];
  });
  const edges: [number, number][] = [];
  for (let i = 0; i < verts.length; i++) {
    for (let j = i + 1; j < verts.length; j++) {
      const d = Math.hypot(
        verts[i][0] - verts[j][0], verts[i][1] - verts[j][1], verts[i][2] - verts[j][2],
      );
      if (d < 1.1) edges.push([i, j]);
    }
  }
  return { verts, edges };
}

/* ------------------------------------------------------------ 3D scene */

function Icosahedron3D() {
  const group = useRef<THREE.Group>(null);
  const pointer = useRef({ x: 0, y: 0 });

  const { verts } = useMemo(() => icosahedron(), []);
  const vertexPositions = useMemo(() => new Float32Array(verts.flat()), [verts]);

  useEffect(() => {
    const onPointer = (e: PointerEvent) => {
      pointer.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.current.y = (e.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener("pointermove", onPointer, { passive: true });
    return () => window.removeEventListener("pointermove", onPointer);
  }, []);

  useFrame((_, delta) => {
    if (document.hidden) return;
    const g = group.current;
    if (!g) return;
    // Slow spin + gentle pointer tilt (lerped).
    g.rotation.y += delta * 0.08;
    const p = pointer.current;
    g.rotation.x += (p.y * 0.14 - g.rotation.x) * Math.min(1, delta * 3);
    g.rotation.z += (-p.x * 0.1 - g.rotation.z) * Math.min(1, delta * 3);
  });

  return (
    <group ref={group} position={[1.35, 0.1, 0]} scale={1.45}>
      <mesh>
        <icosahedronGeometry args={[1, 0]} />
        <meshBasicMaterial
          color="#22d3ee"
          wireframe
          transparent
          opacity={0.32}
          depthWrite={false}
        />
      </mesh>
      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[vertexPositions, 3]} />
        </bufferGeometry>
        <pointsMaterial
          size={0.045}
          color="#67e8f9"
          transparent
          opacity={0.9}
          sizeAttenuation
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>
    </group>
  );
}

/* ------------------------------------------------------------ fallback */

/** Static SVG wireframe icosahedron (reduced-motion / no WebGL). */
function IcosahedronFallback() {
  const { verts, edges } = useMemo(() => icosahedron(), []);
  // Orthographic projection (x, y), scaled to a 220px viewBox.
  const S = 70;
  const pts = verts.map(([x, y]) => [110 + x * S, 110 + y * S] as [number, number]);
  return (
    <svg viewBox="0 0 220 220" className="h-full w-full opacity-60" aria-hidden="true">
      {edges.map(([a, b], i) => (
        <line
          key={i}
          x1={pts[a][0]} y1={pts[a][1]} x2={pts[b][0]} y2={pts[b][1]}
          stroke="#22d3ee" strokeWidth="0.8" opacity="0.5"
        />
      ))}
      {pts.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="2.2" fill="#67e8f9" opacity="0.9" />
      ))}
    </svg>
  );
}

/* --------------------------------------------------------------- gate */

export default function AuthScene3D() {
  const [mode, setMode] = useState<"pending" | "webgl" | "fallback">("pending");

  useEffect(() => {
    if (prefersReducedMotion() || !webglActuallyWorks()) {
      setMode("fallback");
      return;
    }
    setMode("webgl");
  }, []);

  if (mode === "fallback") return <IcosahedronFallback />;
  if (mode === "pending") return null;

  return (
    <Canvas
      dpr={[1, 1.5]}
      camera={{ position: [0, 0, 3.2], fov: 45 }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      style={{ pointerEvents: "none" }}
    >
      <Icosahedron3D />
    </Canvas>
  );
}