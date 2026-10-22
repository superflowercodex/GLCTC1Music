import { useEffect, useRef } from "react";
import { messageOf, showToast } from "./toast";

/** Computer-keyboard layouts: key to semitones above the base C. */
export const PIANO_ROW: Readonly<Record<string, number>> = {
  a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12, o: 13, l: 14, p: 15, ";": 16,
};
export const UPPER_ROW: Readonly<Record<string, number>> = {
  q: 0, "2": 1, w: 2, "3": 3, e: 4, r: 5, "5": 6, t: 7, "6": 8, y: 9, "7": 10, u: 11, i: 12, "9": 13, o: 14, "0": 15, p: 16,
};
export const LOWER_ROW: Readonly<Record<string, number>> = {
  z: 0, s: 1, x: 2, d: 3, c: 4, v: 5, g: 6, b: 7, h: 8, n: 9, j: 10, m: 11, ",": 12, l: 13, ".": 14, ";": 15, "/": 16,
};

function typingInField(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "SELECT" || target.tagName === "TEXTAREA" || target.isContentEditable);
}

export interface KeyLayer {
  layout: Readonly<Record<string, number>>;
  /** MIDI note of offset 0 (a C). */
  base: number;
}

/**
 * Plays notes from the computer keyboard. Layers let one keyboard drive two zones (upper and lower rows);
 * a key that is also in the first layer belongs to that layer, so the layouts must not overlap.
 */
export function useComputerKeys(layers: readonly KeyLayer[], onDown: (midi: number, layer: number) => void, onUp: (midi: number, layer: number) => void): void {
  const state = useRef({ layers, onDown, onUp });
  state.current = { layers, onDown, onUp };

  useEffect(() => {
    const down = new Map<string, { midi: number; layer: number }>();
    const find = (key: string): { midi: number; layer: number } | null => {
      const { layers: ls } = state.current;
      for (let layer = 0; layer < ls.length; layer++) {
        const offset = ls[layer].layout[key];
        if (offset !== undefined) return { midi: ls[layer].base + offset, layer };
      }
      return null;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || typingInField(e.target)) return;
      const key = e.key.toLowerCase();
      if (down.has(key)) return;
      const hit = find(key);
      if (!hit) return;
      down.set(key, hit);
      state.current.onDown(hit.midi, hit.layer);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const hit = down.get(key);
      if (!hit) return;
      down.delete(key);
      state.current.onUp(hit.midi, hit.layer);
    };
    const releaseAll = () => {
      for (const hit of down.values()) state.current.onUp(hit.midi, hit.layer);
      down.clear();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", releaseAll);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", releaseAll);
      releaseAll();
    };
  }, []);
}

export interface MidiHandlers {
  noteOn: (midi: number, velocity: number) => void;
  noteOff: (midi: number) => void;
  bend?: (value: number) => void;
  modWheel?: (value: number) => void;
  sustain?: (on: boolean) => void;
}

/** Listens to every connected MIDI keyboard. Browsers without Web MIDI are skipped quietly; a refused permission is reported. */
export function useMidiInput(handlers: MidiHandlers): void {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    if (typeof navigator === "undefined" || typeof navigator.requestMIDIAccess !== "function") return;
    let cancelled = false;
    let access: MIDIAccess | null = null;
    const onMessage = (event: MIDIMessageEvent) => {
      const data = event.data;
      if (!data || data.length < 2) return;
      const status = data[0] & 0xf0;
      const h = ref.current;
      if (status === 0x90 && data[2] > 0) h.noteOn(data[1], data[2] / 127);
      else if (status === 0x80 || status === 0x90) h.noteOff(data[1]);
      else if (status === 0xe0) h.bend?.(((data[2] << 7) | data[1]) / 8192 - 1);
      else if (status === 0xb0 && data[1] === 1) h.modWheel?.(data[2] / 127);
      else if (status === 0xb0 && data[1] === 64) h.sustain?.(data[2] >= 64);
    };
    const attach = () => access?.inputs.forEach((input) => (input.onmidimessage = onMessage));
    navigator
      .requestMIDIAccess()
      .then((a) => {
        if (cancelled) return;
        access = a;
        attach();
        a.onstatechange = attach;
      })
      .catch((error: unknown) => showToast(`MIDI keyboards are not available: ${messageOf(error)}`));
    return () => {
      cancelled = true;
      access?.inputs.forEach((input) => (input.onmidimessage = null));
      if (access) access.onstatechange = null;
    };
  }, []);
}
