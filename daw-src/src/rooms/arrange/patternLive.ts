import type { Acid30lee, AcidStep } from "../../audio/instruments/acid30lee";
import type { GalacticOne } from "../../audio/instruments/galacticOne";
import type { Lead0010110 } from "../../audio/instruments/lead0010110";
import type { GPattern, GStep } from "../../audio/instruments/synth/patternGen";
import type { Instrument, InstrumentState } from "../../audio/types";
import { setSlotState } from "../../project/actions";
import { history, recordSlotEdit } from "../../project/history";
import { ensureInstrument } from "../../project/instruments";
import type { Project } from "../../project/model";
import { projectStore } from "../../store/project";
import { getPattern, leadPattern, mergePatterns, patternCount, patternFamily } from "./patternEdit";

const same = (a: unknown, b: unknown): boolean => a === b || JSON.stringify(a) === JSON.stringify(b);

/**
 * The synths serialize their live pattern arrays by reference, so anything kept for undo must be a copy,
 * or a later tap would rewrite the snapshot too.
 */
const snapshot = (inst: Instrument): InstrumentState => structuredClone(inst.serialize());

/** Pins the project's copy of the slot to a detached snapshot, so the undo step about to start begins from it. */
function freeze(slotId: string, state: InstrumentState): void {
  projectStore.set((p) => setSlotState(p, slotId, state));
}

/**
 * Makes the live instrument play `after`'s pattern content. The synths are written step by step through
 * their own API, so nothing else about the sound is touched; the drum machines have no per-pattern
 * write, so they take the whole state back (their parameter handlers are idempotent ramps) and keep
 * whichever pattern was playing.
 */
export function writeLive(inst: Instrument, before: InstrumentState, after: InstrumentState): void {
  const family = patternFamily(inst.kind);
  const count = patternCount(after);
  if (family === "drums") {
    const changed = Array.from({ length: count }, (_, i) => i).some((i) => !same(getPattern(before, i), getPattern(after, i)));
    if (!changed) return;
    const playing = inst.activePattern;
    inst.restore(after);
    if (inst.activePattern !== playing) inst.setPattern(playing);
    return;
  }
  if (family === "acid") {
    const synth = inst as Acid30lee;
    for (let p = 0; p < count; p++) {
      const a = (getPattern(before, p) as AcidStep[] | undefined) ?? [];
      const b = (getPattern(after, p) as AcidStep[] | undefined) ?? [];
      b.forEach((step, i) => !same(a[i], step) && synth.setStep(p, i, step));
    }
    return;
  }
  if (family === "galactic") {
    const synth = inst as GalacticOne;
    for (let p = 0; p < count; p++) {
      const a = getPattern(before, p) as GPattern | undefined;
      const b = getPattern(after, p) as GPattern | undefined;
      if (!b) continue;
      if (a?.len !== b.len) synth.setLength(p, b.len);
      b.steps.forEach((step: GStep, i) => !same(a?.steps[i], step) && synth.updateStep(p, i, step));
    }
    return;
  }
  if (family === "lead") {
    const synth = inst as Lead0010110;
    const a = leadPattern(before);
    const b = leadPattern(after);
    b.steps.forEach((d, i) => d !== a.steps[i] && synth.setDegree(i, d));
    b.accents.forEach((acc, i) => acc !== (synth.getAccents()[i] ?? false) && synth.toggleAccent(i));
  }
}

/**
 * One pattern edit: the live instrument plays it at once and the project's saved copy changes in the
 * same undo step (several taps in quick succession join one step, as any edit does).
 */
export function commitPatternEdit(slotId: string, inst: Instrument, edit: (state: InstrumentState) => InstrumentState): void {
  const before = snapshot(inst);
  const after = edit(before);
  if (after === before) return;
  freeze(slotId, before);
  writeLive(inst, before, after);
  const state = snapshot(inst);
  recordSlotEdit([slotId], () => projectStore.set((p) => setSlotState(p, slotId, state)));
}

/** Like commitPatternEdit, for a change that also moves clips (Make unique copy): `next` already holds both. */
export function commitPatternProject(slotId: string, inst: Instrument, next: Project): void {
  const target = next.instruments.find((s) => s.id === slotId)?.state;
  if (!target) return;
  const before = snapshot(inst);
  freeze(slotId, before);
  writeLive(inst, before, mergePatterns(before, target));
  const state = snapshot(inst);
  recordSlotEdit([slotId], () => projectStore.set(setSlotState(next, slotId, state)));
}

// Undo and redo roll a slot's saved patterns back; the live instrument follows, keeping its knobs as they are now.
history.onSlotsRestored((slotIds, project) => {
  for (const slot of project.instruments) {
    if (!slotIds.has(slot.id)) continue;
    void ensureInstrument(slot.kind).then((inst) => {
      const live = snapshot(inst);
      writeLive(inst, live, mergePatterns(live, structuredClone(slot.state)));
      const state = snapshot(inst);
      projectStore.set((p) => setSlotState(p, slot.id, state));
    });
  }
});
