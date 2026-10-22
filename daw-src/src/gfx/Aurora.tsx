import { useEffect, useRef } from "react";
import { peekEngine } from "../audio/engine";
import { prefersReducedMotion } from "../ui/hooks";
import { AURORA_FRAGMENT, AURORA_VERTEX, FramePacer } from "./auroraShader";

const FALLBACK =
  "radial-gradient(900px 520px at 12% 0%, rgba(142,124,255,.22), transparent 70%), radial-gradient(800px 500px at 90% 10%, rgba(255,99,216,.12), transparent 70%), radial-gradient(900px 600px at 50% 110%, rgba(121,235,255,.12), transparent 70%)";

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("WebGL could not create a shader.");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? "no details";
    gl.deleteShader(shader);
    throw new Error(`Aurora shader failed to compile: ${log}`);
  }
  return shader;
}

/** One fixed, pointer-transparent WebGL canvas behind the whole app. It draws at reduced resolution and is CSS-scaled up. */
export function Aurora() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const showFallback = () => {
      canvas.style.background = FALLBACK;
    };
    const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: "low-power" });
    if (!gl) {
      showFallback();
      return;
    }

    let program: WebGLProgram;
    let buffer: WebGLBuffer;
    let vs: WebGLShader;
    let fs: WebGLShader;
    try {
      vs = compile(gl, gl.VERTEX_SHADER, AURORA_VERTEX);
      fs = compile(gl, gl.FRAGMENT_SHADER, AURORA_FRAGMENT);
      const p = gl.createProgram();
      const b = gl.createBuffer();
      if (!p || !b) throw new Error("WebGL could not allocate the aurora program.");
      program = p;
      buffer = b;
      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? "link failed");
    } catch (e) {
      // A broken shader must not take the app down; the CSS backdrop already carries the look.
      console.error(e);
      showFallback();
      return;
    }

    // One oversized triangle covers the screen with a single draw and no seam.
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.useProgram(program);
    const aPos = gl.getAttribLocation(program, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    const uRes = gl.getUniformLocation(program, "uRes");
    const uTime = gl.getUniformLocation(program, "uTime");
    const uLevel = gl.getUniformLocation(program, "uLevel");
    const uKick = gl.getUniformLocation(program, "uKick");
    gl.clearColor(0, 0, 0, 0);

    const reduced = prefersReducedMotion();
    const pacer = new FramePacer(45, 30);
    const spectrum = new Uint8Array(512);
    let level = 0;
    let kick = 0;
    let raf = 0;
    let lost = false;
    let scale = 0.5;
    let width = 0;
    let height = 0;

    const resize = () => {
      const s = pacer.downgraded ? 0.35 : scale;
      const w = Math.max(2, Math.round(window.innerWidth * s));
      const h = Math.max(2, Math.round(window.innerHeight * s));
      if (w === width && h === height) return;
      width = w;
      height = h;
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    };

    const draw = (seconds: number) => {
      resize();
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(uRes, width, height);
      gl.uniform1f(uTime, seconds);
      gl.uniform1f(uLevel, level);
      gl.uniform1f(uKick, kick);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const readAudio = () => {
      const engine = peekEngine();
      let lv = 0;
      let kk = 0;
      if (engine && engine.clock.playing) {
        engine.analyser.getByteFrequencyData(spectrum);
        let sum = 0;
        for (let i = 1; i < 120; i++) sum += spectrum[i];
        lv = sum / 119 / 255;
        kk = (spectrum[1] + spectrum[2] + spectrum[3] + spectrum[4]) / 4 / 255;
      }
      // Fast attack, slow release keeps it a gentle swell instead of a flash.
      level += (lv - level) * (lv > level ? 0.25 : 0.04);
      kick += (kk - kick) * (kk > kick ? 0.4 : 0.06);
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (document.hidden || lost || !pacer.shouldRender(now)) return;
      readAudio();
      draw(now / 1000);
    };

    const onResize = () => {
      if (reduced && !lost) draw(6);
    };
    const onLost = (e: Event) => {
      e.preventDefault();
      lost = true;
      cancelAnimationFrame(raf);
      showFallback();
    };

    canvas.addEventListener("webglcontextlost", onLost);
    window.addEventListener("resize", onResize);
    if (reduced) draw(6);
    else raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      canvas.removeEventListener("webglcontextlost", onLost);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, []);

  return <canvas ref={ref} aria-hidden="true" style={{ position: "fixed", inset: 0, width: "100vw", height: "100vh", zIndex: -1, pointerEvents: "none" }} />;
}
