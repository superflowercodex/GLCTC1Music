import { metronomeStore } from "../../audio/arrangementPlayback";
import { setLoop } from "../../project/actions";
import { redo, undo, useCanRedo, useCanUndo } from "../../project/history";
import { projectStore } from "../../store/project";
import { useStore } from "../../store/store";
import { IconButton } from "../../ui/controls";
import { MetronomeIcon, ZoomIcon } from "./icons";
import { arrangeSettings, setZoom } from "./settings";
import { GRID_OPTIONS, TIME_SIGNATURES, ZOOM } from "./timeline";

/** Undo, snap, grid, time signature and zoom: the controls that live in the room header. */
export function HeaderTools() {
  const canUndo = useCanUndo();
  const canRedo = useCanRedo();
  const { snap, gridBeats, pxPerBeat, avoidOverlaps } = useStore(arrangeSettings, (s) => s);
  const beatsPerBar = useStore(projectStore, (p) => p.beatsPerBar);

  return (
    <div className="arr-tools" role="toolbar" aria-label="Arrange tools">
      <div className="tool-group">
        <button type="button" className="tb-btn" aria-label="Undo" title="Undo (Cmd/Ctrl-Z)" disabled={!canUndo} onClick={() => undo()}>
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3" />
          </svg>
        </button>
        <button type="button" className="tb-btn" aria-label="Redo" title="Redo (Shift-Cmd/Ctrl-Z)" disabled={!canRedo} onClick={() => redo()}>
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M15 14l5-5-5-5M20 9H10a6 6 0 000 12h3" />
          </svg>
        </button>
      </div>
      <div className="tool-group">
        <button
          type="button"
          className={`tb-btn tb-snap${snap ? " on" : ""}`}
          role="switch"
          aria-checked={snap}
          onClick={() => arrangeSettings.set((s) => ({ ...s, snap: !s.snap }))}
        >
          Snap
        </button>
        <button
          type="button"
          className={`tb-btn${avoidOverlaps ? " on" : ""}`}
          role="switch"
          aria-checked={avoidOverlaps}
          aria-label="Avoid overlaps"
          title="Avoid overlaps: drags and pastes slide to the nearest free spot"
          onClick={() => arrangeSettings.set((s) => ({ ...s, avoidOverlaps: !s.avoidOverlaps }))}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <rect x="2.5" y="7" width="8" height="10" rx="2" />
            <rect x="13.5" y="7" width="8" height="10" rx="2" />
          </svg>
        </button>
        <label className="tool-select">
          <span className="sr-only">Grid size</span>
          <select
            value={gridBeats}
            onChange={(e) => arrangeSettings.set((s) => ({ ...s, gridBeats: Number(e.target.value) }))}
            aria-label="Grid size"
          >
            {GRID_OPTIONS.map((g) => (
              <option key={g.value} value={g.value}>
                {g.label}
              </option>
            ))}
          </select>
        </label>
        <label className="tool-select">
          <span className="sr-only">Time signature</span>
          <select
            value={beatsPerBar}
            onChange={(e) => projectStore.set((p) => ({ ...p, beatsPerBar: Number(e.target.value) }))}
            aria-label="Time signature"
          >
            {TIME_SIGNATURES.map((n) => (
              <option key={n} value={n}>
                {n}/4
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="tool-group">
        <button
          type="button"
          className="tb-btn"
          aria-label="Zoom out"
          title="Zoom out"
          disabled={pxPerBeat <= ZOOM.min}
          onClick={() => setZoom(pxPerBeat - ZOOM.step)}
        >
          <ZoomIcon plus={false} />
        </button>
        <button
          type="button"
          className="tb-btn"
          aria-label="Zoom in"
          title="Zoom in"
          disabled={pxPerBeat >= ZOOM.max}
          onClick={() => setZoom(pxPerBeat + ZOOM.step)}
        >
          <ZoomIcon plus />
        </button>
        <button type="button" className="tb-btn tool-fit" title="Zoom to fit the whole song" onClick={() => window.dispatchEvent(new Event("arrange-fit"))}>
          Fit
        </button>
      </div>
    </div>
  );
}

/** Loop and metronome sit in the transport footer next to play. */
export function FooterTools() {
  const loopOn = useStore(projectStore, (p) => p.loop.on);
  const click = useStore(metronomeStore, (m) => m.on);
  return (
    <>
      <IconButton
        icon="loop"
        label={loopOn ? "Loop on" : "Loop off"}
        active={loopOn}
        onClick={() => projectStore.set((p) => setLoop(p, { on: !p.loop.on }))}
      />
      <button
        type="button"
        className={`icon-btn${click ? " on" : ""}`}
        aria-label={click ? "Metronome on" : "Metronome off"}
        aria-pressed={click}
        title="Metronome"
        onClick={() => metronomeStore.set({ on: !click })}
      >
        <MetronomeIcon />
      </button>
    </>
  );
}
