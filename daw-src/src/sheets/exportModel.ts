import type { Project } from "../project/model";
import { estimateRenderSeconds, LONG_EXPORT_SEC, MixdownError, planMixdown, type MixdownOptions } from "../audio/mixdown";
import { wavFileSizeBytes, type WavBitDepth } from "../audio/wav";

export type ExportWhat = "song" | "loop" | "tracks";

export interface ExportChoices {
  what: ExportWhat;
  source: "arrangement" | "song";
  /** The sheet's single "instruments and master limiter" switch. */
  instrumentsAndLimiter: boolean;
  metronome: boolean;
  bitDepth: WavBitDepth;
}

export const EXPORT_SAMPLE_RATE = 44100;

export function mixdownOptionsFor(choices: ExportChoices): MixdownOptions {
  return {
    range: choices.what === "loop" ? { kind: "loop" } : { kind: "song" },
    source: choices.source,
    sampleRate: EXPORT_SAMPLE_RATE,
    includeInstruments: choices.instrumentsAndLimiter,
    masterLimiter: choices.instrumentsAndLimiter,
    metronome: choices.metronome,
  };
}

export interface ExportSummary {
  ok: boolean;
  error: string | null;
  seconds: number;
  bytesPerFile: number;
  files: number;
  renderSeconds: number;
  long: boolean;
}

export function summarizeExport(project: Project, choices: ExportChoices): ExportSummary {
  const options = mixdownOptionsFor(choices);
  try {
    const plan = planMixdown(project, options);
    const files = choices.what === "tracks" ? Math.max(1, project.tracks.filter((t) => !t.muted).length) : 1;
    const frames = Math.ceil(plan.totalSec * EXPORT_SAMPLE_RATE);
    return {
      ok: true,
      error: null,
      seconds: plan.durationSec,
      bytesPerFile: wavFileSizeBytes(frames, 2, choices.bitDepth),
      files,
      renderSeconds: estimateRenderSeconds(project, plan, choices.instrumentsAndLimiter) * files,
      long: plan.durationSec > LONG_EXPORT_SEC,
    };
  } catch (err) {
    if (!(err instanceof MixdownError)) throw err;
    return { ok: false, error: err.message, seconds: 0, bytesPerFile: 0, files: 0, renderSeconds: 0, long: false };
  }
}

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  const mb = bytes / (1024 * 1024);
  return mb >= 1000 ? `${(mb / 1024).toFixed(1)} GB` : `${mb >= 100 ? Math.round(mb) : mb.toFixed(1)} MB`;
}

export function formatRenderTime(seconds: number): string {
  if (seconds < 60) return `~${Math.max(1, Math.round(seconds))} s`;
  return `~${Math.round(seconds / 60)} min`;
}
