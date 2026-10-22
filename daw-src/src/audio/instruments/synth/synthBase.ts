import { InstrumentBase } from "../../instrument";
import type { ParamDef, Preset } from "../../types";
import { freshSeed } from "./rng";
import type { SynthVoice } from "./voice";

/** Plumbing the three synths share: voice bookkeeping with stealing, a seed, and preset loading that leaves performance settings alone. */
export abstract class SynthBase extends InstrumentBase {
  protected seed = freshSeed();
  protected voices: SynthVoice[] = [];
  protected lastStepAt = Number.NEGATIVE_INFINITY;
  private lastStepDur = 0.125;
  protected maxVoices = 8;
  private marks: { time: number; a: number; b: number }[] = [];
  private lastMark: { a: number; b: number } | null = null;

  constructor(
    ctx: BaseAudioContext,
    params: readonly ParamDef[],
    factory: readonly Preset[],
    storageKey: string,
    /** Groups a factory preset does not touch, e.g. the arpeggiator: switching sounds must not switch the arp off. */
    private readonly keepOnPreset: ReadonlySet<string>,
  ) {
    super(ctx, params, factory, storageKey);
  }

  /** Same seed, same probability and random choices, live or bounced. */
  setSeed(seed: number): void {
    this.seed = seed >>> 0;
  }

  get currentSeed(): number {
    return this.seed;
  }

  override loadPreset(id: string): void {
    const preset = this.presets.find((p) => p.id === id);
    if (!preset) throw new RangeError(`${this.kind} has no preset "${id}"`);
    for (const p of this.params) {
      const stored = preset.values[p.id];
      if (stored === undefined && (!preset.factory || this.keeps(p, preset))) continue;
      const value = stored ?? p.def;
      this.values[p.id] = value;
      this.onParam(p.id, value);
    }
    if (preset.data !== undefined) this.restoreData(preset.data);
    this.presetId = id;
    this.bump();
  }

  /** Parameters a factory preset does not mention are reset to defaults unless this says to leave them. */
  protected keeps(def: ParamDef, _preset: Preset): boolean {
    return this.keepOnPreset.has(def.group);
  }

  /** Remembers which step sounds at `time`, for playheads that must follow what is heard, not what is scheduled. */
  protected mark(time: number, a: number, b = -1): void {
    this.marks.push({ time, a, b });
    if (this.marks.length > 64) this.marks.shift();
  }

  /** The step currently audible, or null when the transport is stopped. */
  playhead(): { a: number; b: number } | null {
    const now = this.ctx.currentTime;
    while (this.marks.length > 0 && this.marks[0].time <= now) {
      const m = this.marks.shift();
      if (m) this.lastMark = { a: m.a, b: m.b };
    }
    return this.transportRunning ? this.lastMark : null;
  }

  /** True while the clock is feeding steps, so held keys arpeggiate with the song and play directly when it is stopped. */
  protected get transportRunning(): boolean {
    // Slow tempos leave long gaps between steps; a fixed window would read them as the clock having stopped.
    return this.ctx.currentTime - this.lastStepAt < Math.max(0.3, this.lastStepDur * 2.5);
  }

  protected markStep(stepDur: number): void {
    this.lastStepAt = this.ctx.currentTime;
    this.lastStepDur = stepDur;
  }

  protected track(voice: SynthVoice): void {
    const now = this.ctx.currentTime;
    this.voices = this.voices.filter((v) => v.sounding(now));
    voice.onEnd = () => {
      this.voices = this.voices.filter((v) => v !== voice);
    };
    this.voices.push(voice);
    // Stealing looks at who is sounding when the new note starts, not now: a bounce schedules the whole song up front.
    const at = voice.startTime;
    const overlapping = this.voices.filter((v) => !v.dead && v.startTime <= at && v.sounding(at));
    while (overlapping.length > this.maxVoices) {
      const oldest = overlapping.shift();
      oldest?.kill(at);
    }
  }

  get activeVoiceCount(): number {
    const now = this.ctx.currentTime;
    return this.voices.filter((v) => v.sounding(now)).length;
  }

  override allNotesOff(): void {
    for (const v of this.voices) v.kill();
    this.voices = [];
  }

  /** Silences notes the sequencer started, leaving what the player holds. */
  protected stopSequenced(): void {
    for (const v of this.voices) if (v.sequenced) v.kill();
    this.voices = this.voices.filter((v) => !v.sequenced);
  }
}
