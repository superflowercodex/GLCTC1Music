export type InstrumentKind =
  | "drum80la8"
  | "divine09"
  | "pad64"
  | "acid30lee"
  | "lead0010110"
  | "galacticOne"
  | "vox"
  | "looper";

/** One slider-like control. The UI builds its sliders from these, so an instrument never needs UI code for plain parameters. */
export interface ParamDef {
  id: string;
  label: string;
  /** Section the control lives in, e.g. "Filter". */
  group: string;
  min: number;
  max: number;
  step?: number;
  def: number;
  unit?: string;
  /** When set the value is an index into this list and the UI shows a segmented control. */
  options?: readonly string[];
}

export interface Preset {
  id: string;
  name: string;
  category: string;
  factory: boolean;
  /** Parameter values; anything missing keeps its default. */
  values: Record<string, number>;
  /** Instrument-specific payload such as a pattern. */
  data?: unknown;
}

export interface NoteEvent {
  /** MIDI note number. */
  note: number;
  /** 0 to 1. */
  velocity: number;
  /** Audio-clock time in seconds; omitted means now. */
  time?: number;
  /** Seconds; omitted means held until noteOff. */
  duration?: number;
}

export interface InstrumentState {
  kind: InstrumentKind;
  values: Record<string, number>;
  presetId?: string;
  /** Instrument-specific data (patterns, samples, key maps). Must be structured-clone safe. */
  data?: unknown;
}

export interface Instrument {
  readonly kind: InstrumentKind;
  readonly ctx: BaseAudioContext;
  readonly output: AudioNode;
  readonly params: readonly ParamDef[];
  /** Bumps on every change, so UI code can select against it cheaply. */
  readonly version: number;

  getParam(id: string): number;
  setParam(id: string, value: number): void;

  readonly presets: readonly Preset[];
  loadPreset(id: string): void;
  saveUserPreset(name: string, category?: string): Preset;
  deleteUserPreset(id: string): void;

  serialize(): InstrumentState;
  restore(state: InstrumentState): void;

  /** Number of selectable patterns, 0 for instruments without any (the Song room skips those). */
  readonly patternCount: number;
  /** Which pattern plays; null silences the instrument's sequencer without stopping live playing. */
  readonly activePattern: number | null;
  setPattern(index: number | null): void;

  /** Called by the clock for every 16th step, `time` being the exact audio-clock moment to schedule at. */
  onStep(step: number, time: number, stepDur: number): void;
  noteOn(event: NoteEvent): void;
  noteOff(note: number, time?: number): void;
  allNotesOff(): void;

  subscribe(listener: () => void): () => void;
  dispose(): void;
}

export class AudioEngineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AudioEngineError";
  }
}
