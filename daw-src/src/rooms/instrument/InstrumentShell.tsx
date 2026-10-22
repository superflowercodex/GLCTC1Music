import { useState, type ReactNode } from "react";
import type { Instrument } from "../../audio/types";
import { Button, IconButton, Seg } from "../../ui/controls";
import { isCompact, useLayoutMode } from "../../ui/layoutMode";
import { Display, Faceplate } from "../../ui/hardware";
import { useInstrument } from "../../ui/hooks";
import { Icon } from "../../ui/Icon";
import { RoomFrame } from "../../ui/RoomFrame";
import { ParamPanel } from "./ParamPanel";
import { PresetList } from "./PresetList";

type Pane = "presets" | "play" | "sound";
const PANES: ReadonlyArray<{ value: Pane; label: string }> = [
  { value: "presets", label: "Presets" },
  { value: "play", label: "Play" },
  { value: "sound", label: "Sound" },
];

export interface ShellProps {
  instrument: Instrument;
  title: string;
  tagline: string;
  /** The play surface: sequencer, pads, keys. Fills the middle plate. */
  children: ReactNode;
  /** Replaces the automatic parameter panel when an instrument needs its own right-hand side. */
  rightPanel?: ReactNode;
  /** Restricts the automatic panel to these parameter groups. */
  paramGroups?: readonly string[];
  onBounce?: () => void;
  bounceBusy?: boolean;
  /** Extra buttons next to the standard footer ones. */
  footerExtra?: ReactNode;
}

/**
 * The cockpit every instrument sits in: three holographic glass panes (presets, play surface, sound) in the
 * instrument colour, resting raised over the nebula, a glowing preset readout in the header, record
 * and bounce in the transport.
 */
export function InstrumentShell({ instrument, title, tagline, children, rightPanel, paramGroups, onBounce, bounceBusy, footerExtra }: ShellProps) {
  useInstrument(instrument);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  // Phones and tablets show one pane at a time (Presets / Play / Sound) instead of three side by side; Play first.
  const phone = isCompact(useLayoutMode());
  const [pane, setPane] = useState<Pane>("play");
  const presets = instrument.presets;
  const index = presets.findIndex((p) => p.id === instrument.serialize().presetId);

  const step = (delta: number) => {
    if (presets.length === 0) return;
    const next = (index + delta + presets.length) % presets.length;
    instrument.loadPreset(presets[next].id);
  };

  return (
    <RoomFrame
      eyebrow={tagline}
      title={title}
      actions={
        <>
          <a className="back-link" href="#/play" aria-label="Back to instruments" data-tip="All instruments">
            <Icon name="back" size={20} />
          </a>
          <div className="preset-stepper" role="group" aria-label="Preset">
            <IconButton icon="back" label="Previous preset" size={18} onClick={() => step(-1)} />
            <Display size="sm" label={index < 0 ? "Preset · edited" : "Preset"} value={presets[index]?.name ?? "Custom"} dim={index < 0} align="start" className="preset-lcd" />
            <IconButton icon="next" label="Next preset" size={18} onClick={() => step(1)} />
          </div>
          {saving ? (
            <form
              className="preset-save"
              onSubmit={(e) => {
                e.preventDefault();
                if (name.trim()) instrument.saveUserPreset(name.trim());
                setName("");
                setSaving(false);
              }}
            >
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setSaving(false)} placeholder="Preset name" aria-label="Preset name" />
              <button type="submit" className="btn btn-primary">
                Save
              </button>
            </form>
          ) : (
            <Button onClick={() => setSaving(true)}>Save as…</Button>
          )}
        </>
      }
      footerExtra={
        <>
          {footerExtra}
          <Button variant="primary" onClick={onBounce} disabled={!onBounce || bounceBusy}>
            {bounceBusy ? "Bouncing…" : "Bounce to track"}
          </Button>
        </>
      }
    >
      {phone && <Seg label="Instrument section" options={PANES} value={pane} onChange={setPane} className="inst-panes" color="var(--a1)" />}
      <div className="inst" data-pane={phone ? pane : undefined}>
        <Faceplate as="aside" label="Presets">
          <PresetList instrument={instrument} />
        </Faceplate>
        <Faceplate label="Play surface">
          {children}
        </Faceplate>
        <Faceplate as="aside" label="Sound">
          {rightPanel ?? <ParamPanel instrument={instrument} only={paramGroups} />}
        </Faceplate>
      </div>
    </RoomFrame>
  );
}
