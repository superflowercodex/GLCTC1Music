import { useMemo, useRef, useState, type CSSProperties } from "react";
import { getEngine } from "../audio/engine";
import { showToast } from "../audio/media";
import { getPerformanceRecorder, parseTake, PerformanceError, serializeTake } from "../audio/performance";
import { togglePlay } from "../audio/transport";
import { projectStore } from "../store/project";
import { useStore } from "../store/store";
import { Switch } from "../ui/controls";
import { downloadBlob, safeFileName } from "./download";
import { Sheet } from "./Sheet";

const LANE_COLORS = ["#79ebff", "#8e7cff", "#ff63d8", "#7cf0c0", "#ffd36a"];

export function PerformanceSheet({ onClose }: { onClose: () => void }) {
  const recorder = useMemo(() => getPerformanceRecorder(), []);
  const state = useStore(recorder.state, (s) => s);
  const [error, setError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  // Lanes are read again whenever the event count or layer count changes.
  const lanes = useMemo(() => recorder.lanes(), [recorder, state.events, state.layers]);
  const total = Math.max(8, Math.ceil(lanes.reduce((max, l) => Math.max(max, ...l.beats), 0) + 1));

  const record = async (): Promise<void> => {
    setError(null);
    try {
      if (state.recording) {
        recorder.stopLayer();
        // Hearing the layer you just played is the point of recording it.
        recorder.startReplay();
        return;
      }
      recorder.arm();
      const engine = getEngine();
      await engine.resume();
      if (!engine.clock.playing) await togglePlay();
      recorder.startLayer();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The recorder could not start.");
    }
  };

  const share = (): void => {
    const take = recorder.take(projectStore.get().bpm);
    if (take.events.length === 0) {
      showToast("Nothing recorded yet. Press Record layer and move a knob while the song plays.");
      return;
    }
    downloadBlob(new Blob([serializeTake(take)], { type: "application/json" }), `${safeFileName(projectStore.get().name)} performance.json`);
  };

  const importTake = async (picked: File | undefined): Promise<void> => {
    if (!picked) return;
    setError(null);
    try {
      const { accepted, rejected } = recorder.load(parseTake(await picked.text()));
      showToast(rejected > 0 ? `Imported ${accepted} moves. ${rejected} were for controls that are not in this project and were ignored.` : `Imported ${accepted} moves.`);
    } catch (err) {
      setError(err instanceof PerformanceError || err instanceof Error ? err.message : "That file could not be imported.");
    } finally {
      if (file.current) file.current.value = "";
    }
  };

  return (
    <Sheet title="Performance recorder" subtitle="Locked to the transport" onClose={onClose}>
      <p className="perf-note">Move any knob or fader while it records. Playback repeats your moves exactly, bar for bar.</p>
      <div className="lanes" role="list" aria-label="Recorded moves">
        {lanes.length === 0 && <p className="field-help">No moves recorded yet.</p>}
        {lanes.map((lane, i) => (
          <div key={lane.target} className="lane" role="listitem" style={{ "--c": LANE_COLORS[i % LANE_COLORS.length] } as CSSProperties}>
            <span className="lane-name" title={lane.label}>
              {lane.label}
            </span>
            <div className="lane-track" aria-label={`${lane.beats.length} moves`}>
              {lane.beats.map((beat, j) => (
                <i key={j} style={{ left: `${(beat / total) * 100}%` }} />
              ))}
            </div>
          </div>
        ))}
      </div>
      <Switch
        label={`Replay on play${state.layers > 0 ? ` (${state.layers} layer${state.layers === 1 ? "" : "s"})` : ""}`}
        checked={state.replaying}
        onChange={(on) => (on ? recorder.startReplay() : recorder.stopReplayNow())}
      />
      {error && (
        <p className="sheet-alert" role="alert">
          {error}
        </p>
      )}
      <div className="sheet-actions">
        <button type="button" className="btn btn-ghost" style={{ flex: 1, height: 50 }} aria-pressed={state.armed} onClick={() => (state.armed ? recorder.disarm() : recorder.arm())}>
          {state.armed ? "Armed" : "Arm"}
        </button>
        <button type="button" data-autofocus className="btn btn-record" style={{ flex: 1, height: 50 }} onClick={() => void record()}>
          {state.recording ? "Stop layer" : "Record layer"}
        </button>
        <button type="button" className="btn btn-ghost" style={{ height: 50 }} onClick={share}>
          Share take
        </button>
      </div>
      <div className="sheet-actions">
        <button type="button" className="btn btn-ghost" onClick={() => file.current?.click()}>
          Import take
        </button>
        <button type="button" className="btn btn-ghost" disabled={state.layers === 0 || state.recording} onClick={() => recorder.removeLastLayer()}>
          Remove last layer
        </button>
        <button type="button" className="btn btn-ghost" disabled={state.layers === 0 && state.events === 0} onClick={() => recorder.clear()}>
          Clear
        </button>
        <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => void importTake(e.target.files?.[0])} />
      </div>
    </Sheet>
  );
}
