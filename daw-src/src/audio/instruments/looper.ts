import type { Note } from "../../project/model";
import { projectStore } from "../../store/project";
import { InstrumentBase } from "../instrument";
import { peekEngine } from "../engine";
import type { NoteEvent, ParamDef } from "../types";
import { cachedBuffer, loadAssetBuffer, storeSample } from "./voice/assets";
import { makeImpulse } from "./voice/fx";
import { LOOPER_KITS, SCENES, emptyScenes, type LooperData } from "./voice/looperKits";
import { MicRecorder } from "./voice/mic";
import { toast, toastError } from "./voice/notify";
import { PAD_COUNT, PadPlayer, emptyPad, hasSample, sanitisePad, type PadData } from "./voice/padPlayer";
import { autoSlice, normaliseSlices } from "./voice/slice";

/** First MIDI note of the 16 pads, matching the old studio's MIDI map. */
export const PAD_BASE_NOTE = 36;
export const LAUNCH_MODES = ["Off", "Beat", "Bar"] as const;

const PARAMS: readonly ParamDef[] = [
  { id: "level", label: "Level", group: "Kit", min: 0, max: 1.2, def: 0.85, step: 0.01 },
  { id: "launch", label: "Loop launch", group: "Kit", min: 0, max: 2, def: 2, step: 1, options: LAUNCH_MODES },
  { id: "reverb", label: "Reverb return", group: "Kit", min: 0, max: 1, def: 0.8, step: 0.01 },
  { id: "bounceBars", label: "Bounce length", group: "Kit", min: 1, max: 16, def: 4, step: 1, unit: "bars" },
];

/**
 * Whole bars a loop lasts. A pad's own setting wins; otherwise the count (1, 2, 4, 8 or 16) whose
 * length is closest to the sample's, compared on a log scale so "too short" and "too long" weigh equally.
 */
export function loopBars(regionSeconds: number, barSeconds: number, setting: number): number {
  if (setting > 0) return setting;
  let best = 1;
  let bestError = Infinity;
  for (const bars of [1, 2, 4, 8, 16]) {
    const error = Math.abs(Math.log(regionSeconds / (bars * barSeconds)));
    if (error < bestError) {
      best = bars;
      bestError = error;
    }
  }
  return best;
}

type PadState = "idle" | "playing" | "queued";

interface LoopRun {
  startStep: number;
  bars: number;
  stepDur: number;
  fromScene: boolean;
}

/** 16 sampler pads. Loops start on the bar, one-shots play at once, hold pads play while pressed. */
export class Looper extends InstrumentBase {
  readonly kind = "looper" as const;

  /** Whether the transport is running; when it is not, loops start at once because no bar line is coming. */
  transportRunning: () => boolean = () => peekEngine()?.clock.playing ?? false;
  position: () => number = () => peekEngine()?.clock.position() ?? 0;
  scenes: boolean[][] = emptyScenes();
  performance: Note[] = [];
  performanceSteps = 16;

  private readonly padBus: GainNode;
  private readonly reverbReturn: GainNode;
  private readonly convolver: ConvolverNode;
  private readonly player: PadPlayer;
  private readonly queue = new Map<number, "start" | "stop">();
  private readonly runs = new Map<number, LoopRun>();
  private readonly sliceCursor = new Array<number>(PAD_COUNT).fill(0);
  private readonly pending = new Set<Promise<void>>();
  private pattern: number | null = 0;
  private lastStep = -1;
  private lastStepDur = 0;
  private recorder: { startedAt: number; open: Map<number, { start: number; velocity: number }>; notes: Note[] } | undefined;
  private padRecorder: { pad: number; mic: MicRecorder } | undefined;
  private performanceBuckets = new Map<number, Note[]>();

  constructor(ctx: BaseAudioContext) {
    super(ctx, PARAMS, LOOPER_KITS, "looper");
    this.padBus = ctx.createGain();
    this.reverbReturn = ctx.createGain();
    this.convolver = ctx.createConvolver();
    this.convolver.buffer = makeImpulse(ctx, 1.8);
    this.convolver.connect(this.reverbReturn).connect(this.output);
    this.padBus.connect(this.output);
    this.player = new PadPlayer(ctx, this.padBus, this.convolver);
    this.applyAll();
    this.loadPreset(LOOPER_KITS[0].id);
  }

  override loadPreset(id: string): void {
    const preset = this.presets.find((p) => p.id === id);
    if (!preset) throw new RangeError(`looper has no preset "${id}"`);
    if (!preset.factory) {
      super.loadPreset(id);
      return;
    }
    // Factory kits swap the pads only; the user's level and launch settings stay put.
    this.restoreData(preset.data);
    this.presetId = id;
    this.bump();
  }

  override get patternCount(): number {
    return SCENES;
  }

  override get activePattern(): number | null {
    return this.pattern;
  }

  /** Picks the scene whose loops play on the transport; null stops scene loops at the next bar but leaves pads played by hand alone. */
  override setPattern(index: number | null): void {
    this.pattern = index === null ? null : Math.min(SCENES - 1, Math.max(0, Math.round(index)));
    this.bump();
  }

  get pads(): readonly PadData[] {
    return this.player.pads;
  }

  get recordingPad(): number | null {
    return this.padRecorder?.pad ?? null;
  }

  get performanceRecording(): boolean {
    return this.recorder !== undefined;
  }

  padBuffer(index: number): AudioBuffer | undefined {
    return this.player.bufferOf(index);
  }

  padState(index: number): PadState {
    if (this.queue.has(index) && !this.player.isPlaying(index)) return "queued";
    return this.player.isPlaying(index) ? "playing" : "idle";
  }

  /** Seconds of the pad's region at natural speed, for the length readout. */
  regionSeconds(index: number): number {
    return this.player.regionSeconds(index);
  }

  ready(): Promise<void> {
    return Promise.all([...this.pending]).then(() => undefined);
  }

  // ---------------------------------------------------------------- playing

  override noteOn(event: NoteEvent): void {
    const pad = event.note - PAD_BASE_NOTE;
    if (pad < 0 || pad >= PAD_COUNT) return;
    this.press(pad, Math.min(1, Math.max(0.05, event.velocity)), event.time ?? this.ctx.currentTime);
  }

  override noteOff(note: number, time = this.ctx.currentTime): void {
    const pad = note - PAD_BASE_NOTE;
    if (pad < 0 || pad >= PAD_COUNT) return;
    this.release(pad, time);
  }

  override allNotesOff(): void {
    this.queue.clear();
    this.runs.clear();
    this.player.stopAll(this.ctx.currentTime);
  }

  press(index: number, velocity: number, time: number): void {
    const pad = this.player.pads[index];
    if (!hasSample(pad)) return;
    if (!this.player.refresh(index)) {
      toast(`${pad.name || `Pad ${index + 1}`} is still loading.`);
      return;
    }
    this.recordHit(index, velocity);
    if (pad.mode === "loop") {
      this.toggleLoop(index, velocity, time);
      return;
    }
    this.fire(index, velocity, time);
  }

  release(index: number, time = this.ctx.currentTime): void {
    const pad = this.player.pads[index];
    if (pad?.mode !== "gate") return;
    this.player.stop(index, time);
    this.finishHit(index);
  }

  /** Plays one slice of a pad's sample, for auditioning from the waveform. */
  playSlice(index: number, slice: number): void {
    if (!this.player.refresh(index)) return;
    this.player.trigger(index, { time: this.ctx.currentTime, slice });
  }

  private fire(index: number, velocity: number, time: number): void {
    const pad = this.player.pads[index];
    let slice: number | undefined;
    if (pad.slices.length > 0 && pad.mode === "shot") {
      slice = this.sliceCursor[index] % (pad.slices.length + 1);
      this.sliceCursor[index] += 1;
    }
    this.player.trigger(index, { time, velocity, slice });
  }

  private toggleLoop(index: number, velocity: number, time: number): void {
    const running = this.player.isPlaying(index) && !this.queue.has(index);
    const queuedStart = this.queue.get(index) === "start";
    if (!this.transportRunning()) {
      if (running || queuedStart) this.stopLoop(index, time);
      else this.startLoop(index, velocity, time, this.lastStepDur || this.currentStepDur(), this.lastStep, false);
      this.queue.delete(index);
      return;
    }
    if (running) this.queue.set(index, "stop");
    else if (queuedStart) this.queue.delete(index);
    else this.queue.set(index, "start");
  }

  private startLoop(index: number, velocity: number, time: number, stepDur: number, step: number, fromScene: boolean): void {
    const barSeconds = stepDur * this.barSteps();
    const pad = this.player.pads[index];
    const bars = loopBars(this.player.regionSeconds(index), barSeconds, pad.bars);
    this.player.trigger(index, { time, velocity, fitSeconds: bars * barSeconds });
    this.runs.set(index, { startStep: step, bars, stepDur, fromScene });
  }

  private stopLoop(index: number, time: number): void {
    this.player.stop(index, time);
    this.runs.delete(index);
  }

  private barSteps(): number {
    return (projectStore.get().beatsPerBar || 4) * 4;
  }

  private currentStepDur(): number {
    return 60 / projectStore.get().bpm / 4;
  }

  override onStep(step: number, time: number, stepDur: number): void {
    this.lastStep = step;
    this.lastStepDur = stepDur;
    const barSteps = this.barSteps();
    const launch = this.values.launch;
    const atBar = step % barSteps === 0;
    const atLaunch = launch === 2 ? atBar : launch === 1 ? step % 4 === 0 : true;

    if (atLaunch) {
      for (const [index, action] of this.queue) {
        this.queue.delete(index);
        if (action === "start") this.startLoop(index, 1, time, stepDur, step, false);
        else this.stopLoop(index, time);
      }
    }

    if (atBar) this.syncScene(step, time, stepDur, barSteps);

    // Restart each loop at its own length so tempo changes and pitched loops stay on the grid.
    for (const [index, run] of this.runs) {
      const length = run.bars * barSteps;
      if (step > run.startStep && (step - run.startStep) % length === 0) {
        this.startLoop(index, 1, time, stepDur, step, run.fromScene);
      }
    }

    const hits = this.performanceBuckets.get(step % this.performanceSteps);
    if (hits && !this.recorder) {
      for (const n of hits) {
        const index = n.pitch - PAD_BASE_NOTE;
        this.pressQuiet(index, n.velocity, time);
        if (this.player.pads[index]?.mode === "gate") this.player.stop(index, time + n.lengthSteps * stepDur);
      }
    }
  }

  /** Plays a recorded hit without writing it back into the recording. */
  private pressQuiet(index: number, velocity: number, time: number): void {
    const pad = this.player.pads[index];
    if (!pad || !hasSample(pad) || !this.player.refresh(index)) return;
    if (pad.mode === "loop") {
      if (this.player.isPlaying(index)) this.stopLoop(index, time);
      else this.startLoop(index, velocity, time, this.lastStepDur, this.lastStep, false);
      return;
    }
    this.fire(index, velocity, time);
  }

  private syncScene(step: number, time: number, stepDur: number, barSteps: number): void {
    if (this.pattern === null) {
      for (const [index, run] of this.runs) if (run.fromScene) this.stopLoop(index, time);
      return;
    }
    const scene = this.scenes[this.pattern];
    for (let i = 0; i < PAD_COUNT; i++) {
      const pad = this.player.pads[i];
      const member = scene[i] && hasSample(pad) && this.player.refresh(i);
      if (pad.mode === "loop") {
        const run = this.runs.get(i);
        if (member && !run) this.startLoop(i, 1, time, stepDur, step, true);
        else if (!member && run?.fromScene) this.stopLoop(i, time);
      } else if (member && pad.mode === "shot" && (step / barSteps) % Math.max(1, pad.bars || 1) === 0) {
        this.fire(i, 1, time);
      }
    }
  }

  setSceneMember(scene: number, pad: number, member: boolean): void {
    this.scenes[scene][pad] = member;
    this.bump();
  }

  // ---------------------------------------------------------------- performance take

  private recordHit(index: number, velocity: number): void {
    if (!this.recorder) return;
    const start = Math.max(0, Math.round(this.position() - this.recorder.startedAt));
    this.recorder.open.set(index, { start, velocity });
    if (this.player.pads[index].mode !== "gate") this.finishHit(index);
  }

  private finishHit(index: number): void {
    if (!this.recorder) return;
    const open = this.recorder.open.get(index);
    if (!open) return;
    this.recorder.open.delete(index);
    const end = Math.round(this.position() - this.recorder.startedAt);
    const length = this.player.pads[index].mode === "gate" ? Math.max(1, end - open.start) : 1;
    this.recorder.notes.push({ pitch: PAD_BASE_NOTE + index, startStep: open.start, lengthSteps: length, velocity: open.velocity });
  }

  startPerformanceRecord(): void {
    this.recorder = { startedAt: Math.floor(this.position()), open: new Map(), notes: [] };
    this.bump();
  }

  stopPerformanceRecord(): void {
    const recorder = this.recorder;
    if (!recorder) return;
    for (const index of [...recorder.open.keys()]) this.finishHit(index);
    this.recorder = undefined;
    if (recorder.notes.length === 0) {
      toast("No pads were hit, so the performance was not kept.");
    } else {
      const last = Math.max(...recorder.notes.map((n) => n.startStep + n.lengthSteps), this.position() - recorder.startedAt);
      this.setPerformance(recorder.notes, Math.max(16, Math.ceil(last / 16) * 16));
    }
    this.bump();
  }

  clearPerformance(): void {
    this.setPerformance([], 16);
    this.bump();
  }

  private setPerformance(notes: Note[], steps: number): void {
    this.performance = notes;
    this.performanceSteps = steps;
    this.performanceBuckets = new Map();
    for (const n of notes) {
      const key = n.startStep % steps;
      this.performanceBuckets.set(key, [...(this.performanceBuckets.get(key) ?? []), n]);
    }
  }

  // ---------------------------------------------------------------- pad editing

  setPad(index: number, patch: Partial<PadData>): void {
    this.player.pads[index] = sanitisePad({ ...this.player.pads[index], ...patch });
    this.bump();
  }

  clearPad(index: number): void {
    this.queue.delete(index);
    this.runs.delete(index);
    this.player.stop(index, this.ctx.currentTime);
    this.player.pads[index] = emptyPad();
    this.player.setBuffer(index, undefined);
    for (const scene of this.scenes) scene[index] = false;
    this.bump();
  }

  clearAllPads(): void {
    for (let i = 0; i < PAD_COUNT; i++) this.clearPad(i);
  }

  async loadPadFile(index: number, file: File): Promise<void> {
    try {
      const stored = await storeSample(this.ctx, file, file.name);
      this.assign(index, file.name.replace(/\.[^.]+$/, ""), stored.id, stored.buffer);
    } catch (error) {
      toastError(error, `Could not load ${file.name}.`);
    }
  }

  /** Loads a sample the Library already holds. */
  async loadPadAsset(index: number, assetId: string, name: string): Promise<void> {
    try {
      this.assign(index, name, assetId, await loadAssetBuffer(this.ctx, assetId, name));
    } catch (error) {
      toastError(error, `Could not load ${name}.`);
    }
  }

  private assign(index: number, name: string, assetId: string, buffer: AudioBuffer): void {
    const old = this.player.pads[index];
    this.player.pads[index] = sanitisePad({ ...emptyPad(), name, assetId, mode: old.mode });
    this.player.setBuffer(index, buffer);
    this.bump();
  }

  async togglePadRecording(index: number): Promise<void> {
    if (this.padRecorder) {
      const { pad, mic } = this.padRecorder;
      this.padRecorder = undefined;
      this.bump();
      try {
        const stored = await storeSample(this.ctx, await mic.stop(), `Pad ${pad + 1} recording`);
        this.assign(pad, `Pad ${pad + 1} take`, stored.id, stored.buffer);
      } catch (error) {
        toastError(error, "The recording could not be saved.");
      }
      return;
    }
    const mic = new MicRecorder();
    try {
      await mic.start();
    } catch (error) {
      toastError(error, "The microphone could not be opened.");
      return;
    }
    this.padRecorder = { pad: index, mic };
    this.bump();
  }

  /** Cuts the pad's sample at its loudest hits, or into even parts when it has none. */
  sliceAuto(index: number, maxSlices = 8): void {
    const buffer = this.player.bufferOf(index);
    if (!buffer) return;
    const pad = this.player.pads[index];
    const data = buffer.getChannelData(0);
    const from = Math.floor(pad.start * data.length);
    const to = Math.floor(pad.end * data.length);
    const local = autoSlice(data.subarray(from, to), maxSlices);
    this.setPad(index, { slices: normaliseSlices(local.map((f) => pad.start + f * (pad.end - pad.start))) });
    this.sliceCursor[index] = 0;
  }

  /** Reverses the sample and mirrors trim and slices so the markers stay on the same sound. */
  toggleReverse(index: number): void {
    const pad = this.player.pads[index];
    this.setPad(index, { reverse: !pad.reverse, start: 1 - pad.end, end: 1 - pad.start, slices: pad.slices.map((s) => 1 - s).sort((a, b) => a - b) });
  }

  // ---------------------------------------------------------------- parameters and persistence

  protected onParam(id: string): void {
    if (id === "level") this.output.gain.value = this.values.level;
    if (id === "reverb") this.reverbReturn.gain.value = this.values.reverb;
  }

  private applyAll(): void {
    this.output.gain.value = this.values.level;
    this.reverbReturn.gain.value = this.values.reverb;
  }

  protected override serializeData(): LooperData {
    return {
      pads: this.player.pads.map((p) => ({ ...p, slices: [...p.slices] })),
      scenes: this.scenes.map((s) => [...s]),
      performance: this.performance.map((n) => ({ pad: n.pitch - PAD_BASE_NOTE, startStep: n.startStep, lengthSteps: n.lengthSteps, velocity: n.velocity })),
      performanceSteps: this.performanceSteps,
    };
  }

  /** Same as serialize(), plus the loops sounding right now, so a bounce captures what the user is hearing. */
  snapshotForBounce(): ReturnType<Looper["serialize"]> {
    const state = this.serialize();
    const launch = [...this.runs.keys()];
    return { ...state, data: { ...(state.data as LooperData), launch } };
  }

  protected override restoreData(raw: unknown): void {
    const data = (raw ?? {}) as Partial<LooperData>;
    this.allNotesOff();
    const pads = Array.isArray(data.pads) ? data.pads : [];
    for (let i = 0; i < PAD_COUNT; i++) {
      this.player.pads[i] = sanitisePad(pads[i]);
      this.player.setBuffer(i, undefined);
    }
    this.scenes = emptyScenes();
    if (Array.isArray(data.scenes)) {
      data.scenes.slice(0, SCENES).forEach((scene, s) => {
        if (Array.isArray(scene)) scene.slice(0, PAD_COUNT).forEach((member, i) => (this.scenes[s][i] = member === true));
      });
    }
    const hits = Array.isArray(data.performance) ? data.performance : [];
    this.setPerformance(
      hits
        .filter((h) => typeof h?.pad === "number" && h.pad >= 0 && h.pad < PAD_COUNT)
        .map((h) => ({ pitch: PAD_BASE_NOTE + h.pad, startStep: h.startStep, lengthSteps: Math.max(1, h.lengthSteps), velocity: h.velocity })),
      typeof data.performanceSteps === "number" && data.performanceSteps >= 16 ? data.performanceSteps : 16,
    );
    if (Array.isArray(data.launch)) for (const i of data.launch) if (typeof i === "number") this.queue.set(i, "start");
    this.resolveAssets();
  }

  private resolveAssets(): void {
    this.player.pads.forEach((pad, i) => {
      if (this.player.refresh(i) || !pad.assetId) return;
      const id = pad.assetId;
      const cached = cachedBuffer(id);
      if (cached) {
        this.player.setBuffer(i, cached);
        return;
      }
      const job: Promise<void> = loadAssetBuffer(this.ctx, id, pad.name)
        .then((buffer) => {
          // The kit may have changed while the sample loaded.
          if (this.player.pads[i].assetId === id) this.player.setBuffer(i, buffer);
          this.bump();
        })
        .catch((error: unknown) => toastError(error, `Could not load ${pad.name || `pad ${i + 1}`}.`))
        .finally(() => this.pending.delete(job));
      this.pending.add(job);
    });
  }

  override dispose(): void {
    this.padRecorder?.mic.cancel();
    this.allNotesOff();
    super.dispose();
  }
}
