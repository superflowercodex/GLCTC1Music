import type { AutomationPoint, Project } from "../project/model";
import { faderToDb, positionToHz } from "./mixMath";
import type { Engine } from "./engine";
import type { Instrument } from "./types";

export type AutomationTarget =
  | { kind: "track-gain"; trackId: string }
  | { kind: "track-pan"; trackId: string }
  | { kind: "master"; param: "gain" | "filter" | "delay" | "reverb" }
  | { kind: "instrument"; slotId: string; paramId: string };

const MASTER_ALIASES: Readonly<Record<string, "gain" | "filter" | "delay" | "reverb">> = {
  gain: "gain",
  gainDb: "gain",
  volume: "gain",
  filter: "filter",
  filterHz: "filter",
  delay: "delay",
  delayMix: "delay",
  reverb: "reverb",
  reverbMix: "reverb",
};

/** Lanes whose target no longer exists (a deleted track) resolve to undefined and are skipped. */
export function parseTarget(project: Project, target: string): AutomationTarget | undefined {
  const dot = target.indexOf(".");
  if (dot <= 0) return undefined;
  const owner = target.slice(0, dot);
  const rest = target.slice(dot + 1);
  if (owner === "master") {
    const param = MASTER_ALIASES[rest];
    return param ? { kind: "master", param } : undefined;
  }
  if (project.tracks.some((t) => t.id === owner)) {
    if (rest === "gain") return { kind: "track-gain", trackId: owner };
    if (rest === "pan") return { kind: "track-pan", trackId: owner };
    return undefined;
  }
  if (project.instruments.some((s) => s.id === owner)) return { kind: "instrument", slotId: owner, paramId: rest };
  return undefined;
}

/** Linear between points, held flat before the first and after the last. */
export function interpolate(points: readonly AutomationPoint[], beat: number): number | undefined {
  if (points.length === 0) return undefined;
  const sorted = points.every((p, i) => i === 0 || points[i - 1].beat <= p.beat) ? points : [...points].sort((a, b) => a.beat - b.beat);
  if (beat <= sorted[0].beat) return sorted[0].value;
  const last = sorted[sorted.length - 1];
  if (beat >= last.beat) return last.value;
  let i = 1;
  while (sorted[i].beat < beat) i += 1;
  const a = sorted[i - 1];
  const b = sorted[i];
  const span = b.beat - a.beat;
  return span <= 0 ? b.value : a.value + ((b.value - a.value) * (beat - a.beat)) / span;
}

export interface AutomationContext {
  engine: Engine;
  instrumentFor(slotId: string): Instrument | undefined;
  /** Called with an instrument's previous value the first time a lane touches it, so playback can put it back afterwards. */
  remember?(instrument: Instrument, paramId: string, original: number): void;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/** Applies every lane's value for one 16th step, scheduled for audio time `time`. Live playback and the offline mixdown both call this. */
export function applyAutomationStep(project: Project, step: number, time: number, host: AutomationContext): void {
  const beat = step / 4;
  for (const track of project.tracks) {
    for (const lane of track.automation) {
      const raw = interpolate(lane.points, beat);
      if (raw === undefined) continue;
      const target = parseTarget(project, lane.target);
      if (!target) continue;
      const value = clamp01(raw);
      switch (target.kind) {
        case "track-gain":
          host.engine.bus(target.trackId).setGainDb(faderToDb(value), time);
          break;
        case "track-pan":
          host.engine.bus(target.trackId).setPan(value * 2 - 1, time);
          break;
        case "master": {
          const section = host.engine.section;
          if (target.param === "gain") section.setGainDb(faderToDb(value), time);
          else if (target.param === "filter") section.setFilter(true, positionToHz(value), time);
          else if (target.param === "delay") section.setDelay(true, value, project.bpm);
          else section.setReverb(true, value);
          break;
        }
        case "instrument": {
          const instrument = host.instrumentFor(target.slotId);
          const def = instrument?.params.find((p) => p.id === target.paramId);
          if (!instrument || !def) break;
          const next = def.min + value * (def.max - def.min);
          const current = instrument.getParam(def.id);
          // A lane holds most of the time; resetting an unchanged value every step only churns the audio graph and the UI.
          if (current === (def.options ? Math.round(next) : next)) break;
          if (host.remember) host.remember(instrument, def.id, current);
          instrument.setParam(def.id, next);
          break;
        }
      }
    }
  }
}

export function hasAutomation(project: Project): boolean {
  return project.tracks.some((t) => t.automation.length > 0);
}
