import { useState } from "react";
import { audibleTrackIds } from "../audio/mixMath";
import { projectStore, uiStore } from "../store/project";
import { useStore } from "../store/store";
import { RoomFrame } from "../ui/RoomFrame";
import { Panel, Seg } from "../ui/controls";
import { EffectsTab } from "./mixer/EffectsTab";
import { MasterStrip } from "./mixer/MasterStrip";
import { OutputsTab } from "./mixer/OutputsTab";
import { Strip } from "./mixer/Strip";
import "./mixer/mixer.css";

type Tab = "levels" | "effects" | "outputs";

const TABS: ReadonlyArray<{ value: Tab; label: string }> = [
  { value: "levels", label: "Levels" },
  { value: "effects", label: "Effects" },
  { value: "outputs", label: "Outputs" },
];

function Levels() {
  const tracks = useStore(projectStore, (p) => p.tracks);
  const selected = useStore(uiStore, (s) => s.selectedTrackId);
  const audible = audibleTrackIds(tracks);
  if (tracks.length === 0) {
    return <p className="mixer-empty">No tracks yet. Add one in Arrange or open an instrument in Play, and its strip appears here.</p>;
  }
  return (
    <div className="strips" role="group" aria-label="Channel strips">
      {tracks.map((t) => (
        <Strip key={t.id} track={t} dimmed={!audible.has(t.id)} selected={selected === t.id} />
      ))}
    </div>
  );
}

export default function Mixer() {
  const name = useStore(projectStore, (p) => p.name);
  const [tab, setTab] = useState<Tab>("levels");
  return (
    <RoomFrame eyebrow={name} title="Mixer" actions={<Seg label="Mixer view" options={TABS} value={tab} onChange={setTab} />}>
      <div className="mixer-body">
        <Panel className="mixer-main" label="Channels">
          {tab === "levels" && <Levels />}
          {tab === "effects" && <EffectsTab />}
          {tab === "outputs" && <OutputsTab />}
        </Panel>
        <MasterStrip />
      </div>
    </RoomFrame>
  );
}
