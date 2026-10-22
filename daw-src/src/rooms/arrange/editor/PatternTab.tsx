import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { peekEngine } from "../../../audio/engine";
import { patternAtStep } from "../../../audio/clipPlayer";
import { instrumentInfo } from "../../../audio/instruments/registry";
import type { GalacticOne } from "../../../audio/instruments/galacticOne";
import { degreeOfOffset, offsetOfDegree, PATTERN_LENGTHS } from "../../../audio/instruments/synth/patternGen";
import { noteName, scaleNote } from "../../../audio/instruments/synth/scales";
import type { Instrument, InstrumentState } from "../../../audio/types";
import { setSlotState } from "../../../project/actions";
import { ensureInstrument } from "../../../project/instruments";
import type { Clip, InstrumentSlot, Track } from "../../../project/model";
import { instrumentHref } from "../../../rooms";
import { projectStore } from "../../../store/project";
import { useStore } from "../../../store/store";
import { useInstrument, useRaf } from "../../../ui/hooks";
import { useEdgeFade } from "../../../ui/useEdgeFade";
import {
  acidSteps,
  clipsUsingPattern,
  drumCell,
  drumRows,
  drumStepCount,
  galacticPattern,
  leadPattern,
  makeUniqueCopy,
  nextDrumValue,
  patternCount,
  patternFamily,
  patternLetter,
  setAcidStep,
  setDrumCell,
  setGalacticLength,
  setGalacticStep,
  tapLeadStep,
} from "../patternEdit";
import { commitPatternEdit, commitPatternProject } from "../patternLive";
import { notify } from "./shared";
import "./pattern.css";

const ROWS = 8;
const OCT_LABEL: Record<string, string> = { "-1": "−1", "0": "·", "1": "+1" };
const NEXT_OCT = { "-1": 0, "0": 1, "1": -1 } as const;

interface Props {
  clip: Clip;
  track: Track | undefined;
  /** The editor header's tool slot: the clip actions sit there, beside the tab switch. */
  toolbar: HTMLElement | null;
  /** The dialog footer: Make unique copy and Open in the instrument sit beside Done. */
  footer: HTMLElement | null;
}

/** The slot's live instrument; null until it exists. */
function useLive(slot: InstrumentSlot | undefined): Instrument | null {
  const [inst, setInst] = useState<Instrument | null>(null);
  const kind = slot?.kind;
  useEffect(() => {
    if (!kind) return;
    let live = true;
    void ensureInstrument(kind).then((i) => live && setInst(i));
    return () => {
      live = false;
    };
  }, [kind]);
  return inst && inst.kind === kind ? inst : null;
}

/** The pattern step the transport is on when this pattern is the one playing, else -1. */
function arrangedStep(slotId: string, index: number, steps: number): number {
  const engine = peekEngine();
  if (!engine?.clock.playing) return -1;
  const step = Math.floor(engine.clock.position());
  return patternAtStep(projectStore.get(), slotId, step) === index ? step % steps : -1;
}

export function PatternTab({ clip, track, toolbar, footer }: Props) {
  const slot = useStore(projectStore, (p) => (track ? p.instruments.find((s) => s.trackId === track.id) : undefined));
  const users = useStore(projectStore, (p) => (track ? clipsUsingPattern(p, track.id, clip.patternIndex ?? 0).length : 0));
  const inst = useLive(slot);
  if (!slot || !track) return <div className="ce-empty">This pattern clip has no instrument on its track, so there is nothing to edit.</div>;
  if (!inst) return <div className="ce-empty">Waking up the instrument…</div>;
  return <PatternEditor clip={clip} track={track} slot={slot} inst={inst} users={users} toolbar={toolbar} footer={footer} />;
}

function PatternEditor({ clip, track, slot, inst, users, toolbar, footer }: { clip: Clip; track: Track; slot: InstrumentSlot; inst: Instrument; users: number; toolbar: HTMLElement | null; footer: HTMLElement | null }) {
  const [bar, setBar] = useState<HTMLElement | null>(null);
  const version = useInstrument(inst);
  const state = useMemo(() => inst.serialize(), [inst, version]);
  const index = clip.patternIndex ?? 0;
  const letter = patternLetter(index);
  const info = instrumentInfo(slot.kind);
  const family = patternFamily(slot.kind);
  const count = patternCount(state);
  const edit = (fn: (s: InstrumentState) => InstrumentState) => commitPatternEdit(slot.id, inst, fn);

  const uniqueCopy = () => {
    // Build on the live sound, not the saved copy, which can lag it by a moment.
    const base = setSlotState(projectStore.get(), slot.id, structuredClone(inst.serialize()));
    const result = makeUniqueCopy(base, clip.id, info.name);
    if (!result.ok) {
      notify(result.reason);
      return;
    }
    commitPatternProject(slot.id, inst, result.project);
    notify(`This clip now plays its own copy, pattern ${patternLetter(result.index)}.`);
  };
  const openInstrument = () => {
    if (index < count && inst.activePattern !== index) inst.setPattern(index);
    window.location.hash = instrumentHref(slot.kind);
  };

  const editable = family !== "none" && index < count;
  const shared = users > 1;
  return (
    <div className="pe" style={{ "--c": track.color, "--k": track.color } as CSSProperties}>
      {toolbar && createPortal(<div className="ce-tools-inner pe-bar" ref={setBar} />, toolbar)}
      {footer &&
        createPortal(
          <>
            {editable && (
              <button type="button" className="btn btn-sm" onClick={uniqueCopy} disabled={!shared} data-tip={shared ? `Copy pattern ${letter} to a free pattern and play the copy here only` : "Only this clip plays this pattern already"}>
                Make unique copy
              </button>
            )}
            <button type="button" className="btn btn-sm" onClick={openInstrument}>
              Open in {info.name}
            </button>
          </>,
          footer,
        )}
      {!editable ? (
        <div className="ce-empty">
          {family === "none"
            ? `${info.name} plays recorded takes and pads rather than step patterns. Open it to change what this clip plays.`
            : `Pattern ${letter} does not exist on ${info.name}. Open the instrument to pick another.`}
        </div>
      ) : family === "drums" ? (
        <DrumBody slot={slot} inst={inst} state={state} index={index} onEdit={edit} bar={bar} />
      ) : family === "acid" ? (
        <AcidBody slot={slot} inst={inst} state={state} index={index} onEdit={edit} bar={bar} />
      ) : family === "galactic" ? (
        <GalacticBody inst={inst} state={state} index={index} onEdit={edit} bar={bar} />
      ) : (
        <LeadBody slot={slot} inst={inst} state={state} onEdit={edit} bar={bar} />
      )}
    </div>
  );
}

interface BodyProps {
  slot: InstrumentSlot;
  inst: Instrument;
  state: InstrumentState;
  index: number;
  onEdit: (fn: (s: InstrumentState) => InstrumentState) => void;
  /** Where a body puts its paging and length keys: the pattern header line. */
  bar: HTMLElement | null;
}

function Pages({ pages, page, onPage, size }: { pages: number; page: number; onPage: (p: number) => void; size: number }) {
  if (pages <= 1) return null;
  return (
    <div className="pe-keys" role="radiogroup" aria-label="Page">
      <span className="pe-cap">Page</span>
      {Array.from({ length: pages }, (_, p) => (
        <button key={p} type="button" role="radio" aria-checked={p === page} aria-label={`Steps ${p * size + 1} to ${(p + 1) * size}`} className={`mini-key${p === page ? " on" : ""}`} onClick={() => onPage(p)}>
          {p + 1}
        </button>
      ))}
    </div>
  );
}

/** Portals a body's keys into the pattern header line. */
function Bar({ at, children }: { at: HTMLElement | null; children: ReactNode }) {
  return at ? createPortal(children, at) : null;
}

/**
 * Scroll area whose height is always a whole number of rows (plus its header), so the drawer never shows a
 * half-cut row; the rows beyond scroll inside it with a faded edge. Sized from the parent, since a box sized by
 * its own content cannot measure the room it has.
 */
function useWholeRows(scroller: React.RefObject<HTMLDivElement>, rows: number): void {
  useLayoutEffect(() => {
    const el = scroller.current;
    const parent = el?.parentElement;
    if (!el || !parent) return;
    const fit = () => {
      // Rows size with the keys (CSS), so read the pitch from a real row.
      const pitch = el.querySelector<HTMLElement>(".pe-dg > .pe-dg-row")?.offsetHeight || 40;
      const room = parent.getBoundingClientRect().bottom - el.getBoundingClientRect().top - 2;
      const n = Math.max(2, Math.min(rows, Math.floor(room / pitch)));
      el.style.height = `${n * pitch}px`;
      el.toggleAttribute("data-more", n < rows);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(parent);
    return () => ro.disconnect();
  }, [scroller, rows]);
  useEdgeFade(scroller, "y");
}

/** Lights the playing step column straight from the clock, never through React. */
function usePlayKey(root: React.RefObject<HTMLElement>, read: () => number): void {
  const last = useRef(-1);
  useRaf(() => {
    const el = root.current;
    if (!el) return;
    const col = read();
    if (col === last.current) return;
    el.querySelectorAll(".now").forEach((n) => n.classList.remove("now"));
    if (col >= 0) el.querySelectorAll(`[data-c="${col}"]`).forEach((n) => n.classList.add("now"));
    last.current = col;
  });
}

/** Steps per view, as in the drum rooms: keys stay square and finger-sized. */
const DRUM_PAGE = 16;

function DrumBody({ slot, inst, state, index, onEdit, bar }: BodyProps) {
  const steps = drumStepCount(state);
  const cols = Math.min(steps, DRUM_PAGE);
  const pages = steps / cols;
  const [page, setPage] = useState(0);
  const shown = Math.min(page, pages - 1);
  const rows = drumRows(state);
  const selected = (state.data as { voice?: number } | undefined)?.voice ?? -1;
  const drum = inst as Instrument & { selectVoice(i: number): void };
  const scroller = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLDivElement>(null);
  useWholeRows(scroller, rows.length);
  usePlayKey(head, () => {
    const ix = arrangedStep(slot.id, index, steps);
    return ix >= 0 && Math.floor(ix / cols) === shown ? ix % cols : -1;
  });
  usePlayKey(scroller, () => {
    const ix = arrangedStep(slot.id, index, steps);
    return ix >= 0 && Math.floor(ix / cols) === shown ? ix % cols : -1;
  });
  const hint = slot.kind === "pad64" ? "Tap: on, accent, off" : slot.kind === "drum80la8" ? "Shift-tap: velocity" : "Shift-tap: accent";
  const groups = Array.from({ length: cols / 4 }, (_, g) => g);
  const value = (r: number, c: number) => drumCell(state, index, r, shown * cols + c);
  return (
    <div className="pe-body">
      <Bar at={bar}>
        <Pages pages={pages} page={shown} onPage={setPage} size={cols} />
      </Bar>
      <div className="pe-dg-row pe-dg-head" aria-hidden="true" ref={head}>
        <span className="pe-dg-hint">{hint}</span>
        {groups.map((g) => (
          <div className="pe-dg-group" key={g}>
            {[0, 1, 2, 3].map((k) => (
              <span key={k} className="mono" data-c={g * 4 + k}>
                {shown * cols + g * 4 + k + 1}
              </span>
            ))}
          </div>
        ))}
      </div>
      <div className="pe-scroll fade-y" ref={scroller}>
        <div className="pe-dg" role="grid" aria-label={`Pattern ${patternLetter(index)}, steps ${shown * cols + 1} to ${shown * cols + cols}`}>
          {rows.map((row, r) => (
            <div className="pe-dg-row" key={r} role="row" style={{ "--c": row.color } as CSSProperties}>
              <button type="button" className={`pe-dg-label${r === selected ? " sel" : ""}`} aria-pressed={r === selected} onClick={() => drum.selectVoice(r)}>
                <span className="pe-dot" />
                <span className="pe-dg-name">{row.label}</span>
                {row.sub && <span className="pe-dg-sub">{row.sub}</span>}
              </button>
              {groups.map((g) => (
                <div className="pe-dg-group" key={g}>
                  {[0, 1, 2, 3].map((k) => {
                    const c = g * 4 + k;
                    const v = value(r, c);
                    const lit = slot.kind === "drum80la8" ? (v > 0 ? (v >= 0.99 ? 2 : 1) : 0) : v === 2 ? 2 : v > 0 ? 1 : 0;
                    return (
                      <button
                        key={c}
                        type="button"
                        role="gridcell"
                        className="pe-key"
                        data-c={c}
                        data-v={lit}
                        style={lit && slot.kind === "drum80la8" ? ({ "--lv": v } as CSSProperties) : undefined}
                        aria-pressed={lit > 0}
                        aria-label={`${row.label} step ${shown * cols + c + 1}${lit === 2 ? ", accent" : ""}`}
                        onClick={(e) => {
                          const step = shown * cols + c;
                          onEdit((s) => setDrumCell(s, index, r, step, nextDrumValue(slot.kind, drumCell(s, index, r, step), e.shiftKey)));
                        }}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AcidBody({ slot, inst, state, index, onEdit, bar }: BodyProps) {
  const root = useRef<HTMLDivElement>(null);
  const steps = acidSteps(state, index);
  usePlayKey(root, () => arrangedStep(slot.id, index, steps.length || 16));
  const preview = (note: number) => inst.noteOn({ note, velocity: 0.8, duration: 0.2 });
  return (
    <div className="pe-body">
      <Bar at={bar}>
        <span className="pe-cap">Note: click raises, Shift-click lowers</span>
      </Bar>
      <div className="pe-scroll pe-acid-wrap">
        <div className="pe-acid" ref={root} role="group" aria-label={`30LEE pattern ${patternLetter(index)}`}>
          <div className="pe-legend" aria-hidden="true">
            <span>Step</span>
            <span>Play</span>
            <span>Note</span>
            <span>Octave</span>
            <span>Accent</span>
            <span>Slide</span>
          </div>
          {steps.map((st, i) => {
            const n = String(i + 1).padStart(2, "0");
            return (
              <div key={i} className={`pe-acol${i % 4 === 0 && i > 0 ? " grp" : ""}`} data-c={i}>
                <span className="pe-num mono">{n}</span>
                <button type="button" className="pe-key" data-v={st.on ? 1 : 0} aria-pressed={st.on} aria-label={`Step ${n} play`} onClick={() => onEdit((s) => setAcidStep(s, index, i, { on: !st.on }))} />
                <button
                  type="button"
                  className={`pe-note mono${st.on ? "" : " off"}`}
                  aria-label={`Step ${n} note ${noteName(st.note, true)}; click to raise, shift-click to lower`}
                  onClick={(e) => {
                    const note = Math.max(24, Math.min(60, st.note + (e.shiftKey ? -1 : 1)));
                    onEdit((s) => setAcidStep(s, index, i, { note }));
                    preview(note + st.oct * 12);
                  }}
                >
                  {noteName(st.note)}
                </button>
                <button type="button" className="pe-note pe-oct mono" aria-label={`Step ${n} octave ${OCT_LABEL[String(st.oct)]}; click to change`} onClick={() => onEdit((s) => setAcidStep(s, index, i, { oct: NEXT_OCT[String(st.oct) as "-1" | "0" | "1"] }))}>
                  {OCT_LABEL[String(st.oct)]}
                </button>
                <button type="button" className="pe-key pe-flag" data-v={st.accent ? 1 : 0} aria-pressed={st.accent} aria-label={`Step ${n} accent`} onClick={() => onEdit((s) => setAcidStep(s, index, i, { accent: !st.accent }))} />
                <button type="button" className="pe-key pe-flag slide" data-v={st.slide ? 1 : 0} aria-pressed={st.slide} aria-label={`Step ${n} slide`} onClick={() => onEdit((s) => setAcidStep(s, index, i, { slide: !st.slide }))} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Rows of scale degrees over step columns, the layout Galactic One and 0010110 use in their rooms. */
function DegreeGrid({
  label,
  rowLabels,
  cols,
  offset,
  hint,
  isOn,
  isAccent,
  isOut,
  onCell,
  read,
}: {
  label: string;
  rowLabels: string[];
  cols: number;
  offset: number;
  hint: string;
  isOn: (step: number, row: number) => boolean;
  isAccent: (step: number) => boolean;
  isOut: (step: number) => boolean;
  onCell: (step: number, row: number, shift: boolean) => void;
  read: () => number;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLDivElement>(null);
  useWholeRows(scroller, rowLabels.length);
  const col = () => {
    const s = read();
    return s >= offset && s < offset + cols ? s - offset : -1;
  };
  usePlayKey(head, col);
  usePlayKey(scroller, col);
  const groups = Array.from({ length: Math.ceil(cols / 4) }, (_, g) => g);
  return (
    <>
      <div className="pe-dg-row pe-dg-head" aria-hidden="true" ref={head}>
        <span className="pe-dg-hint">{hint}</span>
        {groups.map((g) => (
          <div className="pe-dg-group" key={g}>
            {[0, 1, 2, 3].map((k) => (g * 4 + k < cols ? <span key={k} className="mono" data-c={g * 4 + k}>{offset + g * 4 + k + 1}</span> : null))}
          </div>
        ))}
      </div>
    <div className="pe-scroll fade-y" ref={scroller}>
      <div className="pe-dg pe-deg" role="grid" aria-label={label}>
        {rowLabels.map((rl, r) => (
          <div className="pe-dg-row" key={r} role="row">
            <span className="pe-dg-label plain mono">{rl}</span>
            {groups.map((g) => (
              <div className="pe-dg-group" key={g}>
                {[0, 1, 2, 3].map((k) => {
                  const c = g * 4 + k;
                  if (c >= cols) return null;
                  const step = offset + c;
                  const on = isOn(step, r);
                  return (
                    <button
                      key={c}
                      type="button"
                      role="gridcell"
                      data-c={c}
                      data-v={on ? (isAccent(step) ? 2 : 1) : 0}
                      disabled={isOut(step)}
                      aria-label={`Step ${step + 1} note ${rl}`}
                      aria-pressed={on}
                      className="pe-key"
                      onClick={(e) => onCell(step, r, e.shiftKey)}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
    </>
  );
}

function GalacticBody({ inst, state, index, onEdit, bar }: Omit<BodyProps, "slot">) {
  const synth = inst as GalacticOne;
  const pattern = galacticPattern(state, index);
  const [page, setPage] = useState(0);
  if (!pattern) return <div className="ce-empty">This bank is empty.</div>;
  const scale = Math.round(state.values["seq.scale"] ?? 0);
  const rootPc = Math.round(state.values["seq.root"] ?? 0);
  const octave = Math.round(state.values["seq.octave"] ?? 3);
  const cols = Math.min(pattern.len, DRUM_PAGE);
  const pages = pattern.len / cols;
  const shown = Math.min(page, pages - 1);
  const labels = Array.from({ length: ROWS }, (_, r) => noteName(rootPc + offsetOfDegree(ROWS - 1 - r, scale)));
  return (
    <div className="pe-body">
      <Bar at={bar}>
        <div className="pe-keys" role="radiogroup" aria-label="Pattern length">
          <span className="pe-cap">Length</span>
          {PATTERN_LENGTHS.map((len) => (
            <button key={len} type="button" role="radio" aria-checked={pattern.len === len} className={`mini-key${pattern.len === len ? " on" : ""}`} onClick={() => onEdit((s) => setGalacticLength(s, index, len))}>
              {len}
            </button>
          ))}
        </div>
        <Pages pages={pages} page={shown} onPage={setPage} size={cols} />
      </Bar>
      <DegreeGrid
        label={`Galactic One bank ${index + 1}`}
        rowLabels={labels}
        cols={cols}
        offset={shown * cols}
        hint="Shift-tap: accent"
        isOn={(step, r) => {
          const st = pattern.steps[step];
          return !!st?.on && step < pattern.len && degreeOfOffset(st.n, scale) === ROWS - 1 - r;
        }}
        isAccent={(step) => !!pattern.steps[step]?.accent}
        isOut={(step) => step >= pattern.len}
        onCell={(step, r, shift) => {
          const degree = ROWS - 1 - r;
          const st = pattern.steps[step];
          if (shift) {
            if (st.on) onEdit((s) => setGalacticStep(s, index, step, { accent: !st.accent }));
            return;
          }
          if (st.on && degreeOfOffset(st.n, scale) === degree) onEdit((s) => setGalacticStep(s, index, step, { on: false }));
          else {
            const n = offsetOfDegree(degree, scale);
            onEdit((s) => setGalacticStep(s, index, step, { on: true, n }));
            synth.noteOn({ note: (octave + 1) * 12 + rootPc + n, velocity: 0.8, duration: 0.18 });
          }
        }}
        read={() => {
          const ph = synth.playhead();
          return ph && Math.floor(ph.a / 100) === index ? ph.a % 100 : -1;
        }}
      />
    </div>
  );
}

function LeadBody({ slot, inst, state, onEdit, bar }: Omit<BodyProps, "index">) {
  const { steps, accents } = leadPattern(state);
  const loop = [4, 8, 12, 16][Math.round(state.values.loop ?? 3)] ?? 16;
  const scale = Math.round(state.values.scale ?? 0);
  const root = (Math.round(state.values.octave ?? 3) + 1) * 12 + Math.round(state.values.root ?? 0);
  const labels = Array.from({ length: ROWS }, (_, r) => noteName(scaleNote(root, scale, ROWS - 1 - r)));
  return (
    <div className="pe-body">
      <Bar at={bar}>
        <span className="pe-cap mono">Loop {loop} steps</span>
      </Bar>
      <DegreeGrid
        label="0010110 pattern"
        rowLabels={labels}
        cols={steps.length || 16}
        offset={0}
        hint="Shift-tap: accent"
        isOn={(step, r) => steps[step] === ROWS - r}
        isAccent={(step) => !!accents[step]}
        isOut={(step) => step >= loop}
        onCell={(step, r, shift) => {
          const degree = ROWS - r;
          if (!shift && steps[step] !== degree) inst.noteOn({ note: scaleNote(root, scale, degree - 1), velocity: 0.8, duration: 0.18 });
          onEdit((s) => tapLeadStep(s, step, degree, shift));
        }}
        read={() => arrangedStep(slot.id, 0, loop)}
      />
    </div>
  );
}
