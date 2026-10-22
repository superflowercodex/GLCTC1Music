import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { getEngine, peekEngine } from "../../../audio/engine";
import { togglePlay } from "../../../audio/transport";
import type { Instrument } from "../../../audio/types";
import { ensureInstrument } from "../../../project/instruments";
import type { Clip, Note, Track } from "../../../project/model";
import { projectStore } from "../../../store/project";
import { Button, Seg } from "../../../ui/controls";
import { useRaf } from "../../../ui/hooks";
import {
  addNote,
  clipSteps,
  DEFAULT_VELOCITY,
  findClip,
  moveNote,
  noteAt,
  quantize,
  removeNote,
  replaceClip,
  resizeNote,
  setMidiLength,
  setNoteVelocity,
  snapStep,
  type NoteGrid,
  type TimeBase,
} from "./clipEdits";
import { connectMidi, KEYBOARD_HINT, type MidiConnection, type MidiEvent } from "./midiInput";
import { isBlackKey, KEY_TO_NOTE, noteName, NoteRecorder, RECORD_VELOCITY } from "./record";
import { notify } from "./shared";

interface Props {
  clip: Clip;
  track: Track | undefined;
  time: TimeBase;
  /** Where the editor header wants this tab's controls, so they share one calm toolbar with the tab switch. */
  toolbar: HTMLElement | null;
}

const HIGH = 107;
const LOW = 24;
const ROWS = HIGH - LOW + 1;
/** Tall enough to hit and read, short enough that two octaves fit even in a 720px window. */
const ROW_H = 20;
const RULER_H = 28;
const MIDDLE_C = 60;
const GRIDS: ReadonlyArray<{ value: NoteGrid; label: string }> = [
  { value: 1, label: "1/16" },
  { value: 2, label: "1/8" },
  { value: 4, label: "1/4" },
];
const LENGTHS = [1, 2, 4] as const;

type Drag = {
  mode: "move" | "resize";
  index: number;
  startX: number;
  orig: Note;
  moved: boolean;
  lastKey: string;
  lastPitch: number;
};

const rowOf = (pitch: number) => HIGH - pitch;

function isTypingTarget(t: EventTarget | null): boolean {
  return t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));
}

export function NotesTab({ clip, track, time, toolbar }: Props) {
  const [grid, setGrid] = useState<NoteGrid>(1);
  const [recording, setRecording] = useState(false);
  const [status, setStatus] = useState(KEYBOARD_HINT);
  const rowH = ROW_H;
  const [cursor, setCursor] = useState<{ pitch: number; step: number } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const gridEl = useRef<HTMLDivElement>(null);
  const roll = useRef<HTMLDivElement>(null);
  const lane = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const centred = useRef(false);
  const instrumentRef = useRef<Instrument | undefined>(undefined);
  const recorderRef = useRef<{ recorder: NoteRecorder; startedTransport: boolean; midi?: MidiConnection } | null>(null);

  const notes = useMemo<readonly Note[]>(() => clip.notes ?? [], [clip.notes]);
  const total = clipSteps(clip, time);
  const live = useRef({ clip, time, total, grid, notes });
  live.current = { clip, time, total, grid, notes };

  const writeNotes = useCallback(
    (fn: (notes: readonly Note[], total: number) => Note[]) =>
      projectStore.set((p) => {
        const c = findClip(p, clip.id)?.clip;
        if (!c) return p;
        const t = clipSteps(c, live.current.time);
        return replaceClip(p, clip.id, [{ ...c, notes: fn(c.notes ?? [], t) }]);
      }),
    [clip.id],
  );

  const getInstrument = useCallback(async (): Promise<Instrument | undefined> => {
    if (instrumentRef.current) return instrumentRef.current;
    const slot = projectStore.get().instruments.find((s) => s.id === track?.slotId);
    if (!slot) return undefined;
    const engine = getEngine();
    await engine.resume();
    let instrument: Instrument;
    try {
      instrument = engine.getInstrument(slot.id);
    } catch {
      instrument = await ensureInstrument(slot.kind);
    }
    instrumentRef.current = instrument;
    return instrument;
  }, [track?.slotId]);

  const audition = useCallback(
    (pitch: number, velocity = DEFAULT_VELOCITY) => {
      void getInstrument().then((i) => i?.noteOn({ note: pitch, velocity, duration: 0.3 }));
    },
    [getInstrument],
  );

  // Open on the clip's own note range (or around middle C when empty); waits for the first real height.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const place = () => {
      if (centred.current || el.clientHeight <= RULER_H) return;
      centred.current = true;
      const pitches = notes.map((n) => n.pitch);
      const middle = pitches.length ? (Math.min(...pitches) + Math.max(...pitches)) / 2 : MIDDLE_C;
      const rowTop = rowOf(Math.round(middle)) * ROW_H;
      el.scrollTop = Math.max(0, rowTop + ROW_H / 2 - (el.clientHeight - RULER_H) / 2);
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    return () => ro.disconnect();
    // Only the first open centres; later note edits must not move the view under the user's hands.
  }, []);

  const pointer = (e: { clientX: number; clientY: number }) => {
    const rect = gridEl.current!.getBoundingClientRect();
    const stepW = rect.width / total;
    return {
      x: e.clientX - rect.left,
      stepPos: (e.clientX - rect.left) / stepW,
      stepW,
      pitch: Math.min(HIGH, Math.max(LOW, HIGH - Math.floor((e.clientY - rect.top) / rowH))),
    };
  };

  const beginDrag = (d: Drag, e: ReactPointerEvent<HTMLElement>) => {
    gridEl.current!.setPointerCapture(e.pointerId);
    drag.current = d;
  };

  const onGridDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const p = pointer(e);
    const step = Math.floor(p.stepPos);
    if (noteAt(notes, p.pitch, step) >= 0) return;
    const start = Math.min(total - 1, snapStep(Math.floor(p.stepPos / grid) * grid, grid));
    const note: Note = { pitch: p.pitch, startStep: start, lengthSteps: grid, velocity: DEFAULT_VELOCITY };
    writeNotes((cur, t) => addNote(cur, note, t));
    audition(p.pitch);
    beginDrag({ mode: "resize", index: notes.length, startX: p.x, orig: note, moved: true, lastKey: "", lastPitch: p.pitch }, e);
    setCursor({ pitch: p.pitch, step });
  };

  const onNoteDown = (index: number, grip: boolean) => (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const p = pointer(e);
    beginDrag({ mode: grip ? "resize" : "move", index, startX: p.x, orig: notes[index], moved: false, lastKey: "", lastPitch: notes[index].pitch }, e);
  };

  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const p = pointer(e);
    if (!d.moved && Math.abs(p.x - d.startX) < 3) return;
    d.moved = true;
    if (d.mode === "resize") {
      const length = Math.max(grid, Math.round((p.stepPos - d.orig.startStep) / grid) * grid);
      const key = `r${length}`;
      if (key === d.lastKey) return;
      d.lastKey = key;
      writeNotes((cur, t) => resizeNote(cur, d.index, length, t));
      return;
    }
    const start = snapStep(d.orig.startStep + (p.x - d.startX) / p.stepW, grid);
    const key = `m${p.pitch}:${start}`;
    if (key === d.lastKey) return;
    if (p.pitch !== d.lastPitch) {
      audition(p.pitch, d.orig.velocity);
      d.lastPitch = p.pitch;
    }
    d.lastKey = key;
    writeNotes((cur, t) => moveNote(cur, d.index, p.pitch, start, t));
  };

  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    if (gridEl.current?.hasPointerCapture(e.pointerId)) gridEl.current.releasePointerCapture(e.pointerId);
    // A click that never turned into a drag removes the note it landed on.
    if (d && !d.moved) writeNotes((cur) => removeNote(cur, d.index));
  };

  const onGridKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const c = cursor ?? { pitch: 60, step: 0 };
    const move = (dp: number, ds: number) => {
      e.preventDefault();
      const next = { pitch: Math.min(HIGH, Math.max(LOW, c.pitch + dp)), step: Math.min(total - 1, Math.max(0, c.step + ds)) };
      setCursor(next);
      const el = scroller.current;
      if (el) {
        const top = rowOf(next.pitch) * rowH;
        if (top < el.scrollTop) el.scrollTop = top;
        else if (top + rowH > el.scrollTop + el.clientHeight - RULER_H) el.scrollTop = top + rowH - (el.clientHeight - RULER_H);
      }
    };
    if (e.key === "ArrowUp") move(1, 0);
    else if (e.key === "ArrowDown") move(-1, 0);
    else if (e.key === "ArrowLeft") move(0, -grid);
    else if (e.key === "ArrowRight") move(0, grid);
    else if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      const hit = noteAt(notes, c.pitch, c.step);
      if (hit >= 0) writeNotes((cur) => removeNote(cur, hit));
      else {
        writeNotes((cur, t) => addNote(cur, { pitch: c.pitch, startStep: c.step, lengthSteps: grid, velocity: DEFAULT_VELOCITY }, t));
        audition(c.pitch);
      }
      setCursor(c);
    }
  };

  // Velocity lane: pick the note under the pointer, then drag vertically.
  const velDrag = useRef<number | null>(null);
  const velFrom = (e: { clientY: number }) => {
    const rect = lane.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0.02, 1 - (e.clientY - rect.top) / rect.height));
  };
  const onLaneDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!notes.length) return;
    const rect = lane.current!.getBoundingClientRect();
    const step = ((e.clientX - rect.left) / rect.width) * total;
    let best = -1;
    let bestDist = Infinity;
    notes.forEach((n, i) => {
      const dist = Math.abs(n.startStep + 0.5 - step);
      if (dist <= bestDist) {
        best = i;
        bestDist = dist;
      }
    });
    if (best < 0) return;
    lane.current!.setPointerCapture(e.pointerId);
    velDrag.current = best;
    const index = best;
    const v = velFrom(e);
    writeNotes((cur) => setNoteVelocity(cur, index, v));
  };
  const onLaneMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const index = velDrag.current;
    if (index === null) return;
    const v = velFrom(e);
    writeNotes((cur) => setNoteVelocity(cur, index, v));
  };
  const onLaneUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    velDrag.current = null;
    if (lane.current?.hasPointerCapture(e.pointerId)) lane.current.releasePointerCapture(e.pointerId);
  };

  // Playhead and end-of-clip check for recording, straight to the DOM.
  useRaf(() => {
    const engine = peekEngine();
    const { clip: c, time: tb, total: tot } = live.current;
    const rel = engine ? engine.clock.position() - (c.startBar - 1) * tb.beatsPerBar * 4 : -1;
    const el = roll.current;
    if (el) {
      const visible = engine !== undefined && rel >= 0 && rel <= tot;
      el.style.display = visible ? "block" : "none";
      if (visible) el.style.left = `${(rel / tot) * 100}%`;
    }
    if (recorderRef.current && engine && rel >= tot) void stopRecording();
  });

  const relStep = (): number => {
    const engine = getEngine();
    const { clip: c, time: tb, total: tot } = live.current;
    return Math.min(tot, engine.clock.position() - (c.startBar - 1) * tb.beatsPerBar * 4);
  };

  const press = (pitch: number, velocity: number) => {
    const session = recorderRef.current;
    if (!session) return;
    const rel = relStep();
    if (rel >= 0) session.recorder.noteOn(pitch, velocity, rel);
    void getInstrument().then((i) => i?.noteOn({ note: pitch, velocity }));
  };

  const release = (pitch: number) => {
    const session = recorderRef.current;
    if (!session) return;
    instrumentRef.current?.noteOff(pitch);
    const note = session.recorder.noteOff(pitch, relStep());
    if (note) writeNotes((cur, t) => addNote(cur, note, t));
  };

  async function stopRecording(): Promise<void> {
    const session = recorderRef.current;
    if (!session) return;
    recorderRef.current = null;
    const rest = session.recorder.releaseAll(relStep());
    if (rest.length) writeNotes((cur, t) => rest.reduce((acc, n) => addNote(acc, n, t), [...cur]));
    session.midi?.close();
    instrumentRef.current?.allNotesOff();
    if (session.startedTransport && peekEngine()?.clock.playing) await togglePlay();
    setRecording(false);
    setStatus(KEYBOARD_HINT);
  }

  const startRecording = async () => {
    try {
      const engine = getEngine();
      await engine.resume();
      await getInstrument();
      if (!instrumentRef.current) {
        notify("This clip's track has no instrument to play, so there is nothing to record through.");
        return;
      }
      const recorder = new NoteRecorder(live.current.grid, live.current.total);
      const session: NonNullable<typeof recorderRef.current> = { recorder, startedTransport: false };
      recorderRef.current = session;
      setRecording(true);
      const clipStart = (clip.startBar - 1) * time.beatsPerBar * 4;
      if (!engine.clock.playing) {
        engine.clock.seek(clipStart);
        await togglePlay();
        session.startedTransport = true;
      }
      const onMidi = (e: MidiEvent) => {
        if (e.kind === "on") press(e.pitch, e.velocity);
        else if (e.kind === "off") release(e.pitch);
        else for (const p of [...Array(128).keys()]) release(p);
      };
      const midi = await connectMidi(onMidi);
      if (recorderRef.current === session) session.midi = midi;
      else midi.close();
      setStatus(midi.message);
    } catch (err) {
      recorderRef.current = null;
      setRecording(false);
      notify(err instanceof Error ? err.message : "Recording could not start.");
    }
  };

  useEffect(() => {
    if (!recording) return;
    const down = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      if (e.key === "Escape") {
        void stopRecording();
        return;
      }
      const pitch = KEY_TO_NOTE[e.key.toLowerCase()];
      if (pitch === undefined) return;
      e.preventDefault();
      press(pitch, RECORD_VELOCITY);
    };
    const up = (e: KeyboardEvent) => {
      const pitch = KEY_TO_NOTE[e.key.toLowerCase()];
      if (pitch !== undefined) release(pitch);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
    // The handlers only read refs and stable callbacks, so they are bound once per recording.
  }, [recording]);

  useEffect(
    () => () => {
      void stopRecording();
    },
    [],
  );

  const stepsLabel = `${total} steps`;
  const barLines = Math.round(time.beatsPerBar * 4);

  const controls = (
    <div className="ce-tools-inner" role="group" aria-label="Piano roll controls">
      <span className="ce-label">Grid</span>
      <Seg<NoteGrid> label="Grid" className="ce-seg" value={grid} onChange={setGrid} options={GRIDS} />
      <span className="ce-label">Bars</span>
      <Seg<number>
        label="Clip length in bars"
        className="ce-seg"
        value={LENGTHS.includes(clip.lengthBars as (typeof LENGTHS)[number]) ? clip.lengthBars : 0}
        onChange={(bars) =>
          projectStore.set((p) => {
            const c = findClip(p, clip.id)?.clip;
            return c ? replaceClip(p, clip.id, [setMidiLength(c, bars, time)]) : p;
          })
        }
        options={LENGTHS.map((bars) => ({ value: bars, label: String(bars) }))}
      />
      <Button className="ce-btn" onClick={() => writeNotes((cur, t) => quantize(cur, grid, t))} title="Snap every note to the grid">
        Quantize
      </Button>
      <Button className="ce-btn" onClick={() => writeNotes(() => [])} disabled={!notes.length} variant="danger">
        Clear
      </Button>
      <Button
        className="ce-btn"
        variant={recording ? "primary" : "ghost"}
        title={`Record notes as you play. ${KEYBOARD_HINT}`}
        onClick={() => (recording ? void stopRecording() : void startRecording())}
      >
        {recording ? "Stop" : "Record"}
      </Button>
    </div>
  );
  const barLabels = Array.from({ length: Math.ceil(total / barLines) }, (_, i) => i);

  return (
    <>
      {toolbar && createPortal(controls, toolbar)}
      {recording && <p className="ce-status" role="status">{status}</p>}

      <div className="ce-roll">
        <div ref={scroller} className="ce-roll-scroll">
          <div className="ce-ruler" style={{ height: RULER_H, "--steps": total, "--bar": barLines } as CSSProperties}>
            <div className="ce-ruler-corner" />
            <div className="ce-ruler-bars">
              {barLabels.map((i) => (
                <span key={i} style={{ left: `${((i * barLines) / total) * 100}%` }}>
                  {i + 1}
                </span>
              ))}
            </div>
          </div>
          <div className="ce-roll-inner" style={{ height: ROWS * rowH }}>
            <div className="ce-keys" aria-hidden="true">
              {Array.from({ length: ROWS }, (_, r) => {
                const pitch = HIGH - r;
                const black = isBlackKey(pitch);
                const label = pitch % 12 === 0 ? noteName(pitch) : "";
                return (
                  <div key={pitch} className={`ce-key ${black ? "black" : ""}`} style={{ height: rowH }}>
                    {label}
                  </div>
                );
              })}
            </div>
            <div
              ref={gridEl}
              className="ce-grid"
              role="application"
              tabIndex={0}
              aria-label={`Piano roll, ${stepsLabel}. Click to add or remove notes. Arrow keys move the cursor, space adds or removes a note.`}
              style={{ "--steps": total, "--bar": barLines, "--row": `${rowH}px` } as CSSProperties}
              onPointerDown={onGridDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
              onKeyDown={onGridKey}
            >
              {Array.from({ length: ROWS }, (_, r) => (
                <div key={r} className={`ce-row-bg ${isBlackKey(HIGH - r) ? "black" : ""}`} style={{ height: rowH }} />
              ))}
              {notes.map((n, i) => (
                <div
                  key={i}
                  className="ce-note"
                  role="img"
                  aria-label={`${noteName(n.pitch)}, step ${n.startStep + 1}, ${n.lengthSteps} long`}
                  style={{
                    top: rowOf(n.pitch) * rowH + 2,
                    height: rowH - 4,
                    left: `${(n.startStep / total) * 100}%`,
                    width: `${(n.lengthSteps / total) * 100}%`,
                    opacity: 0.55 + 0.45 * n.velocity,
                  }}
                  onPointerDown={onNoteDown(i, false)}
                >
                  <span className="ce-grip" onPointerDown={onNoteDown(i, true)} />
                </div>
              ))}
              {cursor && (
                <div
                  className="ce-cursor"
                  style={{ top: rowOf(cursor.pitch) * rowH, height: rowH, left: `${(cursor.step / total) * 100}%`, width: `${(grid / total) * 100}%` }}
                />
              )}
              <div ref={roll} className="ce-playhead" style={{ display: "none" }} />
            </div>
          </div>
        </div>
      </div>

      <div className="ce-vel-row">
        <div className="ce-vel-label">Velocity</div>
        <div
          ref={lane}
          className="ce-vel"
          role="group"
          aria-label="Velocity of each note. Drag a bar up or down."
          style={{ "--steps": total, "--bar": barLines } as CSSProperties}
          onPointerDown={onLaneDown}
          onPointerMove={onLaneMove}
          onPointerUp={onLaneUp}
          onPointerCancel={onLaneUp}
        >
          {notes.map((n, i) => (
            <div
              key={i}
              className="ce-vel-bar"
              role="slider"
              tabIndex={0}
              aria-label={`Velocity of ${noteName(n.pitch)} at step ${n.startStep + 1}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(n.velocity * 100)}
              style={{ left: `${(n.startStep / total) * 100}%`, height: `${n.velocity * 100}%` }}
              onKeyDown={(e) => {
                const dir = e.key === "ArrowUp" ? 1 : e.key === "ArrowDown" ? -1 : 0;
                if (!dir) return;
                e.preventDefault();
                writeNotes((cur) => setNoteVelocity(cur, i, cur[i].velocity + dir * 0.05));
              }}
            />
          ))}
        </div>
      </div>
    </>
  );
}
