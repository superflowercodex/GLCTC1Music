import { useState, type ReactNode } from "react";
import type { Instrument } from "../../audio/types";
import { uiStore } from "../../store/project";
import { Button, IconButton, Panel } from "../../ui/controls";
import { useInstrument } from "../../ui/hooks";
import { Icon } from "../../ui/Icon";
import { RoomFrame } from "../../ui/RoomFrame";
import { ParamPanel } from "./ParamPanel";
import { PresetList } from "./PresetList";

export interface ShellProps {
  instrument: Instrument;
  title: string;
  tagline: string;
  /** The play surface: sequencer, pads, keys. Fills the middle column. */
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

/** The one layout every instrument opens in: presets left, play surface centre, sound right, record and bounce below. */
export function InstrumentShell({ instrument, title, tagline, children, rightPanel, paramGroups, onBounce, bounceBusy, footerExtra }: ShellProps) {
  useInstrument(instrument);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
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
          <a className="back-link" href="#/play" aria-label="Back to instruments">
            <Icon name="back" size={22} />
          </a>
          <IconButton icon="back" label="Previous preset" onClick={() => step(-1)} />
          <span style={{ minWidth: 160, textAlign: "center", fontWeight: 700 }}>{presets[index]?.name ?? "Custom"}</span>
          <IconButton icon="next" label="Next preset" onClick={() => step(1)} />
          {saving ? (
            <form
              style={{ display: "flex", gap: 8 }}
              onSubmit={(e) => {
                e.preventDefault();
                if (name.trim()) instrument.saveUserPreset(name.trim());
                setName("");
                setSaving(false);
              }}
            >
              <input
                className="btn"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Preset name"
                aria-label="Preset name"
                style={{ background: "rgba(255,255,255,.09)", border: 0, color: "inherit" }}
              />
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
          <Button onClick={() => uiStore.set((s) => ({ ...s, sheet: "record" }))}>Record audio</Button>
          <Button variant="primary" onClick={onBounce} disabled={!onBounce || bounceBusy}>
            {bounceBusy ? "Bouncing…" : "Bounce to track"}
          </Button>
        </>
      }
    >
      <div className="inst">
        <Panel as="aside" label="Presets">
          <PresetList instrument={instrument} />
        </Panel>
        <Panel label="Play surface">{children}</Panel>
        <Panel as="aside" label="Sound" className="glass">
          {rightPanel ?? <ParamPanel instrument={instrument} only={paramGroups} />}
        </Panel>
      </div>
    </RoomFrame>
  );
}
