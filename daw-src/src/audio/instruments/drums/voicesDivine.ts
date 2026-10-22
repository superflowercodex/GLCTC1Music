import type { Hit } from "./hit";

export const VOICES_DIVINE = [
  { name: "Kick", color: "#79ebff" },
  { name: "Snare", color: "#8e7cff" },
  { name: "Clap", color: "#ff63d8" },
  { name: "Closed hat", color: "#7cf0c0" },
  { name: "Open hat", color: "#7cf0c0" },
  { name: "Low tom", color: "#ffd36a" },
  { name: "Mid tom", color: "#ffd36a" },
  { name: "High tom", color: "#ffd36a" },
  { name: "Rimshot", color: "#8e7cff" },
  { name: "Ride", color: "#ff63d8" },
  { name: "Crash", color: "#ff63d8" },
  { name: "Sample 1", color: "#79ebff" },
  { name: "Sample 2", color: "#8e7cff" },
  { name: "Sample 3", color: "#ff63d8" },
  { name: "Sample 4", color: "#7cf0c0" },
] as const;

export const SYNTH_VOICES = 11;

/** Kit character: pitch, decay, brightness and noise multipliers applied over a voice profile. */
export interface KitChar {
  f: number;
  d: number;
  b: number;
  n: number;
}

export interface Profile {
  kf: number; kx: number; kt: number; kd: number; kc: number; kw: OscillatorType; ksat: number; kn: number;
  sf: number; sd: number; sn: number; st: number; sw: OscillatorType;
  cd: number; cb: number; cs: number;
  hd: number; ho: number; hn: number; hm: number; hs: number;
  td: number; tf: number; tk: number; wd: number; mt: number;
}

const BASE: Profile = {
  kf: 50, kx: 4.5, kt: 0.03, kd: 0.55, kc: 0.9, kw: "sine", ksat: 2.5, kn: 0,
  sf: 185, sd: 0.26, sn: 1, st: 0.9, sw: "triangle",
  cd: 0.24, cb: 4, cs: 0.011,
  hd: 0.09, ho: 0.55, hn: 0.35, hm: 1, hs: 1,
  td: 0.42, tf: 1, tk: 0.5, wd: 0, mt: 0,
};
const mk = (o: Partial<Profile>): Profile => ({ ...BASE, ...o });

export const PROFILES: Record<string, Profile> = {
  "909": mk({}),
  "808": mk({ kf: 46, kx: 3.2, kt: 0.055, kd: 1.3, kc: 0.2, ksat: 1.6, sf: 178, sd: 0.3, sn: 0.7, st: 1.1, cd: 0.28, cb: 3, cs: 0.013, hd: 0.11, ho: 0.7, hn: 0.2, td: 0.7, tf: 0.85, tk: 0.15 }),
  analogue: mk({ kf: 52, kx: 3.8, kt: 0.04, kd: 0.65, kc: 0.45, ksat: 2, sf: 190, sd: 0.26, sn: 0.85, cd: 0.25, cb: 3, hd: 0.1, ho: 0.6, hn: 0.45, hm: 0.8, td: 0.5, tf: 0.95, tk: 0.35, wd: 1 }),
  digital: mk({ kf: 58, kx: 5.5, kt: 0.02, kd: 0.32, kc: 1, kw: "triangle", ksat: 1.2, sf: 220, sd: 0.17, sw: "square", st: 0.6, cd: 0.16, cb: 5, cs: 0.009, hd: 0.06, ho: 0.35, hn: 0.2, hm: 1.2, hs: 1.1, td: 0.3, tf: 1.1, tk: 0.8 }),
  metallic: mk({ kf: 55, kx: 4, kd: 0.5, kc: 0.6, sf: 250, sd: 0.24, cd: 0.22, hd: 0.09, ho: 0.8, hn: 0.1, hm: 1.5, hs: 1.25, td: 0.45, tf: 1.2, tk: 0.6, mt: 1 }),
  noise: mk({ kf: 50, kx: 3.5, kt: 0.04, kd: 0.5, kn: 0.5, sd: 0.38, sn: 1.4, st: 0.5, cd: 0.32, hd: 0.13, ho: 0.65, hn: 1, hm: 0.3, td: 0.42, tk: 0.9 }),
  sub: mk({ kf: 38, kx: 2.8, kt: 0.07, kd: 1.1, kc: 0.05, ksat: 1, sf: 165, sd: 0.2, sn: 0.6, st: 1.2, cd: 0.2, hd: 0.07, ho: 0.4, td: 0.6, tf: 0.7, tk: 0.15 }),
  tight: mk({ kf: 60, kx: 5, kt: 0.018, kd: 0.26, kc: 1, ksat: 2.8, sd: 0.13, st: 0.8, cd: 0.12, cb: 4, hd: 0.045, ho: 0.22, td: 0.22, tf: 1.05 }),
  wide: mk({ kf: 50, kx: 4, kt: 0.035, kd: 0.75, kc: 0.5, wd: 1, sd: 0.4, cd: 0.4, cb: 4, cs: 0.014, hd: 0.12, ho: 0.8, td: 0.55, tk: 0.4 }),
};

/** Voice profile choices in the order the sound panel shows them; `kit` follows the selected kit. */
export const PROFILE_CHOICES: readonly { label: string; id: string }[] = [
  { label: "Classic", id: "kit" },
  { label: "Punchy", id: "909" },
  { label: "Deep", id: "sub" },
  { label: "Crunch", id: "noise" },
  { label: "Tight", id: "tight" },
  { label: "Loose", id: "wide" },
  { label: "Lo-fi", id: "analogue" },
  { label: "Bright", id: "digital" },
  { label: "Boomy", id: "808" },
  { label: "Gated", id: "metallic" },
];

export interface Kit {
  id: string;
  name: string;
  char: KitChar;
  profile: string;
}

export const KITS_DIVINE: readonly Kit[] = [
  { id: "909", name: "Classic 909", char: { f: 1, d: 1, b: 1, n: 1 }, profile: "909" },
  { id: "808", name: "Warehouse", char: { f: 0.93, d: 1.45, b: 0.85, n: 0.8 }, profile: "808" },
  { id: "industrial", name: "Berlin", char: { f: 0.86, d: 1.15, b: 0.9, n: 1.3 }, profile: "metallic" },
  { id: "707", name: "Rave 91", char: { f: 1.05, d: 0.85, b: 1.1, n: 0.9 }, profile: "digital" },
  { id: "linn", name: "Dusty", char: { f: 0.97, d: 1.05, b: 0.95, n: 1 }, profile: "analogue" },
  { id: "dmx", name: "Tight", char: { f: 1.03, d: 0.8, b: 1.1, n: 1.1 }, profile: "tight" },
  { id: "electro", name: "Detroit", char: { f: 1.08, d: 0.9, b: 1.25, n: 0.9 }, profile: "digital" },
  { id: "606", name: "Chicago", char: { f: 1.12, d: 0.7, b: 1.2, n: 0.9 }, profile: "digital" },
  { id: "breaks", name: "Lo-fi", char: { f: 1, d: 0.85, b: 1, n: 1.2 }, profile: "tight" },
  { id: "tribal", name: "Big room", char: { f: 0.9, d: 1.25, b: 0.9, n: 0.9 }, profile: "wide" },
  { id: "glitch", name: "Minimal", char: { f: 1.18, d: 0.55, b: 1.3, n: 1.1 }, profile: "noise" },
  { id: "hybrid", name: "Galactic", char: { f: 1, d: 1, b: 1.05, n: 1 }, profile: "analogue" },
];

export interface DivineVoiceOptions {
  kc: KitChar;
  p: Profile;
  /** Hat tone from the master section, 0.1 to 1. */
  hat: number;
  /** Frequency ratio from the voice's tune control. */
  tune: number;
  /** Decay multiplier from the voice's decay control. */
  decay: number;
  /** 0 to 2: how hard the transient click is hit. */
  punch: number;
  /** Hit velocity, used only for the velocity-dependent brightness. */
  vel: number;
}

/** The synthesised voices 0 to 10. Everything is built from oscillators and noise through envelopes. */
export function playDivine(h: Hit, voice: number, o: DivineVoiceOptions): void {
  const { p, tune } = o;
  const kc: KitChar = { f: o.kc.f * tune, d: o.kc.d * o.decay, b: o.kc.b, n: o.kc.n };
  const vq = Math.max(0.15, Math.min(1.25, o.vel));
  const br = 0.6 + 0.4 * Math.min(1, vq);
  const hum = 1 + (h.rng() - 0.5) * 0.01;
  const hatHp = (o.hat * 5500 + 2500) * kc.b;
  const hatBp = 8000 + o.hat * 4000;
  const pn = o.punch;

  switch (voice) {
    case 0: {
      const f1 = p.kf * kc.f ** 0.6 * hum;
      const f0 = f1 * p.kx;
      const dur = p.kd * kc.d ** 0.7;
      const body = h.saturator(p.ksat);
      h.osc(f0, p.kw, dur, 0.62, f1, p.kt, 0.0008, body);
      h.osc(f1 * 2, "triangle", dur * 0.35, 0.18, f1 * 1.6, p.kt, 0.0008, body);
      if (p.wd) h.osc(f0, "sine", dur * 0.9, 0.26, f1 * 1.01, p.kt, 0.001, body, 9);
      if (p.kc > 0 && pn > 0) {
        h.noise(0.014, p.kc * br * kc.b * pn, "bandpass", 3200 * kc.b, 0, 0.9, 0.0004);
        h.osc(900 * kc.f, "triangle", 0.01, 0.15 * p.kc * br * pn, 200, 0.004, 0.0003);
      }
      if (p.kn) h.noise(0.2, 0.6 * p.kn, "lowpass", 2200);
      if (p.mt) {
        h.osc(f1 * 7.3, "square", 0.05, 0.1, f1 * 5, 0.02, 0.0005);
        h.noise(0.04, 0.9, "bandpass", 4200, 0, 2);
      }
      break;
    }
    case 1: {
      const sf = p.sf * kc.f * hum;
      const d = p.sd * kc.d;
      const nz = p.sn * kc.n;
      h.osc(sf * 1.7, p.sw, 0.1 + d * 0.2, 0.38 * p.st, sf, 0.02, 0.0008);
      h.osc(sf * 2.9, "sine", 0.07, 0.17 * p.st, sf * 1.9, 0.015, 0.0008);
      h.noise(d, 0.3 * nz, "highpass", 1400 * kc.b, 0, 0.7, 0.001);
      h.noise(d * 0.75, 0.45 * nz * br, "bandpass", 4200 * kc.b, 0, 0.9, 0.001);
      h.noise(0.012, 0.3 * br * pn, "highpass", 6500, 0, 0.7, 0.0003);
      if (p.mt) h.metal(d, 1.2, 3000, 6500, 1.3 * p.hs);
      break;
    }
    case 2: {
      const tail = p.cd * kc.d ** 0.8;
      let at = 0;
      for (let j = 0; j < p.cb; j++) {
        h.noise(0.012, 3.2 * kc.n * (0.85 + 0.15 * h.rng()), "bandpass", 1250 * kc.b * (1 + j * 0.02), at, 1.4, 0.0005);
        at += p.cs * (1 + (h.rng() - 0.5) * 0.3);
      }
      h.noise(tail, 1.5 * kc.n, "bandpass", 1150 * kc.b, at, 1.1, 0.002);
      h.noise(tail * 0.6, 0.2 * br, "highpass", 3500, at, 0.7, 0.002);
      break;
    }
    case 3: {
      const dur = p.hd * kc.d ** 0.5;
      h.metal(dur, 3.2 * p.hm * br, hatHp, hatBp, p.hs);
      h.noise(dur * 0.9, 0.6 * p.hn * br, "highpass", hatHp * 1.2, 0, 0.7, 0.0006);
      break;
    }
    case 4: {
      const dur = p.ho * kc.d ** 0.5;
      h.metal(dur, 2.6 * p.hm * br, hatHp * 0.9, hatBp, p.hs);
      h.noise(dur * 0.8, 0.55 * p.hn * br, "highpass", hatHp, 0, 0.7, 0.001);
      break;
    }
    case 5:
    case 6:
    case 7: {
      const base = [92, 132, 190][voice - 5] * p.tf * kc.f ** 0.7 * hum;
      const dur = p.td * (1 - (voice - 5) * 0.12) * kc.d ** 0.6;
      const body = h.saturator(1.3, 0.9);
      h.osc(base * 1.9, "sine", dur, 0.55, base, 0.045, 0.001, body);
      h.osc(base * 2.6, "triangle", dur * 0.25, 0.14, base * 1.6, 0.03, 0.001, body);
      h.noise(0.02, 0.4 * p.tk * br * 2 * pn, "bandpass", 1800, 0, 1, 0.0005);
      if (p.wd) h.osc(base * 1.9, "sine", dur * 0.85, 0.22, base * 1.012, 0.045, 0.001, h.out, 8);
      if (p.mt) h.osc(base * 3.4, "square", 0.04, 0.06, base * 3, 0.02, 0.0005);
      break;
    }
    case 8:
      h.osc(1650 * kc.f, "sine", 0.04, 0.32, 1500, 0.02, 0.0003);
      h.osc(520 * kc.f, "triangle", 0.05, 0.32, 460, 0.03, 0.0003);
      h.noise(0.02, 0.8 * br * pn, "bandpass", 3800 * kc.b, 0, 1.2, 0.0002);
      break;
    case 9:
      h.metal(1.7 * o.decay, 1.2, hatHp, hatBp, 0.85 * p.hs);
      h.noise(0.9 * o.decay, 0.15, "highpass", 7000);
      [[538, 0.09, 0.7], [1214, 0.06, 0.45], [1805, 0.04, 0.3]].forEach(([f, a, d]) => h.osc(f * kc.f * hum, "sine", d, a));
      break;
    case 10:
      h.metal(1.9 * o.decay, 1.35, hatHp * 0.8, hatBp * 0.85, 1.15 * p.hs, 0.003);
      h.noise(1.7 * o.decay, 0.3, "highpass", hatHp, 0, 0.7, 0.003);
      break;
  }
}
