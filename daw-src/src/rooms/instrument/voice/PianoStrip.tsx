import { useRef, useState } from "react";
import { noteName } from "../../../audio/instruments/voice/scales";
import { IconButton } from "../../../ui/controls";
import { useComputerKeys } from "./hooks";

const ROW = "q2w3er5t6y7ui9o0p";
const BLACK = new Set([1, 3, 6, 8, 10]);

/** Two-octave keyboard that also answers the computer's Q-row, while it is on screen. */
export function PianoStrip({
  onNoteOn,
  onNoteOff,
  computerKeys = true,
}: {
  onNoteOn: (note: number, velocity: number) => void;
  onNoteOff: (note: number) => void;
  computerKeys?: boolean;
}) {
  const [octave, setOctave] = useState(3);
  const [down, setDown] = useState<ReadonlySet<number>>(new Set());
  const held = useRef(new Set<number>());
  const base = (octave + 1) * 12;
  const count = 25;

  const press = (note: number, velocity: number) => {
    if (held.current.has(note)) return;
    held.current.add(note);
    setDown(new Set(held.current));
    onNoteOn(note, velocity);
  };
  const lift = (note: number) => {
    if (!held.current.delete(note)) return;
    setDown(new Set(held.current));
    onNoteOff(note);
  };

  useComputerKeys(
    computerKeys,
    (key) => {
      const i = ROW.indexOf(key);
      if (i >= 0) press(base + i, 0.8);
    },
    (key) => {
      const i = ROW.indexOf(key);
      if (i >= 0) lift(base + i);
    },
  );

  const whites: number[] = [];
  for (let i = 0; i < count; i++) if (!BLACK.has((base + i) % 12)) whites.push(i);
  const whiteWidth = 100 / whites.length;

  return (
    <div className="piano">
      <div className="piano-octave">
        <IconButton icon="back" label="Octave down" onClick={() => setOctave((o) => Math.max(0, o - 1))} />
        <span className="mono" aria-live="polite">
          C{octave}
        </span>
        <IconButton icon="next" label="Octave up" onClick={() => setOctave((o) => Math.min(6, o + 1))} />
      </div>
      <div className="piano-keys" role="group" aria-label="Keyboard">
        {Array.from({ length: count }, (_, i) => {
          const note = base + i;
          const black = BLACK.has(note % 12);
          const whiteIndex = whites.filter((w) => w < i).length;
          const left = black ? whiteIndex * whiteWidth - whiteWidth * 0.3 : whiteIndex * whiteWidth;
          const width = black ? whiteWidth * 0.6 : whiteWidth;
          return (
            <button
              key={note}
              type="button"
              className={`piano-key ${black ? "black" : ""} ${down.has(note) ? "down" : ""}`}
              style={{ left: `${left}%`, width: `calc(${width}% - ${black ? 0 : 2}px)` }}
              aria-label={noteName(note)}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                const rect = e.currentTarget.getBoundingClientRect();
                press(note, Math.min(1, 0.4 + 0.6 * ((e.clientY - rect.top) / rect.height)));
              }}
              onPointerUp={() => lift(note)}
              onPointerCancel={() => lift(note)}
            >
              {!black && ROW[i] && i % 12 === 0 ? <span>{noteName(note)}</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
