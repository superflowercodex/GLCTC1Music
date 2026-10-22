import { useRef, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { noteName } from "../../../audio/instruments/synth/scales";

const WHITE_OFFSETS = [0, 2, 4, 5, 7, 9, 11];
/** Positions within an octave of white keys that have a black key on their right. */
const HAS_BLACK = new Set([0, 1, 3, 4, 5]);

export interface PianoKeysProps {
  /** MIDI note of the first white key; should be a C. */
  start: number;
  whites: number;
  label: string;
  /** Highlight colour for pressed keys. */
  color: string;
  height: number;
  onDown: (midi: number, velocity: number) => void;
  onUp: (midi: number) => void;
}

/** Marks keys pressed from outside the keyboard (computer keys, MIDI) by class, without re-rendering. */
export function lightKey(root: HTMLElement | null, midi: number, on: boolean): void {
  root?.querySelectorAll<HTMLElement>(`[data-midi="${midi}"]`).forEach((el) => el.classList.toggle("pressed", on));
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/**
 * A touch keyboard. Pointer position along a key sets velocity, sliding across keys glides between notes,
 * and each pointer is tracked on its own so chords work. Focused keys also respond to Enter and Space.
 */
export function PianoKeys({ start, whites, label, color, height, onDown, onUp }: PianoKeysProps) {
  const root = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, number>());

  const press = (id: number, midi: number, velocity: number) => {
    pointers.current.set(id, midi);
    lightKey(root.current, midi, true);
    onDown(midi, velocity);
  };
  const release = (id: number) => {
    const midi = pointers.current.get(id);
    if (midi === undefined) return;
    pointers.current.delete(id);
    lightKey(root.current, midi, false);
    onUp(midi);
  };
  const keyAt = (target: EventTarget | null): HTMLElement | null => (target instanceof Element ? target.closest<HTMLElement>("[data-midi]") : null);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const key = keyAt(e.target);
    if (!key) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = key.getBoundingClientRect();
    press(e.pointerId, Number(key.dataset.midi), 0.3 + 0.7 * clamp((e.clientY - rect.top) / rect.height, 0, 1));
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const current = pointers.current.get(e.pointerId);
    if (current === undefined) return;
    const key = keyAt(document.elementFromPoint(e.clientX, e.clientY));
    if (!key || !root.current?.contains(key) || Number(key.dataset.midi) === current) return;
    release(e.pointerId);
    press(e.pointerId, Number(key.dataset.midi), 0.7);
  };
  const onPointerEnd = (e: PointerEvent<HTMLDivElement>) => release(e.pointerId);

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if ((e.key !== "Enter" && e.key !== " ") || e.repeat) return;
    e.preventDefault();
    const midi = Number(e.currentTarget.dataset.midi);
    press(-midi - 1, midi, 0.8);
  };
  const onKeyUp = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === "Enter" || e.key === " ") release(-Number(e.currentTarget.dataset.midi) - 1);
  };

  const keys: { midi: number; black: boolean; left: number }[] = [];
  for (let k = 0; k < whites; k++) {
    const octave = Math.floor(k / 7);
    const index = k % 7;
    const midi = start + octave * 12 + WHITE_OFFSETS[index];
    keys.push({ midi, black: false, left: k });
    if (HAS_BLACK.has(index) && k < whites - 1) keys.push({ midi: midi + 1, black: true, left: k + 1 });
  }

  return (
    <div
      ref={root}
      className="sy-keys"
      style={{ height, "--key": color, "--whites": whites } as CSSProperties}
      role="group"
      aria-label={label}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
    >
      {keys
        .filter((k) => !k.black)
        .map((k) => (
          <button key={k.midi} type="button" className="sy-key" data-midi={k.midi} aria-label={noteName(k.midi, true)} style={{ left: `${(k.left / whites) * 100}%` }} onKeyDown={onKeyDown} onKeyUp={onKeyUp} />
        ))}
      {keys
        .filter((k) => k.black)
        .map((k) => (
          <button key={k.midi} type="button" className="sy-key black" data-midi={k.midi} aria-label={noteName(k.midi, true)} style={{ left: `${(k.left / whites) * 100}%` }} onKeyDown={onKeyDown} onKeyUp={onKeyUp} />
        ))}
    </div>
  );
}
