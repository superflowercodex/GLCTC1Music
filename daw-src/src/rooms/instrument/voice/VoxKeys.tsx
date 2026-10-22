import { useRef } from "react";
import type { Vox } from "../../../audio/instruments/vox";
import { describeRange, zoneRanges } from "../../../audio/instruments/voice/sampler";
import { noteName } from "../../../audio/instruments/voice/scales";
import { Button, IconButton } from "../../../ui/controls";
import { PianoStrip } from "./PianoStrip";

const COLORS = ["#8e7cff", "#7cf0c0", "#79ebff", "#ff63d8", "#ffd36a"];
const LOW = 24;
const HIGH = 108;

export function VoxKeys({ vox }: { vox: Vox }) {
  const picker = useRef<HTMLInputElement>(null);
  const zones = vox.zones;
  const ranges = zoneRanges(zones.map((z) => z.root));
  const pct = (note: number) => ((Math.min(HIGH, Math.max(LOW, note)) - LOW) / (HIGH - LOW)) * 100;

  return (
    <div
      className="voice-surface"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith("audio/"));
        if (files.length > 0) void vox.addSamples(files);
      }}
    >
      <div className="voice-label">Each sample plays across the keys it covers</div>
      <div className="zone-strip" role="img" aria-label="Key zones of your samples">
        {zones.length === 0 && <div className="wave-empty">No samples yet. The piano plays the keys.</div>}
        {zones.map((zone, i) => {
          const color = COLORS[i % COLORS.length];
          const left = pct(ranges[i].lo);
          const right = pct(ranges[i].hi + 1);
          return (
            <div
              key={zone.assetId + i}
              className="zone"
              style={{ left: `${left}%`, width: `calc(${Math.max(1, right - left)}% - 4px)`, background: `linear-gradient(180deg, ${color}55, ${color}1c)`, boxShadow: `inset 0 0 0 1px ${color}88` }}
            >
              {zone.name}
            </div>
          );
        })}
      </div>
      <div className="sample-list scroll-y">
        {zones.map((zone, i) => (
          <div className="sample-row" key={zone.assetId + i}>
            <span className="dot" style={{ background: COLORS[i % COLORS.length] }} />
            <span className="name">{zone.name}</span>
            <span className="range mono">{describeRange(ranges[i])}</span>
            <div className="stepper" role="group" aria-label={`Root key of ${zone.name}`}>
              <IconButton icon="back" label="Root note down" onClick={() => vox.setZoneRoot(i, zone.root - 1)} />
              <span className="root mono">{noteName(zone.root)}</span>
              <IconButton icon="next" label="Root note up" onClick={() => vox.setZoneRoot(i, zone.root + 1)} />
            </div>
            <IconButton icon="trash" label={`Remove ${zone.name}`} onClick={() => vox.removeZone(i)} />
          </div>
        ))}
      </div>
      <div className="voice-bar">
        <Button onClick={() => picker.current?.click()}>+ Add a sample</Button>
        {zones.length > 0 && (
          <Button variant="danger" onClick={() => vox.clearZones()}>
            Clear key samples
          </Button>
        )}
        <span className="spacer" />
        <span className="voice-note">Drop audio files here. The root key is detected; correct it with the arrows.</span>
        <input
          ref={picker}
          className="voice-hidden-input"
          type="file"
          accept="audio/*"
          multiple
          aria-label="Choose samples for the keys"
          tabIndex={-1}
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = "";
            if (files.length > 0) void vox.addSamples(files);
          }}
        />
      </div>
      <PianoStrip onNoteOn={(note, velocity) => vox.noteOn({ note, velocity })} onNoteOff={(note) => vox.noteOff(note)} />
    </div>
  );
}
