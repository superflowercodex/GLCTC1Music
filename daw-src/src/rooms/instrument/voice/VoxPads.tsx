import { useRef } from "react";
import type { Vox } from "../../../audio/instruments/vox";
import { hasSample } from "../../../audio/instruments/voice/padPlayer";
import { Button, Seg, Slider } from "../../../ui/controls";
import { useComputerKeys } from "./hooks";
import { PAD_KEYS, PadGrid } from "./PadGrid";
import { ParamControl } from "./ParamControl";

const MODES = [
  { value: "shot" as const, label: "One-shot" },
  { value: "gate" as const, label: "Hold" },
  { value: "loop" as const, label: "Loop" },
];

export function VoxPads({ vox, selected, onSelect }: { vox: Vox; selected: number; onSelect: (i: number) => void }) {
  const picker = useRef<HTMLInputElement>(null);
  const recording = vox.recordingPad;

  useComputerKeys(
    true,
    (key) => {
      const i = PAD_KEYS.indexOf(key as (typeof PAD_KEYS)[number]);
      if (i < 0) return;
      onSelect(i);
      vox.triggerPad(i, 0.9);
    },
    (key) => {
      const i = PAD_KEYS.indexOf(key as (typeof PAD_KEYS)[number]);
      if (i >= 0) vox.releasePad(i);
    },
  );

  return (
    <div className="voice-surface">
      <PadGrid
        pads={vox.padData}
        selected={selected}
        recordingPad={recording}
        stateOf={(i) => (vox.isPadPlaying(i) ? "playing" : "idle")}
        onDown={(i) => {
          onSelect(i);
          vox.triggerPad(i);
        }}
        onUp={(i) => vox.releasePad(i)}
      />
      <div className="voice-bar">
        <Button onClick={() => void vox.togglePadRecording(selected)} variant={recording === selected ? "primary" : "ghost"}>
          {recording === selected ? "Stop recording" : "Record into pad"}
        </Button>
        <Button onClick={() => picker.current?.click()}>Load sample</Button>
        <Button variant="danger" onClick={() => vox.clearPad(selected)} disabled={!hasSample(vox.padData[selected])}>
          Clear pad
        </Button>
        <span className="spacer" />
        <span className="voice-note">Pads are saved with the project</span>
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
            if (file) void vox.loadPadFile(selected, file);
          }}
        />
      </div>
    </div>
  );
}

export function VoxPadSettings({ vox, selected }: { vox: Vox; selected: number }) {
  const pad = vox.padData[selected];
  const loaded = hasSample(pad);
  return (
    <>
      <div>
        <div className="voice-label">Pad {selected + 1}</div>
        <div className="module-title">{loaded ? pad.name || `Pad ${selected + 1}` : "Empty pad"}</div>
        <div className="module-blurb">{loaded ? "Press the pad or its key to play it." : "Load a sample or record into this pad."}</div>
      </div>
      <div className="module-body scroll-y amber-sliders mint-sliders" style={{ flex: 1 }}>
        <div>
          <div className="slider-head">
            <span>Play mode</span>
          </div>
          <Seg label="Play mode" value={pad.mode} options={MODES} onChange={(mode) => vox.setPad(selected, { mode })} />
        </div>
        <Slider label="Pad volume" value={pad.volume} min={0} max={1.5} step={0.01} onChange={(volume) => vox.setPad(selected, { volume })} format={(v) => `${Math.round(v * 100)}%`} />
        <Slider label="Pad pitch" value={pad.pitch} min={-24} max={24} step={1} onChange={(pitch) => vox.setPad(selected, { pitch })} format={(v) => `${v > 0 ? "+" : ""}${v} st`} />
        <Slider label="Reverb send" value={pad.reverb} min={0} max={1} step={0.01} onChange={(reverb) => vox.setPad(selected, { reverb })} format={(v) => `${Math.round(v * 100)}%`} />
        <ParamControl instrument={vox} id="padLevel" />
        <Button variant="danger" onClick={() => vox.clearAllPads()}>
          Clear all pads
        </Button>
      </div>
    </>
  );
}
