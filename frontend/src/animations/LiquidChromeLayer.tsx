/**
 * App-wide animated background layer.
 *
 * Renders the Liquid Chrome WebGL shader behind all routes:
 *  - fixed, -z-10, pointer-events:none -> zero interference with the UI,
 *  - skipped entirely when the user prefers reduced motion (body keeps the
 *    static #050b14 gradient fallback),
 *  - hidden in light theme via CSS (html[data-theme="light"] .app-bg-layer).
 *
 * Brand tint: #0E2A33 deep teal-navy, speed 0.72 (see LiquidChrome.tsx).
 */
import { useEffect, useState } from "react";
import LiquidChrome from "./LiquidChrome";

const BRAND_BASE_COLOR: [number, number, number] = [0.055, 0.165, 0.2];
const BRAND_SPEED = 0.72;

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * True only when WebGL genuinely renders (not just when a context exists).
 * Privacy shields (e.g. Brave fingerprinting protection) can return a stub
 * context that draws nothing — probe with a clear+readback to detect that.
 */
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
    return px[1] > 100; // the green channel survived => real rendering
  } catch {
    return false;
  }
}

export function LiquidChromeLayer() {
  const [enabled, setEnabled] = useState(() => !prefersReducedMotion());
  const [shader, setShader] = useState(false);

  useEffect(() => {
    setShader(webglActuallyWorks());
  }, []);

  useEffect(() => {
    if (!window.matchMedia) return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setEnabled(!query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  if (!enabled) return null;

  return (
    <div className="app-bg-layer pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden="true">
      {/* CSS liquid fallback — always present, shows through when WebGL
          is blocked (privacy shields / GPU blocklist) */}
      <div className="liquid-fallback">
        <div className="liquid-blob liquid-blob-b1" />
        <div className="liquid-blob liquid-blob-b2" />
        <div className="liquid-blob liquid-blob-b3" />
        <div className="liquid-blob liquid-blob-b4" />
      </div>
      {/* WebGL liquid-chrome shader — mounts only when WebGL truly renders */}
      {shader && (
        <LiquidChrome
          baseColor={BRAND_BASE_COLOR}
          speed={BRAND_SPEED}
          interactive
        />
      )}
    </div>
  );
}

export default LiquidChromeLayer;
