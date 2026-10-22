import type { Route } from "../rooms";
import type { SectionKind } from "../project/model";
import { hexToHsl, type Palette } from "./palette";
import { mulberry32 } from "./stars";

/*
 * The living sky, as pure functions of (project seed, time, music). Aurora.tsx feeds the results to the shader.
 * Everything here is cheap enough to run every drawn frame and is deterministic, so a project always has the
 * same sky at the same moment and the tests can pin it down.
 */

export type SkyMode = "alive" | "calm" | "still";
export type SceneId = "ribbons" | "shafts" | "clouds" | "deep" | "dust" | "device";

/** 32-bit FNV-1a: a project's id becomes the seed of its own sky. */
export function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const TAU = Math.PI * 2;
const smooth = (x: number): number => {
  const k = Math.min(1, Math.max(0, x));
  return k * k * (3 - 2 * k);
};

// ---------------------------------------------------------------- colour journey

export interface Pool {
  /** Offset of the pool's centre from its home, in the shader's half-height units. */
  dx: number;
  dy: number;
  /** Radius multiplier. */
  size: number;
}

export interface Journey {
  /** The colours of the right, left and low pools, 0..1 display RGB. */
  colors: [Rgb, Rgb, Rgb];
  pools: [Pool, Pool, Pool, Pool];
}

export interface Wave {
  period: number;
  phase: number;
}

/** Periods in seconds. Pairwise incommensurate (ratios of primes) and minutes long, so the sum of them never visibly repeats. */
const COLOR_PERIODS = [173, 241, 317, 409, 563, 691];
const MOVE_PERIODS = [89, 131, 197, 263, 347, 433, 521, 613];

function waves(seed: number, salt: number, periods: readonly number[]): Wave[] {
  const rand = mulberry32(seed ^ salt);
  // Each project also stretches its periods a little, so two projects never drift in lockstep.
  return periods.map((p) => ({ period: p * (0.85 + rand() * 0.3), phase: rand() * TAU }));
}

const wave = (w: Wave, t: number): number => Math.sin((TAU * t) / w.period + w.phase);

export type Rgb = [number, number, number];

/** HSL (h in degrees) to 0..1 RGB, in floats so a minutes-long glide never steps by a whole 8-bit level. */
export function hslRgb(h: number, s: number, l: number): Rgb {
  const hh = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = hh < 60 ? [c, x, 0] : hh < 120 ? [x, c, 0] : hh < 180 ? [0, c, x] : hh < 240 ? [0, x, c] : hh < 300 ? [x, 0, c] : [c, 0, x];
  return [r + m, g + m, b + m];
}

/** How far a pool's hue wanders from its home colour, at most, in degrees. */
export const HUE_WANDER = 36;
/** The most a pool leans toward the next palette colour when it visits it. */
export const VISIT_SHARE = 0.5;

interface Home {
  h: number;
  s: number;
  l: number;
  next: { h: number; s: number; l: number };
}

function homes(p: Palette): Home[] {
  // Slot order matches the shader: the right pool (a2), the left pool (a3), the low pool (a1).
  const order = [p.a2, p.a3, p.a1].map(hexToHsl);
  return order.map((c, i) => ({ ...c, next: order[(i + 1) % 3] }));
}

/** Shortest-way hue mix, so a visit from 340 to 20 degrees passes through red, not round the whole wheel. */
function mixHue(a: number, b: number, k: number): number {
  const d = ((b - a + 540) % 360) - 180;
  return a + d * k;
}

export class JourneyClock {
  private readonly colorWaves: Wave[];
  private readonly moveWaves: Wave[];
  private homes: Home[];

  constructor(readonly seed: number, palette: Palette) {
    this.colorWaves = waves(seed, 0x51ed27, COLOR_PERIODS);
    this.moveWaves = waves(seed, 0x2c1b3c, MOVE_PERIODS);
    this.homes = homes(palette);
  }

  setPalette(palette: Palette): void {
    this.homes = homes(palette);
  }

  /**
   * Each pool keeps its own home colour from the palette, so the pools never collapse into one hue; its hue
   * wanders around home, and now and then it visits the next palette colour and comes back.
   */
  private color(i: number, t: number): Rgb {
    const c = this.colorWaves;
    const home = this.homes[i];
    const wander = HUE_WANDER * (0.7 * wave(c[i], t) + 0.3 * wave(c[i + 3], t));
    const visit = VISIT_SHARE * Math.pow(0.5 + 0.5 * wave(c[(i + 1) % 3 + 3], t * 0.9), 4);
    const h = mixHue(home.h + wander, home.next.h, visit);
    const s = Math.min(1, home.s + (home.next.s - home.s) * visit);
    const l = Math.max(0.6, home.l + (home.next.l - home.l) * visit);
    return hslRgb(h, s, l);
  }

  /** `t` is wall-clock seconds, so the journey carries on across reloads instead of restarting at the same frame. */
  at(t: number, amount = 1): Journey {
    const m = this.moveWaves;
    const pool = (i: number): Pool => ({
      dx: amount * (0.11 * wave(m[i], t) + 0.05 * wave(m[(i + 3) % m.length], t)),
      dy: amount * (0.07 * wave(m[(i + 1) % m.length], t) + 0.03 * wave(m[(i + 5) % m.length], t)),
      size: 1 + amount * (0.14 * wave(m[(i + 2) % m.length], t) + 0.06 * wave(m[(i + 6) % m.length], t)),
    });
    return {
      colors: [this.color(0, t), this.color(1, t), this.color(2, t)],
      pools: [pool(0), pool(1), pool(2), pool(3)],
    };
  }
}

// ---------------------------------------------------------------- weather

export type WeatherKind = "cloud" | "shafts" | "dust";

export interface Weather {
  cloud: number;
  shafts: number;
  dust: number;
  /** Where the new cloud sits (0..1 screen, y up) and the dust band's angle (radians) and offset. */
  x: number;
  y: number;
  angle: number;
  offset: number;
  /** Hue the cloud brings in, relative to the project's main accent. */
  hueShift: number;
}

/** One weather slot every 70 s; an event inside it lasts 34-58 s, so at most two ever overlap. */
export const WEATHER_SLOT = 70;

interface WeatherEvent {
  kind: WeatherKind;
  start: number;
  length: number;
  peak: number;
  x: number;
  y: number;
  angle: number;
  hueShift: number;
}

function slotEvent(seed: number, slot: number): WeatherEvent | null {
  const rand = mulberry32((seed ^ Math.imul(slot, 0x9e3779b1)) >>> 0);
  // About two slots in three have weather; the rest are clear sky, so events feel occasional.
  if (rand() > 0.66) return null;
  const r = rand();
  const kind: WeatherKind = r < 0.45 ? "cloud" : r < 0.75 ? "shafts" : "dust";
  return {
    kind,
    start: slot * WEATHER_SLOT + rand() * 18,
    length: 34 + rand() * 24,
    peak: 0.6 + rand() * 0.4,
    x: 0.15 + rand() * 0.7,
    y: 0.2 + rand() * 0.6,
    angle: -0.5 + rand() * 1.0,
    hueShift: (rand() < 0.5 ? -1 : 1) * (40 + rand() * 50),
  };
}

/** Rises and falls with eased shoulders over a third of the event each way, so nothing pops in. */
export function envelope(t: number, start: number, length: number): number {
  const u = (t - start) / length;
  if (u <= 0 || u >= 1) return 0;
  return smooth(u / 0.36) * smooth((1 - u) / 0.36);
}

export function weatherAt(seed: number, t: number): Weather {
  const out: Weather = { cloud: 0, shafts: 0, dust: 0, x: 0.5, y: 0.5, angle: 0, offset: 0, hueShift: 50 };
  const slot = Math.floor(t / WEATHER_SLOT);
  let strongest = 0;
  for (const s of [slot - 1, slot]) {
    const e = slotEvent(seed, s);
    if (!e) continue;
    const k = envelope(t, e.start, e.length) * e.peak;
    if (k <= 0) continue;
    out[e.kind] = Math.max(out[e.kind], k);
    if (k > strongest) {
      strongest = k;
      const u = (t - e.start) / e.length;
      // The cloud and band drift slowly across their life instead of hanging still.
      out.x = e.x + (u - 0.5) * 0.12;
      out.y = e.y + (u - 0.5) * 0.05;
      out.angle = e.angle;
      out.offset = (u - 0.5) * 0.5;
      out.hueShift = e.hueShift;
    }
  }
  return out;
}

// ---------------------------------------------------------------- music

export interface Energy {
  /** 0 = sparse and dim, 0.45 = the resting sky, 1 = a drop. */
  energy: number;
  /** -1 cool .. +1 warm. */
  warmth: number;
  /** How wide the focus pool opens (drops). */
  wide: number;
  /** Extra dust and darkness (breaks). */
  sparse: number;
}

export const REST: Energy = { energy: 0.45, warmth: 0, wide: 0, sparse: 0 };

/** Energy ramps per section kind (start, end), the same curve the Song room draws. */
const KIND_RAMP: Record<SectionKind, readonly [number, number]> = {
  intro: [0.25, 0.35],
  build: [0.4, 0.85],
  drop: [1, 0.95],
  break: [0.2, 0.15],
  outro: [0.35, 0.05],
};
const KIND_WARMTH: Record<SectionKind, readonly [number, number]> = {
  intro: [-0.7, -0.5],
  build: [0, 0.6],
  drop: [0.35, 0.3],
  break: [-0.4, -0.5],
  outro: [-0.2, -0.4],
};

/** The sky's target for a section kind at `progress` (0..1) through the section. */
export function sectionEnergy(kind: SectionKind, progress: number): Energy {
  const u = Math.min(1, Math.max(0, progress));
  const [e0, e1] = KIND_RAMP[kind];
  const [w0, w1] = KIND_WARMTH[kind];
  return {
    energy: e0 + (e1 - e0) * u,
    warmth: w0 + (w1 - w0) * u,
    wide: kind === "drop" ? 1 : kind === "build" ? 0.3 * u : 0,
    sparse: kind === "break" ? 1 : kind === "outro" ? 0.5 * u : 0,
  };
}

/** Without section kinds: the slow loudness relative to the song's loudest so far stands in for energy. */
export function rmsEnergy(slowLevel: number, peakLevel: number): Energy {
  const ratio = peakLevel > 0.02 ? Math.min(1, slowLevel / peakLevel) : 0;
  const energy = 0.2 + 0.75 * Math.pow(ratio, 1.5);
  return { energy, warmth: (energy - 0.5) * 0.9, wide: Math.max(0, (energy - 0.75) * 4), sparse: Math.max(0, (0.35 - energy) * 3) };
}

/** Soft, bounded loudness for the swell: never more than `cap`, and gentler the louder it gets. */
export function swell(level: number, cap = 1): number {
  return cap * (1 - Math.exp(-Math.max(0, level) * 3));
}

/**
 * A kick follower: rises on an onset (bass above its own running average), then falls. The attack is a few
 * frames, never one, so a kick is a soft breath of light and not a strobe.
 */
export class KickFollower {
  private avg = 0;
  value = 0;

  constructor(private readonly attack = 0.05, private readonly release = 0.32) {}

  step(bass: number, dt: number): number {
    const onset = Math.max(0, bass - this.avg * 1.12);
    this.avg += (bass - this.avg) * (1 - Math.exp(-dt / 0.45));
    const target = Math.min(1, onset * 4);
    const tau = target > this.value ? this.attack : this.release;
    this.value = target + (this.value - target) * Math.exp(-Math.max(0, dt) / tau);
    return this.value;
  }
}

// ---------------------------------------------------------------- rooms

/** Weights of the shader's room layers: ribbons, shafts, clouds, deep, dust, device. */
export type SceneWeights = [number, number, number, number, number, number];

export function sceneFor(route: Route, instrumentRoom: boolean): SceneId {
  switch (route.room) {
    case "arrange":
      return "ribbons";
    case "mix":
      return "shafts";
    case "song":
      return "clouds";
    case "stage":
      return "deep";
    case "library":
      return "dust";
    case "play":
      return instrumentRoom ? "device" : "dust";
  }
}

const SCENE_ORDER: readonly SceneId[] = ["ribbons", "shafts", "clouds", "deep", "dust", "device"];

export function sceneWeights(scene: SceneId): SceneWeights {
  return SCENE_ORDER.map((s) => (s === scene ? 1 : 0)) as SceneWeights;
}

// ---------------------------------------------------------------- safety

/**
 * Brightest channel the sky may reach. The resting cap is the measured one the glass and text were tuned
 * against (0.44); energy may lift it by up to 15%, and only a drop's kick bloom briefly by a little more.
 */
export const BASE_CAP = 0.44;
export function brightnessCap(energy: number, bloom: number): number {
  const lift = 0.15 * smooth((energy - 0.45) / 0.55);
  const flash = 0.06 * Math.min(1, Math.max(0, bloom));
  return BASE_CAP * (1 + lift + flash);
}

/** Mode scaling: Calm moves slower and reacts less; Still freezes everything. */
export interface ModeScale {
  speed: number;
  react: number;
  weather: number;
}
export function modeScale(mode: SkyMode): ModeScale {
  if (mode === "still") return { speed: 0, react: 0, weather: 0 };
  if (mode === "calm") return { speed: 0.45, react: 0.35, weather: 0.6 };
  return { speed: 1, react: 1, weather: 1 };
}

/** Twinkle playback rate from the tempo: 120 bpm is the resting rate, kept within a gentle range. */
export function twinkleRate(bpm: number | null, mode: SkyMode): number {
  if (mode === "still") return 0;
  const base = bpm === null ? 1 : Math.min(1.7, Math.max(0.6, bpm / 120));
  return mode === "calm" ? 0.6 + (base - 1) * 0.3 : base;
}
