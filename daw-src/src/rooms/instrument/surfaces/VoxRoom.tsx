import { useState } from "react";
import { Vox } from "../../../audio/instruments/vox";
import type { Instrument } from "../../../audio/types";
import { projectStore } from "../../../store/project";
import { useStore } from "../../../store/store";
import { InstrumentShell } from "../InstrumentShell";
import { HwChoice } from "../synth/HwChoice";
import { bounceVox } from "../voice/bounce";
import { ParamControl } from "../voice/ParamControl";
import { ModulePanel } from "../voice/ModulePanel";
import { SidePlate } from "../voice/SidePlate";
import type { ModuleId } from "../voice/SignalChain";
import { VoxChoir } from "../voice/VoxChoir";
import { VoxKeys } from "../voice/VoxKeys";
import { VoxPadSettings, VoxPads } from "../voice/VoxPads";
import { VoxProcess } from "../voice/VoxProcess";
import "../voice/voice.css";

type View = "proc" | "choir" | "pads" | "keys";
const VIEWS = [
  { value: "proc" as const, label: "Process" },
  { value: "choir" as const, label: "Choir" },
  { value: "pads" as const, label: "Pads" },
  { value: "keys" as const, label: "Keys" },
];
const INPUTS = [
  { value: 0, label: "Mic" },
  { value: 1, label: "File" },
];

function SidePanel({ title, blurb, ids, vox }: { title: string; blurb: string; ids: readonly string[]; vox: Vox }) {
  return (
    <SidePlate eyebrow="Editing" title={title} blurb={blurb}>
      {ids.map((id) => (
        <ParamControl key={id} instrument={vox} id={id} />
      ))}
    </SidePlate>
  );
}

export default function VoxRoom({ instrument }: { instrument: Instrument }) {
  if (!(instrument instanceof Vox)) throw new TypeError("VoxRoom needs a Vox instrument");
  const vox = instrument;
  const [view, setView] = useState<View>("proc");
  const [module, setModule] = useState<ModuleId>("tune");
  const [pad, setPad] = useState(0);
  const [busy, setBusy] = useState(false);
  const bpm = useStore(projectStore, (p) => p.bpm);
  const key = useStore(projectStore, (p) => p.key);
  const trackName = useStore(projectStore, (p) => p.tracks.find((t) => t.slotId && p.instruments.some((s) => s.id === t.slotId && s.kind === "vox"))?.name ?? "Galactic Vox");

  const side =
    view === "proc" ? (
      <ModulePanel vox={vox} module={module} />
    ) : view === "choir" ? (
      <SidePanel
        title="Choir"
        blurb="Formant filters shape each note into a sung vowel."
        ids={["choirLyrics", "choirVowel", "choirVoices", "choirAttack", "choirRelease", "choirVibRate", "choirLevel"]}
        vox={vox}
      />
    ) : view === "pads" ? (
      <VoxPadSettings vox={vox} selected={pad} />
    ) : (
      <SidePanel
        title="Keys"
        blurb="Choose what the keys play, and shape the piano and your samples."
        ids={["keysTarget", "pianoTimbre", "pianoBright", "pianoRelease", "pianoHammer", "pianoLevel", "sampAttack", "sampRelease", "sampLoop"]}
        vox={vox}
      />
    );

  return (
    <InstrumentShell
      instrument={vox}
      title="Galactic Vox"
      tagline={`Playing on track ${trackName} · ${bpm} BPM · ${key}`}
      rightPanel={side}
      onBounce={() => {
        setBusy(true);
        void bounceVox(vox).finally(() => setBusy(false));
      }}
      bounceBusy={busy}
      footerExtra={
        <>
          <button type="button" className={`hw-key led ${vox.midiRecording ? "on" : ""}`} style={{ "--lit": "var(--live)" } as React.CSSProperties} aria-pressed={vox.midiRecording} onClick={() => (vox.midiRecording ? vox.stopMidiRecord() : vox.startMidiRecord())}>
            {vox.midiRecording ? "Stop MIDI" : "Record MIDI"}
          </button>
          {vox.take.length > 0 && !vox.midiRecording && (
            <button type="button" className="hw-key" onClick={() => vox.clearTake()} data-tip="Remove the recorded MIDI take">
              Clear take ({vox.take.length})
            </button>
          )}
          <span className="hw-note foot-note" style={{ marginLeft: "auto" }}>
            Pads and key samples saved to project
          </span>
        </>
      }
    >
    <div className="vx hw-plate">
      <div className="voice-bar">
        <HwChoice label="View" value={view} options={VIEWS} onChange={setView} className="vx-views" />
        <span className="spacer" />
        <HwChoice
          label="Input"
          value={vox.getParam("source")}
          options={INPUTS}
          onChange={(source) => {
            vox.setParam("source", source);
            if (source === 0) void vox.startMic();
            else if (vox.hasFile) void vox.playFile();
            else vox.stopMic();
          }}
        />
      </div>
      {view === "proc" && <VoxProcess vox={vox} module={module} onModule={setModule} />}
      {view === "choir" && <VoxChoir vox={vox} />}
      {view === "pads" && <VoxPads vox={vox} selected={pad} onSelect={setPad} />}
      {view === "keys" && <VoxKeys vox={vox} />}
    </div>
    </InstrumentShell>
  );
}
