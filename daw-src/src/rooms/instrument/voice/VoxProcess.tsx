import { useState, type DragEvent } from "react";
import type { Vox } from "../../../audio/instruments/vox";
import { NOTE_NAMES } from "../../../audio/instruments/voice/scales";
import { projectStore } from "../../../store/project";
import { useStore } from "../../../store/store";
import { LevelRow, PitchView } from "./PitchView";
import { SignalChain, type ModuleId } from "./SignalChain";

function status(vox: Vox): string {
  if (vox.micActive) return "Mic live · use headphones";
  if (vox.filePlaying) return `Playing ${vox.inputName ?? "file"}`;
  if (vox.hasFile) return `${vox.inputName ?? "File"} loaded · press Play file`;
  return "Start the mic or drop an audio file here to see your pitch";
}

export function VoxProcess({ vox, module, onModule }: { vox: Vox; module: ModuleId; onModule: (id: ModuleId) => void }) {
  const [dropping, setDropping] = useState(false);
  useStore(projectStore, (p) => p.key);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDropping(false);
    const file = [...e.dataTransfer.files].find((f) => f.type.startsWith("audio/"));
    if (file) void vox.loadInputFile(file).then(() => vox.playFile());
  };

  return (
    <>
      <div
        className="voice-surface"
        style={{ flex: "1 1 auto" }}
        onDragOver={(e) => {
          e.preventDefault();
          setDropping(true);
        }}
        onDragLeave={() => setDropping(false)}
        onDrop={onDrop}
      >
        <PitchView vox={vox} status={status(vox)} dropping={dropping} />
        <LevelRow vox={vox} />
        <SignalChain instrument={vox} selected={module} onSelect={onModule} />
        <div className="hw-note">
          Tuning to {NOTE_NAMES[vox.key.root]} {vox.key.scale}. Change the key in the project settings.
        </div>
      </div>
    </>
  );
}
