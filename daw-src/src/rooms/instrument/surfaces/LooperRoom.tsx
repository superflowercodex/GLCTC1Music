import { useRef, useState, type DragEvent } from "react";
import { Looper, PAD_BASE_NOTE } from "../../../audio/instruments/looper";
import { SCENES } from "../../../audio/instruments/voice/looperKits";
import { hasSample, type PadMode } from "../../../audio/instruments/voice/padPlayer";
import type { Instrument } from "../../../audio/types";
import { projectStore } from "../../../store/project";
import { useStore } from "../../../store/store";
import { Caption } from "../../../ui/Caption";
import { Knob } from "../../../ui/Knob";
import { InstrumentShell } from "../InstrumentShell";
import { HwChoice } from "../synth/HwChoice";
import { bounceLooper } from "../voice/bounce";
import { useComputerKeys } from "../voice/hooks";
import { PAD_KEYS, PadGrid } from "../voice/PadGrid";
import { ParamControl } from "../voice/ParamControl";
import { SidePlate } from "../voice/SidePlate";
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
    <SidePlate eyebrow={`Pad ${selected + 1}`} title={loaded ? pad.name || `Pad ${selected + 1}` : "Empty pad"}>
      <div>
        <Caption as="div" className="sy-fieldhead">
          When you press it
        </Caption>
        <HwChoice label="Pad mode" value={pad.mode} options={MODES} onChange={(mode) => looper.setPad(selected, { mode })} wrap />
        <div className="hw-note" style={{ marginTop: 10 }}>
          {HELP[pad.mode]}
        </div>
      </div>
      <Knob label="Volume" value={pad.volume} min={0} max={1.5} step={0.01} defaultValue={1} onChange={(volume) => looper.setPad(selected, { volume })} format={dB} />
      <Knob label="Pitch" value={pad.pitch} min={-24} max={24} step={1} onChange={(pitch) => looper.setPad(selected, { pitch })} format={(v) => `${v > 0 ? "+" : ""}${v} st`} />
      <Knob
        label="Start trim"
        value={pad.start}
        min={0}
        max={0.95}
        step={0.005}
        onChange={(start) => looper.setPad(selected, { start: Math.min(start, pad.end - 0.01) })}
        format={(v) => `${(v * (looper.padBuffer(selected)?.duration ?? 0)).toFixed(2)} s`}
      />
      <Knob label="Fade out" value={pad.fadeOut} min={0} max={2} step={0.01} defaultValue={0.02} onChange={(fadeOut) => looper.setPad(selected, { fadeOut })} format={(v) => `${Math.round(v * 1000)} ms`} />
      <Knob label="Filter" value={pad.filter} min={0} max={1} step={0.01} defaultValue={1} onChange={(filter) => looper.setPad(selected, { filter })} format={(v) => (v > 0.97 ? "Open" : `${Math.round(v * 100)}%`)} />
      <Knob label="Reverb send" value={pad.reverb} min={0} max={1} step={0.01} onChange={(reverb) => looper.setPad(selected, { reverb })} format={(v) => `${Math.round(v * 100)}%`} />
      {pad.mode === "loop" && (
        <Knob
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
        <Caption as="div" className="sy-fieldhead">
          Plays in scene
        </Caption>
        <div className="scene-chips" role="group" aria-label="Scenes this pad plays in">
          {SCENE_NAMES.map((name, s) => {
            const on = looper.scenes[s][selected];
            return (
              <button key={name} type="button" aria-pressed={on} className={`hw-key sq ${on ? "on" : ""}`} onClick={() => looper.setSceneMember(s, selected, !on)}>
                {name}
              </button>
            );
          })}
        </div>
      </div>
      <div className="kit-group knob-grid">
        <div className="hw-title">Kit</div>
        <ParamControl instrument={looper} id="level" />
        <ParamControl instrument={looper} id="launch" label="Loops start on" />
        <ParamControl instrument={looper} id="reverb" />
        <ParamControl instrument={looper} id="bounceBars" />
      </div>
    </SidePlate>
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
          <button type="button" className={`hw-key sm led ${recording === selected ? "on" : ""}`} aria-label={recording === selected ? "Stop recording" : "Record into pad"} style={{ "--lit": "var(--live)" } as React.CSSProperties} aria-pressed={recording === selected} onClick={() => void looper.togglePadRecording(selected)}>
            {recording === selected ? "Stop rec" : "Rec pad"}
          </button>
          <button
            type="button"
            className={`hw-key sm led ${looper.performanceRecording ? "on" : ""}`}
            aria-label={looper.performanceRecording ? "Stop performance" : "Record performance"}
            style={{ "--lit": "var(--live)" } as React.CSSProperties}
            aria-pressed={looper.performanceRecording}
            onClick={() => (looper.performanceRecording ? looper.stopPerformanceRecord() : looper.startPerformanceRecord())}
          >
            {looper.performanceRecording ? "Stop perf" : "Rec performance"}
          </button>
          {looper.performance.length > 0 && !looper.performanceRecording && (
            <button type="button" className="hw-key sm" onClick={() => looper.clearPerformance()}>
              Clear
            </button>
          )}
          <span className="hw-note foot-note" style={{ marginLeft: "auto" }}>
            Samples saved with the project
          </span>
        </>
      }
    >
      <div className="voice-surface hw-plate" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
        <div className="voice-bar">
          <div className="scene-seg">
            <span className="voice-label">Scene</span>
            <HwChoice
              label="Scene"
              value={scene ?? -1}
              options={[...Array.from({ length: SCENES }, (_, s) => ({ value: s, label: SCENE_NAMES[s] })), { value: -1, label: "Off" }]}
              onChange={(s) => looper.setPattern(s < 0 ? null : s)}
              className="lp-scenes"
            />
          </div>
          <span className="spacer" />
          <span className="key-badge">
            <i className="hw-led on" style={{ "--lit": "var(--a1)" } as React.CSSProperties} aria-hidden="true" />
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
            <span className="hw-note">
              {loaded ? `${seconds.toFixed(2)} s · ${pad.slices.length > 0 ? `${pad.slices.length + 1} slices` : "no slices"}` : "Drop a sample here or record into it"}
            </span>
            <span style={{ flex: 1 }} />
            <button type="button" className="hw-key sm" onClick={() => picker.current?.click()}>
              Load sample
            </button>
            <button type="button" className="hw-key sm" onClick={() => looper.sliceAuto(selected)} disabled={!loaded}>
              Auto-slice
            </button>
            <button type="button" className={`hw-key sm ${pad.reverse ? "on" : ""}`} aria-pressed={pad.reverse} onClick={() => looper.toggleReverse(selected)} disabled={!loaded}>
              Reverse
            </button>
            <button type="button" className="hw-key sm" onClick={() => looper.clearPad(selected)} disabled={!loaded}>
              Clear pad
            </button>
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
