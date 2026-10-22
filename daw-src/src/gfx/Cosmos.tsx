import { useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
import { peekEngine } from "../audio/engine";
import { projectStore } from "../store/project";
import { useStore } from "../store/store";
import { prefersReducedMotion } from "../ui/hooks";
import { Aurora } from "./Aurora";
import type { Ambience } from "./ambience";
import { hashSeed, modeScale, twinkleRate, type SkyMode } from "./sky";
import { useSkyMode } from "./skySettings";
import { starField } from "./stars";
import "./cosmos.css";

/**
 * Three star depths. Each is a canvas drawn once per size; the compositor sways them along one slow camera path,
 * nearer layers further, so the sky has parallax without repainting a single star. Far dust needs no retina pixels.
 */
const LAYERS = [
  { seed: 0x91c7c1, area: 5200, dpr: 1, sway: 5, size: 0.85, alpha: 0.85 },
  { seed: 0x3b7f21, area: 6500, dpr: 1.5, sway: 12, size: 1, alpha: 1 },
  { seed: 0xc0ffee, area: 13000, dpr: 2, sway: 24, size: 1.1, alpha: 1 },
] as const;
/** One lap of the camera sway. Long enough that the loop itself is never noticed. */
const SWAY_MS = 210_000;
// A closed Lissajous-like path (unit amplitude), so the sway returns to where it started without a seam.
const SWAY_PATH = Array.from({ length: 13 }, (_, i) => {
  const a = (i / 12) * Math.PI * 2;
  return [Math.sin(a), 0.55 * Math.sin(2 * a + 0.6)] as const;
});

function StarLayer({ layer, mode }: { layer: (typeof LAYERS)[number]; mode: SkyMode }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const anim = useRef<Animation | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    let timer = 0;
    const m = layer.sway + 4;
    const paint = () => {
      const dpr = Math.min(devicePixelRatio || 1, layer.dpr);
      const w = innerWidth + m * 2;
      const h = innerHeight + m * 2;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      for (const s of starField(w, h, layer.seed, layer.area)) {
        const r = 236 + Math.round(s.warmth * 14);
        const b = 248 - Math.round(s.warmth * 22);
        ctx.fillStyle = `rgba(${r}, 240, ${b}, ${Math.min(1, s.alpha * layer.alpha)})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r * layer.size, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    const onResize = () => {
      clearTimeout(timer);
      timer = window.setTimeout(paint, 150);
    };
    paint();
    addEventListener("resize", onResize);
    if (!prefersReducedMotion() && typeof canvas.animate === "function") {
      anim.current = canvas.animate(
        SWAY_PATH.map(([x, y]) => ({ transform: `translate3d(${(x * layer.sway).toFixed(2)}px, ${(y * layer.sway).toFixed(2)}px, 0)` })),
        { duration: SWAY_MS, iterations: Infinity, easing: "linear" },
      );
      // Every load starts somewhere else on the path.
      anim.current.currentTime = Date.now() % SWAY_MS;
    }
    return () => {
      clearTimeout(timer);
      removeEventListener("resize", onResize);
      anim.current?.cancel();
      anim.current = null;
    };
  }, [layer]);

  useEffect(() => {
    const a = anim.current;
    if (!a) return;
    const speed = modeScale(mode).speed;
    if (speed === 0) a.pause();
    else {
      a.updatePlaybackRate(speed);
      if (a.playState === "paused") a.play();
    }
  }, [mode]);

  const m = layer.sway + 4;
  return <canvas ref={ref} className="amb-stars amb-star-layer" style={{ inset: -m, width: `calc(100% + ${m * 2}px)`, height: `calc(100% + ${m * 2}px)` }} aria-hidden="true" />;
}

// The brighter stars that breathe, each on its own period so they never pulse together.
const TWINKLES: { x: number; y: number; d: number; delay: number; s: number }[] = [
  { x: 14, y: 9, d: 7.5, delay: 0, s: 2 },
  { x: 63, y: 6, d: 9.2, delay: 2.1, s: 1.6 },
  { x: 88, y: 17, d: 6.4, delay: 4.3, s: 2.2 },
  { x: 41, y: 93, d: 10.6, delay: 1.2, s: 1.8 },
  { x: 96, y: 71, d: 8.1, delay: 5.5, s: 1.6 },
  { x: 27, y: 52, d: 11.3, delay: 3.4, s: 1.5 },
  { x: 74, y: 44, d: 9.7, delay: 6.6, s: 1.7 },
  { x: 6, y: 64, d: 12.4, delay: 8.1, s: 1.4 },
  { x: 52, y: 28, d: 8.8, delay: 3.9, s: 1.3 },
  { x: 81, y: 88, d: 10.1, delay: 7.2, s: 1.5 },
];

/** Twinkles follow the tempo while the music plays; checked twice a second, eased by the animation's own rate change. */
function useTwinkleTempo(host: RefObject<HTMLDivElement | null>, mode: SkyMode): void {
  useEffect(() => {
    const el = host.current;
    if (!el || prefersReducedMotion()) return;
    let applied = -1;
    const tick = () => {
      if (document.hidden) return;
      const engine = peekEngine();
      const bpm = engine?.clock.playing ? engine.clock.bpm : null;
      const rate = twinkleRate(bpm, mode);
      if (Math.abs(rate - applied) < 0.04) return;
      applied = rate;
      for (const a of el.getAnimations({ subtree: true })) {
        if (rate === 0) a.pause();
        else {
          a.updatePlaybackRate(rate);
          if (a.playState === "paused") a.play();
        }
      }
    };
    tick();
    const id = window.setInterval(tick, 500);
    return () => clearInterval(id);
  }, [host, mode]);
}

/**
 * A rare, faint shooting star: one short streak every minute or so (less in Calm, never in Still or with
 * reduced motion), drawn and moved by the compositor.
 */
function useMeteors(host: RefObject<HTMLDivElement | null>, mode: SkyMode): void {
  useEffect(() => {
    const el = host.current;
    if (!el || mode === "still" || prefersReducedMotion() || typeof el.animate !== "function") return;
    const [min, spread] = mode === "calm" ? [90_000, 110_000] : [40_000, 60_000];
    let timer = 0;
    const schedule = () => {
      timer = window.setTimeout(fire, min + Math.random() * spread);
    };
    const fire = () => {
      schedule();
      if (document.hidden) return;
      const streak = document.createElement("i");
      streak.className = "amb-meteor";
      const x = 8 + Math.random() * 80;
      const y = 4 + Math.random() * 50;
      const dir = Math.random() < 0.5 ? -1 : 1;
      const angle = dir * (18 + Math.random() * 16);
      const travel = 160 + Math.random() * 140;
      streak.style.left = `${x}%`;
      streak.style.top = `${y}%`;
      el.appendChild(streak);
      const rad = (angle * Math.PI) / 180;
      const dx = Math.cos(rad) * travel * dir;
      const dy = Math.abs(Math.sin(rad)) * travel;
      const rot = `rotate(${(Math.atan2(dy, dx) * 180) / Math.PI}deg)`;
      const a = streak.animate(
        [
          { transform: `translate3d(0, 0, 0) ${rot} scaleX(.3)`, opacity: 0 },
          { opacity: 0.5, offset: 0.25 },
          { transform: `translate3d(${dx.toFixed(1)}px, ${dy.toFixed(1)}px, 0) ${rot} scaleX(1)`, opacity: 0 },
        ],
        { duration: 1100 + Math.random() * 500, easing: "cubic-bezier(.2,.6,.4,1)" },
      );
      a.onfinish = () => streak.remove();
      a.oncancel = () => streak.remove();
    };
    schedule();
    return () => {
      clearTimeout(timer);
      for (const s of el.querySelectorAll(".amb-meteor")) s.remove();
    };
  }, [host, mode]);
}

/**
 * Deep space behind the whole app: true-black void, the WebGL nebula (or its CSS stand-in), three drifting star
 * depths, twinkling stars, a rare shooting star and a soft vignette. Fixed, pointer-transparent, behind every panel.
 */
export function Cosmos({ ambience }: { ambience: Ambience }) {
  const [gl, setGl] = useState(true);
  const mode = useSkyMode();
  const projectId = useStore(projectStore, (p) => p.id);
  const seed = useMemo(() => hashSeed(projectId), [projectId]);
  const twinkles = useRef<HTMLDivElement>(null);
  const sky = useRef<HTMLDivElement>(null);
  useTwinkleTempo(twinkles, mode);
  useMeteors(sky, mode);
  const style = { "--neb": ambience.accent, "--neb-a": ambience.pools?.[0] ?? "#ff63d8", "--neb-b": ambience.pools?.[1] ?? "#8e7cff", "--neb-x": `${ambience.focus[0] * 100}%`, "--neb-y": `${(1 - ambience.focus[1]) * 100}%` } as CSSProperties;
  return (
    <div className="ambient" data-gl={gl ? "on" : "off"} data-sky={mode} style={style} aria-hidden="true">
      {gl ? (
        <Aurora accent={ambience.accent} focus={ambience.focus} pools={ambience.pools} palette={ambience.palette} scene={ambience.scene} seed={seed} onUnavailable={() => setGl(false)} />
      ) : (
        <div className="amb-pools" />
      )}
      {LAYERS.map((layer) => (
        <StarLayer key={layer.seed} layer={layer} mode={mode} />
      ))}
      <div ref={twinkles} className="amb-twinkles">
        {TWINKLES.map((t, i) => (
          <i key={i} style={{ left: `${t.x}%`, top: `${t.y}%`, width: t.s, height: t.s, animationDuration: `${t.d}s`, animationDelay: `-${t.delay}s` }} />
        ))}
      </div>
      <div ref={sky} className="amb-meteors" />
      <div className="amb-vignette" />
    </div>
  );
}
