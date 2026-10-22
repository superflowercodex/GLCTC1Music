import { useEffect, useRef } from "react";
import { peekEngine } from "../audio/engine";
import { KIND_COLOR, sectionAtBar, sectionStarts } from "../rooms/song/songModel";
import { projectStore } from "../store/project";
import { prefersReducedMotion } from "../ui/hooks";
import { approach, AURORA_FRAGMENT, AURORA_VERTEX, FramePacer, parseHex } from "./auroraShader";
import { BRAND, hexToHsl, hslToHex, mixHex, type Palette } from "./palette";
import {
  brightnessCap,
  JourneyClock,
  KickFollower,
  modeScale,
  REST,
  rmsEnergy,
  sceneWeights,
  sectionEnergy,
  swell,
  weatherAt,
  type Energy,
  type SceneId,
  type SkyMode,
} from "./sky";
import { skyStore } from "./skySettings";

/** The nebula is soft and low-frequency, so a quarter of the (capped) device resolution is plenty. */
const DPR_CAP = 1.5;
const RES_SCALE = 0.25;
const RES_SCALE_LOW = 0.18;
/** The journey is slow enough that 15 fps reads as smooth; playback and room changes get 30. */
const FPS_IDLE = 15;
const FPS_BUSY = 30;
const FPS_LOW = 15;
/** Seconds for the light to settle on a new room's colour and position. */
const DRIFT_TAU = 0.7;
/** Sections hand over over a few seconds, so a drop arrives as a dawn, not a flash. */
const ENERGY_TAU = 2.2;
const SCENE_TAU = 0.9;
/** The still frame (reduced motion, "Still") is one moment of the project's own journey. */
const STILL_AT = 4_000;

type Vec3 = [number, number, number];

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

const lerp3 = (a: readonly number[], b: readonly number[], k: number): Vec3 => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

function warmthTint(w: number): Vec3 {
  return w >= 0 ? lerp3([1, 1, 1], [1.1, 0.97, 0.84], w) : lerp3([1, 1, 1], [0.86, 0.97, 1.12], -w);
}

interface Target {
  accent: Vec3;
  focus: [number, number];
  pa: Vec3;
  pb: Vec3;
  palette: Palette;
  scene: SceneId;
  seed: number;
}

export interface AuroraProps {
  accent: string;
  focus: [number, number];
  pools?: [string, string];
  palette?: Palette;
  scene: SceneId;
  /** The project's sky seed (`hashSeed(project.id)`). */
  seed: number;
  onUnavailable: () => void;
}

const BRAND_POOLS: [string, string] = ["#ff63d8", "#8e7cff"];

/**
 * The nebula: one pointer-transparent WebGL canvas at reduced resolution, CSS-scaled up behind the app.
 * `accent`, `focus` and `scene` steer the room's own light; changes ease in over about a second. The pools walk the
 * project's palette over minutes (`sky.ts`), weather drifts through, and while audio plays the sky follows the song.
 * `onUnavailable` fires when WebGL is missing or lost so the caller can show the CSS nebula instead.
 */
export function Aurora({ accent, focus, pools = BRAND_POOLS, palette = BRAND, scene, seed, onUnavailable }: AuroraProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const make = (): Target => ({ accent: parseHex(accent), focus, pa: parseHex(pools[0]), pb: parseHex(pools[1]), palette, scene, seed });
  const target = useRef<Target>(make());
  const poke = useRef<() => void>(() => {});
  const fail = useRef(onUnavailable);
  fail.current = onUnavailable;

  useEffect(() => {
    target.current = make();
    poke.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accent, focus[0], focus[1], pools[0], pools[1], palette.a1, palette.a2, palette.a3, scene, seed]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: "low-power" });
    if (!gl) {
      fail.current();
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
      // A broken shader must not take the app down; the CSS nebula carries the look.
      console.error(e);
      fail.current();
      return;
    }

    // One oversized triangle covers the screen with a single draw and no seam.
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.useProgram(program);
    const aPos = gl.getAttribLocation(program, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    const u = (name: string) => gl.getUniformLocation(program, name);
    const U = {
      res: u("uRes"), time: u("uTime"), octaves: u("uOctaves"), accent: u("uAccent"), focus: u("uFocus"),
      poolA: u("uPoolA"), poolB: u("uPoolB"), poolC: u("uPoolC"), p0: u("uP0"), p1: u("uP1"), p2: u("uP2"), p3: u("uP3"),
      energy: u("uEnergy"), tint: u("uTint"), kick: u("uKick"), meter: u("uMeter"), scene: u("uScene"), scene2: u("uScene2"),
      weather: u("uWeather"), weatherGeo: u("uWeatherGeo"), weatherCol: u("uWeatherCol"), section: u("uSection"), cap: u("uCap"),
    };
    gl.clearColor(0, 0, 0, 0);

    const reduced = prefersReducedMotion();
    const pacer = new FramePacer(FPS_IDLE, FPS_LOW);
    const spectrum = new Uint8Array(512);
    let journey = new JourneyClock(target.current.seed, target.current.palette);
    let journeySeed = target.current.seed;
    let journeyPalette = target.current.palette;
    const kickFollower = new KickFollower();

    const col = [...target.current.accent] as Vec3;
    const foc = [...target.current.focus];
    const pa = [...target.current.pa] as Vec3;
    const pb = [...target.current.pb] as Vec3;
    const pc: Vec3 = [0.475, 0.922, 1];
    const scn = [...sceneWeights(target.current.scene)];
    const en: Energy = { ...REST };
    let warm = 0;
    const section: [number, number, number, number] = [1, 1, 1, 0];
    let level = 0;
    let slowLevel = 0;
    let peakLevel = 0;
    let kick = 0;
    let meter = 0;
    let raf = 0;
    let running = false;
    let lost = false;
    let width = 0;
    let height = 0;
    let lastDraw = 0;
    // Sky time and journey time only advance at the mode's speed, so Calm slows the sky without a jump.
    let skyTime = (target.current.seed % 997) + 20;
    let journeyTime = Date.now() / 1000;
    let mode: SkyMode = skyStore.get().mode;
    let weatherHue = NaN;
    let weatherCol: Vec3 = [1, 1, 1];

    const isStill = () => reduced || mode === "still";

    const resize = () => {
      const s = Math.min(devicePixelRatio || 1, DPR_CAP) * (pacer.downgraded ? RES_SCALE_LOW : RES_SCALE);
      const w = Math.max(2, Math.round(innerWidth * s));
      const h = Math.max(2, Math.round(innerHeight * s));
      if (w === width && h === height) return;
      width = w;
      height = h;
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    };

    const syncJourney = () => {
      const t = target.current;
      if (t.seed !== journeySeed) {
        // A different project: a different sky, but the light still eases over from the old one.
        journeySeed = t.seed;
        journey = new JourneyClock(t.seed, t.palette);
        journeyPalette = t.palette;
        skyTime = (t.seed % 997) + 20;
      } else if (t.palette !== journeyPalette) {
        journey.setPalette(t.palette);
        journeyPalette = t.palette;
      }
    };

    const readAudio = (dt: number, react: number): { playing: boolean; energy: Energy; sectionColor: string | null } => {
      const engine = peekEngine();
      const playing = !!engine?.clock.playing && react > 0;
      let lv = 0;
      let bass = 0;
      if (engine && playing) {
        engine.analyser.getByteFrequencyData(spectrum);
        let sum = 0;
        for (let i = 1; i < 120; i++) sum += spectrum[i];
        lv = sum / 119 / 255;
        bass = (spectrum[1] + spectrum[2] + spectrum[3] + spectrum[4]) / 4 / 255;
      }
      // Fast attack, slow release keeps it a gentle swell instead of a flash.
      level = approach(level, lv, dt, lv > level ? 0.12 : 0.6);
      slowLevel = approach(slowLevel, lv, dt, 4);
      peakLevel = Math.max(slowLevel, playing ? approach(peakLevel, slowLevel, dt, 40) : peakLevel);
      kick = kickFollower.step(bass, dt) * react;
      meter = approach(meter, Math.min(1, lv * 1.8), dt, lv > meter ? 0.1 : 0.35);

      if (!engine || !playing) return { playing: false, energy: REST, sectionColor: null };
      const project = projectStore.get();
      const stepsPerBar = project.beatsPerBar * 4;
      const barPos = engine.clock.position() / stepsPerBar + 1;
      const sections = project.song.sections;
      const i = sectionAtBar(sections, Math.floor(barPos));
      const s = i >= 0 ? sections[i] : undefined;
      if (s?.kind) {
        const start = sectionStarts(sections)[i];
        return { playing, energy: sectionEnergy(s.kind, (barPos - start) / s.bars), sectionColor: KIND_COLOR[s.kind] };
      }
      return { playing, energy: rmsEnergy(slowLevel, peakLevel), sectionColor: null };
    };

    /** Advances everything by `dt` seconds; returns true while something is still visibly moving toward a target. */
    const ease = (dt: number): boolean => {
      const t = target.current;
      syncJourney();
      const still = isStill();
      const ms = modeScale(still ? "still" : mode);
      skyTime += dt * ms.speed;
      journeyTime += dt * ms.speed;
      const jt = still ? STILL_AT + (t.seed % 600) : journeyTime;
      const j = journey.at(jt, still ? 1 : 0.6 + 0.4 * ms.speed);
      const k = (tau: number) => (still || dt === 0 ? 1 : 1 - Math.exp(-dt / tau));

      if (still) {
        // A still sky is the resting sky: no leftover drop, kick or section colour from before the switch.
        Object.assign(en, REST);
        warm = 0;
        kick = 0;
        level = 0;
        meter = 0;
        section[3] = 0;
      }
      const audio = still ? { playing: false, energy: REST, sectionColor: null } : readAudio(dt, ms.react);
      const goal = audio.energy;
      const r = ms.react;
      en.energy = approach(en.energy, REST.energy + (goal.energy - REST.energy) * r, still ? 0 : dt, ENERGY_TAU);
      en.wide = approach(en.wide, goal.wide * r, still ? 0 : dt, ENERGY_TAU);
      en.sparse = approach(en.sparse, goal.sparse * r, still ? 0 : dt, ENERGY_TAU);
      warm = approach(warm, goal.warmth * r, still ? 0 : dt, ENERGY_TAU * 1.4);
      const sc = audio.sectionColor ? parseHex(mixHex(audio.sectionColor, t.palette.a1, 0.4)) : section.slice(0, 3);
      const sk = k(ENERGY_TAU);
      for (let i = 0; i < 3; i++) section[i] += (sc[i] - section[i]) * sk;
      section[3] += ((audio.sectionColor ? 0.55 * r : 0) - section[3]) * sk;

      const drift = k(DRIFT_TAU);
      const [ja, jb, jc] = j.colors;
      let moving = 0;
      for (let i = 0; i < 3; i++) {
        moving += Math.abs(col[i] - t.accent[i]);
        col[i] += (t.accent[i] - col[i]) * drift;
        pa[i] += (ja[i] - pa[i]) * drift;
        pb[i] += (jb[i] - pb[i]) * drift;
        pc[i] += (jc[i] - pc[i]) * drift;
      }
      const fk = k(DRIFT_TAU * 1.4);
      for (let i = 0; i < 2; i++) {
        moving += Math.abs(foc[i] - t.focus[i]);
        foc[i] += (t.focus[i] - foc[i]) * fk;
      }
      const sw = sceneWeights(t.scene);
      const sck = k(SCENE_TAU);
      for (let i = 0; i < 6; i++) {
        moving += Math.abs(scn[i] - sw[i]);
        scn[i] += (sw[i] - scn[i]) * sck;
      }

      const wx = still ? null : weatherAt(t.seed, journeyTime);
      if (wx && wx.hueShift !== weatherHue) {
        weatherHue = wx.hueShift;
        const base = hexToHsl(t.palette.a1);
        weatherCol = parseHex(hslToHex({ h: (base.h + wx.hueShift + 360) % 360, s: Math.max(0.55, base.s), l: Math.max(0.62, base.l) }));
      }

      const gain = 0.865 + 0.3 * en.energy - 0.2 * en.sparse;
      const tint = warmthTint(warm);
      const cap = brightnessCap(en.energy, kick * en.wide);
      gl.uniform3f(U.accent, col[0], col[1], col[2]);
      gl.uniform2f(U.focus, foc[0], foc[1]);
      gl.uniform3f(U.poolA, pa[0], pa[1], pa[2]);
      gl.uniform3f(U.poolB, pb[0], pb[1], pb[2]);
      gl.uniform3f(U.poolC, pc[0], pc[1], pc[2]);
      const [q0, q1, q2, q3] = j.pools;
      gl.uniform3f(U.p0, q0.dx, q0.dy, q0.size);
      gl.uniform3f(U.p1, q1.dx, q1.dy, q1.size);
      gl.uniform3f(U.p2, q2.dx, q2.dy, q2.size);
      gl.uniform3f(U.p3, q3.dx, q3.dy, q3.size);
      gl.uniform4f(U.energy, gain, en.wide, en.sparse, swell(level, 1) * r);
      gl.uniform3f(U.tint, tint[0], tint[1], tint[2]);
      gl.uniform1f(U.kick, kick);
      gl.uniform1f(U.meter, meter);
      gl.uniform3f(U.scene, scn[0], scn[1], scn[2]);
      gl.uniform3f(U.scene2, scn[3], scn[4], scn[5]);
      const ws = ms.weather;
      gl.uniform3f(U.weather, (wx?.cloud ?? 0) * ws, (wx?.shafts ?? 0) * ws, (wx?.dust ?? 0) * ws);
      gl.uniform4f(U.weatherGeo, wx?.x ?? 0.5, wx?.y ?? 0.5, wx?.angle ?? 0, wx?.offset ?? 0);
      gl.uniform3f(U.weatherCol, weatherCol[0], weatherCol[1], weatherCol[2]);
      gl.uniform4f(U.section, section[0], section[1], section[2], section[3]);
      gl.uniform1f(U.cap, cap);
      return audio.playing || moving > 0.01 || level > 0.01 || kick > 0.01;
    };

    const draw = () => {
      resize();
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(U.res, width, height);
      gl.uniform1f(U.time, skyTime);
      gl.uniform1f(U.octaves, pacer.downgraded ? 3 : 4);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (document.hidden || lost || !pacer.shouldRender(now)) return;
      const dt = lastDraw ? Math.min(0.25, (now - lastDraw) / 1000) : 0;
      lastDraw = now;
      const busy = ease(dt);
      pacer.target = busy ? FPS_BUSY : FPS_IDLE;
      draw();
    };

    // Still: one frame, redrawn only when the size, the room or the project changes.
    const still = () => {
      if (lost) return;
      ease(0);
      draw();
    };
    const start = () => {
      if (running || lost || document.hidden) return;
      running = true;
      lastDraw = 0;
      raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
    };
    const apply = () => {
      if (isStill()) {
        stop();
        still();
      } else start();
    };
    poke.current = () => {
      if (isStill()) still();
    };

    const onResize = () => {
      if (isStill()) still();
    };
    // A hidden tab stops the loop entirely instead of spinning rAF callbacks that draw nothing.
    const onVisibility = () => {
      if (isStill() || lost) return;
      if (document.hidden) stop();
      else start();
    };
    const onLost = (e: Event) => {
      e.preventDefault();
      lost = true;
      stop();
      fail.current();
    };
    const unsubscribeMode = skyStore.subscribe(() => {
      const next = skyStore.get().mode;
      if (next === mode) return;
      mode = next;
      apply();
    });

    canvas.addEventListener("webglcontextlost", onLost);
    addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVisibility);
    apply();

    return () => {
      stop();
      unsubscribeMode();
      poke.current = () => {};
      removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("webglcontextlost", onLost);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      // No loseContext(): a canvas hands back the same context forever, so StrictMode's remount (or any
      // remount onto this canvas) would get a dead one and drop to the CSS nebula. The GC frees it.
    };
  }, []);

  return <canvas ref={ref} className="amb-nebula" aria-hidden="true" />;
}
