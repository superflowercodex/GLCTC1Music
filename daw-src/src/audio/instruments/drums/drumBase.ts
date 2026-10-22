import { InstrumentBase } from "../../instrument";
import type { NoteEvent, ParamDef, Preset } from "../../types";
import { Hit } from "./hit";
import { SendFx } from "./fx";
import { notify } from "./notify";
import { clampIndex, swingDelay } from "./pattern";
import { cacheSample, cachedSample, isSampleRef, loadSample, type SampleRef } from "./samples";
import { createSafetyChain, type SafetyChain } from "./safety";
import { mulberry32 } from "./rng";

export const PATTERN_COUNT = 4;
export const PATTERN_NAMES = ["A", "B", "C", "D"] as const;

const VOICE_PARAM = /^v(\d+)\.(\w+)$/;

/**
 * Everything the three drum machines share: the pattern A to D plumbing, hit bookkeeping so
 * stopping silences tails, sample slots stored as asset references, and the output safety chain.
 */
export abstract class DrumBase extends InstrumentBase {
  protected readonly mix: GainNode;
  protected readonly safety: SafetyChain;
  protected readonly fx: SendFx;
  protected stepDur = 0.125;
  protected activeIndex: number | null = 0;
  protected editIndex = 0;
  protected samples: (SampleRef | null)[];
  protected buffers: (AudioBuffer | null)[];
  private selected = 0;
  private readonly live = new Set<Hit>();
  private syncedStepDur = 0;

  constructor(
    ctx: BaseAudioContext,
    params: readonly ParamDef[],
    presets: readonly Preset[],
    storageKey: string,
    readonly voiceCount: number,
    sampleSlots: number,
  ) {
    super(ctx, params, presets, storageKey);
    this.mix = ctx.createGain();
    this.safety = createSafetyChain(ctx);
    this.fx = new SendFx(ctx, this.mix);
    this.mix.connect(this.safety.input);
    this.safety.output.connect(this.output);
    this.samples = Array.from({ length: sampleSlots }, () => null);
    this.buffers = Array.from({ length: sampleSlots }, () => null);
  }

  get selectedVoice(): number {
    return this.selected;
  }

  selectVoice(index: number): void {
    this.selected = clampIndex(index, this.voiceCount);
    this.bump();
  }

  override get patternCount(): number {
    return PATTERN_COUNT;
  }

  override get activePattern(): number | null {
    return this.activeIndex;
  }

  /** The pattern the grid shows and edits; stays put while the Song room silences playback. */
  get editPattern(): number {
    return this.editIndex;
  }

  override setPattern(index: number | null): void {
    this.activeIndex = index === null ? null : clampIndex(index, PATTERN_COUNT);
    if (this.activeIndex !== null) this.editIndex = this.activeIndex;
    this.onPatternChange();
    this.bump();
  }

  protected onPatternChange(): void {}

  override onStep(step: number, time: number, stepDur: number): void {
    this.stepDur = stepDur;
    if (Math.abs(stepDur - this.syncedStepDur) > 1e-6) {
      this.syncedStepDur = stepDur;
      this.fx.syncTo(stepDur);
    }
    if (this.activeIndex === null) return;
    this.playStep(step, time, stepDur);
  }

  /** When each hit sounds, with odd 16ths pushed later by the swing amount. */
  protected swung(step: number, time: number, stepDur: number, swing: number): number {
    return time + swingDelay(step, swing, stepDur);
  }

  protected abstract playStep(step: number, time: number, stepDur: number): void;
  protected abstract trigger(voice: number, velocity: number, time: number, rng: () => number): void;
  protected abstract applyVoiceParam(voice: number, key: string, value: number): void;
  protected abstract applyGlobal(id: string, value: number): void;
  protected abstract refreshGates(): void;

  protected override onParam(id: string, value: number): void {
    const m = VOICE_PARAM.exec(id);
    if (!m) {
      this.applyGlobal(id, value);
      return;
    }
    const voice = Number(m[1]);
    this.applyVoiceParam(voice, m[2], value);
    if (m[2] === "mute" || m[2] === "solo") this.refreshGates();
  }

  protected applyAllParams(): void {
    for (const p of this.params) this.onParam(p.id, p.def);
  }

  /** True when the voice should be heard given every voice's mute and solo. */
  protected voiceAudible(voice: number): boolean {
    let anySolo = false;
    for (let i = 0; i < this.voiceCount; i++) if (this.values[`v${i}.solo`] === 1) anySolo = true;
    if (this.values[`v${voice}.mute`] === 1) return false;
    return !anySolo || this.values[`v${voice}.solo`] === 1;
  }

  protected newHit(time: number, velocity: number, dest: AudioNode, rng: () => number): Hit {
    const hit = new Hit(this.ctx, time, velocity, dest, rng, (h) => this.live.delete(h));
    this.live.add(hit);
    return hit;
  }

  /** A live tap on a pad: sounds now (or at `time`) with unseeded variation. */
  hitVoice(voice: number, velocity = 0.9, time?: number): void {
    const v = ((Math.round(voice) % this.voiceCount) + this.voiceCount) % this.voiceCount;
    this.trigger(v, Math.max(0.02, Math.min(1.25, velocity)), time ?? this.ctx.currentTime + 0.005, Math.random);
  }

  protected seeded(step: number, voice: number): () => number {
    return mulberry32(((step + 1) * 7919 + voice * 104729) >>> 0);
  }

  override noteOn(event: NoteEvent): void {
    this.hitVoice(event.note - 36, event.velocity, event.time);
  }

  override allNotesOff(): void {
    const now = this.ctx.currentTime;
    for (const hit of this.live) hit.choke(now);
    this.live.clear();
  }

  // Samples are saved as asset ids, never as audio, so the project JSON stays small.
  sampleRef(slot: number): SampleRef | null {
    return this.samples[slot] ?? null;
  }

  sampleBuffer(slot: number): AudioBuffer | null {
    return this.buffers[slot] ?? null;
  }

  setSample(slot: number, ref: SampleRef, buffer: AudioBuffer): void {
    cacheSample(ref.assetId, buffer);
    this.samples[slot] = ref;
    this.buffers[slot] = buffer;
    this.bump();
  }

  clearSample(slot: number): void {
    this.samples[slot] = null;
    this.buffers[slot] = null;
    this.bump();
  }

  /** Every referenced sample, so a bounce can decode them before it builds its offline copy. */
  async preloadSamples(): Promise<void> {
    await Promise.all(this.samples.map(async (ref) => ref && (await loadSample(this.ctx, ref))));
  }

  protected restoreSamples(refs: unknown): void {
    for (let i = 0; i < this.samples.length; i++) {
      const ref = Array.isArray(refs) && isSampleRef(refs[i]) ? refs[i] : null;
      this.samples[i] = ref;
      this.buffers[i] = ref ? (cachedSample(ref.assetId) ?? null) : null;
      if (ref && !this.buffers[i]) {
        loadSample(this.ctx, ref).then(
          (buffer) => {
            if (this.samples[i]?.assetId !== ref.assetId) return;
            this.buffers[i] = buffer;
            this.bump();
          },
          (err: unknown) => notify(err instanceof Error ? err.message : `Could not load the sample "${ref.name}".`),
        );
      }
    }
  }

  protected sampleRefs(): (SampleRef | null)[] {
    return this.samples.map((s) => (s ? { ...s } : null));
  }

  protected restoreSelected(value: unknown): void {
    this.selected = clampIndex(value, this.voiceCount);
  }

  override dispose(): void {
    this.allNotesOff();
    this.fx.dispose();
    this.mix.disconnect();
    super.dispose();
  }
}
