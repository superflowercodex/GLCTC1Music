import { snapStep, type NoteGrid } from "./clipEdits";
import type { Note } from "../../../project/model";

/** Computer keys laid out like a piano: the home row is the white keys, the row above the black ones (C4 to D5). */
export const KEY_TO_NOTE: Readonly<Record<string, number>> = {
  a: 60, w: 61, s: 62, e: 63, d: 64, f: 65, t: 66, g: 67, y: 68, h: 69, u: 70, j: 71, k: 72, o: 73, l: 74,
};

export const RECORD_VELOCITY = 0.8;

const NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];

export function noteName(pitch: number, withOctave = true): string {
  const name = NAMES[((pitch % 12) + 12) % 12];
  return withOctave ? `${name}${Math.floor(pitch / 12) - 1}` : name;
}

export function isBlackKey(pitch: number): boolean {
  return NAMES[((pitch % 12) + 12) % 12].includes("♯");
}

/** Turns note-on and note-off moments (in clip steps) into notes snapped to the grid. */
export class NoteRecorder {
  private readonly held = new Map<number, { step: number; velocity: number }>();

  constructor(
    private readonly grid: NoteGrid,
    private readonly totalSteps: number,
  ) {}

  noteOn(pitch: number, velocity: number, step: number): void {
    if (!this.held.has(pitch)) this.held.set(pitch, { step, velocity });
  }

  noteOff(pitch: number, step: number): Note | undefined {
    const start = this.held.get(pitch);
    if (!start) return undefined;
    this.held.delete(pitch);
    const startStep = Math.min(Math.max(0, snapStep(start.step, this.grid)), Math.max(0, this.totalSteps - this.grid));
    const rawLength = Math.max(0, step - start.step);
    const lengthSteps = Math.max(this.grid, Math.round(rawLength / this.grid) * this.grid);
    return {
      pitch,
      startStep,
      lengthSteps: Math.min(lengthSteps, this.totalSteps - startStep),
      velocity: start.velocity,
    };
  }

  /** Ends every key still down, as when recording stops. */
  releaseAll(step: number): Note[] {
    return [...this.held.keys()].flatMap((pitch) => {
      const note = this.noteOff(pitch, step);
      return note ? [note] : [];
    });
  }
}
