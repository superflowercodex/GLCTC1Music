import type { Instrument } from "../../../audio/types";

export type ModuleId = "input" | "gate" | "comp" | "tune" | "harm" | "voc" | "fx";

export const MODULES: ReadonlyArray<{ id: ModuleId; name: string; power: string; blurb: string }> = [
  { id: "input", name: "Input", power: "monitor", blurb: "Mic or file in, with level and monitoring." },
  { id: "gate", name: "Gate", power: "gateOn", blurb: "Silences the mic between phrases." },
  { id: "comp", name: "Compressor", power: "compOn", blurb: "Evens out loud and quiet words." },
  { id: "tune", name: "Auto-tune", power: "tuneOn", blurb: "Snaps your voice to the project key." },
  { id: "harm", name: "Harmoniser", power: "harmOn", blurb: "Up to three extra voices at set intervals." },
  { id: "voc", name: "Vocoder", power: "vocOn", blurb: "Turns your voice into a playable synth." },
  { id: "fx", name: "Effects", power: "fxOn", blurb: "Delay, reverb and space modulation." },
];

/** The processing chain as chips: tap a name to edit it, tap the dot to switch it on or off. */
export function SignalChain({
  instrument,
  selected,
  onSelect,
}: {
  instrument: Instrument;
  selected: ModuleId;
  onSelect: (id: ModuleId) => void;
}) {
  return (
    <div>
      <div className="chain-title">Signal chain · tap to edit, switch to bypass</div>
      <div className="chain" role="list">
        {MODULES.map((m, i) => {
          const on = instrument.getParam(m.power) === 1;
          return (
            <div className="chain-item" role="listitem" key={m.id}>
              <div className={`chain-chip ${on ? "" : "off"} ${selected === m.id ? "sel" : ""}`}>
                <button type="button" className="chain-main" aria-pressed={selected === m.id} onClick={() => onSelect(m.id)}>
                  {m.name}
                </button>
                <button
                  type="button"
                  className="chain-power"
                  role="switch"
                  aria-checked={on}
                  aria-label={`Switch ${m.name} on or off`}
                  onClick={() => instrument.setParam(m.power, on ? 0 : 1)}
                >
                  <span className="chain-dot" />
                </button>
              </div>
              {i < MODULES.length - 1 && (
                <span className="chain-arrow" aria-hidden="true">
                  ›
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
