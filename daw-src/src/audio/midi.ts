import { lsGet, lsSet } from "../storage";
import { projectStore } from "../store/project";
import { createStore, type Store } from "../store/store";
import type { Instrument } from "./types";

export class MidiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MidiError";
  }
}

/** Anything a controller can move. `norm` is 0 to 1; the target maps it onto its own range. */
export interface MidiTarget {
  id: string;
  label: string;
  /** range: follows a knob. toggle: a note or button flips it. trigger: fires on press. */
  kind: "range" | "toggle" | "trigger";
  set(norm: number): void;
  /** Needed by toggles so a note press can flip the current state. */
  get?(): number;
}

export type MidiMessageKind = "cc" | "note";

export interface MidiBinding {
  id: string;
  targetId: string;
  /** What the person sees in the list; starts as the target's label and can be renamed. */
  name: string;
  kind: MidiMessageKind;
  number: number;
  channel: number;
}

export interface MidiControl {
  kind: MidiMessageKind;
  number: number;
  channel: number;
}

export type MidiEvent =
  | { type: "noteOn"; note: number; velocity: number; channel: number }
  | { type: "noteOff"; note: number; channel: number }
  | { type: "cc"; controller: number; value: number; channel: number }
  | { type: "allNotesOff" };

export function parseMidiMessage(data: ArrayLike<number>): MidiEvent | null {
  const status = data[0] ?? 0;
  const a = data[1] ?? 0;
  const b = data[2] ?? 0;
  const channel = status & 0x0f;
  switch (status & 0xf0) {
    case 0x90:
      return b > 0 ? { type: "noteOn", note: a, velocity: b / 127, channel } : { type: "noteOff", note: a, channel };
    case 0x80:
      return { type: "noteOff", note: a, channel };
    case 0xb0:
      return a === 123 ? { type: "allNotesOff" } : { type: "cc", controller: a, value: b / 127, channel };
    default:
      return null;
  }
}

function isBinding(value: unknown): value is MidiBinding {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.targetId === "string" &&
    typeof v.name === "string" &&
    (v.kind === "cc" || v.kind === "note") &&
    typeof v.number === "number" &&
    typeof v.channel === "number"
  );
}

export interface BindingPersistence {
  load(): unknown;
  save(bindings: MidiBinding[]): boolean;
}

export const studioBindingPersistence: BindingPersistence = {
  load: () => lsGet<unknown>("midiBindings", []),
  save: (bindings) => lsSet("midiBindings", bindings),
};

export interface BindingsState {
  bindings: MidiBinding[];
  /** Set when the browser refused to store the bindings, so the list can say they will be lost. */
  saveError: string | null;
}

/** The list of controller-to-parameter links. One controller drives one parameter; one parameter listens to one controller. */
export class MidiBindings {
  readonly store: Store<BindingsState>;
  private counter = 0;

  constructor(private readonly persistence: BindingPersistence = studioBindingPersistence) {
    const loaded = persistence.load();
    this.store = createStore<BindingsState>({ bindings: Array.isArray(loaded) ? loaded.filter(isBinding) : [], saveError: null });
  }

  list(): MidiBinding[] {
    return this.store.get().bindings;
  }

  find(control: MidiControl): MidiBinding | undefined {
    return this.list().find((b) => b.kind === control.kind && b.number === control.number && b.channel === control.channel);
  }

  forTarget(targetId: string): MidiBinding | undefined {
    return this.list().find((b) => b.targetId === targetId);
  }

  bind(target: Pick<MidiTarget, "id" | "label">, control: MidiControl): MidiBinding {
    const binding: MidiBinding = {
      id: `bind-${Date.now().toString(36)}-${this.counter++}`,
      targetId: target.id,
      name: this.forTarget(target.id)?.name ?? target.label,
      ...control,
    };
    this.commit([...this.list().filter((b) => b.targetId !== target.id && !(b.kind === control.kind && b.number === control.number && b.channel === control.channel)), binding]);
    return binding;
  }

  rename(id: string, name: string): void {
    const trimmed = name.trim();
    if (!trimmed) throw new MidiError("A link needs a name.");
    this.commit(this.list().map((b) => (b.id === id ? { ...b, name: trimmed } : b)));
  }

  clear(id: string): void {
    this.commit(this.list().filter((b) => b.id !== id));
  }

  clearAll(): void {
    this.commit([]);
  }

  private commit(bindings: MidiBinding[]): void {
    const ok = this.persistence.save(bindings);
    this.store.set({ bindings, saveError: ok ? null : "This browser would not store your MIDI links, so they will be gone after a reload." });
  }
}

export interface LearnState {
  /** The target waiting for a controller, or null when learn is off. */
  targetId: string | null;
}

/** Routes incoming MIDI to bound parameters, and binds the next control moved while learn is armed. */
export class MidiRouter {
  readonly bindings: MidiBindings;
  readonly learn: Store<LearnState> = createStore<LearnState>({ targetId: null });
  readonly targets: Store<readonly MidiTarget[]> = createStore<readonly MidiTarget[]>([]);
  private readonly listeners = new Set<(event: MidiEvent) => void>();

  constructor(bindings: MidiBindings = new MidiBindings()) {
    this.bindings = bindings;
  }

  registerTarget(target: MidiTarget): () => void {
    this.targets.set((all) => [...all.filter((t) => t.id !== target.id), target]);
    return () => this.targets.set((all) => all.filter((t) => t !== target));
  }

  getTarget(id: string): MidiTarget | undefined {
    return this.targets.get().find((t) => t.id === id);
  }

  /** Raw notes and controllers that no binding or learn session used, for playing instruments from a keyboard. */
  onUnclaimed(listener: (event: MidiEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  startLearn(targetId: string): void {
    if (!this.getTarget(targetId)) throw new MidiError("That control is not on screen any more, so it cannot be linked.");
    this.learn.set({ targetId });
  }

  cancelLearn(): void {
    this.learn.set({ targetId: null });
  }

  handle(data: ArrayLike<number>): void {
    const event = parseMidiMessage(data);
    if (!event) return;
    if (event.type === "allNotesOff") {
      this.emit(event);
      return;
    }
    const control: MidiControl =
      event.type === "cc" ? { kind: "cc", number: event.controller, channel: event.channel } : { kind: "note", number: event.note, channel: event.channel };

    const learning = this.learn.get().targetId;
    if (learning !== null) {
      // Releases and zero-value moves must not end the session: only a press or a real controller move binds.
      if (event.type === "noteOff") return;
      const target = this.getTarget(learning);
      this.cancelLearn();
      if (target) this.bindings.bind(target, control);
      return;
    }

    const binding = this.bindings.find(control);
    const target = binding ? this.getTarget(binding.targetId) : undefined;
    if (!binding || !target) {
      this.emit(event);
      return;
    }
    this.drive(target, event);
  }

  private drive(target: MidiTarget, event: MidiEvent): void {
    if (event.type === "noteOff") return;
    if (event.type === "cc") {
      if (target.kind === "range") target.set(event.value);
      else if (event.value >= 0.5) target.set(target.kind === "toggle" ? ((target.get?.() ?? 0) >= 0.5 ? 0 : 1) : 1);
      return;
    }
    if (event.type === "noteOn") {
      if (target.kind === "toggle") target.set((target.get?.() ?? 0) >= 0.5 ? 0 : 1);
      else target.set(1);
    }
  }

  private emit(event: MidiEvent): void {
    for (const l of this.listeners) l(event);
  }
}

export const midiRouter = new MidiRouter();

function quantise(value: number, min: number, max: number, step: number | undefined, isOption: boolean): number {
  const raw = min + value * (max - min);
  if (isOption) return Math.min(max, Math.max(min, Math.round(raw)));
  if (!step) return raw;
  return Math.min(max, Math.max(min, Math.round((raw - min) / step) * step + min));
}

/** Makes every parameter of an instrument linkable. Returns one function that removes them all. */
export function registerInstrumentTargets(router: MidiRouter, prefix: string, instrument: Instrument): () => void {
  const removers = instrument.params.map((p) =>
    router.registerTarget({
      id: `${instrument.kind}.${p.id}`,
      label: `${prefix} · ${p.label}`,
      kind: "range",
      set: (norm) => instrument.setParam(p.id, quantise(norm, p.min, p.max, p.step, p.options !== undefined)),
      get: () => (p.max === p.min ? 0 : (instrument.getParam(p.id) - p.min) / (p.max - p.min)),
    }),
  );
  return () => removers.forEach((r) => r());
}

export function registerMasterTargets(router: MidiRouter): () => void {
  const setMaster = (patch: Partial<ReturnType<typeof projectStore.get>["master"]>): void =>
    projectStore.set((p) => ({ ...p, master: { ...p.master, ...patch } }));
  const m = () => projectStore.get().master;
  const removers = [
    router.registerTarget({ id: "master.gainDb", label: "Master · Volume", kind: "range", set: (n) => setMaster({ gainDb: -60 + n * 66 }), get: () => (m().gainDb + 60) / 66 }),
    router.registerTarget({ id: "master.reverbMix", label: "Master · Reverb", kind: "range", set: (n) => setMaster({ reverbMix: n }), get: () => m().reverbMix }),
    router.registerTarget({ id: "master.delayMix", label: "Master · Delay", kind: "range", set: (n) => setMaster({ delayMix: n }), get: () => m().delayMix }),
    router.registerTarget({
      id: "master.filterHz",
      label: "Master · Filter",
      kind: "range",
      set: (n) => setMaster({ filterHz: 20 * 1000 ** n }),
      get: () => Math.log(Math.max(20, m().filterHz) / 20) / Math.log(1000),
    }),
  ];
  return () => removers.forEach((r) => r());
}

export interface MidiDevice {
  id: string;
  name: string;
  manufacturer: string;
}

export type MidiStatus = "idle" | "unsupported" | "requesting" | "denied" | "ready" | "error";

export interface MidiState {
  status: MidiStatus;
  devices: MidiDevice[];
  error: string | null;
}

type RequestMidiAccess = (options?: { sysex?: boolean }) => Promise<MIDIAccess>;

export class MidiService {
  readonly state: Store<MidiState> = createStore<MidiState>({ status: "idle", devices: [], error: null });
  private access: MIDIAccess | null = null;

  constructor(
    private readonly router: MidiRouter,
    private readonly request: RequestMidiAccess | undefined = typeof navigator !== "undefined" && "requestMIDIAccess" in navigator
      ? (o) => navigator.requestMIDIAccess(o)
      : undefined,
  ) {
    if (!request) this.state.set({ status: "unsupported", devices: [], error: null });
  }

  get supported(): boolean {
    return this.request !== undefined;
  }

  async enable(): Promise<void> {
    if (!this.request) return;
    if (this.access) return;
    this.state.set({ status: "requesting", devices: [], error: null });
    try {
      this.access = await this.request({ sysex: false });
    } catch (error) {
      const denied = error instanceof DOMException && (error.name === "SecurityError" || error.name === "NotAllowedError");
      this.state.set({
        status: denied ? "denied" : "error",
        devices: [],
        error: denied ? "MIDI access was blocked. Allow it in the browser's site settings to use a keyboard or controller." : `MIDI could not start: ${error instanceof Error ? error.message : String(error)}`,
      });
      return;
    }
    this.access.onstatechange = () => this.refresh();
    this.refresh();
  }

  private refresh(): void {
    const access = this.access;
    if (!access) return;
    const devices: MidiDevice[] = [];
    for (const input of access.inputs.values()) {
      input.onmidimessage = (e) => this.router.handle(e.data ?? []);
      if (input.state === "connected") devices.push({ id: input.id, name: input.name ?? "MIDI input", manufacturer: input.manufacturer ?? "" });
    }
    this.state.set({ status: "ready", devices, error: null });
  }
}

export const midiService = new MidiService(midiRouter);

let masterRegistered = false;

/** Starts MIDI at launch only when the browser already allows it, so nobody gets a permission prompt out of nowhere. */
export async function autoStartMidi(): Promise<void> {
  if (!masterRegistered) {
    masterRegistered = true;
    registerMasterTargets(midiRouter);
  }
  if (!midiService.supported || typeof navigator === "undefined" || !navigator.permissions) return;
  try {
    const status = await navigator.permissions.query({ name: "midi" as PermissionName });
    if (status.state === "granted") await midiService.enable();
  } catch {
    // Browsers that cannot report MIDI permission simply wait for the Enable button.
  }
}
