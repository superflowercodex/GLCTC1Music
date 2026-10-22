import { lsGet, lsSet } from "../storage";
import type { Instrument, InstrumentKind, InstrumentState, NoteEvent, ParamDef, Preset } from "./types";

/**
 * Shared plumbing for every instrument: parameter storage, presets, serialization and change
 * notification. Subclasses build their audio graph in the constructor and react to parameter
 * changes in onParam.
 */
export abstract class InstrumentBase implements Instrument {
  abstract readonly kind: InstrumentKind;
  readonly output: GainNode;
  presetId: string | undefined;

  protected values: Record<string, number> = {};
  private listeners = new Set<() => void>();
  private versionCounter = 0;
  private userPresets: Preset[] = [];

  constructor(
    readonly ctx: BaseAudioContext,
    readonly params: readonly ParamDef[],
    private readonly factoryPresets: readonly Preset[],
    private readonly storageKey: string,
  ) {
    this.output = ctx.createGain();
    for (const p of params) this.values[p.id] = p.def;
    this.userPresets = lsGet<Preset[]>(`presets.${storageKey}`, []);
  }

  get version(): number {
    return this.versionCounter;
  }

  get presets(): readonly Preset[] {
    return [...this.factoryPresets, ...this.userPresets];
  }

  getParam(id: string): number {
    const value = this.values[id];
    if (value === undefined) throw new RangeError(`${this.kind} has no parameter "${id}"`);
    return value;
  }

  setParam(id: string, value: number): void {
    const def = this.params.find((p) => p.id === id);
    if (!def) throw new RangeError(`${this.kind} has no parameter "${id}"`);
    let next = Math.min(def.max, Math.max(def.min, value));
    if (def.options) next = Math.round(next);
    this.values[id] = next;
    this.onParam(id, next);
    this.bump();
  }

  loadPreset(id: string): void {
    const preset = this.presets.find((p) => p.id === id);
    if (!preset) throw new RangeError(`${this.kind} has no preset "${id}"`);
    for (const p of this.params) {
      const value = preset.values[p.id] ?? p.def;
      this.values[p.id] = value;
      this.onParam(p.id, value);
    }
    if (preset.data !== undefined) this.restoreData(preset.data);
    this.presetId = id;
    this.bump();
  }

  saveUserPreset(name: string, category = "Yours"): Preset {
    const preset: Preset = {
      id: `user-${Date.now().toString(36)}`,
      name,
      category,
      factory: false,
      values: { ...this.values },
      data: this.serializeData(),
    };
    this.userPresets = [...this.userPresets, preset];
    lsSet(`presets.${this.storageKey}`, this.userPresets);
    this.presetId = preset.id;
    this.bump();
    return preset;
  }

  deleteUserPreset(id: string): void {
    this.userPresets = this.userPresets.filter((p) => p.id !== id);
    lsSet(`presets.${this.storageKey}`, this.userPresets);
    if (this.presetId === id) this.presetId = undefined;
    this.bump();
  }

  serialize(): InstrumentState {
    return { kind: this.kind, values: { ...this.values }, presetId: this.presetId, data: this.serializeData() };
  }

  restore(state: InstrumentState): void {
    for (const p of this.params) {
      const value = state.values[p.id] ?? p.def;
      this.values[p.id] = value;
      this.onParam(p.id, value);
    }
    if (state.data !== undefined) this.restoreData(state.data);
    this.presetId = state.presetId;
    this.bump();
  }

  get patternCount(): number {
    return 0;
  }

  get activePattern(): number | null {
    return null;
  }

  setPattern(_index: number | null): void {}

  onStep(_step: number, _time: number, _stepDur: number): void {}
  noteOn(_event: NoteEvent): void {}
  noteOff(_note: number, _time?: number): void {}
  allNotesOff(): void {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    this.allNotesOff();
    this.output.disconnect();
    this.listeners.clear();
  }

  /** Apply one parameter to the audio graph. Also called for every parameter on preset load and restore. */
  protected abstract onParam(id: string, value: number): void;
  protected serializeData(): unknown {
    return undefined;
  }
  protected restoreData(_data: unknown): void {}

  protected bump(): void {
    this.versionCounter += 1;
    for (const listener of this.listeners) listener();
  }
}
