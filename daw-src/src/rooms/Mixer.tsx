import { useRef, useState } from "react";
import { audibleTrackIds } from "../audio/mixMath";
import { projectStore, uiStore } from "../store/project";
import { useStore } from "../store/store";
import { Caption } from "../ui/Caption";
import { RoomFrame } from "../ui/RoomFrame";
import { Seg } from "../ui/controls";
import { Faceplate } from "../ui/hardware";
import { useEdgeFade } from "../ui/useEdgeFade";
import { EffectsTab } from "./mixer/EffectsTab";
import { MasterStrip } from "./mixer/MasterStrip";
import { OutputsTab } from "./mixer/OutputsTab";
import { Strip } from "./mixer/Strip";
import { useLayoutMode } from "../ui/layoutMode";
import "./mixer/mixer.css";

type Tab = "levels" | "effects" | "outputs" | "master";

const TABS: ReadonlyArray<{ value: Tab; label: string }> = [
  { value: "levels", label: "Levels" },
  { value: "effects", label: "Effects" },
  { value: "outputs", label: "Outputs" },
];
/** Phones have no room for the Master beside the channels, so it becomes its own segment. */
const PHONE_TABS: ReadonlyArray<{ value: Tab; label: string }> = [...TABS, { value: "master", label: "Master" }];

const TAB_ASIDE: Record<Tab, string> = {
  levels: "Fader, pan, sends",
  effects: "Inserts and sends",
  outputs: "Devices and routing",
  master: "Master",
};

function Levels({ onOpenFx }: { onOpenFx: (trackId: string) => void }) {
  const tracks = useStore(projectStore, (p) => p.tracks);
  const selected = useStore(uiStore, (s) => s.selectedTrackId);
  const audible = audibleTrackIds(tracks);
  const scroller = useRef<HTMLDivElement>(null);
  useEdgeFade(scroller, "x");
  if (tracks.length === 0) {
    return <p className="mixer-empty">No tracks yet. Add one in Arrange or open an instrument in Play, and its strip appears here.</p>;
  }
  return (
    <div ref={scroller} className="strips" role="group" aria-label="Channel strips">
      {tracks.map((t) => (
        <Strip key={t.id} track={t} dimmed={!audible.has(t.id)} selected={selected === t.id} onOpenFx={onOpenFx} />
      ))}
    </div>
  );
}

export default function Mixer() {
  const [tab, setTab] = useState<Tab>("levels");
  const [fxFocus, setFxFocus] = useState<string | null>(null);
  const count = useStore(projectStore, (p) => p.tracks.length);
  const phone = useLayoutMode() === "phone";
  // Leaving the phone layout with Master picked falls back to the channels, where the Master sits beside them.
  const view: Tab = !phone && tab === "master" ? "levels" : tab;
  const openFx = (trackId: string): void => {
    setFxFocus(trackId);
    setTab("effects");
  };
  return (
    <RoomFrame title="Mixer" actions={<Seg label="Mixer view" options={phone ? PHONE_TABS : TABS} value={view} onChange={setTab} className="mix-tabs" />}>
      <div className="mixer-body" data-view={phone ? (view === "master" ? "master" : "channels") : undefined}>
        <Faceplate className="mixer-main" label="Channels">
          <Caption className="mixer-cap" aside={`${TAB_ASIDE[view]} · ${count} ${count === 1 ? "track" : "tracks"}`}>
            {view === "effects" ? "Effects" : view === "outputs" ? "Outputs" : "Channels"}
          </Caption>
          {view === "levels" && <Levels onOpenFx={openFx} />}
          {view === "effects" && <EffectsTab focusTrackId={fxFocus} />}
          {view === "outputs" && <OutputsTab />}
        </Faceplate>
        <MasterStrip />
      </div>
    </RoomFrame>
  );
}
