import type { Hit } from "./hit";

export interface Voice80Def {
  id: string;
  name: string;
  short: string;
  type: "kick" | "snare" | "clap" | "hatc" | "hato" | "toml" | "tomm" | "rim" | "cow" | "conga" | "perc1" | "perc2";
  color: string;
}

export const VOICES_80LA8: readonly Voice80Def[] = [
  { id: "kick", name: "Kick", short: "BD", type: "kick", color: "#79ebff" },
  { id: "snare", name: "Snare", short: "SD", type: "snare", color: "#8e7cff" },
  { id: "clap", name: "Clap", short: "CP", type: "clap", color: "#ff63d8" },
  { id: "hatc", name: "Closed hat", short: "CH", type: "hatc", color: "#7cf0c0" },
  { id: "hato", name: "Open hat", short: "OH", type: "hato", color: "#ffd36a" },
  { id: "toml", name: "Low tom", short: "LT", type: "toml", color: "#79ebff" },
  { id: "tomm", name: "Mid tom", short: "MT", type: "tomm", color: "#8e7cff" },
  { id: "rim", name: "Rimshot", short: "RS", type: "rim", color: "#ff63d8" },
  { id: "cow", name: "Cowbell", short: "CB", type: "cow", color: "#7cf0c0" },
  { id: "conga", name: "Conga", short: "CG", type: "conga", color: "#ffd36a" },
  { id: "perc1", name: "Perc 1", short: "P1", type: "perc1", color: "#79ebff" },
  { id: "perc2", name: "Perc 2", short: "P2", type: "perc2", color: "#8e7cff" },
];

/** `pitch` is a frequency ratio (2^(semitones/12)); `decay` is the voice's length in seconds. */
export function play80la8(h: Hit, type: Voice80Def["type"], pitch: number, decay: number): void {
  const d = decay;
  switch (type) {
    case "kick": {
      const dur = Math.max(0.12, d);
      h.osc(150 * pitch, "sine", dur, 0.95, 43 * pitch, 0.03);
      h.noise(0.012, 0.35, "bandpass", 3000, 0, 0.9, 0.0004);
      break;
    }
    case "snare":
      h.osc(190 * pitch, "triangle", Math.min(0.22, d), 0.65, 150 * pitch, 0.02);
      h.noise(Math.min(0.28, d), 0.8, "highpass", 1300);
      break;
    case "clap":
      [0, 0.018, 0.036].forEach((off, j) => h.noise(Math.min(0.11, d), 0.75 - j * 0.16, "highpass", 900, off));
      break;
    case "hatc":
      h.noise(0.11, 0.55, "highpass", 7200);
      break;
    case "hato":
      h.noise(Math.min(d, 1.8), 0.6, "highpass", 5400);
      break;
    case "toml":
    case "tomm":
    case "conga": {
      const base = type === "toml" ? 105 : type === "tomm" ? 165 : 220;
      h.osc(base * pitch, "sine", Math.max(0.08, Math.min(d, 0.8)), 0.95, base * 0.58 * pitch, 0.035);
      if (type === "conga") h.noise(0.05, 0.18, "bandpass", 900);
      break;
    }
    case "rim":
      h.osc(1600 * pitch, "triangle", 0.055, 0.9, 1450 * pitch, 0.02, 0.0004);
      h.noise(0.025, 0.22, "highpass", 3200);
      break;
    case "cow":
      [540, 815].forEach((f, j) => h.osc(f * pitch, "square", Math.min(0.4, d), j ? 0.22 : 0.3));
      break;
    case "perc1":
    case "perc2": {
      const f = type === "perc1" ? 460 : 780;
      h.osc(f * pitch, type === "perc1" ? "triangle" : "sine", Math.max(0.04, Math.min(0.3, d)), 0.95, f * 0.7 * pitch, 0.012);
      if (type === "perc2") h.noise(0.06, 0.25, "bandpass", 2600);
      break;
    }
  }
}
