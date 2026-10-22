import type { DrumBase } from "../../../audio/instruments/drums/drumBase";
import { Button } from "../../../ui/controls";
import { useInstrument } from "../../../ui/hooks";
import { useSampleSlot } from "./useSampleSlot";

/** Drop, choose or record a sample for one slot, and clear it again. */
export function SampleDrop({ instrument, slot, title, hint }: { instrument: DrumBase; slot: number; title: string; hint: string }) {
  useInstrument(instrument);
  const s = useSampleSlot(instrument, slot);
  const ref = instrument.sampleRef(slot);
  return (
    <div className={`drop ${s.over ? "over" : ""}`} {...s.dropProps}>
      <div className="drop-title">{ref ? ref.name : title}</div>
      <p className="drop-note drum-note">{ref ? "Saved with the project. Drop another file to replace it." : hint}</p>
      <div className="drop-actions">
        <Button variant="primary" onClick={s.choose} disabled={s.busy}>
          {s.busy ? "Loading…" : ref ? "Replace…" : "Choose file…"}
        </Button>
        <Button onClick={() => void s.toggleRecord()}>
          <span className={`rec-dot ${s.recording ? "live" : ""}`} />
          {s.recording ? "Stop and keep" : "Record"}
        </Button>
        {ref && (
          <Button onClick={() => instrument.hitVoice(slot, 0.9)} title="Play the sample">
            Preview
          </Button>
        )}
        {ref && (
          <Button variant="danger" onClick={s.clear}>
            Clear
          </Button>
        )}
      </div>
    </div>
  );
}

/** A compact sample slot for the Divine09 sound panel: click to load, drop a file, clear with the x. */
export function SampleChip({ instrument, slot, label }: { instrument: DrumBase; slot: number; label: string }) {
  useInstrument(instrument);
  const s = useSampleSlot(instrument, slot);
  const ref = instrument.sampleRef(slot);
  return (
    <div style={{ display: "flex", gap: 4 }} {...s.dropProps}>
      <button type="button" className={`smp ${ref ? "has" : ""} ${s.over ? "over" : ""}`} style={{ flex: 1 }} onClick={s.choose} title={ref ? `${ref.name}: click to replace` : `${label}: click or drop a file`} disabled={s.busy}>
        {s.busy ? "Loading…" : ref ? ref.name : "+ Drop"}
      </button>
      {ref && (
        <button type="button" className="icon-btn" aria-label={`Clear ${label}`} onClick={s.clear}>
          ×
        </button>
      )}
    </div>
  );
}
