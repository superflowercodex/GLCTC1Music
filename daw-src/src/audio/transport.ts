import { projectStore } from "../store/project";
import { tempoFromTaps } from "./clock";
import { getEngine, peekEngine } from "./engine";

/** Position as bar and beat, both 1-based, from a fractional 16th step. */
export function barBeat(step: number, beatsPerBar: number): { bar: number; beat: number } {
  const stepsPerBar = beatsPerBar * 4;
  return { bar: Math.floor(step / stepsPerBar) + 1, beat: Math.floor((step % stepsPerBar) / 4) + 1 };
}

export async function togglePlay(): Promise<void> {
  const engine = getEngine();
  await engine.resume();
  if (engine.clock.playing) engine.clock.stop();
  else engine.clock.start();
}

export function stopAndRewind(): void {
  const engine = peekEngine();
  if (!engine) return;
  engine.clock.stop();
  engine.clock.seek(0);
}

export function setProjectBpm(bpm: number): void {
  const clamped = Math.min(300, Math.max(30, bpm));
  projectStore.set((p) => ({ ...p, bpm: clamped }));
  peekEngine()?.clock.setBpm(clamped);
}

const taps: number[] = [];

export function tapTempo(): void {
  taps.push(performance.now() / 1000);
  if (taps.length > 8) taps.shift();
  const bpm = tempoFromTaps(taps);
  if (bpm !== null) setProjectBpm(bpm);
}
