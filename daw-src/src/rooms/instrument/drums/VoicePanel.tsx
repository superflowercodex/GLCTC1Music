import { useRef, type CSSProperties, type ReactNode } from "react";
import type { DrumBase } from "../../../audio/instruments/drums/drumBase";
import { Button } from "../../../ui/controls";
import { useInstrument } from "../../../ui/hooks";
import { useEdgeFade } from "../../../ui/useEdgeFade";
import { MuteSolo, ParamControl } from "./ParamControl";
import { useSampleSlot } from "./useSampleSlot";

interface Props {
  instrument: DrumBase;
  voice: number;
  /** Which sample slot this voice uses, or null when it cannot take a sample. */
  slot: number | null;
  name: string;
  color: string;
  subtitle: string;
  /** Parameter keys after `v<n>.`, in the order shown. */
  keys: readonly string[];
  /** Extra controls above the sliders, such as a profile picker. */
  before?: ReactNode;
  /** Extra controls under the sliders. */
  after?: ReactNode;
  swapLabel?: string;
}

/** The right-hand sound panel: only the selected voice's controls, with a preview and a sample swap. */
export function VoicePanel({ instrument, voice, slot, name, color, subtitle, keys, before, after, swapLabel = "Swap for a sample" }: Props) {
  useInstrument(instrument);
  const sample = useSampleSlot(instrument, slot ?? 0);
  const body = useRef<HTMLDivElement>(null);
  useEdgeFade(body, "y");
  return (
    <div className="vp" style={{ "--c": color } as CSSProperties}>
      <div className="vp-head">
        <span className="vp-dot" />
        <div>
          <div className="vp-title">{name}</div>
          <div className="vp-sub">{subtitle}</div>
        </div>
      </div>
      <div className="vp-body scroll-y fade-y knob-grid" ref={body}>
        {before}
        {keys.map((k) => (
          <ParamControl key={k} instrument={instrument} id={`v${voice}.${k}`} color={color} />
        ))}
        <MuteSolo instrument={instrument} voice={voice} />
        {after}
      </div>
      <div className="vp-foot">
        <Button onClick={() => instrument.hitVoice(voice, 0.9)}>Preview</Button>
        {slot !== null && (
          <Button onClick={sample.choose} disabled={sample.busy}>
            {sample.busy ? "Loading…" : swapLabel}
          </Button>
        )}
      </div>
    </div>
  );
}
