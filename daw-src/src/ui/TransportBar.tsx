import { useRef, useState, type ReactNode } from "react";
import { barBeat, setProjectBpm, stopAndRewind, tapTempo, togglePlay } from "../audio/transport";
import { peekEngine } from "../audio/engine";
import { projectStore } from "../store/project";
import { useStore } from "../store/store";
import { Button, IconButton } from "./controls";
import { Icon } from "./Icon";
import { useRaf } from "./hooks";

/** The footer every room shares: play, stop, record, position and tempo. */
export function TransportBar({ onRecord, children }: { onRecord?: () => void; children?: ReactNode }) {
  const bpm = useStore(projectStore, (p) => p.bpm);
  const beatsPerBar = useStore(projectStore, (p) => p.beatsPerBar);
  const pos = useRef<HTMLSpanElement>(null);
  const [playing, setPlaying] = useState(false);

  useRaf(() => {
    const engine = peekEngine();
    const step = engine ? engine.clock.position() : 0;
    const { bar, beat } = barBeat(step, beatsPerBar);
    if (pos.current) pos.current.textContent = `${String(bar).padStart(2, "0")} · ${String(beat).padStart(2, "0")}`;
    const isPlaying = engine?.clock.playing ?? false;
    setPlaying((prev) => (prev === isPlaying ? prev : isPlaying));
  });

  return (
    <footer className="transport panel">
      <IconButton icon="rewind" label="Back to start" onClick={stopAndRewind} />
      <button type="button" className="play-btn" aria-label={playing ? "Pause" : "Play"} onClick={() => void togglePlay()}>
        <Icon name={playing ? "pause" : "play"} size={24} />
      </button>
      {onRecord && (
        <button type="button" className="rec-btn" aria-label="Record" onClick={onRecord}>
          <span />
        </button>
      )}
      <span ref={pos} className="mono transport-pos">
        01 · 01
      </span>
      <label className="transport-bpm">
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
      </label>
      <Button onClick={tapTempo}>Tap</Button>
      <span className="spacer" />
      {children}
    </footer>
  );
}
