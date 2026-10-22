import { useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { barBeat, setProjectBpm, stopAndRewind, tapTempo, togglePlay } from "../audio/transport";
import { peekEngine } from "../audio/engine";
import { projectStore } from "../store/project";
import { useStore } from "../store/store";
import { IconButton } from "./controls";
import { Icon } from "./Icon";
import { prefersReducedMotion, useRaf } from "./hooks";
import { dispatchDock, playerDock } from "./playerDock";
import { LedMeter } from "./LedMeter";
import { Cover } from "../gfx/Cover";
import { useProjectPalette } from "../gfx/useProjectPalette";
import { stepsPerBar, timelineEndBar } from "../project/actions";
import { InfoChip } from "./controls";

// masterLevel() is RMS; a sine's peak sits 3 dB above its RMS, so this keeps the LEDs near true peak.
const RMS_TO_PEAK = Math.SQRT2;
const masterPeak = (): number => (peekEngine()?.masterLevel() ?? 0) * RMS_TO_PEAK;

const DOCK_MS = 320;
const DOCK_EASE = "cubic-bezier(.22, 1, .36, 1)";

/**
 * The floating glass transport every room shares: play, stop, record, position, tempo and the master meter.
 * The chevron collapses it to a compact pill in the bottom-right corner (same element, laid out by CSS), so
 * Space, the keys and the play state never notice the switch.
 */
export function TransportBar({ onRecord, children }: { onRecord?: () => void; children?: ReactNode }) {
  const bpm = useStore(projectStore, (p) => p.bpm);
  const beatsPerBar = useStore(projectStore, (p) => p.beatsPerBar);
  const name = useStore(projectStore, (p) => p.name);
  const key = useStore(projectStore, (p) => p.key);
  const songSteps = useStore(projectStore, (p) => (timelineEndBar(p) - 1) * stepsPerBar(p));
  const palette = useProjectPalette();
  const pos = useRef<HTMLSpanElement>(null);
  const [playing, setPlaying] = useState(false);
  const minimised = useStore(playerDock, (d) => d.minimised);
  const root = useRef<HTMLElement>(null);
  const settled = useRef(minimised);

  // Own opacity and transform never touch the capsule's own backdrop blur, so the glass stays frosted while it morphs.
  useLayoutEffect(() => {
    if (settled.current === minimised) return;
    settled.current = minimised;
    const el = root.current;
    if (!el || prefersReducedMotion() || typeof el.animate !== "function") return;
    el.style.transformOrigin = "100% 100%";
    el.animate(
      [
        { opacity: 0.4, transform: "translateY(10px) scale(.94)" },
        { opacity: 1, transform: "none" },
      ],
      { duration: DOCK_MS, easing: DOCK_EASE },
    );
  }, [minimised]);

  // The pill itself is the expand target; its own buttons and the room's tools keep their jobs.
  const onPillClick = (e: ReactMouseEvent) => {
    if (minimised && !(e.target as Element).closest("button, input, label, .tp-extra")) dispatchDock("expand");
  };

  useRaf(() => {
    const engine = peekEngine();
    const step = engine ? engine.clock.position() : 0;
    const { bar, beat } = barBeat(step, beatsPerBar);
    const text = `${String(bar).padStart(2, "0")} · ${String(beat).padStart(2, "0")}`;
    // Writing the same text every frame still forces a layout and repaint, and a repaint under the glass
    // re-runs the backdrop blur, so only touch the DOM when the readout really changes.
    if (pos.current && pos.current.textContent !== text) pos.current.textContent = text;
    // Progress through the song, in thousandths so the bar only repaints when it visibly moves.
    const prog = songSteps > 0 ? String(Math.round(Math.min(1, step / songSteps) * 1000) / 1000) : "0";
    if (root.current && root.current.style.getPropertyValue("--prog") !== prog) root.current.style.setProperty("--prog", prog);
    const isPlaying = engine?.clock.playing ?? false;
    setPlaying((prev) => (prev === isPlaying ? prev : isPlaying));
  });

  return (
    <footer ref={root} className={`transport ${playing ? "is-playing" : ""} ${minimised ? "is-min" : ""} ${children ? "has-tools" : ""}`} onClick={onPillClick}>
      <span className="tp-prog" aria-hidden="true">
        <i />
      </span>
      <div className="tp-now">
        <span className="tp-cover">
          <Cover palette={palette} playing={playing} />
          <i className="tp-ring" aria-hidden="true" />
        </span>
        <div className="tp-now-t">
          <b>{name}</b>
          <InfoChip>{key}</InfoChip>
        </div>
      </div>
      <div className="tp-ctrls">
        <IconButton icon="rewind" label="Back to start" onClick={stopAndRewind} size={20} />
        <button type="button" className="play-btn" aria-label={playing ? "Pause" : "Play"} onClick={() => void togglePlay()}>
          <Icon name={playing ? "pause" : "play"} size={22} />
        </button>
        {onRecord && (
          <button type="button" className="rec-btn" aria-label="Record audio" title="Record audio" onClick={onRecord}>
            <span />
          </button>
        )}
      </div>
      <div className="tp-readout">
        <span className="tp-cap">Bar · Beat</span>
        <span ref={pos} className="mono transport-pos">
          01 · 01
        </span>
      </div>
      <label className="transport-bpm tp-readout">
        <span className="tp-cap">Tempo</span>
        <span className="tp-bpm-row">
          <input
            className="mono"
            type="number"
            min={30}
            max={300}
            step={0.1}
            value={bpm}
            onChange={(e) => setProjectBpm(Number(e.target.value))}
            aria-label="Tempo in beats per minute"
          />
          <span>BPM</span>
        </span>
      </label>
      <button type="button" className="btn btn-ghost btn-sm" onClick={tapTempo}>
        Tap
      </button>
      <LedMeter getLevel={masterPeak} label="Master output level" horizontal className="tp-meter" scale={{ segments: 20 }} />
      <span className="spacer" />
      <div className="tp-extra">{children}</div>
      <IconButton
        icon={minimised ? "chevron-up" : "chevron-down"}
        label={minimised ? "Expand player" : "Minimise player"}
        onClick={() => dispatchDock("toggle")}
        size={20}
        className="tp-min-btn"
      />
    </footer>
  );
}
