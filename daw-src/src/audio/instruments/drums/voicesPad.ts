import type { Hit } from "./hit";

export const PAD_KINDS = ["Kick", "Snare", "Clap", "Hat", "Open", "Tom", "Rim", "Conga", "Sub bass", "Pluck", "Stab", "Pad", "Lead", "Zap", "Riser", "Impact"] as const;
export const PAD_COLORS = ["#79ebff", "#8e7cff", "#ff63d8", "#7cf0c0", "#7cf0c0", "#ffd36a", "#8e7cff", "#ff63d8", "#79ebff", "#ff63d8", "#ffd36a", "#8e7cff", "#7cf0c0", "#79ebff", "#ff63d8", "#ffd36a"];

/** The 16 synth voices. `r` is the tune ratio, `dec` the decay multiplier. */
export function playPad(h: Hit, kind: number, r: number, dec: number): void {
  const hum = 1 + (h.rng() - 0.5) * 0.008;
  const f = (x: number) => x * hum;
  switch (kind) {
    case 0: {
      const base = 50 * r;
      h.osc(f(base * 4.4), "sine", 0.55 * dec, 0.8, base, 0.03);
      h.osc(f(base * 2), "triangle", 0.15 * dec, 0.2, base * 1.5, 0.03);
      h.noise(0.014, 1, "bandpass", 3200, 0, 0.9, 0.0004);
      break;
    }
    case 1: {
      const base = 190 * r;
      h.osc(f(base * 1.7), "triangle", 0.14 * dec, 0.4, base, 0.02);
      h.osc(f(base * 2.9), "sine", 0.07 * dec, 0.17, base * 1.9, 0.015);
      h.noise(0.26 * dec, 0.3, "highpass", 1400);
      h.noise(0.2 * dec, 0.45, "bandpass", 4200, 0, 0.9);
      h.noise(0.012, 0.3, "highpass", 6500, 0, 0.7, 0.0003);
      break;
    }
    case 2: {
      for (let j = 0; j < 4; j++) h.noise(0.012, 3.2 * (0.85 + 0.15 * h.rng()), "bandpass", 1250 * (1 + j * 0.02), j * 0.011, 1.4, 0.0005);
      h.noise(0.24 * dec, 1.5, "bandpass", 1150, 0.044, 1.1, 0.002);
      h.noise(0.14 * dec, 0.2, "highpass", 3500, 0.044, 0.7, 0.002);
      break;
    }
    case 3:
      h.metal(0.09 * dec, 3.2, 6000 * r, 10600, r);
      h.noise(0.08 * dec, 0.21, "highpass", 7200 * r, 0, 0.7, 0.0006);
      break;
    case 4:
      h.metal(0.55 * dec, 2.6, 5400 * r, 10600, r);
      h.noise(0.44 * dec, 0.19, "highpass", 6500 * r, 0, 0.7, 0.001);
      break;
    case 5: {
      const base = 92 * r;
      h.osc(f(base * 1.9), "sine", 0.42 * dec, 0.55, base, 0.045);
      h.osc(f(base * 2.6), "triangle", 0.1 * dec, 0.14, base * 1.6, 0.03);
      h.noise(0.02, 0.4, "bandpass", 1800, 0, 1, 0.0005);
      break;
    }
    case 6:
      h.osc(1650 * r, "sine", 0.04, 0.32, 1500, 0.02, 0.0003);
      h.osc(520 * r, "triangle", 0.05, 0.32, 460, 0.03, 0.0003);
      h.noise(0.02, 0.8, "bandpass", 3800, 0, 1.2, 0.0002);
      break;
    case 7: {
      const base = 330 * r;
      h.osc(f(base * 1.18), "sine", 0.24 * dec, 0.6, base, 0.03);
      h.osc(f(base * 1.9), "triangle", 0.08 * dec, 0.15, base * 1.5, 0.02);
      h.noise(0.025, 0.45, "bandpass", 1900, 0, 1.2, 0.0006);
      break;
    }
    case 8: {
      const base = 55 * r;
      h.osc(f(base), "sine", 0.75 * dec, 0.85, undefined, undefined, 0.004);
      h.osc(f(base * 2), "triangle", 0.4 * dec, 0.14, undefined, undefined, 0.004);
      break;
    }
    case 9: {
      const base = 110 * r;
      h.filtOsc("sawtooth", f(base), 0.4 * dec, 0.5, 5000, 500, 4);
      h.filtOsc("square", f(base * 0.5), 0.4 * dec, 0.3, 1200, 300, 1);
      break;
    }
    case 10:
      [0, 3, 7, 10].forEach((s, i) => h.filtOsc("sawtooth", f(220 * r * 2 ** (s / 12)), 0.32 * dec, 0.17, 3800, 600, 3, 0.004, (i - 1.5) * 5));
      break;
    case 11:
      [0, 7, 12, 15].forEach((s, i) => h.filtOsc("sawtooth", f(130.8 * r * 2 ** (s / 12)), 1.5 * dec, 0.12, 1300, 900, 0.7, 0.3, (i - 1.5) * 7));
      break;
    case 12:
      h.filtOsc("sawtooth", f(440 * r), 0.4 * dec, 0.3, 4200, 1500, 2.5, 0.004);
      h.filtOsc("square", f(440 * r * 1.003), 0.4 * dec, 0.16, 3200, 1200, 1, 0.004);
      break;
    case 13:
      h.osc(2600 * r, "sawtooth", 0.34 * dec, 0.4, 90 * r, 0.07);
      h.noise(0.12 * dec, 0.25, "highpass", 3200);
      break;
    case 14:
      h.sweep(1.7 * dec, 1.8, 300, 9000 * r);
      break;
    case 15:
      h.noise(1.5 * dec, 1.5, "lowpass", 170, 0, 0.7, 0.002);
      h.osc(72 * r, "sine", 1.2 * dec, 0.85, 26 * r, 0.18);
      h.noise(0.55 * dec, 0.25, "highpass", 2200);
      break;
  }
}
