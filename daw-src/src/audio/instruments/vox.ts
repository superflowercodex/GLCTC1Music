import type { Note } from "../../project/model";
import { projectStore } from "../../store/project";
import { InstrumentBase } from "../instrument";
import { peekEngine } from "../engine";
import { AudioEngineError, type NoteEvent, type Preset } from "../types";
import { speedToSeconds, RatioSmoother, tuneRatio } from "./voice/autotune";
import { cachedBuffer, loadAssetBuffer, storeSample } from "./voice/assets";
import { CarrierSynth } from "./voice/carrierEngine";
import { Choir, DEFAULT_CHOIR, type ChoirSettings } from "./voice/choirEngine";
import { FxRack, type FxSettings } from "./voice/fx";
import { createShifterNode, loadShifterWorklet } from "./voice/granular";
import { harmonyRatio, type HarmonyMode } from "./voice/harmony";
import { MicRecorder, openMic } from "./voice/mic";
import { toast, toastError } from "./voice/notify";
import { PAD_COUNT, PadPlayer, emptyPad, hasSample, sanitisePad, type PadData } from "./voice/padPlayer";
import { PIANO_TIMBRES, nearestPianoIndex, pianoBuffers, pianoRoots } from "./voice/piano";
import { KeySampler, zoneFor, type KeyZone } from "./voice/sampler";
import { freqToMidi, parseKey, snapToScale, type KeySignature } from "./voice/scales";
import { BAND_COUNTS, CARRIERS, Vocoder } from "./voice/vocoder";
import { VOX_PARAMS, VOX_PRESETS } from "./voice/voxParams";
import { detectPitch, rms } from "./voice/yin";

export const TRAIL_LENGTH = 240;
const TICK_MS = 30;

export interface VoxData {
  lyrics: string;
  inputAssetId?: string;
  inputName?: string;
  pads: PadData[];
  zones: KeyZone[];
  take: Note[];
  takeSteps: number;
}

export class VoxStateError extends AudioEngineError {
  constructor(message: string) {
    super(message);
    this.name = "VoxStateError";
  }
}

/** Pitch history the Process view draws: MIDI pitch per tick, NaN where nothing was sung. */
export interface PitchTrail {
  raw: Float32Array;
  tuned: Float32Array;
  head: number;
}

class Bypass {
  readonly input: GainNode;
  readonly output: GainNode;
  private readonly wet: GainNode;
  private readonly dry: GainNode;

  constructor(ctx: BaseAudioContext, processIn: AudioNode, processOut: AudioNode) {
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.wet = ctx.createGain();
    this.dry = ctx.createGain();
    this.input.connect(this.wet).connect(processIn);
    processOut.connect(this.output);
    this.input.connect(this.dry).connect(this.output);
    this.dry.gain.value = 0;
  }

  set(on: boolean, now: number): void {
    this.wet.gain.setTargetAtTime(on ? 1 : 0, now, 0.01);
    this.dry.gain.setTargetAtTime(on ? 0 : 1, now, 0.01);
  }
}

/** Vocal studio: a toggleable input chain (gate, compressor, auto-tune, harmoniser, vocoder, effects) plus choir, piano, sampler and pads played from the keys. */
export class Vox extends InstrumentBase {
  readonly kind = "vox" as const;

  readonly trail: PitchTrail = { raw: new Float32Array(TRAIL_LENGTH).fill(NaN), tuned: new Float32Array(TRAIL_LENGTH).fill(NaN), head: 0 };
  /** Smoothed input level, linear RMS. Read every frame by the meter. */
  inputLevel = 0;
  /** Latest sung MIDI pitch and the pitch it is tuned to, or null while nothing voiced is heard. */
  sung: { midi: number; target: number | null } | null = null;
  zones: KeyZone[] = [];
  take: Note[] = [];
  takeSteps = 16;
  lyrics = "la lo ah ooh la na ay oh";
  inputName: string | undefined;
  /** Where the transport is, in 16th steps; replaced in tests. */
  position: () => number = () => peekEngine()?.clock.position() ?? 0;

  private inputAssetId: string | undefined;
  private fileBuffer: AudioBuffer | undefined;
  private fileSource: AudioBufferSourceNode | undefined;
  private micStream: MediaStream | undefined;
  private micSource: MediaStreamAudioSourceNode | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private recorder: { startedAt: number; open: Map<number, { start: number; velocity: number }>; notes: Note[] } | undefined;
  private padRecorder: { pad: number; mic: MicRecorder } | undefined;
  private readonly pending = new Set<Promise<void>>();
  private readonly groupOf = new Map<string, string>(VOX_PARAMS.map((p) => [p.id, p.group]));
  private readonly held = new Set<number>();
  private takeBuckets = new Map<number, Note[]>();

  private readonly inGain: GainNode;
  private readonly analyser: AnalyserNode;
  private readonly frame: Float32Array<ArrayBuffer>;
  private readonly gateGain: GainNode;
  private readonly compBypass: Bypass;
  private readonly comp: DynamicsCompressorNode;
  private readonly makeup: GainNode;
  private readonly tuneOut: GainNode;
  private readonly mainDry: GainNode;
  private readonly mainWet: GainNode;
  private readonly formantLow: BiquadFilterNode;
  private readonly formantHigh: BiquadFilterNode;
  private readonly voiceBus: GainNode;
  private readonly voiceGain: GainNode;
  private readonly vocSend: GainNode;
  private readonly vocoder: Vocoder;
  private readonly carrierBus: GainNode;
  private readonly carrier: CarrierSynth;
  private readonly monitor: GainNode;
  private readonly fx: FxRack;
  private readonly keysBus: GainNode;
  private readonly padBus: GainNode;
  private readonly pianoFilter: BiquadFilterNode;
  private readonly pianoGain: GainNode;
  private readonly pianoSampler: KeySampler;
  private readonly userSampler: KeySampler;
  private readonly choir: Choir;
  private readonly pads: PadPlayer;
  private readonly hammerNoise: AudioBuffer;
  private shifters: { main: AudioWorkletNode; harm: AudioWorkletNode[]; harmGain: GainNode[]; harmPan: StereoPannerNode[] } | undefined;
  private readonly smoother = new RatioSmoother();
  private lastTick = 0;
  private unvoicedFor = 0;
  private lastFreq = 0;
  private workletWarned = false;

  constructor(ctx: BaseAudioContext) {
    super(ctx, VOX_PARAMS, VOX_PRESETS, "vox");
    this.inGain = ctx.createGain();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.frame = new Float32Array(new ArrayBuffer(this.analyser.fftSize * 4));
    this.gateGain = ctx.createGain();
    this.comp = ctx.createDynamicsCompressor();
    this.makeup = ctx.createGain();
    this.comp.connect(this.makeup);
    this.compBypass = new Bypass(ctx, this.comp, this.makeup);
    this.tuneOut = ctx.createGain();
    this.mainDry = ctx.createGain();
    this.mainWet = ctx.createGain();
    this.mainWet.gain.value = 0;
    this.formantLow = ctx.createBiquadFilter();
    this.formantLow.type = "lowshelf";
    this.formantLow.frequency.value = 600;
    this.formantHigh = ctx.createBiquadFilter();
    this.formantHigh.type = "highshelf";
    this.formantHigh.frequency.value = 2200;
    this.voiceBus = ctx.createGain();
    this.voiceGain = ctx.createGain();
    this.vocSend = ctx.createGain();
    this.vocoder = new Vocoder(ctx);
    this.carrierBus = ctx.createGain();
    this.carrier = new CarrierSynth(ctx, this.carrierBus);
    this.monitor = ctx.createGain();
    this.fx = new FxRack(ctx);
    this.keysBus = ctx.createGain();
    this.padBus = ctx.createGain();
    this.pianoFilter = ctx.createBiquadFilter();
    this.pianoFilter.type = "lowpass";
    this.pianoGain = ctx.createGain();
    this.pianoSampler = new KeySampler(ctx, this.pianoFilter);
    this.userSampler = new KeySampler(ctx, this.keysBus);
    this.choir = new Choir(ctx);
    this.pads = new PadPlayer(ctx, this.padBus, this.fx.reverbReturn);
    this.hammerNoise = ctx.createBuffer(1, Math.round(ctx.sampleRate * 0.06), ctx.sampleRate);
    const noise = this.hammerNoise.getChannelData(0);
    for (let i = 0; i < noise.length; i++) noise[i] = (Math.random() * 2 - 1) * (1 - i / noise.length) ** 3;

    this.inGain.connect(this.analyser);
    this.inGain.connect(this.gateGain).connect(this.compBypass.input);
    this.compBypass.output.connect(this.mainDry).connect(this.tuneOut);
    this.tuneOut.connect(this.formantLow).connect(this.formantHigh).connect(this.voiceBus);
    this.voiceBus.connect(this.voiceGain).connect(this.monitor);
    this.voiceBus.connect(this.vocSend).connect(this.vocoder.modulator);
    this.vocoder.output.connect(this.monitor);
    this.carrierBus.connect(this.vocoder.carrier);
    this.monitor.connect(this.fx.input);
    this.pianoFilter.connect(this.pianoGain).connect(this.keysBus);
    this.choir.output.connect(this.keysBus);
    this.keysBus.connect(this.fx.input);
    this.padBus.connect(this.fx.input);
    this.fx.output.connect(this.output);

    this.pads.pads.forEach((_, i) => (this.pads.pads[i] = emptyPad()));
    this.applyAll();
  }

  override loadPreset(id: string): void {
    const preset: Preset | undefined = this.presets.find((p) => p.id === id);
    if (!preset) throw new RangeError(`vox has no preset "${id}"`);
    if (!preset.factory) {
      super.loadPreset(id);
      return;
    }
    // A vocal type changes the processing only: the user's input, keys and pads stay as they are.
    for (const [key, value] of Object.entries(preset.values)) {
      this.values[key] = value;
      this.onParam(key, value);
    }
    this.presetId = id;
    this.bump();
  }

  get patternCount(): number {
    return 1;
  }

  private patternOn: number | null = 0;

  override get activePattern(): number | null {
    return this.patternOn;
  }

  override setPattern(index: number | null): void {
    this.patternOn = index === null ? null : 0;
    this.bump();
  }

  get micActive(): boolean {
    return this.micStream !== undefined;
  }

  get filePlaying(): boolean {
    return this.fileSource !== undefined;
  }

  get hasFile(): boolean {
    return this.fileBuffer !== undefined;
  }

  get midiRecording(): boolean {
    return this.recorder !== undefined;
  }

  get recordingPad(): number | null {
    return this.padRecorder?.pad ?? null;
  }

  get padData(): readonly PadData[] {
    return this.pads.pads;
  }

  padBuffer(index: number): AudioBuffer | undefined {
    return this.pads.bufferOf(index);
  }

  zoneBuffer(index: number): AudioBuffer | undefined {
    const zone = this.zones[index];
    return zone ? cachedBuffer(zone.assetId) : undefined;
  }

  get key(): KeySignature {
    return parseKey(projectStore.get().key);
  }

  /** The syllable the choir will sing next, for the Choir view. */
  nextSyllable(): string | undefined {
    return this.choir.upcoming()?.text;
  }

  ready(): Promise<void> {
    return Promise.all([...this.pending]).then(() => undefined);
  }

  // ---------------------------------------------------------------- input

  async startMic(): Promise<boolean> {
    if (this.micStream) return true;
    try {
      const stream = await openMic();
      await this.prepareShifters();
      this.stopFile();
      this.micStream = stream;
      if (!(this.ctx instanceof AudioContext)) throw new AudioEngineError("The microphone needs a live audio context.");
      this.micSource = this.ctx.createMediaStreamSource(stream);
      this.micSource.connect(this.inGain);
      this.setParam("source", 0);
      this.startAnalysis();
      this.bump();
      return true;
    } catch (error) {
      toastError(error, "The microphone could not be opened.");
      return false;
    }
  }

  stopMic(): void {
    this.micSource?.disconnect();
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.micSource = undefined;
    this.micStream = undefined;
    this.stopAnalysisIfIdle();
    this.bump();
  }

  /** Decodes an audio file, saves it with the project and makes it the file input. */
  async loadInputFile(file: File): Promise<void> {
    try {
      const stored = await storeSample(this.ctx, file, file.name);
      this.fileBuffer = stored.buffer;
      this.inputAssetId = stored.id;
      this.inputName = file.name;
      this.setParam("source", 1);
      this.bump();
    } catch (error) {
      toastError(error, `Could not load ${file.name}.`);
    }
  }

  async playFile(): Promise<void> {
    if (!this.fileBuffer) {
      toast("Load an audio file first.");
      return;
    }
    await this.prepareShifters();
    this.stopMic();
    this.stopFile();
    const source = this.ctx.createBufferSource();
    source.buffer = this.fileBuffer;
    source.loop = true;
    source.connect(this.inGain);
    source.start();
    this.fileSource = source;
    this.startAnalysis();
    this.bump();
  }

  stopFile(): void {
    if (!this.fileSource) return;
    this.fileSource.stop();
    this.fileSource.disconnect();
    this.fileSource = undefined;
    this.stopAnalysisIfIdle();
    this.bump();
  }

  private async prepareShifters(): Promise<void> {
    if (this.shifters) return;
    const ok = await loadShifterWorklet(this.ctx);
    if (!ok) {
      if (!this.workletWarned) toast("This browser cannot shift pitch live, so auto-tune, pitch and harmony are off. Gate, compressor, vocoder and effects still work.");
      this.workletWarned = true;
      return;
    }
    const main = createShifterNode(this.ctx);
    this.compBypass.output.connect(main).connect(this.mainWet).connect(this.tuneOut);
    const harm: AudioWorkletNode[] = [];
    const harmGain: GainNode[] = [];
    const harmPan: StereoPannerNode[] = [];
    for (let i = 0; i < 3; i++) {
      const node = createShifterNode(this.ctx);
      const gain = this.ctx.createGain();
      const pan = this.ctx.createStereoPanner();
      this.compBypass.output.connect(node).connect(gain).connect(pan).connect(this.voiceBus);
      harm.push(node);
      harmGain.push(gain);
      harmPan.push(pan);
    }
    this.shifters = { main, harm, harmGain, harmPan };
    this.fx.attachShifters();
    this.applyAll();
  }

  private startAnalysis(): void {
    if (this.timer !== undefined) return;
    this.lastTick = performance.now();
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  private stopAnalysisIfIdle(): void {
    if (this.micStream || this.fileSource || this.timer === undefined) return;
    clearInterval(this.timer);
    this.timer = undefined;
    this.inputLevel = 0;
    this.sung = null;
  }

  /** One analysis pass: level and gate, pitch detection, then the tuning and harmony ratios for the shifters. */
  private tick(): void {
    const now = this.ctx.currentTime;
    const t = performance.now();
    const dt = Math.max(0.001, (t - this.lastTick) / 1000);
    this.lastTick = t;
    this.analyser.getFloatTimeDomainData(this.frame);
    const level = rms(this.frame);
    this.inputLevel += (level - this.inputLevel) * (level > this.inputLevel ? 0.6 : 0.15);
    const db = 20 * Math.log10(Math.max(level, 1e-6));

    const gateOn = this.values.gateOn === 1;
    const open = !gateOn || db > this.values.gateThresh;
    this.gateGain.gain.setTargetAtTime(open ? 1 : 0, now, open ? 0.01 : Math.max(0.005, this.values.gateRelease / 3000));

    const found = open ? detectPitch(this.frame, this.ctx.sampleRate) : null;
    const voiced = found !== null && found.clarity > 0.8;
    const key = this.key;
    const tuneOn = this.values.tuneOn === 1;
    const pitchFactor = 2 ** (this.values.pitch / 12);
    let target = 1;
    if (voiced) {
      this.unvoicedFor = 0;
      this.lastFreq = found.freq;
      const midi = freqToMidi(found.freq);
      const snapped = snapToScale(midi, key);
      this.sung = { midi, target: tuneOn ? snapped : null };
      if (tuneOn) target = tuneRatio(found.freq, { key, amount: this.values.tuneAmount, humanise: this.values.tuneHumanise });
    } else {
      this.unvoicedFor += dt;
      if (this.unvoicedFor > 0.25) this.sung = null;
    }
    const correction = this.smoother.step(target, dt, speedToSeconds(this.values.tuneSpeed));

    const trail = this.trail;
    trail.raw[trail.head] = this.sung ? this.sung.midi : NaN;
    // The tuned line shows where the voice ends up: the sung pitch moved by the correction actually applied.
    trail.tuned[trail.head] = this.sung && tuneOn ? this.sung.midi + 12 * Math.log2(correction) : NaN;
    trail.head = (trail.head + 1) % TRAIL_LENGTH;

    const shifters = this.shifters;
    if (!shifters) return;
    const period = this.lastFreq > 0 ? this.ctx.sampleRate / this.lastFreq : 0;
    shifters.main.parameters.get("ratio")?.setValueAtTime(correction * pitchFactor, now);
    shifters.main.parameters.get("period")?.setValueAtTime(period, now);
    if (this.values.harmOn === 1 && this.lastFreq > 0) {
      const mode: HarmonyMode = this.values.harmMode === 1 ? "scale" : "interval";
      for (let i = 0; i < 3; i++) {
        const ratio = harmonyRatio(this.lastFreq, this.values[`harmI${i + 1}`], mode, key) * correction * pitchFactor;
        shifters.harm[i].parameters.get("ratio")?.setValueAtTime(Math.min(4, Math.max(0.25, ratio)), now);
        shifters.harm[i].parameters.get("period")?.setValueAtTime(period, now);
      }
    }
  }

  // ---------------------------------------------------------------- playing

  /** `target` overrides the "Keys play" setting for one note, so a view that is about one sound (the choir) can play it without changing the setting. */
  override noteOn(event: NoteEvent, target: number = this.values.keysTarget): void {
    const time = event.time ?? this.ctx.currentTime;
    const velocity = Math.min(1, Math.max(0.05, event.velocity));
    this.held.add(event.note);
    if (this.recorder) this.recorder.open.set(event.note, { start: Math.round(this.position() - this.recorder.startedAt), velocity });

    const usesSampler = (target === 1 || target === 4) && this.zones.length > 0;
    if (target === 0 || target === 4 || (target === 1 && !usesSampler)) this.playPiano(event.note, velocity, time);
    if (usesSampler) this.playSampler(event.note, velocity, time);
    if (target === 2 || target === 4) this.choir.noteOn(event.note, velocity, time);
    if (target === 3 || target === 4) this.carrier.noteOn(event.note, velocity, time);
    if (event.duration !== undefined) this.noteOff(event.note, time + event.duration, true);
  }

  override noteOff(note: number, time = this.ctx.currentTime, fromSequence = false): void {
    this.held.delete(note);
    if (!fromSequence && this.recorder) {
      const open = this.recorder.open.get(note);
      if (open) {
        this.recorder.open.delete(note);
        const end = Math.round(this.position() - this.recorder.startedAt);
        this.recorder.notes.push({ pitch: note, startStep: Math.max(0, open.start), lengthSteps: Math.max(1, end - open.start), velocity: open.velocity });
      }
    }
    this.pianoSampler.noteOff(note, time, this.values.pianoRelease);
    this.userSampler.noteOff(note, time, this.values.sampRelease);
    this.choir.noteOff(note, time);
    this.carrier.noteOff(note, time);
  }

  override allNotesOff(): void {
    const now = this.ctx.currentTime;
    this.held.clear();
    this.pianoSampler.allNotesOff(now);
    this.userSampler.allNotesOff(now);
    this.choir.allNotesOff();
    this.carrier.allNotesOff(now);
    this.pads.stopAll(now);
  }

  private playPiano(note: number, velocity: number, time: number): void {
    const timbre = PIANO_TIMBRES[Math.round(this.values.pianoTimbre)];
    const index = nearestPianoIndex(note);
    const buffer = pianoBuffers(this.ctx, timbre)[index];
    this.pianoSampler.noteOn(buffer, pianoRoots()[index], note, velocity, time, { attack: 0.002, release: this.values.pianoRelease, loop: false });
    const hammer = this.values.pianoHammer;
    if (hammer > 0) {
      const thump = this.ctx.createBufferSource();
      thump.buffer = this.hammerNoise;
      const gain = this.ctx.createGain();
      gain.gain.value = hammer * velocity * 0.25;
      thump.connect(gain).connect(this.pianoFilter);
      thump.start(time);
      thump.addEventListener("ended", () => {
        thump.disconnect();
        gain.disconnect();
      });
    }
  }

  private playSampler(note: number, velocity: number, time: number): void {
    const roots = this.zones.map((z) => z.root);
    const index = zoneFor(roots, note);
    const buffer = index >= 0 ? cachedBuffer(this.zones[index].assetId) : undefined;
    if (!buffer) return;
    this.userSampler.noteOn(buffer, this.zones[index].root, note, velocity, time, {
      attack: this.values.sampAttack,
      release: this.values.sampRelease,
      loop: this.values.sampLoop === 1,
    });
  }

  override onStep(step: number, time: number, stepDur: number): void {
    if (step % 16 === 0) this.applyFx(60 / (stepDur * 4));
    if (this.patternOn === null || this.take.length === 0) return;
    const notes = this.takeBuckets.get(step % this.takeSteps);
    if (!notes) return;
    for (const n of notes) this.noteOn({ note: n.pitch, velocity: n.velocity, time, duration: n.lengthSteps * stepDur });
  }

  // ---------------------------------------------------------------- pads

  triggerPad(index: number, velocity = 1, time = this.ctx.currentTime): void {
    const pad = this.pads.pads[index];
    if (!pad || !hasSample(pad)) return;
    if (!this.pads.refresh(index)) {
      toast(`${pad.name || "This pad"} is still loading.`);
      return;
    }
    if (pad.mode === "loop" && this.pads.isPlaying(index)) {
      this.pads.stop(index, time);
      return;
    }
    this.pads.trigger(index, { time, velocity });
  }

  releasePad(index: number, time = this.ctx.currentTime): void {
    if (this.pads.pads[index]?.mode === "gate") this.pads.stop(index, time);
  }

  isPadPlaying(index: number): boolean {
    return this.pads.isPlaying(index);
  }

  setPad(index: number, patch: Partial<PadData>): void {
    this.pads.pads[index] = sanitisePad({ ...this.pads.pads[index], ...patch });
    this.bump();
  }

  clearPad(index: number): void {
    this.pads.stop(index, this.ctx.currentTime);
    this.pads.pads[index] = emptyPad();
    this.pads.setBuffer(index, undefined);
    this.bump();
  }

  clearAllPads(): void {
    for (let i = 0; i < PAD_COUNT; i++) this.clearPad(i);
  }

  async loadPadFile(index: number, file: File): Promise<void> {
    try {
      const stored = await storeSample(this.ctx, file, file.name);
      this.pads.pads[index] = sanitisePad({ ...emptyPad(), name: file.name.replace(/\.[^.]+$/, ""), assetId: stored.id });
      this.pads.setBuffer(index, stored.buffer);
      this.bump();
    } catch (error) {
      toastError(error, `Could not load ${file.name}.`);
    }
  }

  /** Starts or stops recording the microphone into a pad. */
  async togglePadRecording(index: number): Promise<void> {
    if (this.padRecorder) {
      const { pad, mic } = this.padRecorder;
      this.padRecorder = undefined;
      this.bump();
      try {
        const blob = await mic.stop();
        const stored = await storeSample(this.ctx, blob, `Pad ${pad + 1} recording`);
        this.pads.pads[pad] = sanitisePad({ ...emptyPad(), name: `Pad ${pad + 1} take`, assetId: stored.id });
        this.pads.setBuffer(pad, stored.buffer);
      } catch (error) {
        toastError(error, "The recording could not be saved.");
      }
      this.bump();
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

  // ---------------------------------------------------------------- key samples

  async addSamples(files: readonly File[]): Promise<void> {
    for (const file of files) {
      try {
        const stored = await storeSample(this.ctx, file, file.name);
        this.zones = [...this.zones, { assetId: stored.id, name: file.name.replace(/\.[^.]+$/, ""), root: guessRoot(stored.buffer) }];
        this.bump();
      } catch (error) {
        toastError(error, `Could not load ${file.name}.`);
      }
    }
    if (this.zones.length > 0 && this.values.keysTarget === 0) this.setParam("keysTarget", 1);
  }

  setZoneRoot(index: number, root: number): void {
    this.zones = this.zones.map((z, i) => (i === index ? { ...z, root: Math.min(127, Math.max(0, root)) } : z));
    this.bump();
  }

  removeZone(index: number): void {
    this.zones = this.zones.filter((_, i) => i !== index);
    this.bump();
  }

  clearZones(): void {
    this.zones = [];
    this.bump();
  }

  // ---------------------------------------------------------------- lyrics and MIDI take

  setLyrics(text: string): void {
    this.lyrics = text;
    this.choir.setLyrics(text);
    this.bump();
  }

  startMidiRecord(): void {
    this.recorder = { startedAt: Math.floor(this.position()), open: new Map(), notes: [] };
    this.bump();
  }

  /** Ends recording; the take becomes the pattern and is rounded up to whole bars. */
  stopMidiRecord(): void {
    const recorder = this.recorder;
    if (!recorder) return;
    const end = this.position() - recorder.startedAt;
    for (const [note, open] of recorder.open) {
      recorder.notes.push({ pitch: note, startStep: Math.max(0, open.start), lengthSteps: Math.max(1, Math.round(end - open.start)), velocity: open.velocity });
    }
    this.recorder = undefined;
    if (recorder.notes.length === 0) {
      toast("No notes were played, so the take was not kept.");
    } else {
      const last = Math.max(...recorder.notes.map((n) => n.startStep + n.lengthSteps));
      this.setTake(recorder.notes, Math.max(16, Math.ceil(Math.max(last, end) / 16) * 16));
      this.patternOn = 0;
    }
    this.bump();
  }

  clearTake(): void {
    this.setTake([], 16);
    this.bump();
  }

  private setTake(notes: Note[], steps: number): void {
    this.take = notes;
    this.takeSteps = steps;
    this.takeBuckets = new Map();
    for (const n of notes) {
      const list = this.takeBuckets.get(n.startStep % steps) ?? [];
      list.push(n);
      this.takeBuckets.set(n.startStep % steps, list);
    }
  }

  // ---------------------------------------------------------------- parameters

  protected onParam(id: string, _value: number): void {
    const group = this.groupOf.get(id);
    if (id === "level") this.output.gain.value = this.values.level;
    else if (group === "Choir") this.applyChoir();
    else if (group === "Keys") this.applyKeys();
    else if (group === "Pads") this.padBus.gain.value = this.values.padLevel;
    else if (group === "Effects" || group === "Tone and space") this.applyFx();
    else if (group === "Vocoder") this.applyVocoder();
    else this.applyInputChain();
  }

  private applyAll(): void {
    this.output.gain.value = this.values.level;
    this.applyInputChain();
    this.applyVocoder();
    this.applyFx();
    this.applyChoir();
    this.applyKeys();
    this.padBus.gain.value = this.values.padLevel;
  }

  private applyInputChain(): void {
    const v = this.values;
    const now = this.ctx.currentTime;
    this.inGain.gain.value = v.inGain;
    this.voiceGain.gain.value = v.voiceLevel;
    this.monitor.gain.value = v.monitor;
    if (v.gateOn !== 1) this.gateGain.gain.setTargetAtTime(1, now, 0.01);
    this.compBypass.set(v.compOn === 1, now);
    this.comp.threshold.value = v.compThresh;
    this.comp.ratio.value = v.compRatio;
    this.comp.knee.value = 12;
    this.comp.attack.value = 0.005;
    this.comp.release.value = 0.15;
    this.makeup.gain.value = 10 ** (v.compMakeup / 20);
    this.formantLow.gain.value = -v.formant * 0.9;
    this.formantHigh.gain.value = v.formant * 0.9;
    const shifting = v.tuneOn === 1 || v.pitch !== 0;
    const live = this.shifters !== undefined;
    this.mainWet.gain.setTargetAtTime(live && shifting ? 1 : 0, now, 0.01);
    this.mainDry.gain.setTargetAtTime(live && shifting ? 0 : 1, now, 0.01);
    if (this.shifters) {
      for (let i = 0; i < 3; i++) {
        this.shifters.harmGain[i].gain.setTargetAtTime(v.harmOn === 1 ? v[`harmL${i + 1}`] * v.harmMix * 1.5 : 0, now, 0.02);
        this.shifters.harmPan[i].pan.value = v[`harmP${i + 1}`];
      }
    }
  }

  private applyVocoder(): void {
    const v = this.values;
    const on = v.vocOn === 1;
    this.vocSend.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.01);
    this.vocoder.configure({
      bands: BAND_COUNTS[Math.round(v.vocBands)],
      q: v.vocQ,
      shiftSemitones: v.vocShift,
      responseHz: v.vocResponse,
      sibilance: v.vocSib * 0.8,
      level: v.vocMix * 5,
    });
    const kind = CARRIERS[Math.round(v.vocCarrier)];
    const wantDrone = on && this.held.size === 0;
    if (kind !== this.carrier.kind || wantDrone !== this.droneRunning) {
      this.carrier.rebuildFor(kind, wantDrone ? this.key.root + 36 : null);
      this.droneRunning = wantDrone;
    }
  }

  private droneRunning = false;

  private applyFx(bpm = projectStore.get().bpm): void {
    const v = this.values;
    const off = v.fxOn !== 1;
    const settings: FxSettings = {
      drive: v.drive,
      low: v.low,
      high: v.high,
      chorus: v.chorus,
      delayMix: off ? 0 : v.delayMix,
      delayDiv: v.delayDiv,
      delayFeedback: v.delayFb,
      reverbMix: off ? 0 : v.reverbMix,
      reverbSize: Math.round(v.reverbSize),
      reverbDamp: v.reverbDamp,
      spaceMix: off ? 0 : v.spaceMix,
      spaceSize: Math.round(v.spaceSize),
      spacePre: v.spacePre,
      nebula: v.nebula,
      orbit: v.orbit,
      radiation: v.radiation,
      comet: v.comet,
      shimmer: v.shimmer,
      gravity: v.gravity,
    };
    this.fx.apply(settings, bpm);
    this.fx.lfoRates.nebula.frequency.value = v.nebulaRate;
    this.fx.lfoRates.orbit.frequency.value = v.orbitRate;
    this.fx.lfoRates.trem.frequency.value = v.radRate;
    this.fx.lfoRates.comet.frequency.value = v.cometRate;
  }

  private applyChoir(): void {
    const v = this.values;
    const settings: ChoirSettings = {
      ...DEFAULT_CHOIR,
      layers: [v.voiceSoprano === 1, v.voiceAlto === 1, v.voiceTenor === 1, v.voiceBass === 1],
      morph: v.choirVowel,
      useLyrics: v.choirLyrics === 1,
      vibrato: v.choirVibrato,
      vibratoRate: v.choirVibRate,
      breath: v.choirBreath,
      spread: v.choirSpread,
      voices: v.choirVoices,
      attack: v.choirAttack,
      release: v.choirRelease,
      level: v.choirLevel,
    };
    this.choir.settings = settings;
  }

  private applyKeys(): void {
    const v = this.values;
    this.pianoFilter.frequency.value = 800 * 24 ** v.pianoBright;
    this.pianoGain.gain.value = v.pianoLevel;
  }

  // ---------------------------------------------------------------- persistence

  protected override serializeData(): VoxData {
    return {
      lyrics: this.lyrics,
      inputAssetId: this.inputAssetId,
      inputName: this.inputName,
      pads: this.pads.pads.map((p) => ({ ...p, slices: [...p.slices] })),
      zones: this.zones.map((z) => ({ ...z })),
      take: this.take.map((n) => ({ ...n })),
      takeSteps: this.takeSteps,
    };
  }

  protected override restoreData(raw: unknown): void {
    const data = (raw ?? {}) as Partial<VoxData>;
    if (typeof data.lyrics === "string") {
      this.lyrics = data.lyrics;
      this.choir.setLyrics(data.lyrics);
    }
    const pads = Array.isArray(data.pads) ? data.pads : [];
    for (let i = 0; i < PAD_COUNT; i++) {
      this.pads.pads[i] = sanitisePad(pads[i]);
      this.pads.setBuffer(i, undefined);
    }
    this.zones = Array.isArray(data.zones)
      ? data.zones.filter((z): z is KeyZone => typeof z?.assetId === "string" && typeof z.root === "number").map((z) => ({ assetId: z.assetId, name: String(z.name ?? ""), root: z.root }))
      : [];
    const take = Array.isArray(data.take) ? data.take.filter((n) => typeof n?.pitch === "number" && typeof n.startStep === "number") : [];
    this.setTake(take, typeof data.takeSteps === "number" && data.takeSteps >= 16 ? data.takeSteps : 16);
    this.inputAssetId = typeof data.inputAssetId === "string" ? data.inputAssetId : undefined;
    this.inputName = typeof data.inputName === "string" ? data.inputName : undefined;
    this.fileBuffer = this.inputAssetId ? cachedBuffer(this.inputAssetId) : undefined;
    this.resolveAssets();
  }

  /** Fills in sample buffers from the cache now, and fetches anything missing from storage in the background. */
  private resolveAssets(): void {
    const wanted: { id: string; name: string; apply: (b: AudioBuffer) => void }[] = [];
    this.pads.pads.forEach((pad, i) => {
      if (this.pads.refresh(i) || !pad.assetId) return;
      wanted.push({ id: pad.assetId, name: pad.name, apply: (b) => this.pads.setBuffer(i, b) });
    });
    for (const zone of this.zones) if (!cachedBuffer(zone.assetId)) wanted.push({ id: zone.assetId, name: zone.name, apply: () => undefined });
    if (this.inputAssetId && !this.fileBuffer) wanted.push({ id: this.inputAssetId, name: this.inputName ?? "input", apply: (b) => (this.fileBuffer = b) });
    for (const item of wanted) {
      const job: Promise<void> = loadAssetBuffer(this.ctx, item.id, item.name)
        .then((buffer) => {
          item.apply(buffer);
          this.bump();
        })
        .catch((error: unknown) => toastError(error, `Could not load ${item.name}.`))
        .finally(() => this.pending.delete(job));
      this.pending.add(job);
    }
  }

  override dispose(): void {
    this.stopMic();
    this.stopFile();
    this.padRecorder?.mic.cancel();
    if (this.timer !== undefined) clearInterval(this.timer);
    this.choir.dispose();
    this.carrier.dispose();
    this.vocoder.dispose();
    this.fx.dispose();
    super.dispose();
  }
}

/** Reads the pitch of a loaded sample so it lands on the right key; falls back to middle C. */
function guessRoot(buffer: AudioBuffer): number {
  const data = buffer.getChannelData(0);
  const size = 4096;
  if (data.length < size * 2) return 60;
  const from = Math.floor(data.length * 0.2);
  const found = detectPitch(data.subarray(from, from + size), buffer.sampleRate, 40, 2000, 0.2);
  if (!found || found.clarity < 0.7) return 60;
  const midi = Math.round(freqToMidi(found.freq));
  return midi >= 12 && midi <= 120 ? midi : 60;
}

