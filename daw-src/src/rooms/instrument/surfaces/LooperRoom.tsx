import { useRef, useState, type DragEvent } from "react";
import { Looper, PAD_BASE_NOTE } from "../../../audio/instruments/looper";
import { SCENES } from "../../../audio/instruments/voice/looperKits";
import { hasSample, type PadMode } from "../../../audio/instruments/voice/padPlayer";
import type { Instrument } from "../../../audio/types";
import { projectStore } from "../../../store/project";
import { useStore } from "../../../store/store";
import { Button, Seg, Slider } from "../../../ui/controls";
import { InstrumentShell } from "../InstrumentShell";
import { bounceLooper } from "../voice/bounce";
import { useComputerKeys } from "../voice/hooks";
import { PAD_KEYS, PadGrid } from "../voice/PadGrid";
import { ParamControl } from "../voice/ParamControl";
import { Waveform } from "../voice/Waveform";
import "../voice/voice.css";

const PALETTE = ["#79ebff", "#8e7cff", "#ff63d8", "#7cf0c0", "#ffd36a"];
const MODES: ReadonlyArray<{ value: PadMode; label: string }> = [
  { value: "loop", label: "Loop" },
  { value: "shot", label: "One-shot" },
  { value: "gate", label: "Hold" },
];
const HELP: Record<PadMode, string> = {
  shot: "Plays the whole sample once, every time you press.",
  loop: "Press once to start looping in time with the project. Press again to stop.",
  gate: "Plays only while you hold the pad down.",
};
const SCENE_NAMES = ["A", "B", "C", "D"];

const dB = (v: number) => (v <= 0.001 ? "−∞ dB" : `${20 * Math.log10(v) >= 0 ? "+" : "−"}${Math.abs(Math.round(20 * Math.log10(v) * 10) / 10)} dB`);

export default function LooperRoom({ instrument }: { instrument: Instrument }) {
  if (!(instrument instanceof Looper)) throw new TypeError("LooperRoom needs a Looper instrument");
  const looper = instrument;
  const [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const bpm = useStore(projectStore, (p) => p.bpm);
  const trackName = useStore(projectStore, (p) => p.tracks.find((t) => p.instruments.some((s) => s.id === t.slotId && s.kind === "looper"))?.name ?? "Looper");

  const pad = looper.pads[selected];
  const loaded = hasSample(pad);
  const color = PALETTE[selected % PALETTE.length];
  const seconds = looper.regionSeconds(selected);

  // Computer keys only exist while this room is mounted, and any held pad is released when it goes away.
  useComputerKeys(
    true,
    (key) => {
      const i = PAD_KEYS.indexOf(key as (typeof PAD_KEYS)[number]);
      if (i < 0) return;
      setSelected(i);
      looper.noteOn({ note: PAD_BASE_NOTE + i, velocity: 0.9 });
    },
    (key) => {
      const i = PAD_KEYS.indexOf(key as (typeof PAD_KEYS)[number]);
      if (i >= 0) looper.noteOff(PAD_BASE_NOTE + i);
    },
  );

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith("audio/"));
    // Several files fill consecutive pads from the selected one.
    files.slice(0, 16 - selected).forEach((file, n) => void looper.loadPadFile(selected + n, file));
  };

  const scene = looper.activePattern;
  const recording = looper.recordingPad;

  const right = (
    <>
      <div>
        <div className="voice-label">Pad {selected + 1}</div>
        <div className="module-title">{loaded ? pad.name || `Pad ${selected + 1}` : "Empty pad"}</div>
      </div>
      <div className="module-body scroll-y amber-sliders" style={{ flex: 1 }}>
        <div>
          <div className="voice-label" style={{ marginBottom: 8 }}>
            When you press it
          </div>
          <div className="voice-seg-amber">
            <Seg label="Pad mode" value={pad.mode} options={MODES} onChange={(mode) => looper.setPad(selected, { mode })} />
          </div>
          <div className="voice-note" style={{ marginTop: 10 }}>
            {HELP[pad.mode]}
          </div>
        </div>
        <Slider label="Volume" value={pad.volume} min={0} max={1.5} step={0.01} onChange={(volume) => looper.setPad(selected, { volume })} format={dB} />
        <Slider label="Pitch" value={pad.pitch} min={-24} max={24} step={1} onChange={(pitch) => looper.setPad(selected, { pitch })} format={(v) => `${v > 0 ? "+" : ""}${v} st`} />
        <Slider
          label="Start trim"
          value={pad.start}
          min={0}
          max={0.95}
          step={0.005}
          onChange={(start) => looper.setPad(selected, { start: Math.min(start, pad.end - 0.01) })}
          format={(v) => `${(v * (looper.padBuffer(selected)?.duration ?? 0)).toFixed(2)} s`}
        />
        <Slider label="Fade out" value={pad.fadeOut} min={0} max={2} step={0.01} onChange={(fadeOut) => looper.setPad(selected, { fadeOut })} format={(v) => `${Math.round(v * 1000)} ms`} />
        <Slider label="Filter" value={pad.filter} min={0} max={1} step={0.01} onChange={(filter) => looper.setPad(selected, { filter })} format={(v) => (v > 0.97 ? "Open" : `${Math.round(v * 100)}%`)} />
        <Slider label="Reverb send" value={pad.reverb} min={0} max={1} step={0.01} onChange={(reverb) => looper.setPad(selected, { reverb })} format={(v) => `${Math.round(v * 100)}%`} />
        {pad.mode === "loop" && (
          <Slider
            label="Loop length"
            value={pad.bars}
            min={0}
            max={16}
            step={1}
            onChange={(bars) => looper.setPad(selected, { bars })}
            format={(v) => (v === 0 ? "Auto" : `${v} ${v === 1 ? "bar" : "bars"}`)}
          />
        )}
        <div>
          <div className="voice-label" style={{ marginBottom: 8 }}>
            Plays in scene
          </div>
          <div className="scene-chips" role="group" aria-label="Scenes this pad plays in">
            {SCENE_NAMES.map((name, s) => {
              const on = looper.scenes[s][selected];
              return (
                <button key={name} type="button" aria-pressed={on} className={`voice-chip ${on ? "on" : ""}`} onClick={() => looper.setSceneMember(s, selected, !on)}>
                  {name}
                </button>
              );
            })}
          </div>
        </div>
        <div className="kit-group">
          <div className="voice-label">Kit</div>
          <ParamControl instrument={looper} id="level" />
          <ParamControl instrument={looper} id="launch" label="Loops start on" />
          <ParamControl instrument={looper} id="reverb" />
          <ParamControl instrument={looper} id="bounceBars" />
        </div>
      </div>
    </>
  );

  return (
    <InstrumentShell
      instrument={looper}
      title="Looper"
      tagline={`16 pads · plays on track ${trackName} · ${bpm} BPM`}
      rightPanel={right}
      onBounce={() => {
        setBusy(true);
        void bounceLooper(looper).finally(() => setBusy(false));
      }}
      bounceBusy={busy}
      footerExtra={
        <>
          <Button variant={recording === selected ? "primary" : "ghost"} onClick={() => void looper.togglePadRecording(selected)}>
            <span style={{ width: 12, height: 12, borderRadius: "50%", background: "var(--pink)" }} aria-hidden="true" />
            {recording === selected ? "Stop recording" : "Record into pad"}
          </Button>
          <Button
            variant={looper.performanceRecording ? "primary" : "ghost"}
            onClick={() => (looper.performanceRecording ? looper.stopPerformanceRecord() : looper.startPerformanceRecord())}
          >
            {looper.performanceRecording ? "Stop performance" : "Record performance"}
          </Button>
          {looper.performance.length > 0 && !looper.performanceRecording && (
            <Button variant="outline" onClick={() => looper.clearPerformance()}>
              Clear performance
            </Button>
          )}
          <span className="voice-note" style={{ marginLeft: "auto" }}>
            Samples saved with the project
          </span>
        </>
      }
    >
      <div className="voice-surface" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
        <div className="voice-bar">
          <div className="scene-seg voice-seg-amber">
            <span className="voice-label">Scene</span>
            <Seg
              label="Scene"
              value={scene ?? -1}
              options={[...Array.from({ length: SCENES }, (_, s) => ({ value: s, label: SCENE_NAMES[s] })), { value: -1, label: "Off" }]}
              onChange={(s) => looper.setPattern(s < 0 ? null : s)}
            />
          </div>
          <span className="spacer" />
          <span className="key-badge">
            <i aria-hidden="true" />
            Computer keys play pads while this room is open
          </span>
        </div>
        <PadGrid
          pads={looper.pads}
          selected={selected}
          palette={PALETTE}
          recordingPad={recording}
          stateOf={(i) => looper.padState(i)}
          onDown={(i) => {
            setSelected(i);
            looper.noteOn({ note: PAD_BASE_NOTE + i, velocity: 0.9 });
          }}
          onUp={(i) => looper.noteOff(PAD_BASE_NOTE + i)}
        />
        <div className="wave-card">
          <div className="wave-head">
            <span className="wave-title">{loaded ? pad.name || `Pad ${selected + 1}` : "Empty pad"}</span>
            <span className="mono voice-note">
              {loaded ? `${seconds.toFixed(2)} s · ${pad.slices.length > 0 ? `${pad.slices.length + 1} slices` : "no slices"}` : "Drop a sample here or record into it"}
            </span>
            <span style={{ flex: 1 }} />
            <Button onClick={() => picker.current?.click()}>Load sample</Button>
            <Button onClick={() => looper.sliceAuto(selected)} disabled={!loaded}>
              Auto-slice
            </Button>
            <Button onClick={() => looper.toggleReverse(selected)} disabled={!loaded}>
              {pad.reverse ? "Forward" : "Reverse"}
            </Button>
            <Button variant="danger" onClick={() => looper.clearPad(selected)} disabled={!loaded}>
              Clear pad
            </Button>
          </div>
          <Waveform buffer={looper.padBuffer(selected)} pad={pad} color={color} onChange={(patch) => looper.setPad(selected, patch)} />
        </div>
        <input
          ref={picker}
          className="voice-hidden-input"
          type="file"
          accept="audio/*"
          aria-label="Choose a sample for the selected pad"
          tabIndex={-1}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void looper.loadPadFile(selected, file);
          }}
        />
      </div>
    </InstrumentShell>
  );
}
